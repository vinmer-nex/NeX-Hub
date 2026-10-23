const db = require('../db');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');
const { shell } = require('electron');
const refsService = require('../lib/refs');
const { ensureThumbnail, thumbName } = require('../lib/thumbnails');
const runner = require('../scripts/runner');

function logActivity(userId, projectId, type, detail) {
  db.prepare(
    'INSERT INTO activity_log (user_id, project_id, type, detail) VALUES (?, ?, ?, ?)'
  ).run(userId, projectId, type, detail);
}

// Безопасный разбор JSON-массива из текстовой колонки
function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

const MAX_ATTACHMENTS = 100;
const MAX_NOTE_TAGS = 20;
const MAX_TAG_LEN = 32;

// Валидация тегов заметки: массив коротких уникальных строк
function sanitizeTags(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const t of arr) {
    if (typeof t !== 'string') continue;
    const tag = t.trim().slice(0, MAX_TAG_LEN);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_NOTE_TAGS) break;
  }
  return out;
}

// Валидация вложений: upload — только файлы этого проекта; path — только внутри folder_path
function sanitizeAttachments(raw, project) {
  const arr = Array.isArray(raw) ? raw : [];
  const root = project && project.folder_path ? path.resolve(project.folder_path) : null;
  const out = [];
  for (const a of arr) {
    if (!a || typeof a !== 'object') continue;
    if (a.kind === 'upload') {
      const id = parseInt(a.id, 10);
      if (!Number.isFinite(id)) continue;
      const f = db.prepare('SELECT id, original_name FROM files WHERE id = ? AND project_id = ?').get(id, project.id);
      if (f) out.push({ kind: 'upload', id: f.id, name: a.name || f.original_name });
    } else if (a.kind === 'path') {
      const p = String(a.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (root && p && resolveInside(root, p)) {
        out.push({ kind: 'path', path: p, name: a.name || p.split('/').pop() });
      }
    }
    if (out.length >= MAX_ATTACHMENTS) break;
  }
  return out;
}

// Контекст для пакетного декорирования вложений проекта (без запросов на каждое вложение)
function createAttachmentContext(project) {
  const root = project && project.folder_path ? path.resolve(project.folder_path) : null;
  const uploadIds = new Set();
  if (project && project.id) {
    const rows = db.prepare('SELECT id FROM files WHERE project_id = ?').all(project.id);
    rows.forEach(row => uploadIds.add(row.id));
  }
  return { root, uploadIds, pathCache: new Map() };
}

// Дополняет вложения флагом missing (файл удалён / перемещён)
function decorateAttachments(list, project, ctx) {
  const arr = Array.isArray(list) ? list : [];
  const root = ctx ? ctx.root : (project && project.folder_path ? path.resolve(project.folder_path) : null);
  return arr.map(a => {
    if (a.kind === 'upload') {
      if (ctx) {
        const id = parseInt(a.id, 10);
        return { ...a, missing: !ctx.uploadIds.has(id) };
      }
      const f = db.prepare('SELECT id FROM files WHERE id = ? AND project_id = ?').get(a.id, project.id);
      return { ...a, missing: !f };
    }
    let ok = false;
    const target = root ? resolveInside(root, a.path) : null;
    if (target) {
      if (ctx) {
        if (ctx.pathCache.has(target)) {
          ok = ctx.pathCache.get(target);
        } else {
          try { ok = fs.statSync(target).isFile(); } catch (e) { ok = false; }
          ctx.pathCache.set(target, ok);
        }
      } else {
        try { ok = fs.statSync(target).isFile(); } catch (e) { ok = false; }
      }
    }
    return { ...a, missing: !ok };
  });
}

// ==================== ФАЙЛОВАЯ СИСТЕМА ====================

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '$RECYCLE.BIN', 'System Volume Information',
  '.cache', '.next', '.nuxt', 'dist', 'build', '__pycache__', '.idea', '.vs'
]);

const MAX_TREE_ENTRIES = 2000;
// Лимит размера файла для текстового предпросмотра (можно переопределить в .env: MAX_TEXT_SIZE, в байтах).
// Нужен только чтобы браузер не завис на гигантских файлах. По умолчанию 20 МБ.
const MAX_TEXT_SIZE = (function() {
  const v = parseInt(process.env.MAX_TEXT_SIZE, 10);
  return (v && v > 0) ? v : 20 * 1024 * 1024;
})();

const TEXT_EXTS = new Set([
  '', 'txt', 'md', 'markdown', 'rst', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
  'json', 'jsonc', 'json5', 'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl', 'xml',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'sql',
  'py', 'pyw', 'rb', 'php', 'java', 'kt', 'kts', 'scala', 'groovy', 'gradle',
  'c', 'h', 'cc', 'cxx', 'cpp', 'hpp', 'cs', 'go', 'rs', 'swift', 'dart',
  'lua', 'pl', 'r', 'm', 'pas', 'clj', 'ex', 'exs', 'erl', 'hs', 'ml', 'nim', 'zig', 'sol',
  'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'log', 'csv', 'tsv',
  'vue', 'svelte', 'astro', 'pug', 'jade', 'coffee', 'hbs', 'handlebars', 'mustache', 'twig',
  'gitignore', 'editorconfig', 'lock', 'graphql', 'gql', 'prisma', 'proto', 'srt', 'vtt'
]);

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tiff', 'tif', 'svg'
]);

function isTextFile(ext) { return TEXT_EXTS.has(ext); }
function isImageFile(ext) { return IMAGE_EXTS.has(ext); }

function isPathInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveInside(root, rel) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, rel || '.');
  if (!isPathInside(resolvedRoot, target)) return null;
  return target;
}

function getOwnedProject(req) {
  return db.prepare('SELECT id, folder_path FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
}

// Корни дисков (Windows: C:\ ... Z:\)
function listDriveEntries() {
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i) + ':\\';
    try { if (fs.existsSync(letter)) drives.push({ name: letter.slice(0, 2), path: letter }); } catch (e) { /* */ }
  }
  return drives;
}

// Быстрые папки пользователя (Рабочий стол, Документы, Загрузки и т.д.)
function userPlaces() {
  const out = [];
  const seen = new Set();
  const push = (name, p) => {
    if (!p) return;
    try {
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return;
      const key = path.resolve(p).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name: name, path: p });
    } catch (e) { /* */ }
  };

  if (process.platform === 'win32') {
    const home = process.env.USERPROFILE || os.homedir();
    push('Домашняя папка', home);
    push('Рабочий стол', path.join(home, 'Desktop'));
    push('Документы', path.join(home, 'Documents'));
    push('Загрузки', path.join(home, 'Downloads'));
    push('Изображения', path.join(home, 'Pictures'));
    push('Видео', path.join(home, 'Videos'));
    push('Музыка', path.join(home, 'Music'));

    const oneDrive = process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial;
    if (oneDrive) {
      push('Рабочий стол (OneDrive)', path.join(oneDrive, 'Desktop'));
      push('Документы (OneDrive)', path.join(oneDrive, 'Documents'));
    }
  } else {
    const home = os.homedir();
    push('Домашняя папка', home);
    push('Рабочий стол', path.join(home, 'Desktop'));
    push('Документы', path.join(home, 'Documents'));
    push('Загрузки', path.join(home, 'Downloads'));
  }
  return out;
}

// Список дисков / подпапок для выбора папки проекта
async function browseFs(req, res) {
  try {
    const drives = listDriveEntries();
    const places = userPlaces();
    const target = req.query.path;

    if (!target) {
      if (process.platform === 'win32') {
        return res.json({ path: '', parent: null, dirs: drives, drives, places });
      }
      return res.json({ path: '/', parent: null, dirs: [{ name: '/', path: '/' }], drives, places });
    }

    const resolved = path.resolve(target);
    let stat;
    try { stat = await fsp.stat(resolved); } catch (e) { stat = null; }
    if (!stat || !stat.isDirectory()) {
      return res.status(400).json({ error: 'Папка не найдена' });
    }

    const dirs = (await fsp.readdir(resolved, { withFileTypes: true }))
      .filter(e => e.isDirectory() && !IGNORED_DIRS.has(e.name))
      .map(e => ({ name: e.name, path: path.join(resolved, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .slice(0, MAX_TREE_ENTRIES);

    const parent = path.dirname(resolved);
    res.json({ path: resolved, parent: parent === resolved ? null : parent, dirs, drives, places });
  } catch (err) {
    console.error('browseFs error:', err);
    res.status(500).json({ error: 'Не удалось прочитать папку' });
  }
}

// Сохранить путь к папке проекта
async function setProjectFolder(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const folderPath = (req.body.folderPath || '').trim();
    if (!folderPath) {
      db.prepare('UPDATE projects SET folder_path = ? WHERE id = ?').run('', project.id);
      return res.json({ folderPath: '' });
    }

    const resolved = path.resolve(folderPath);
    let stat;
    try { stat = await fsp.stat(resolved); } catch (e) { stat = null; }
    if (!stat || !stat.isDirectory()) {
      return res.status(400).json({ error: 'Папка не существует' });
    }

    db.prepare('UPDATE projects SET folder_path = ? WHERE id = ?').run(resolved, project.id);
    logActivity(req.user.id, project.id, 'folder_set', 'Выбрана папка: ' + resolved);
    res.json({ folderPath: resolved });
  } catch (err) {
    console.error('setProjectFolder error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// Один уровень дерева (ленивая загрузка)
async function getProjectFileTree(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    if (!project.folder_path) return res.status(400).json({ error: 'folder_missing' });

    const root = path.resolve(project.folder_path);
    let rootStat;
    try { rootStat = await fsp.stat(root); } catch (e) { rootStat = null; }
    if (!rootStat || !rootStat.isDirectory()) return res.status(400).json({ error: 'folder_missing' });

    const rel = req.query.path || '';
    const target = resolveInside(root, rel);
    if (!target) return res.status(400).json({ error: 'Недопустимый путь' });

    let stat;
    try { stat = await fsp.stat(target); } catch (e) { stat = null; }
    if (!stat || !stat.isDirectory()) return res.status(400).json({ error: 'Папка не найдена' });

    const dirents = (await fsp.readdir(target, { withFileTypes: true }))
      .filter(e => !(e.isDirectory() && IGNORED_DIRS.has(e.name)))
      .slice(0, MAX_TREE_ENTRIES);

    const entries = await Promise.all(dirents.map(async e => {
      const full = path.join(target, e.name);
      const relPath = path.relative(root, full).split(path.sep).join('/');
      if (e.isDirectory()) {
        let hasChildren = false;
        try { hasChildren = (await fsp.readdir(full)).length > 0; } catch (err) { hasChildren = false; }
        return { name: e.name, path: relPath, type: 'dir', hasChildren };
      }
      let size = 0;
      try { size = (await fsp.stat(full)).size; } catch (err) { size = 0; }
      return {
        name: e.name, path: relPath, type: 'file', size,
        ext: path.extname(e.name).slice(1).toLowerCase()
      };
    }));

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'ru');
    });

    res.json({ path: rel, root, entries });
  } catch (err) {
    console.error('getProjectFileTree error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// Чтение файла: текст (JSON) / картинка / бинарник (raw)
async function readProjectFile(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    if (!project.folder_path) return res.status(400).json({ error: 'Папка не выбрана' });

    const root = path.resolve(project.folder_path);
    const target = resolveInside(root, req.query.path || '');
    if (!target) return res.status(400).json({ error: 'Недопустимый путь' });

    let stat;
    try { stat = await fsp.stat(target); } catch (e) { stat = null; }
    if (!stat || !stat.isFile()) return res.status(404).json({ error: 'Файл не найден' });

    const ext = path.extname(target).slice(1).toLowerCase();

    if (req.query.raw === '1') {
      return res.sendFile(target);
    }

    if (isImageFile(ext)) {
      return res.json({ type: 'image', size: stat.size, ext });
    }

    if (isTextFile(ext)) {
      if (stat.size > MAX_TEXT_SIZE) {
        return res.json({ type: 'text', tooLarge: true, size: stat.size, ext });
      }
      const content = await fsp.readFile(target, 'utf8');
      return res.json({ type: 'text', content, size: stat.size, ext });
    }

    res.json({ type: 'binary', size: stat.size, ext });
  } catch (err) {
    console.error('readProjectFile error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// Открыть папку/файл во внешнем приложении (VS Code / проводник)
// Ищет исполняемый файл команды в PATH (учитывая PATHEXT в Windows).
// Нужно, чтобы не запускать случайный "code" и корректно отдавать ошибку, если ничего нет.
function resolveCommand(cmd) {
  if (!cmd) return null;
  try {
    if (path.isAbsolute(cmd)) return fs.existsSync(cmd) ? cmd : null;
  } catch (e) { /* */ }

  const isWin = process.platform === 'win32';
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = isWin
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];

  // В Windows сначала перебираем PATHEXT (.cmd/.exe/...), голое имя — в конце:
  // иначе можно подцепить Unix-скрипт без расширения (например, "code" в пакете Cursor).
  const variants = isWin ? exts.concat(['']) : [''];
  for (let i = 0; i < dirs.length; i++) {
    for (let j = 0; j < variants.length; j++) {
      const full = path.join(dirs[i], cmd + variants[j]);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch (e) { /* */ }
    }
  }
  return null;
}

// Понятное имя редактора по пути к команде
function editorLabel(cmdPath) {
  const p = String(cmdPath).toLowerCase();
  const base = path.basename(p).replace(/\.(cmd|exe|bat|sh)$/, '');
  if (p.includes('cursor')) return 'Cursor';
  if (p.includes('code-insiders')) return 'VS Code Insiders';
  if (p.includes('vscode') || p.includes('microsoft vs code') || base === 'code') return 'VS Code';
  if (p.includes('sublime') || base === 'subl') return 'Sublime Text';
  if (p.includes('notepad++') || base === 'notepad++') return 'Notepad++';
  if (p.includes('webstorm')) return 'WebStorm';
  if (p.includes('pycharm')) return 'PyCharm';
  if (p.includes('phpstorm')) return 'PhpStorm';
  if (p.includes('goland')) return 'GoLand';
  if (p.includes('clion')) return 'CLion';
  if (p.includes('rider')) return 'Rider';
  if (p.includes('intellij') || base === 'idea') return 'IntelliJ IDEA';
  if (p.includes('android studio') || base === 'studio') return 'Android Studio';
  return path.basename(cmdPath);
}

// Команды редакторов, которые пробуем найти в PATH
const EDITOR_COMMANDS = [
  'code', 'code-insiders', 'cursor', 'windsurf', 'subl',
  'notepad++', 'idea', 'webstorm', 'pycharm', 'phpstorm',
  'goland', 'clion', 'rider', 'studio'
];

// Ключевые слова в имени папки/файла для распознавания редакторов
const EDITOR_KEYWORDS = /(sublime|vs ?code|vscode|microsoft vs code|cursor|windsurf|jetbrains|intellij|webstorm|pycharm|phpstorm|goland|clion|rider|notepad\+\+|android studio)/i;

// exe-файлы редакторов, которые ищем при сканировании диска
const EDITOR_EXE_NAMES = new Set([
  'sublime_text.exe', 'subl.exe', 'code.exe', 'cursor.exe', 'windsurf.exe',
  'notepad++.exe', 'idea64.exe', 'webstorm64.exe', 'pycharm64.exe',
  'phpstorm64.exe', 'goland64.exe', 'clion64.exe', 'rider64.exe', 'studio64.exe'
]);

// Известные пути установки (Windows) — на случай, если команда не в PATH
function knownEditorPaths() {
  if (process.platform !== 'win32') return [];
  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(pf, 'Microsoft VS Code', 'Code.exe'),
    path.join(pf86, 'Microsoft VS Code', 'Code.exe'),
    path.join(local, 'Programs', 'cursor', 'Cursor.exe'),
    path.join(pf, 'Cursor', 'Cursor.exe'),
    path.join(pf, 'Sublime Text', 'subl.exe'),
    path.join(pf, 'Sublime Text', 'sublime_text.exe'),
    path.join(pf, 'Sublime Text 3', 'subl.exe'),
    path.join(pf, 'Sublime Text 3', 'sublime_text.exe'),
    path.join(pf, 'Notepad++', 'notepad++.exe'),
    path.join(pf, 'JetBrains', 'IntelliJ IDEA', 'bin', 'idea64.exe'),
    path.join(pf, 'JetBrains', 'WebStorm', 'bin', 'webstorm64.exe'),
    path.join(pf, 'JetBrains', 'PyCharm', 'bin', 'pycharm64.exe')
  ];
}

// Все совпадения команды в PATH (а не только первое вхождение)
function resolveAllCommands(cmd) {
  const out = [];
  if (!cmd) return out;
  const isWin = process.platform === 'win32';
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = isWin
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const variants = isWin ? exts.concat(['']) : [''];
  const seen = new Set();

  dirs.forEach(function(dir) {
    for (let j = 0; j < variants.length; j++) {
      const full = path.join(dir, cmd + variants[j]);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          const key = path.resolve(full).toLowerCase();
          if (!seen.has(key)) { seen.add(key); out.push(full); }
          break; // нашли вариант в этой папке — дальше не ищем
        }
      } catch (e) { /* */ }
    }
  });
  return out;
}

// Корни дисков (C..Z)
function listDrives() {
  const drives = [];
  for (let i = 67; i <= 90; i++) {
    const root = String.fromCharCode(i) + ':\\';
    try { if (fs.existsSync(root)) drives.push(root); } catch (e) { /* */ }
  }
  return drives;
}

// Сканирование дисков в отдельном потоке (не блокирует main process)
function scanDrivesForEditorsAsync() {
  return new Promise(resolve => {
    const drives = listDrives();
    if (!drives.length) return resolve([]);

    let worker = null;
    let timer = null;
    let settled = false;
    const finish = function(list) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { if (worker) worker.terminate(); } catch (e) { /* */ }
      resolve(Array.isArray(list) ? list : []);
    };

    try {
      worker = new Worker(path.join(__dirname, '..', 'workers', 'editor-scan-worker.js'), {
        workerData: { drives, timeLimit: 2500, stepLimit: 40000 }
      });
    } catch (e) {
      return finish([]);
    }

    timer = setTimeout(function() { finish([]); }, 3500);
    worker.on('message', function(list) { finish(list); });
    worker.on('error', function() { finish([]); });
    worker.on('exit', function() { finish([]); });
  });
}

// Список всех найденных на машине редакторов
let _editorsCache = null;
let _editorsCacheAt = 0;
const EDITORS_CACHE_TTL = 5 * 60 * 1000;

function makeEditorCollector() {
  const result = [];
  const seenPaths = new Set();
  const seenNames = new Set();

  const add = function(cmdPath) {
    if (!cmdPath) return;
    let isFile = false;
    try { isFile = fs.existsSync(cmdPath) && fs.statSync(cmdPath).isFile(); } catch (e) { isFile = false; }
    if (!isFile) return;
    const key = path.resolve(cmdPath).toLowerCase();
    if (seenPaths.has(key)) return;
    const name = editorLabel(cmdPath);
    if (seenNames.has(name)) return;
    seenPaths.add(key);
    seenNames.add(name);
    result.push({ name: name, cmd: cmdPath });
  };

  return { result, add };
}

// Быстрая синхронная часть обнаружения: EDITOR_CMD, PATH и известные пути
function detectEditorsFast() {
  const collector = makeEditorCollector();
  const add = collector.add;

  // 1) EDITOR_CMD из .env — приоритетно
  if (process.env.EDITOR_CMD) {
    const e = process.env.EDITOR_CMD.trim();
    add(resolveCommand(e) || e);
  }

  // 2) PATH — берём ВСЕ совпадения (code может быть и у Cursor, и у VS Code)
  EDITOR_COMMANDS.forEach(function(c) {
    resolveAllCommands(c).forEach(add);
  });

  // 3) Известные пути установки
  knownEditorPaths().forEach(add);

  return collector;
}

// Полное обнаружение: быстрая часть + сканирование дисков в worker-потоке
async function detectEditorsAsync(isWindows) {
  const collector = detectEditorsFast();
  const add = collector.add;

  if (isWindows) {
    const found = await scanDrivesForEditorsAsync();
    found.forEach(add);
  }

  // Запасной вариант
  if (!collector.result.length) add(resolveCommand('notepad'));

  return collector.result;
}

async function getEditorsCached(force) {
  const now = Date.now();
  if (force || !_editorsCache || (now - _editorsCacheAt) > EDITORS_CACHE_TTL) {
    _editorsCache = await detectEditorsAsync(process.platform === 'win32');
    _editorsCacheAt = Date.now();
  }
  return _editorsCache;
}

function warmEditorsCache() {
  return getEditorsCached(false).catch(function(err) {
    console.error('warmEditorsCache error:', err);
    return [];
  });
}

async function getEditors(req, res) {
  try {
    const force = req.query.refresh === '1';
    res.json({ editors: await getEditorsCached(force) });
  } catch (err) {
    console.error('getEditors error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

async function openProjectPath(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    if (!project.folder_path) return res.status(400).json({ error: 'Папка не выбрана' });

    const root = path.resolve(project.folder_path);
    const relPath = req.body.path || '';
    let fsPath = root;

    if (relPath) {
      const resolved = resolveInside(root, relPath);
      if (!resolved) return res.status(400).json({ error: 'Недопустимый путь' });
      let stat;
      try { stat = fs.statSync(resolved); } catch (e) { stat = null; }
      if (!stat) return res.status(404).json({ error: 'Путь не найден' });
      fsPath = resolved;
    } else {
      let stat;
      try { stat = fs.statSync(root); } catch (e) { stat = null; }
      if (!stat) return res.status(400).json({ error: 'Папка не найдена' });
    }

    let stat = null;
    try { stat = fs.statSync(fsPath); } catch (e) { stat = null; }
    const isFile = !!(stat && stat.isFile());

    const target = req.body.target === 'explorer' ? 'explorer' : 'editor';

    if (target === 'editor') {
      // Список редакторов, реально найденных на машине (из кеша)
      const editors = await getEditorsCached(false);
      let found = null;

      // Конкретный редактор, выбранный в меню (валидируем по списку найденных —
      // чтобы через API нельзя было запустить произвольную команду)
      if (req.body.editor) {
        const wanted = String(req.body.editor).toLowerCase();
        const match = editors.find(function(e) {
          return e.cmd.toLowerCase() === wanted || e.name.toLowerCase() === wanted;
        });
        if (!match) return res.status(400).json({ error: 'Редактор не найден' });
        found = match.cmd;
      } else if (editors.length) {
        // Автоопределение: первый доступный
        found = editors[0].cmd;
      }

      if (!found) {
        return res.status(400).json({
          error: 'Редактор не найден. Установите редактор или укажите EDITOR_CMD в .env'
        });
      }

      const useShell = /\.(cmd|bat)$/i.test(found);
      try {
        const child = spawn(found, [fsPath], {
          detached: true,
          stdio: 'ignore',
          shell: useShell,
          windowsHide: true
        });
        child.on('error', function() { /* процесс мог уже стартовать */ });
        child.unref();
      } catch (e) {
        return res.status(500).json({ error: 'Не удалось запустить редактор' });
      }
      return res.json({ message: 'Открыто: ' + editorLabel(found) });
    }

    // Проводник / файловый менеджер
    try {
      if (isFile) {
        shell.showItemInFolder(fsPath);
      } else {
        const openError = await shell.openPath(fsPath);
        if (openError) return res.status(500).json({ error: openError });
      }
    } catch (e) {
      return res.status(500).json({ error: 'Не удалось открыть проводник' });
    }
    return res.json({ message: 'Открыто в проводнике' });
  } catch (err) {
    console.error('openProjectPath error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}












function loadProjectDetails(project) {
  // ===== ПОЛУЧАЕМ ПОСЛЕДНЮЮ ВЕРСИЮ =====
  const latestVersion = db.prepare(
    'SELECT number FROM versions WHERE project_id = ? ORDER BY date DESC LIMIT 1'
  ).get(project.id);

  const linksMap = refsService.getRefsForProject(project.id);
  const attachCtx = createAttachmentContext(project);

  // Подгружаем связанные данные
  const notes = db.prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY created_at DESC').all(project.id)
    .map(n => ({ ...n, pinned: !!n.pinned, tags: parseJsonArray(n.tags), attachments: decorateAttachments(parseJsonArray(n.attachments), project, attachCtx) }));
  refsService.attachRefsToEntities(notes, 'note', linksMap);
  notes.forEach(n => { n.links = n.checklist_ids; });

  const versions = db.prepare('SELECT * FROM versions WHERE project_id = ? ORDER BY date DESC').all(project.id)
    .map(v => ({ ...v, attachments: decorateAttachments(parseJsonArray(v.attachments), project, attachCtx) }));
  refsService.attachRefsToEntities(versions, 'version', linksMap);
  const checklistCategories = db.prepare('SELECT * FROM checklist_categories WHERE project_id = ? ORDER BY position ASC, id ASC').all(project.id);
  const checklist = db.prepare('SELECT * FROM checklist_items WHERE project_id = ? ORDER BY position ASC').all(project.id);

  const subtaskRows = db.prepare(
    'SELECT s.* FROM subtasks s JOIN checklist_items ci ON ci.id = s.checklist_item_id WHERE ci.project_id = ? ORDER BY s.id'
  ).all(project.id);
  const subtasksByItem = new Map();
  subtaskRows.forEach(s => {
    let arr = subtasksByItem.get(s.checklist_item_id);
    if (!arr) { arr = []; subtasksByItem.set(s.checklist_item_id, arr); }
    arr.push({ ...s, done: !!s.done });
  });

  const checklistWithSubtasks = checklist.map(item => ({
    ...item,
    done: !!item.done,
    attachments: decorateAttachments(parseJsonArray(item.attachments), project, attachCtx),
    subtasks: subtasksByItem.get(item.id) || []
  }));
  refsService.attachRefsToEntities(checklistWithSubtasks, 'checklist', linksMap);

  const milestones = db.prepare('SELECT * FROM milestones WHERE project_id = ?').all(project.id);
  const comments = db.prepare('SELECT * FROM comments WHERE project_id = ? ORDER BY created_at DESC').all(project.id);
  const photos = db.prepare('SELECT * FROM photos WHERE project_id = ?').all(project.id);
  const files = db.prepare('SELECT * FROM files WHERE project_id = ?').all(project.id);
  const scripts = db.prepare(
    'SELECT * FROM project_scripts WHERE project_id = ? ORDER BY position ASC, created_at ASC'
  ).all(project.id).map(function(script) {
    return {
      ...script,
      env: parseJsonObject(script.env),
      confirm: !!script.confirm,
      auto_start: !!script.auto_start,
      favorite: !!script.favorite,
      running: runner.isRunning(project.id, script.id),
      runId: runner.getRunId(project.id, script.id)
    };
  });

  return {
    ...project,
    tags: JSON.parse(project.tags || '[]'),
    favorite: !!project.favorite,
    pinned: !!project.pinned,
    latestVersion: latestVersion ? latestVersion.number : null,
    notes,
    versions,
    checklistCategories,
    checklist: checklistWithSubtasks,
    milestones,
    comments,
    photos,
    files,
    scripts
  };
}

function getOne(req, res) {
  try {
    const project = db.prepare(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);

    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    res.json({ project: loadProjectDetails(project) });
  } catch (err) {
    console.error('getOne error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function exportAll(req, res) {
  try {
    const projects = db.prepare(
      'SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY pinned DESC, created_at DESC'
    ).all(req.user.id);
    const trash = db.prepare(
      'SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY created_at DESC'
    ).all(req.user.id);

    res.json({
      projects: projects.map(loadProjectDetails),
      trash: trash.map(loadProjectDetails),
      exportedAt: new Date().toISOString(),
      version: '3.0'
    });
  } catch (err) {
    console.error('exportAll error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}











// ==================== ПРОЕКТЫ ====================

const PROJECT_LIST_COLUMNS = [
  'id', 'user_id', 'name', 'description', 'logo', 'tags', 'status', 'priority',
  'color', 'favorite', 'pinned', 'deadline', 'start_date', 'estimated_hours',
  'folder_path', 'created_at', 'deleted_at'
].join(', ');

function groupMilestones(rows) {
  const map = new Map();
  rows.forEach(m => {
    let arr = map.get(m.project_id);
    if (!arr) { arr = []; map.set(m.project_id, arr); }
    arr.push(m);
  });
  return map;
}

function getAll(req, res) {
  try {
    const { status, priority, tag, favorite, search, sort, deleted } = req.query;
    const userId = req.user.id;

    let sql = `SELECT ${PROJECT_LIST_COLUMNS},
      (SELECT number FROM versions v WHERE v.project_id = projects.id ORDER BY v.date DESC LIMIT 1) AS latest_version
      FROM projects WHERE user_id = ?`;
    const params = [userId];

    if (deleted === 'true') {
      sql += ' AND deleted_at IS NOT NULL';
    } else {
      sql += ' AND deleted_at IS NULL';
    }

    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (priority) { sql += ' AND priority = ?'; params.push(priority); }
    if (favorite === 'true') { sql += ' AND favorite = 1'; }
    if (search) { sql += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (tag) { sql += ' AND tags LIKE ?'; params.push(`%"${tag}"%`); }

    switch (sort) {
      case 'oldest': sql += ' ORDER BY pinned DESC, created_at ASC'; break;
      case 'name': sql += ' ORDER BY pinned DESC, name COLLATE NOCASE ASC'; break;
      case 'deadline': sql += ' ORDER BY pinned DESC, deadline ASC NULLS LAST'; break;
      case 'priority': sql += ' ORDER BY pinned DESC, CASE priority WHEN "p0" THEN 0 WHEN "p1" THEN 1 WHEN "p2" THEN 2 WHEN "p3" THEN 3 WHEN "p4" THEN 4 END ASC'; break;
      default: sql += ' ORDER BY pinned DESC, created_at DESC';
    }

    const projects = db.prepare(sql).all(...params);

    const deletedFilter = deleted === 'true' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL';
    const allMilestones = db.prepare(
      'SELECT * FROM milestones WHERE project_id IN (SELECT id FROM projects WHERE user_id = ? AND ' + deletedFilter + ') ORDER BY date ASC'
    ).all(userId);
    const milestonesByProject = groupMilestones(allMilestones);

    const parsed = projects.map(p => {
      const { latest_version, ...rest } = p;
      return {
        ...rest,
        tags: JSON.parse(p.tags || '[]'),
        favorite: !!p.favorite,
        pinned: !!p.pinned,
        latestVersion: latest_version == null ? null : latest_version,
        milestones: milestonesByProject.get(p.id) || []
      };
    });

    res.json({ projects: parsed });
  } catch (err) {
    console.error('getAll error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function getBoard(req, res) {
  try {
    const userId = req.user.id;

    const rows = db.prepare(`
      SELECT p.id, p.user_id, p.name, p.description, p.logo, p.tags, p.status,
        p.priority, p.color, p.favorite, p.pinned, p.deadline, p.start_date,
        p.estimated_hours, p.folder_path, p.created_at, p.deleted_at,
        (SELECT number FROM versions v WHERE v.project_id = p.id ORDER BY v.date DESC LIMIT 1) AS latest_version,
        (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id) AS stat_notes,
        (SELECT COUNT(*) FROM checklist_items ci WHERE ci.project_id = p.id AND ci.done = 1) AS stat_checklist_done,
        (SELECT COUNT(*) FROM checklist_items ci WHERE ci.project_id = p.id) AS stat_checklist_total,
        (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.id) AS stat_photos,
        (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS stat_files,
        (SELECT COUNT(*) FROM comments c WHERE c.project_id = p.id) AS stat_comments
      FROM projects p
      WHERE p.user_id = ? AND p.deleted_at IS NULL
      ORDER BY p.pinned DESC, p.created_at DESC
    `).all(userId);

    const allMilestones = db.prepare(
      'SELECT * FROM milestones WHERE project_id IN (SELECT id FROM projects WHERE user_id = ? AND deleted_at IS NULL) ORDER BY date ASC'
    ).all(userId);
    const milestonesByProject = groupMilestones(allMilestones);

    const projects = rows.map(p => {
      const {
        latest_version, stat_notes, stat_checklist_done, stat_checklist_total,
        stat_photos, stat_files, stat_comments, ...rest
      } = p;
      return {
        ...rest,
        tags: JSON.parse(p.tags || '[]'),
        favorite: !!p.favorite,
        pinned: !!p.pinned,
        latestVersion: latest_version == null ? null : latest_version,
        milestones: milestonesByProject.get(p.id) || [],
        stats: {
          notes: stat_notes,
          checklistDone: stat_checklist_done,
          checklistTotal: stat_checklist_total,
          photos: stat_photos,
          files: stat_files,
          comments: stat_comments
        }
      };
    });

    res.json({ projects });
  } catch (err) {
    console.error('getBoard error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// function getOne(req, res) {
//   try {
//     const project = db.prepare(
//       'SELECT * FROM projects WHERE id = ? AND user_id = ?'
//     ).get(req.params.id, req.user.id);

//     if (!project) return res.status(404).json({ error: 'Проект не найден' });

//     // Подгружаем связанные данные
//     const notes = db.prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY created_at DESC').all(project.id);
//     const versions = db.prepare('SELECT * FROM versions WHERE project_id = ? ORDER BY date DESC').all(project.id);
//     const checklist = db.prepare('SELECT * FROM checklist_items WHERE project_id = ? ORDER BY position ASC').all(project.id);
    
//     // Подгружаем подзадачи для каждого элемента чеклиста
//     const checklistWithSubtasks = checklist.map(item => ({
//       ...item,
//       done: !!item.done,
//       subtasks: db.prepare('SELECT * FROM subtasks WHERE checklist_item_id = ?').all(item.id).map(s => ({ ...s, done: !!s.done }))
//     }));

//     const milestones = db.prepare('SELECT * FROM milestones WHERE project_id = ?').all(project.id);
//     const comments = db.prepare('SELECT * FROM comments WHERE project_id = ? ORDER BY created_at DESC').all(project.id);
//     const photos = db.prepare('SELECT * FROM photos WHERE project_id = ?').all(project.id);
//     const files = db.prepare('SELECT * FROM files WHERE project_id = ?').all(project.id);

//     res.json({
//       project: {
//         ...project,
//         tags: JSON.parse(project.tags || '[]'),
//         favorite: !!project.favorite,
//         notes,
//         versions,
//         checklist: checklistWithSubtasks,
//         milestones,
//         comments,
//         photos,
//         files
//       }
//     });
//   } catch (err) {
//     console.error('getOne error:', err);
//     res.status(500).json({ error: 'Ошибка сервера' });
//   }
// }

function create(req, res) {
  try {
    const {
      name, description, tags, status, priority, color,
      deadline, startDate, estimatedHours, folderPath, logo, version
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Название обязательно' });

    const initialVersion = (version && String(version).trim()) || '1.0.0';
    if (!/^\d+\.\d+\.\d+$/.test(initialVersion)) {
      return res.status(400).json({ error: 'Формат версии: 1.2.3' });
    }

    const id = 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    db.prepare(`
      INSERT INTO projects (id, user_id, name, description, logo, tags, status, priority, color, deadline, start_date, estimated_hours, folder_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.user.id, name.trim(),
      description || '', logo || null,
      JSON.stringify(tags || []),
      status || 'active', priority || 'p3', color || '#0071e3',
      deadline || null, startDate || null,
      estimatedHours || null, folderPath || ''
    );

    // Начальная версия
    const verId = 'ver_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    db.prepare('INSERT INTO versions (id, project_id, number, description) VALUES (?, ?, ?, ?)').run(verId, id, initialVersion, 'Начальная');

    logActivity(req.user.id, id, 'created', 'Проект создан');

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.status(201).json({
      project: { ...project, tags: JSON.parse(project.tags || '[]'), favorite: !!project.favorite, pinned: !!project.pinned }
    });
  } catch (err) {
    console.error('create error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function update(req, res) {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const {
      name, description, tags, status, priority, color,
      favorite, pinned, deadline, startDate, estimatedHours, folderPath, logo, mindmap_positions, mindmap_graph, mindmap_files, mindmap_headings
    } = req.body;

    db.prepare(`
      UPDATE projects SET
        name = ?, description = ?, logo = ?, tags = ?,
        status = ?, priority = ?, color = ?, favorite = ?, pinned = ?,
        deadline = ?, start_date = ?, estimated_hours = ?, folder_path = ?,
        mindmap_positions = ?, mindmap_graph = ?, mindmap_files = ?, mindmap_headings = ?
      WHERE id = ?
    `).run(
      name || project.name,
      description !== undefined ? description : project.description,
      logo !== undefined ? logo : project.logo,
      tags !== undefined ? JSON.stringify(tags) : project.tags,
      status || project.status,
      priority || project.priority,
      color || project.color,
      favorite !== undefined ? (favorite ? 1 : 0) : project.favorite,
      pinned !== undefined ? (pinned ? 1 : 0) : project.pinned,
      deadline !== undefined ? deadline : project.deadline,
      startDate !== undefined ? startDate : project.start_date,
      estimatedHours !== undefined ? estimatedHours : project.estimated_hours,
      folderPath !== undefined ? folderPath : project.folder_path,
      mindmap_positions !== undefined ? mindmap_positions : project.mindmap_positions,
      mindmap_graph !== undefined ? mindmap_graph : project.mindmap_graph,
      mindmap_files !== undefined ? mindmap_files : project.mindmap_files,
      mindmap_headings !== undefined ? mindmap_headings : project.mindmap_headings,
      project.id
    );

    logActivity(req.user.id, project.id, 'edited', 'Проект изменён');

    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);
    res.json({ project: { ...updated, tags: JSON.parse(updated.tags || '[]'), favorite: !!updated.favorite, pinned: !!updated.pinned } });
  } catch (err) {
    console.error('update error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function remove(req, res) {
  try {
    const { permanent } = req.query;
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    runner.stopProject(project.id);

    if (permanent === 'true') {
      // Удаляем физически
      // Сначала удаляем файлы с диска
      const photos = db.prepare('SELECT filename FROM photos WHERE project_id = ?').all(project.id);
      const files = db.prepare('SELECT filename FROM files WHERE project_id = ?').all(project.id);
      const uploadsPath = process.env.UPLOADS_PATH || './uploads';

      photos.forEach(p => {
        const filePath = path.join(uploadsPath, 'photos', p.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        const thumb = thumbName(p.filename);
        if (thumb) {
          const thumbPath = path.join(uploadsPath, 'photos', thumb);
          if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
        }
      });
      files.forEach(f => {
        const filePath = path.join(uploadsPath, 'files', f.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      });

      db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
      logActivity(req.user.id, null, 'deleted_permanent', 'Проект удалён навсегда');
      res.json({ message: 'Удалён навсегда' });
    } else if (project.deleted_at) {
      // Восстановить из корзины
      db.prepare('UPDATE projects SET deleted_at = NULL WHERE id = ?').run(project.id);
      logActivity(req.user.id, project.id, 'restored', 'Восстановлен из корзины');
      res.json({ message: 'Восстановлен' });
    } else {
      // В корзину
      db.prepare('UPDATE projects SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(project.id);
      logActivity(req.user.id, project.id, 'trashed', 'Проект в корзине');
      res.json({ message: 'В корзине' });
    }
  } catch (err) {
    console.error('remove error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// ==================== ЗАМЕТКИ ====================

function addNote(req, res) {
  try {
    const project = db.prepare('SELECT id, folder_path FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const { title, text, language, attachments, pinned, tags, links, note_ids, checklist_ids } = req.body;
    const id = 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const clean = sanitizeAttachments(attachments, project);
    const cleanTags = sanitizeTags(tags);
    const isPinned = pinned ? 1 : 0;
    let cleanRefs;

    db.transaction(() => {
      db.prepare('INSERT INTO notes (id, project_id, title, text, language, attachments, pinned, tags, links) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, project.id, title || '', text || '', language || 'javascript',
        JSON.stringify(clean), isPinned, JSON.stringify(cleanTags), '[]'
      );
      cleanRefs = refsService.setRefs(project.id, 'note', id, { note_ids, checklist_ids, links });
      logActivity(req.user.id, project.id, 'note_add', `Заметка: ${(title || 'Без заголовка').slice(0, 40)}`);
    })();

    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    note.pinned = !!note.pinned;
    note.tags = cleanTags;
    note.links = cleanRefs.checklist_ids;
    note.attachments = decorateAttachments(clean, project);
    refsService.attachRefs(note, cleanRefs);
    res.status(201).json({ note });
  } catch (err) {
    console.error('addNote error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function updateNote(req, res) {
  try {
    const note = db.prepare('SELECT n.*, p.folder_path FROM notes n JOIN projects p ON n.project_id = p.id WHERE n.id = ? AND p.user_id = ?').get(req.params.noteId, req.user.id);
    if (!note) return res.status(404).json({ error: 'Заметка не найдена' });

    const { title, text, language, attachments, pinned, tags, links, note_ids, checklist_ids } = req.body;
    const clean = attachments !== undefined ? sanitizeAttachments(attachments, { id: note.project_id, folder_path: note.folder_path }) : null;
    const cleanTags = tags !== undefined ? sanitizeTags(tags) : null;
    const refsProvided = note_ids !== undefined || checklist_ids !== undefined || links !== undefined;
    const touch = (title !== undefined || text !== undefined) ? 1 : 0;
    let cleanRefs;

    db.transaction(() => {
      cleanRefs = refsProvided
        ? refsService.setRefs(note.project_id, 'note', note.id, { note_ids, checklist_ids, links })
        : refsService.getRefs(note.project_id, 'note', note.id);

      db.prepare(`UPDATE notes SET
          title = ?, text = ?, language = ?, attachments = ?,
          pinned = ?, tags = ?,
          updated_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE updated_at END
        WHERE id = ?`).run(
        title !== undefined ? title : note.title,
        text !== undefined ? text : note.text,
        language || note.language,
        clean !== null ? JSON.stringify(clean) : note.attachments,
        pinned !== undefined ? (pinned ? 1 : 0) : note.pinned,
        cleanTags !== null ? JSON.stringify(cleanTags) : note.tags,
        touch,
        note.id
      );

      logActivity(req.user.id, note.project_id, 'note_edit', 'Заметка изменена');
    })();

    const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id);
    const stored = clean !== null ? clean : parseJsonArray(updated.attachments);
    updated.pinned = !!updated.pinned;
    updated.tags = parseJsonArray(updated.tags);
    updated.links = cleanRefs.checklist_ids;
    updated.attachments = decorateAttachments(stored, { id: note.project_id, folder_path: note.folder_path });
    refsService.attachRefs(updated, cleanRefs);
    res.json({ note: updated });
  } catch (err) {
    console.error('updateNote error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function deleteNote(req, res) {
  try {
    const note = db.prepare('SELECT n.* FROM notes n JOIN projects p ON n.project_id = p.id WHERE n.id = ? AND p.user_id = ?').get(req.params.noteId, req.user.id);
    if (!note) return res.status(404).json({ error: 'Заметка не найдена' });

    db.transaction(() => {
      db.prepare('DELETE FROM notes WHERE id = ?').run(note.id);
      refsService.removeEntityRefs(note.project_id, 'note', note.id);
      logActivity(req.user.id, note.project_id, 'note_delete', 'Заметка удалена');
    })();
    res.json({ message: 'Удалена' });
  } catch (err) {
    console.error('deleteNote error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// ==================== ВЕРСИИ ====================

function addVersion(req, res) {
  try {
    const project = db.prepare('SELECT id, folder_path FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const { number, description, attachments, note_ids, checklist_ids } = req.body;
    if (!number || !/^\d+\.\d+\.\d+$/.test(number)) return res.status(400).json({ error: 'Формат версии: 1.2.3' });

    const clean = sanitizeAttachments(attachments, project);
    const id = 'ver_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    let cleanRefs;

    db.transaction(() => {
      db.prepare('INSERT INTO versions (id, project_id, number, description, attachments, note_ids, checklist_ids) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id, project.id, number, description || '',
        JSON.stringify(clean), '[]', '[]'
      );
      cleanRefs = refsService.setRefs(project.id, 'version', id, { note_ids, checklist_ids });
      logActivity(req.user.id, project.id, 'version_add', `Версия ${number}`);
    })();

    const version = db.prepare('SELECT * FROM versions WHERE id = ?').get(id);
    version.attachments = decorateAttachments(clean, project);
    refsService.attachRefs(version, cleanRefs);
    res.status(201).json({ version });
  } catch (err) {
    console.error('addVersion error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function updateVersion(req, res) {
  try {
    const version = db.prepare('SELECT v.*, p.folder_path FROM versions v JOIN projects p ON v.project_id = p.id WHERE v.id = ? AND p.user_id = ?').get(req.params.versionId, req.user.id);
    if (!version) return res.status(404).json({ error: 'Версия не найдена' });

    const { number, description, attachments, note_ids, checklist_ids } = req.body;
    if (number !== undefined && !/^\d+\.\d+\.\d+$/.test(number)) return res.status(400).json({ error: 'Формат версии: 1.2.3' });

    const clean = attachments !== undefined
      ? sanitizeAttachments(attachments, { id: version.project_id, folder_path: version.folder_path })
      : parseJsonArray(version.attachments);
    const refsProvided = note_ids !== undefined || checklist_ids !== undefined;
    let cleanRefs;

    db.transaction(() => {
      cleanRefs = refsProvided
        ? refsService.setRefs(version.project_id, 'version', version.id, { note_ids, checklist_ids })
        : refsService.getRefs(version.project_id, 'version', version.id);

      db.prepare('UPDATE versions SET number = ?, description = ?, attachments = ? WHERE id = ?').run(
        number || version.number,
        description !== undefined ? description : version.description,
        JSON.stringify(clean),
        version.id
      );
    })();

    const updated = db.prepare('SELECT * FROM versions WHERE id = ?').get(version.id);
    updated.attachments = decorateAttachments(clean, { id: version.project_id, folder_path: version.folder_path });
    refsService.attachRefs(updated, cleanRefs);
    res.json({ version: updated });
  } catch (err) {
    console.error('updateVersion error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function deleteVersion(req, res) {
  try {
    const version = db.prepare('SELECT v.* FROM versions v JOIN projects p ON v.project_id = p.id WHERE v.id = ? AND p.user_id = ?').get(req.params.versionId, req.user.id);
    if (!version) return res.status(404).json({ error: 'Версия не найдена' });

    db.transaction(() => {
      db.prepare('DELETE FROM versions WHERE id = ?').run(version.id);
      refsService.removeRefsForSource(version.project_id, 'version', version.id);
    })();
    res.json({ message: 'Удалена' });
  } catch (err) {
    console.error('deleteVersion error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// ==================== ЧЕКЛИСТ ====================

function resolveChecklistCategoryId(projectId, rawId) {
  if (rawId === undefined) return undefined;
  if (rawId === null || rawId === '' || rawId === 'null') return null;
  const categoryId = parseInt(rawId, 10);
  if (!categoryId) return null;
  const category = db.prepare('SELECT id FROM checklist_categories WHERE id = ? AND project_id = ?').get(categoryId, projectId);
  return category ? category.id : null;
}

function addChecklistItem(req, res) {
  try {
    const project = db.prepare('SELECT id, folder_path FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const { text, priority, attachments, category_id, note_ids, checklist_ids } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Текст задачи обязателен' });

    const maxPos = db.prepare('SELECT MAX(position) as maxPos FROM checklist_items WHERE project_id = ?').get(project.id);
    const position = (maxPos?.maxPos ?? -1) + 1;
    const clean = sanitizeAttachments(attachments, project);
    const categoryId = resolveChecklistCategoryId(project.id, category_id) ?? null;

    let itemId;
    let cleanRefs;

    db.transaction(() => {
      const result = db.prepare('INSERT INTO checklist_items (project_id, text, priority, done, position, attachments, category_id) VALUES (?, ?, ?, 0, ?, ?, ?)').run(project.id, text.trim(), priority || 'p3', position, JSON.stringify(clean), categoryId);
      itemId = result.lastInsertRowid;
      cleanRefs = refsService.setRefs(project.id, 'checklist', itemId, { note_ids, checklist_ids });
      logActivity(req.user.id, project.id, 'checklist_add', `Задача: ${text.trim().slice(0, 40)}`);
    })();

    const item = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(itemId);
    item.attachments = decorateAttachments(clean, project);
    refsService.attachRefs(item, cleanRefs);
    res.status(201).json({ item });
  } catch (err) {
    console.error('addChecklistItem error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function updateChecklistItem(req, res) {
  try {
    const item = db.prepare('SELECT ci.*, p.folder_path FROM checklist_items ci JOIN projects p ON ci.project_id = p.id WHERE ci.id = ? AND p.user_id = ?').get(req.params.itemId, req.user.id);
    if (!item) return res.status(404).json({ error: 'Задача не найдена' });

    const { text, priority, done, attachments, category_id, note_ids, checklist_ids } = req.body;
    const proj = { id: item.project_id, folder_path: item.folder_path };
    const clean = attachments !== undefined ? sanitizeAttachments(attachments, proj) : null;
    const categoryId = resolveChecklistCategoryId(item.project_id, category_id);
    const refsProvided = note_ids !== undefined || checklist_ids !== undefined;
    let cleanRefs;

    db.transaction(() => {
      cleanRefs = refsProvided
        ? refsService.setRefs(item.project_id, 'checklist', item.id, { note_ids, checklist_ids })
        : refsService.getRefs(item.project_id, 'checklist', item.id);

      db.prepare('UPDATE checklist_items SET text = ?, priority = ?, done = ?, attachments = ?, category_id = ? WHERE id = ?').run(
        text !== undefined ? text : item.text,
        priority || item.priority,
        done !== undefined ? (done ? 1 : 0) : item.done,
        clean !== null ? JSON.stringify(clean) : item.attachments,
        categoryId !== undefined ? categoryId : item.category_id,
        item.id
      );

      logActivity(req.user.id, item.project_id, 'checklist_toggle', `Задача: ${item.text.slice(0, 40)}`);
    })();

    const updated = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(item.id);
    const stored = clean !== null ? clean : parseJsonArray(updated.attachments);
    updated.attachments = decorateAttachments(stored, proj);
    refsService.attachRefs(updated, cleanRefs);
    res.json({ item: updated });
  } catch (err) {
    console.error('updateChecklistItem error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function deleteChecklistItem(req, res) {
  try {
    const item = db.prepare('SELECT ci.* FROM checklist_items ci JOIN projects p ON ci.project_id = p.id WHERE ci.id = ? AND p.user_id = ?').get(req.params.itemId, req.user.id);
    if (!item) return res.status(404).json({ error: 'Задача не найдена' });

    db.transaction(() => {
      db.prepare('DELETE FROM checklist_items WHERE id = ?').run(item.id);
      refsService.removeEntityRefs(item.project_id, 'checklist', item.id);
    })();
    res.json({ message: 'Удалена' });
  } catch (err) {
    console.error('deleteChecklistItem error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function addChecklistCategory(req, res) {
  try {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Название категории обязательно' });

    const maxPos = db.prepare('SELECT MAX(position) as maxPos FROM checklist_categories WHERE project_id = ?').get(project.id);
    const position = (maxPos?.maxPos ?? -1) + 1;
    const colorValue = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#2f6df6';

    const result = db.prepare('INSERT INTO checklist_categories (project_id, name, color, position) VALUES (?, ?, ?, ?)').run(project.id, name.trim(), colorValue, position);
    const category = db.prepare('SELECT * FROM checklist_categories WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ category });
  } catch (err) {
    console.error('addChecklistCategory error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function updateChecklistCategory(req, res) {
  try {
    const category = db.prepare(`
      SELECT cc.* FROM checklist_categories cc
      JOIN projects p ON cc.project_id = p.id
      WHERE cc.id = ? AND p.user_id = ?
    `).get(req.params.categoryId, req.user.id);
    if (!category) return res.status(404).json({ error: 'Категория не найдена' });

    const { name, color, position } = req.body;
    const colorValue = color !== undefined && /^#[0-9a-fA-F]{6}$/.test(color) ? color : category.color;
    db.prepare('UPDATE checklist_categories SET name = ?, color = ?, position = ? WHERE id = ?').run(
      name !== undefined && name.trim() ? name.trim() : category.name,
      colorValue,
      position !== undefined ? parseInt(position, 10) || 0 : category.position,
      category.id
    );

    res.json({ category: db.prepare('SELECT * FROM checklist_categories WHERE id = ?').get(category.id) });
  } catch (err) {
    console.error('updateChecklistCategory error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function deleteChecklistCategory(req, res) {
  try {
    const category = db.prepare(`
      SELECT cc.* FROM checklist_categories cc
      JOIN projects p ON cc.project_id = p.id
      WHERE cc.id = ? AND p.user_id = ?
    `).get(req.params.categoryId, req.user.id);
    if (!category) return res.status(404).json({ error: 'Категория не найдена' });

    const moved = db.prepare('UPDATE checklist_items SET category_id = NULL WHERE category_id = ? AND project_id = ?').run(category.id, category.project_id);
    db.prepare('DELETE FROM checklist_categories WHERE id = ?').run(category.id);
    res.json({ message: 'Категория удалена', moved: moved.changes });
  } catch (err) {
    console.error('deleteChecklistCategory error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function addSubtask(req, res) {
  try {
    const item = db.prepare('SELECT ci.* FROM checklist_items ci JOIN projects p ON ci.project_id = p.id WHERE ci.id = ? AND p.user_id = ?').get(req.params.itemId, req.user.id);
    if (!item) return res.status(404).json({ error: 'Задача не найдена' });

    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Текст подзадачи обязателен' });

    const result = db.prepare('INSERT INTO subtasks (checklist_item_id, text, done) VALUES (?, ?, 0)').run(item.id, text.trim());
    res.status(201).json({ subtask: db.prepare('SELECT * FROM subtasks WHERE id = ?').get(result.lastInsertRowid) });
  } catch (err) {
    console.error('addSubtask error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function updateSubtask(req, res) {
  try {
    const subtask = db.prepare(`
      SELECT s.* FROM subtasks s
      JOIN checklist_items ci ON s.checklist_item_id = ci.id
      JOIN projects p ON ci.project_id = p.id
      WHERE s.id = ? AND p.user_id = ?
    `).get(req.params.subId, req.user.id);
    if (!subtask) return res.status(404).json({ error: 'Подзадача не найдена' });

    const { text, done } = req.body;
    db.prepare('UPDATE subtasks SET text = ?, done = ? WHERE id = ?').run(
      text !== undefined ? text : subtask.text,
      done !== undefined ? (done ? 1 : 0) : subtask.done,
      subtask.id
    );

    res.json({ subtask: db.prepare('SELECT * FROM subtasks WHERE id = ?').get(subtask.id) });
  } catch (err) {
    console.error('updateSubtask error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function deleteSubtask(req, res) {
  try {
    const subtask = db.prepare(`
      SELECT s.* FROM subtasks s
      JOIN checklist_items ci ON s.checklist_item_id = ci.id
      JOIN projects p ON ci.project_id = p.id
      WHERE s.id = ? AND p.user_id = ?
    `).get(req.params.subId, req.user.id);
    if (!subtask) return res.status(404).json({ error: 'Подзадача не найдена' });

    db.prepare('DELETE FROM subtasks WHERE id = ?').run(subtask.id);
    res.json({ message: 'Удалена' });
  } catch (err) {
    console.error('deleteSubtask error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// ==================== ВЕХИ ====================

function addMilestone(req, res) {
  try {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const { title, date, description } = req.body;
    if (!title) return res.status(400).json({ error: 'Название обязательно' });

    const result = db.prepare('INSERT INTO milestones (project_id, title, date, description, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)').run(project.id, title, date || null, description || '');

    logActivity(req.user.id, project.id, 'milestone_add', `Веха: ${title}`);
    res.status(201).json({ milestone: db.prepare('SELECT * FROM milestones WHERE id = ?').get(result.lastInsertRowid) });
  } catch (err) {
    console.error('addMilestone error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function deleteMilestone(req, res) {
  try {
    const milestone = db.prepare('SELECT m.* FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.id = ? AND p.user_id = ?').get(req.params.milestoneId, req.user.id);
    if (!milestone) return res.status(404).json({ error: 'Веха не найдена' });

    db.prepare('DELETE FROM milestones WHERE id = ?').run(milestone.id);
    res.json({ message: 'Удалена' });
  } catch (err) {
    console.error('deleteMilestone error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function updateMilestone(req, res) {
  try {
    const milestone = db.prepare('SELECT m.* FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.id = ? AND p.user_id = ?').get(req.params.milestoneId, req.user.id);
    if (!milestone) return res.status(404).json({ error: 'Веха не найдена' });

    const { title, date, description } = req.body;
    db.prepare('UPDATE milestones SET title = ?, date = ?, description = ? WHERE id = ?').run(
      title || milestone.title,
      date !== undefined ? date : milestone.date,
      description !== undefined ? description : milestone.description,
      milestone.id
    );

    res.json({ milestone: db.prepare('SELECT * FROM milestones WHERE id = ?').get(milestone.id) });
  } catch (err) {
    console.error('updateMilestone error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// ==================== КОММЕНТАРИИ ====================

function addComment(req, res) {
  try {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const { author, text } = req.body;
    if (!text) return res.status(400).json({ error: 'Текст комментария обязателен' });

    const result = db.prepare('INSERT INTO comments (project_id, author, text) VALUES (?, ?, ?)').run(project.id, author || req.user.username || 'Аноним', text);

    logActivity(req.user.id, project.id, 'comment_add', `Комментарий: ${text.slice(0, 50)}`);
    res.status(201).json({ comment: db.prepare('SELECT * FROM comments WHERE id = ?').get(result.lastInsertRowid) });
  } catch (err) {
    console.error('addComment error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function updateComment(req, res) {
  try {
    const comment = db.prepare(
      'SELECT c.* FROM comments c JOIN projects p ON c.project_id = p.id WHERE c.id = ? AND p.user_id = ?'
    ).get(req.params.commentId, req.user.id);
    if (!comment) return res.status(404).json({ error: 'Комментарий не найден' });

    const { author, text } = req.body;
    if (text !== undefined && !String(text).trim()) {
      return res.status(400).json({ error: 'Текст комментария обязателен' });
    }

    db.prepare('UPDATE comments SET author = ?, text = ? WHERE id = ?').run(
      author !== undefined ? (String(author).trim() || 'Аноним') : comment.author,
      text !== undefined ? String(text).trim() : comment.text,
      comment.id
    );

    logActivity(req.user.id, comment.project_id, 'comment_edit', 'Комментарий изменён');
    res.json({ comment: db.prepare('SELECT * FROM comments WHERE id = ?').get(comment.id) });
  } catch (err) {
    console.error('updateComment error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function deleteComment(req, res) {
  try {
    const comment = db.prepare(
      'SELECT c.* FROM comments c JOIN projects p ON c.project_id = p.id WHERE c.id = ? AND p.user_id = ?'
    ).get(req.params.commentId, req.user.id);
    if (!comment) return res.status(404).json({ error: 'Комментарий не найден' });

    db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
    logActivity(req.user.id, comment.project_id, 'comment_delete', 'Комментарий удалён');
    res.json({ message: 'Удалён' });
  } catch (err) {
    console.error('deleteComment error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// ==================== ФОТО ====================

function addPhotos(req, res) {
  try {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Файлы не загружены' });
    }

    const insertPhoto = db.prepare('INSERT INTO photos (project_id, filename, original_name, width, height, size) VALUES (?, ?, ?, ?, ?, ?)');
    const addedPhotos = [];

    req.files.forEach(file => {
      const result = insertPhoto.run(project.id, file.filename, file.originalname, 0, 0, file.size);
      addedPhotos.push(db.prepare('SELECT * FROM photos WHERE id = ?').get(result.lastInsertRowid));
    });

    logActivity(req.user.id, project.id, 'photos_add', `Добавлено ${req.files.length} фото`);
    res.status(201).json({ photos: addedPhotos });

    const filenames = req.files.map(file => file.filename);
    setImmediate(() => {
      const photosDir = path.join(process.env.UPLOADS_PATH || './uploads', 'photos');
      filenames.forEach(filename => {
        try { ensureThumbnail(photosDir, filename); } catch (e) { /* thumbnails are best-effort */ }
      });
    });
  } catch (err) {
    console.error('addPhotos error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function deletePhoto(req, res) {
  try {
    const photo = db.prepare('SELECT ph.* FROM photos ph JOIN projects p ON ph.project_id = p.id WHERE ph.id = ? AND p.user_id = ?').get(req.params.photoId, req.user.id);
    if (!photo) return res.status(404).json({ error: 'Фото не найдено' });

    // Удаляем файл с диска
    const filePath = path.join(process.env.UPLOADS_PATH || './uploads', 'photos', photo.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const thumb = thumbName(photo.filename);
    if (thumb) {
      const thumbPath = path.join(process.env.UPLOADS_PATH || './uploads', 'photos', thumb);
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    }

    db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
    logActivity(req.user.id, photo.project_id, 'photo_delete', 'Фото удалено');
    res.json({ message: 'Удалено' });
  } catch (err) {
    console.error('deletePhoto error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// ==================== ФАЙЛЫ ====================

function addFiles(req, res) {
  try {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Файлы не загружены' });
    }

    const insertFile = db.prepare('INSERT INTO files (project_id, filename, original_name, type, size) VALUES (?, ?, ?, ?, ?)');
    const addedFiles = [];

    req.files.forEach(file => {
      const isImage = file.mimetype.startsWith('image/');
      const result = insertFile.run(project.id, file.filename, file.originalname, isImage ? 'image' : 'file', file.size);
      addedFiles.push(db.prepare('SELECT * FROM files WHERE id = ?').get(result.lastInsertRowid));
    });

    logActivity(req.user.id, project.id, 'files_add', `Добавлено ${req.files.length} файлов`);
    res.status(201).json({ files: addedFiles });
  } catch (err) {
    console.error('addFiles error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function deleteFile(req, res) {
  try {
    const file = db.prepare('SELECT f.* FROM files f JOIN projects p ON f.project_id = p.id WHERE f.id = ? AND p.user_id = ?').get(req.params.fileId, req.user.id);
    if (!file) return res.status(404).json({ error: 'Файл не найден' });

    const filePath = path.join(process.env.UPLOADS_PATH || './uploads', 'files', file.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
    logActivity(req.user.id, file.project_id, 'file_delete', 'Файл удалён');
    res.json({ message: 'Удалён' });
  } catch (err) {
    console.error('deleteFile error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// ==================== АКТИВНОСТЬ ====================

function getActivity(req, res) {
  try {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const activity = db.prepare(
      'SELECT * FROM activity_log WHERE project_id = ? ORDER BY timestamp DESC LIMIT 50'
    ).all(project.id);

    res.json({ activity });
  } catch (err) {
    console.error('getActivity error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// Глобальная лента активности пользователя (по всем проектам) — для дашборда
function getRecentActivity(req, res) {
  try {
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    if (limit > 100) limit = 100;

    const activity = db.prepare(`
      SELECT a.*, p.name AS project_name
      FROM activity_log a
      LEFT JOIN projects p ON p.id = a.project_id
      WHERE a.user_id = ?
      ORDER BY a.timestamp DESC
      LIMIT ?
    `).all(req.user.id, limit);

    res.json({ activity });
  } catch (err) {
    console.error('getRecentActivity error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// Последняя активность по каждому проекту пользователя — для индикатора «застоя»
function getLastActivity(req, res) {
  try {
    const activity = db.prepare(`
      SELECT project_id, MAX(timestamp) AS last
      FROM activity_log
      WHERE user_id = ? AND project_id IS NOT NULL
      GROUP BY project_id
    `).all(req.user.id);

    res.json({ activity });
  } catch (err) {
    console.error('getLastActivity error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// ==================== ИМПОРТ ====================

function importProjects(req, res) {
  try {
    const { projects } = req.body;
    if (!projects || !Array.isArray(projects)) {
      return res.status(400).json({ error: 'Массив projects обязателен' });
    }

    let imported = 0;
    let failed = 0;
    const errors = [];

    const insertProject = db.prepare(`
      INSERT OR REPLACE INTO projects (id, user_id, name, description, logo, tags, status, priority, color, favorite, pinned, deadline, start_date, estimated_hours, folder_path, created_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertNote = db.prepare(`
      INSERT OR REPLACE INTO notes (id, project_id, title, text, language, attachments, pinned, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertVersion = db.prepare(`
      INSERT OR REPLACE INTO versions (id, project_id, number, description, date, attachments, note_ids, checklist_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertChecklistCategory = db.prepare(`
      INSERT INTO checklist_categories (project_id, name, color, position)
      VALUES (?, ?, ?, ?)
    `);

    const insertChecklist = db.prepare(`
      INSERT INTO checklist_items (project_id, text, priority, done, position, attachments, category_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSubtask = db.prepare(`
      INSERT INTO subtasks (checklist_item_id, text, done)
      VALUES (?, ?, ?)
    `);

    const insertMilestone = db.prepare(`
      INSERT INTO milestones (project_id, title, date, description, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const insertComment = db.prepare(`
      INSERT INTO comments (project_id, author, text, created_at)
      VALUES (?, ?, ?, ?)
    `);

    const insertScript = db.prepare(`
      INSERT OR REPLACE INTO project_scripts
        (id, project_id, name, command, workdir, shell, env, confirm, auto_start, favorite, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deleteScripts = db.prepare('DELETE FROM project_scripts WHERE project_id = ?');
    const deleteChecklist = db.prepare('DELETE FROM checklist_items WHERE project_id = ?');
    const deleteChecklistCategories = db.prepare('DELETE FROM checklist_categories WHERE project_id = ?');
    const deleteMilestones = db.prepare('DELETE FROM milestones WHERE project_id = ?');
    const deleteComments = db.prepare('DELETE FROM comments WHERE project_id = ?');
    const deleteNotes = db.prepare('DELETE FROM notes WHERE project_id = ?');
    const deleteVersions = db.prepare('DELETE FROM versions WHERE project_id = ?');
    const deleteEntityLinks = db.prepare('DELETE FROM entity_links WHERE project_id = ?');

    projects.forEach(p => {
      try {
        if (p.id === undefined || p.id === null || p.id === '') {
          throw new Error('У проекта отсутствует id');
        }
        p.id = String(p.id);

        db.transaction(() => {
        // Вставляем или обновляем проект
        insertProject.run(
          p.id, req.user.id,
          p.name || 'Без названия',
          p.description || '',
          p.logo || null,
          JSON.stringify(p.tags || []),
          p.status || 'active',
          p.priority || 'p3',
          p.color || '#0071e3',
          p.favorite ? 1 : 0,
          p.pinned ? 1 : 0,
          p.deadline || null,
          p.startDate || p.start_date || null,
          p.estimatedHours || p.estimated_hours || null,
          p.folderPath || p.folder_path || '',
          p.createdAt || p.created_at || new Date().toISOString(),
          p.deletedAt || p.deleted_at || null
        );

        // Очищаем старые связанные данные
        deleteNotes.run(p.id);
        deleteVersions.run(p.id);
        deleteChecklist.run(p.id);
        deleteChecklistCategories.run(p.id);
        deleteMilestones.run(p.id);
        deleteComments.run(p.id);
        deleteScripts.run(p.id);
        deleteEntityLinks.run(p.id);

        const noteMap = {};
        const itemMap = {};
        const deferredLinks = [];

        // Заметки
        if (p.notes && Array.isArray(p.notes)) {
          p.notes.forEach(n => {
            try {
              const noteId = n.id || ('note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
              if (n.id !== undefined && n.id !== null) noteMap[String(n.id)] = noteId;
              insertNote.run(
                noteId,
                p.id,
                n.title || '',
                n.text || '',
                n.language || 'javascript',
                JSON.stringify(Array.isArray(n.attachments) ? n.attachments : []),
                n.pinned ? 1 : 0,
                JSON.stringify(sanitizeTags(n.tags)),
                n.createdAt || n.created_at || new Date().toISOString(),
                n.updated_at || null
              );
              deferredLinks.push({
                sourceType: 'note',
                sourceId: noteId,
                note_ids: n.note_ids,
                checklist_ids: n.checklist_ids !== undefined ? n.checklist_ids : n.links
              });
            } catch (e) { throw e; }
          });
        }

        // Версии
        if (p.versions && Array.isArray(p.versions)) {
          p.versions.forEach(v => {
            try {
              const versionId = v.id || ('ver_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4));
              insertVersion.run(
                versionId,
                p.id,
                v.number || '1.0.0',
                v.description || '',
                v.date || new Date().toISOString(),
                JSON.stringify(Array.isArray(v.attachments) ? v.attachments : []),
                '[]',
                '[]'
              );
              deferredLinks.push({
                sourceType: 'version',
                sourceId: versionId,
                note_ids: v.note_ids,
                checklist_ids: v.checklist_ids
              });
            } catch (e) { throw e; }
          });
        }

        // Категории чеклиста
        const categoryMap = {};
        const sourceCategories = p.checklistCategories || p.checklist_categories || [];
        if (Array.isArray(sourceCategories)) {
          sourceCategories.forEach((c, idx) => {
            try {
              const colorValue = /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : '#2f6df6';
              const result = insertChecklistCategory.run(p.id, c.name || 'Без названия', colorValue, idx);
              if (c.id !== undefined && c.id !== null) categoryMap[String(c.id)] = result.lastInsertRowid;
            } catch (e) { throw e; }
          });
        }

        // Чеклист
        if (p.checklist && Array.isArray(p.checklist)) {
          p.checklist.forEach((item, idx) => {
            try {
              var rawCategoryId = item.category_id !== undefined ? item.category_id : item.categoryId;
              var categoryId = rawCategoryId !== null && rawCategoryId !== undefined
                ? (categoryMap[String(rawCategoryId)] || null)
                : null;
              var result = insertChecklist.run(
                p.id,
                item.text || '',
                item.priority || 'p3',
                item.done ? 1 : 0,
                idx,
                JSON.stringify(Array.isArray(item.attachments) ? item.attachments : []),
                categoryId
              );
              const itemId = result.lastInsertRowid;
              if (item.id !== undefined && item.id !== null) itemMap[String(item.id)] = itemId;
              deferredLinks.push({
                sourceType: 'checklist',
                sourceId: itemId,
                note_ids: item.note_ids,
                checklist_ids: item.checklist_ids
              });
              // Подзадачи
              if (item.subtasks && Array.isArray(item.subtasks)) {
                item.subtasks.forEach(st => {
                  try {
                    insertSubtask.run(
                      itemId,
                      st.text || '',
                      st.done ? 1 : 0
                    );
                  } catch (e) { throw e; }
                });
              }
            } catch (e) { throw e; }
          });
        }

        // Связи создаём после вставки всех сущностей, чтобы знать новые id
        deferredLinks.forEach(link => {
          try {
            const noteIds = (Array.isArray(link.note_ids) ? link.note_ids : [])
              .map(id => noteMap[String(id)])
              .filter(Boolean);
            const checklistIds = (Array.isArray(link.checklist_ids) ? link.checklist_ids : [])
              .map(id => itemMap[String(id)])
              .filter(id => id !== undefined && id !== null);
            if (!noteIds.length && !checklistIds.length) return;
            refsService.setRefs(p.id, link.sourceType, link.sourceId, {
              note_ids: noteIds,
              checklist_ids: checklistIds
            });
          } catch (e) { throw e; }
        });

        // Вехи
        if (p.milestones && Array.isArray(p.milestones)) {
          p.milestones.forEach(m => {
            try {
              insertMilestone.run(
                p.id,
                m.title || '',
                m.date || null,
                m.description || ''
              );
            } catch (e) { throw e; }
          });
        }

        // Комментарии
        if (p.comments && Array.isArray(p.comments)) {
          p.comments.forEach(c => {
            try {
              insertComment.run(
                p.id,
                c.author || 'Аноним',
                c.text || '',
                c.createdAt || c.created_at || new Date().toISOString()
              );
            } catch (e) { throw e; }
          });
        }

        // Скрипты
        if (p.scripts && Array.isArray(p.scripts)) {
          p.scripts.forEach((s, idx) => {
            try {
              const scriptId = s.id || ('scr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
              const env = s.env && typeof s.env === 'object' && !Array.isArray(s.env) ? s.env : {};
              const importedAutoStart = s.auto_start ? 1 : 0;
              const autoStart = 0;
              const confirm = importedAutoStart ? 1 : (s.confirm === undefined ? 1 : (s.confirm ? 1 : 0));
              insertScript.run(
                scriptId,
                p.id,
                s.name || 'Скрипт',
                s.command || '',
                s.workdir || '',
                s.shell || '',
                JSON.stringify(env),
                confirm,
                autoStart,
                s.favorite ? 1 : 0,
                idx,
                s.created_at || s.createdAt || new Date().toISOString(),
                s.updated_at || s.updatedAt || null
              );
            } catch (e) { throw e; }
          });
        }

        })();
        imported++;
      } catch (e) {
        failed++;
        errors.push({ name: p.name || 'Без названия', error: e.message });
        console.error('Import project error:', p.name, e.message);
      }
    });

    logActivity(req.user.id, null, 'import', 'Импортировано ' + imported + ' проектов');
    res.json({
      message: 'Импортировано ' + imported + ' проектов' + (failed ? ', ошибок: ' + failed : ''),
      imported,
      failed,
      errors
    });
  } catch (err) {
    console.error('importProjects error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

module.exports = {
  getAll, getOne, getBoard, exportAll, create, update, remove,
  addNote, updateNote, deleteNote,
  addVersion, updateVersion, deleteVersion,
  addChecklistCategory, updateChecklistCategory, deleteChecklistCategory,
  addChecklistItem, updateChecklistItem, deleteChecklistItem,
  addSubtask, updateSubtask, deleteSubtask,
  addMilestone, updateMilestone, deleteMilestone,
  addComment, updateComment, deleteComment,
  addPhotos, deletePhoto,
  addFiles, deleteFile,
  getActivity, getRecentActivity, getLastActivity,
  browseFs, setProjectFolder, getProjectFileTree, readProjectFile, openProjectPath, getEditors,
  warmEditorsCache,
  importProjects
};