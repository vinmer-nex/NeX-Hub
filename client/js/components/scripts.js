import api from '../api.js';
import store from '../store.js';
import { svgIcon, escapeHTML, showToast } from '../utils/dom.js';
import { openModal } from './modal.js';
import { showMenu } from './context-menu.js';

const MAX_LINES = 2000;

let currentProject = null;
let scriptsCache = [];
let selectedScriptId = null;
let terminalInfo = null;
let refreshCallback = null;
let eventsBound = false;
let draggedScriptId = null;
let consolePaintScheduled = false;

let consoleView = {
  scriptId: null,
  generation: -1,
  pushed: -1,
  headHTML: ''
};

const consoleState = new Map();

function getState(scriptId) {
  let state = consoleState.get(scriptId);
  if (!state) {
    state = {
      runId: null,
      lines: [],
      pushed: 0,
      generation: 0,
      status: 'idle',
      exitCode: null,
      durationMs: null,
      startedAt: null,
      shell: '',
      shellLabel: '',
      command: '',
      partial: { stdout: '', stderr: '' }
    };
    consoleState.set(scriptId, state);
  }
  return state;
}

function resetConsoleView() {
  consoleView = {
    scriptId: null,
    generation: -1,
    pushed: -1,
    headHTML: ''
  };
}

function pushLine(state, type, text) {
  state.lines.push({ type: type, text: text });
  state.pushed += 1;
}

function cleanAnsi(text) {
  return String(text || '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function trimState(state) {
  if (state.lines.length <= MAX_LINES) return;
  state.lines.splice(0, state.lines.length - MAX_LINES);
}

function appendChunk(state, type, chunk) {
  const text = cleanAnsi(chunk).replace(/\r\n/g, '\n');
  const combined = (state.partial[type] || '') + text;
  const parts = combined.split('\n');
  state.partial[type] = parts.pop();

  for (const raw of parts) {
    const line = raw.indexOf('\r') !== -1 ? raw.split('\r').pop() : raw;
    pushLine(state, type, line);
  }
  trimState(state);
}

function flushState(state) {
  ['stdout', 'stderr'].forEach(function(type) {
    const rest = state.partial[type];
    if (rest) {
      pushLine(state, type, rest.split('\r').pop());
    }
    state.partial[type] = '';
  });
}

function formatDuration(ms) {
  if (!ms && ms !== 0) return '';
  if (ms < 1000) return ms + ' мс';
  if (ms < 60000) return (ms / 1000).toFixed(1) + ' с';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return minutes + ' мин ' + seconds + ' с';
}

function handleScriptEvent(ev) {
  if (!ev || !ev.scriptId) return;
  const state = getState(ev.scriptId);

  if (ev.type === 'started') {
    state.runId = ev.runId;
    state.lines = [];
    state.pushed = 0;
    state.generation += 1;
    state.partial = { stdout: '', stderr: '' };
    state.status = 'running';
    state.exitCode = null;
    state.durationMs = null;
    state.startedAt = ev.startedAt;
    state.shell = ev.shell || '';
    state.shellLabel = ev.shellLabel || ev.shell || '';
    state.command = ev.command || '';
    pushLine(state, 'system', '$ ' + state.command);
    pushLine(state, 'system', 'Оболочка: ' + state.shellLabel + ' · ' + (ev.cwd || ''));
  } else if (ev.type === 'stdout' || ev.type === 'stderr') {
    appendChunk(state, ev.type, ev.chunk);
  } else if (ev.type === 'exit') {
    flushState(state);
    state.exitCode = ev.code;
    state.durationMs = ev.durationMs;
    if (ev.stopped) {
      state.status = 'stopped';
      pushLine(state, 'system', 'Процесс остановлен · ' + formatDuration(ev.durationMs));
    } else if (ev.code === 0) {
      state.status = 'exited';
      pushLine(state, 'success', 'Процесс завершён с кодом 0 · ' + formatDuration(ev.durationMs));
    } else if (state.status === 'error' && ev.code == null) {
      state.status = 'error';
    } else {
      state.status = 'failed';
      pushLine(state, 'system', 'Процесс завершён с кодом ' + ev.code + ' · ' + formatDuration(ev.durationMs));
    }
    trimState(state);
  } else if (ev.type === 'error') {
    state.status = 'error';
    pushLine(state, 'stderr', ev.message || 'Не удалось запустить скрипт');
    trimState(state);
  }

  const sameProject = currentProject && ev.projectId === currentProject.id;
  if (sameProject && store.currentDetailTab === 'scripts') {
    if (ev.type === 'stdout' || ev.type === 'stderr') {
      scheduleConsolePaint();
    } else {
      paintList();
      paintConsole();
    }
  }
}

function ensureScriptEvents() {
  if (eventsBound) return;
  if (!window.nexhub || typeof window.nexhub.onScriptEvent !== 'function') return;
  window.nexhub.onScriptEvent(handleScriptEvent);
  eventsBound = true;
}

function statusLabel(status) {
  const map = {
    idle: 'не запущен',
    running: 'работает',
    exited: 'завершён',
    failed: 'ошибка',
    stopped: 'остановлен',
    error: 'ошибка'
  };
  return map[status] || status;
}

function statusClass(status) {
  if (status === 'running') return 'running';
  if (status === 'exited') return 'success';
  if (status === 'failed' || status === 'error') return 'danger';
  if (status === 'stopped') return 'warning';
  return 'default';
}

function shellDisplayName(id) {
  const value = id || (terminalInfo && terminalInfo.shell) || 'auto';
  if (value === 'auto') {
    const def = terminalInfo && Array.isArray(terminalInfo.shells)
      ? terminalInfo.shells.find(function(shell) { return shell.default; })
      : null;
    return def ? 'Авто (' + def.label + ')' : 'Авто';
  }
  const found = terminalInfo && Array.isArray(terminalInfo.shells)
    ? terminalInfo.shells.find(function(shell) { return shell.id === value; })
    : null;
  return found ? found.label : value;
}

function shellLabelFor(script) {
  return shellDisplayName(script.shell || (terminalInfo && terminalInfo.shell) || 'auto');
}

function syncFromServer() {
  for (const script of scriptsCache) {
    const state = getState(script.id);
    if (script.running) {
      state.status = 'running';
      state.runId = script.runId || state.runId;
    } else if (state.status === 'running') {
      state.status = 'idle';
      state.runId = null;
    }
  }
}

function renderScriptsTab(proj) {
  currentProject = proj;
  resetConsoleView();
  scriptsCache = Array.isArray(proj.scripts) ? proj.scripts : [];
  syncFromServer();

  if (!selectedScriptId || !scriptsCache.some(function(s) { return s.id === selectedScriptId; })) {
    const running = scriptsCache.find(function(s) { return getState(s.id).status === 'running'; });
    selectedScriptId = running ? running.id : (scriptsCache[0] ? scriptsCache[0].id : null);
  }

  ensureScriptEvents();
  loadTerminalInfo();

  const hasFolder = !!(proj.folder_path);

  let html = '<div class="notes-section">';
  html += '<div class="section-header">';
  html += '<span class="section-title">' + svgIcon('terminal') + ' Скрипты проекта</span>';
  html += '<div class="files-actions">';
  html += '<button class="btn btn-sm btn-primary" id="btnAddScript">' + svgIcon('plus', 'sm') + ' Добавить скрипт</button>';
  if (scriptsCache.length) {
    html += '<button class="btn btn-sm btn-secondary" id="btnStopAllScripts">' + svgIcon('stop', 'sm') + ' Остановить все</button>';
    html += '<button class="btn btn-sm btn-secondary" id="btnRefreshScripts" title="Обновить">' + svgIcon('refresh', 'sm') + '</button>';
  }
  html += '</div></div>';

  if (!hasFolder) {
    html += '<div class="script-folder-warning">' + svgIcon('alert', 'sm') +
      ' Сначала выберите папку проекта во вкладке «Файлы» — иначе скрипты не смогут запуститься.</div>';
  }

  html += '<p class="script-hint">Команда выполняется в папке проекта. Рабочую папку можно сузить, указав относительный путь.</p>';

  html += '<div class="scripts-layout">';
  html += '<div class="scripts-list" id="scriptsList">' + renderScriptCards() + '</div>';
  html += '<div class="script-console" id="scriptConsole">';
  html += '<div class="script-console-head" id="scriptConsoleHead"></div>';
  html += '<div class="script-console-body" id="scriptConsoleBody"></div>';
  html += '<div class="script-console-foot">';
  html += '<button class="btn btn-xs btn-secondary" id="btnClearScriptConsole">' + svgIcon('trash', 'sm') + ' Очистить</button>';
  html += '<button class="btn btn-xs btn-secondary" id="btnCopyScriptConsole">' + svgIcon('copy', 'sm') + ' Копировать</button>';
  html += '</div></div>';
  html += '</div>';

  html += '</div>';
  return html;
}

function renderScriptCards() {
  if (!scriptsCache.length) {
    return '<div class="script-empty">' +
      '<div class="script-empty-icon">' + svgIcon('terminal', 'lg') + '</div>' +
      '<p>Скриптов пока нет</p>' +
      '<p class="fp-sub">Добавьте команду для запуска dev-сервера, сборки или git push.</p>' +
    '</div>';
  }

  return scriptsCache.map(function(script) {
    const state = getState(script.id);
    const active = script.id === selectedScriptId ? ' active' : '';
    const running = state.status === 'running';
    const canRun = !!(currentProject && currentProject.folder_path);

    let badges = '';
    if (script.auto_start) badges += '<span class="badge badge-accent badge-xs">автостарт</span>';
    if (script.confirm) badges += '<span class="badge badge-default badge-xs">с подтверждением</span>';

    let action = '';
    if (running) {
      action = '<button class="btn btn-icon btn-xs btn-secondary" data-act="restart" title="Перезапустить">' + svgIcon('refresh', 'sm') + '</button>' +
        '<button class="btn btn-icon btn-xs btn-danger" data-act="stop" title="Остановить">' + svgIcon('stop', 'sm') + '</button>';
    } else {
      action = '<button class="btn btn-icon btn-xs btn-primary" data-act="run" title="Запустить"' + (canRun ? '' : ' disabled') + '>' + svgIcon('play', 'sm') + '</button>';
    }

    return '<div class="script-card' + active + '" data-script-id="' + escapeHTML(script.id) + '" draggable="true">' +
      '<div class="script-card-main" data-act="select">' +
        '<div class="script-card-top">' +
          '<span class="script-name">' + escapeHTML(script.name) + '</span>' +
          (script.favorite ? '<span class="script-favorite" title="Избранное">' + svgIcon('star-filled', 'sm') + '</span>' : '') +
          '<span class="script-status ' + statusClass(state.status) + '">' + statusLabel(state.status) + '</span>' +
        '</div>' +
        '<div class="script-command">' + escapeHTML(script.command) + '</div>' +
        '<div class="script-meta">' + escapeHTML(shellLabelFor(script)) +
          (script.workdir ? ' · ' + escapeHTML(script.workdir) : '') + '</div>' +
        (badges ? '<div class="script-badges">' + badges + '</div>' : '') +
      '</div>' +
      '<div class="script-card-actions">' +
        action +
        '<button class="btn btn-icon btn-xs btn-secondary" data-act="edit" title="Редактировать">' + svgIcon('edit', 'sm') + '</button>' +
        '<button class="btn btn-icon btn-xs btn-secondary" data-act="delete" title="Удалить">' + svgIcon('trash', 'sm') + '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function paintList() {
  const list = document.getElementById('scriptsList');
  if (!list) return;
  list.innerHTML = renderScriptCards();
}

function scheduleConsolePaint() {
  if (consolePaintScheduled) return;
  consolePaintScheduled = true;
  const raf = window.requestAnimationFrame || function(callback) {
    return setTimeout(callback, 16);
  };
  raf(function() {
    consolePaintScheduled = false;
    paintConsole();
  });
}

function lineClass(type) {
  if (type === 'stderr') return ' err';
  if (type === 'system') return ' sys';
  if (type === 'success') return ' ok';
  return '';
}

function createConsoleLine(line) {
  const el = document.createElement('div');
  el.className = 'script-line' + lineClass(line.type);
  el.textContent = line.text || '\u00a0';
  return el;
}

function paintConsole() {
  const head = document.getElementById('scriptConsoleHead');
  const body = document.getElementById('scriptConsoleBody');
  if (!head || !body) return;

  const script = scriptsCache.find(function(s) { return s.id === selectedScriptId; });
  if (!script) {
    const html = '<span class="script-console-title">Консоль</span>';
    if (consoleView.headHTML !== html) {
      head.innerHTML = html;
      consoleView.headHTML = html;
    }
    body.innerHTML = '<p class="fp-empty">Выберите скрипт слева</p>';
    resetConsoleView();
    consoleView.headHTML = html;
    return;
  }

  const state = getState(script.id);
  const exitText = state.exitCode !== null && state.exitCode !== undefined
    ? ' · код ' + state.exitCode
    : '';
  const durationText = state.durationMs ? ' · ' + formatDuration(state.durationMs) : '';

  const headHTML = '<div class="script-console-title">' + escapeHTML(script.name) +
    ' <span class="script-status ' + statusClass(state.status) + '">' + statusLabel(state.status) + '</span></div>' +
    '<div class="script-console-meta">' + escapeHTML(state.shellLabel || shellLabelFor(script)) + exitText + durationText + '</div>';

  if (consoleView.headHTML !== headHTML) {
    head.innerHTML = headHTML;
    consoleView.headHTML = headHTML;
  }

  const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;

  if (!state.lines.length) {
    const emptyHTML = '<p class="fp-empty">Консоль пуста. Нажмите «Запустить» на карточке скрипта.</p>';
    if (body.innerHTML !== emptyHTML) body.innerHTML = emptyHTML;
    consoleView.scriptId = script.id;
    consoleView.generation = state.generation;
    consoleView.pushed = state.pushed;
    if (nearBottom) body.scrollTop = body.scrollHeight;
    return;
  }

  const hasPlaceholder = body.firstElementChild && body.firstElementChild.classList.contains('fp-empty');
  let full = consoleView.scriptId !== script.id ||
    consoleView.generation !== state.generation ||
    consoleView.pushed === -1 ||
    state.pushed < consoleView.pushed ||
    !body.firstElementChild ||
    hasPlaceholder;

  const missing = state.pushed - consoleView.pushed;
  if (missing >= state.lines.length) full = true;

  if (full) {
    body.innerHTML = '';
    const fragment = document.createDocumentFragment();
    state.lines.forEach(function(line) {
      fragment.appendChild(createConsoleLine(line));
    });
    body.appendChild(fragment);
    consoleView.scriptId = script.id;
    consoleView.generation = state.generation;
    consoleView.pushed = state.pushed;
  } else if (missing > 0) {
    const fragment = document.createDocumentFragment();
    const startIndex = Math.max(0, state.lines.length - missing);
    for (let i = startIndex; i < state.lines.length; i++) {
      fragment.appendChild(createConsoleLine(state.lines[i]));
    }
    body.appendChild(fragment);
    while (body.childElementCount > MAX_LINES) {
      body.removeChild(body.firstElementChild);
    }
    consoleView.scriptId = script.id;
    consoleView.generation = state.generation;
    consoleView.pushed = state.pushed;
  }

  if (nearBottom) body.scrollTop = body.scrollHeight;
}

async function loadTerminalInfo(force) {
  try {
    terminalInfo = await api.getTerminalSettings(!!force);
    if (store.currentDetailTab === 'scripts' && currentProject) {
      paintList();
      paintConsole();
    }
  } catch (e) {}
}

async function reloadScripts() {
  if (!currentProject) return;
  try {
    const data = await api.getScripts(currentProject.id);
    scriptsCache = data.scripts || [];
    syncFromServer();
    paintList();
    paintConsole();
  } catch (err) {
    showToast(err.message || 'Не удалось обновить скрипты', true);
  }
}

function confirmAction(title, bodyHTML, okLabel, danger) {
  return new Promise(function(resolve) {
    const footer = '<button class="btn btn-secondary" id="scriptConfirmCancel" type="button">Отмена</button>' +
      '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" id="scriptConfirmOk" type="button">' +
      escapeHTML(okLabel) + '</button>';
    const overlay = openModal(title, bodyHTML, null, { footer });

    function done(value) {
      overlay.remove();
      resolve(value);
    }

    overlay.querySelector('#scriptConfirmCancel').addEventListener('click', function() { done(false); });
    overlay.querySelector('#scriptConfirmOk').addEventListener('click', function() { done(true); });
  });
}

async function runScript(script, skipConfirm) {
  if (script.confirm && !skipConfirm) {
    const ok = await confirmAction(
      'Запуск скрипта',
      '<p class="script-confirm-text">Запустить <strong>' + escapeHTML(script.name) + '</strong>?</p>' +
      '<pre class="script-confirm-command">' + escapeHTML(script.command) + '</pre>',
      'Запустить'
    );
    if (!ok) return;
  }

  try {
    const result = await api.runScript(currentProject.id, script.id);
    const state = getState(script.id);
    state.status = 'running';
    state.runId = result.runId;
    selectedScriptId = script.id;
    paintList();
    paintConsole();
  } catch (err) {
    showToast(err.message || 'Не удалось запустить скрипт', true);
    await reloadScripts();
  }
}

async function restartScript(script) {
  try {
    const result = await api.restartScript(currentProject.id, script.id);
    const state = getState(script.id);
    state.status = 'running';
    state.runId = result.runId;
    selectedScriptId = script.id;
    paintList();
    paintConsole();
    showToast('Перезапускаю «' + script.name + '»');
  } catch (err) {
    showToast(err.message || 'Не удалось перезапустить скрипт', true);
    await reloadScripts();
  }
}

async function toggleFavorite(script) {
  const next = !script.favorite;
  script.favorite = next;
  paintList();

  try {
    const data = await api.updateScript(currentProject.id, script.id, { favorite: next });
    if (data && data.script) script.favorite = !!data.script.favorite;
  } catch (err) {
    script.favorite = !next;
    showToast(err.message || 'Не удалось изменить избранное', true);
  }
  paintList();
}

async function duplicateScript(script) {
  const suffix = ' (копия)';
  const base = String(script.name || 'Скрипт');
  const name = (base.length + suffix.length > 80 ? base.slice(0, 80 - suffix.length) : base) + suffix;

  try {
    await api.createScript(currentProject.id, {
      name: name,
      command: script.command,
      workdir: script.workdir,
      shell: script.shell,
      env: script.env,
      confirm: script.confirm,
      auto_start: false,
      favorite: !!script.favorite
    });
    showToast('Скрипт дублирован');
    await refreshAfterChange();
  } catch (err) {
    showToast(err.message || 'Не удалось дублировать скрипт', true);
  }
}

async function stopScript(script) {
  try {
    await api.stopScript(currentProject.id, script.id);
    showToast('Останавливаю «' + script.name + '»');
  } catch (err) {
    showToast(err.message || 'Не удалось остановить скрипт', true);
  }
}

async function deleteScript(script) {
  const ok = await confirmAction(
    'Удаление скрипта',
    '<p class="script-confirm-text">Удалить <strong>' + escapeHTML(script.name) + '</strong>? Это действие необратимо.</p>',
    'Удалить',
    true
  );
  if (!ok) return;

  try {
    await api.deleteScript(currentProject.id, script.id);
    consoleState.delete(script.id);
    showToast('Скрипт удалён');
    await refreshAfterChange();
  } catch (err) {
    showToast(err.message || 'Не удалось удалить скрипт', true);
  }
}

async function stopAllScripts() {
  const ok = await confirmAction(
    'Остановить все скрипты',
    '<p class="script-confirm-text">Остановить все запущенные скрипты этого проекта?</p>',
    'Остановить',
    true
  );
  if (!ok) return;

  try {
    await api.stopAllScripts(currentProject.id);
    showToast('Скрипты остановлены');
  } catch (err) {
    showToast(err.message || 'Не удалось остановить скрипты', true);
  }
}

async function refreshAfterChange() {
  if (refreshCallback) {
    try {
      await refreshCallback();
      return;
    } catch (e) {}
  }
  await reloadScripts();
}

function envToLines(env) {
  if (!env || typeof env !== 'object') return '';
  return Object.keys(env).map(function(key) {
    return key + '=' + String(env[key]);
  }).join('\n');
}

function parseEnvLines(text) {
  const env = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.charAt(0) === '#') continue;
    const idx = line.indexOf('=');
    if (idx < 1) {
      const err = new Error('Переменная окружения должна быть в формате KEY=VALUE');
      err.code = 'VALIDATION';
      throw err;
    }
    const key = line.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      const err = new Error('Некорректное имя переменной: ' + key);
      err.code = 'VALIDATION';
      throw err;
    }
    env[key] = line.slice(idx + 1);
  }
  return env;
}

function shellHint(id) {
  const value = id || (terminalInfo && terminalInfo.shell) || 'auto';
  if (value === 'auto') {
    return 'Будет использована оболочка из настроек: ' + shellDisplayName('auto') + '.';
  }
  if (value === 'cmd') return 'cmd.exe: && и || работают.';
  if (value === 'powershell') return 'PowerShell 5.1: && не поддерживается — используйте ; или отдельные команды.';
  if (value === 'pwsh') return 'PowerShell 7: && и || работают.';
  if (value === 'bash') return 'Git Bash: && и || работают.';
  return '';
}

function switchRow(id, label, desc, checked) {
  return '<label class="switch-row" for="' + id + '">' +
    '<span class="switch-text">' +
      '<span class="switch-label">' + escapeHTML(label) + '</span>' +
      (desc ? '<span class="switch-desc">' + escapeHTML(desc) + '</span>' : '') +
    '</span>' +
    '<span class="switch"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '>' +
    '<span class="switch-track"></span></span>' +
  '</label>';
}

async function openScriptModal(script) {
  await loadTerminalInfo(false);

  const isEdit = !!script;
  const shells = terminalInfo && Array.isArray(terminalInfo.shells) ? terminalInfo.shells : [];
  const inheritedId = (terminalInfo && terminalInfo.shell) || 'auto';

  let shellOptions = '<option value="">Как в настройках (' + escapeHTML(shellDisplayName(inheritedId)) + ')</option>';
  shellOptions += shells.map(function(shell) {
    const selected = script && script.shell === shell.id ? ' selected' : '';
    const disabled = shell.available ? '' : ' disabled';
    const suffix = shell.available ? '' : ' — не найдено';
    return '<option value="' + escapeHTML(shell.id) + '"' + selected + disabled + '>' +
      escapeHTML(shell.label + suffix) + '</option>';
  }).join('');

  const body = '' +
    '<div class="form-group">' +
      '<span class="form-label">Название</span>' +
      '<input class="form-input" id="scriptName" maxlength="80" placeholder="Например: Dev-сервер" value="' + escapeHTML(script ? script.name : '') + '">' +
    '</div>' +
    '<div class="form-group">' +
      '<span class="form-label">Команда</span>' +
      '<textarea class="form-input script-command-input" id="scriptCommand" rows="4" spellcheck="false" placeholder="npm run dev">' + escapeHTML(script ? script.command : '') + '</textarea>' +
    '</div>' +
    '<div class="form-grid">' +
      '<div class="form-group">' +
        '<span class="form-label">Рабочая папка</span>' +
        '<input class="form-input" id="scriptWorkdir" placeholder="Пусто = корень проекта" value="' + escapeHTML(script ? script.workdir : '') + '">' +
        '<p class="script-field-hint">Относительно папки проекта, например server</p>' +
      '</div>' +
      '<div class="form-group">' +
        '<span class="form-label">Оболочка</span>' +
        '<select class="form-input" id="scriptShell">' + shellOptions + '</select>' +
      '</div>' +
    '</div>' +
    '<p class="script-field-hint" id="scriptShellHint">' + escapeHTML(shellHint(script ? script.shell : '')) + '</p>' +
    '<div class="form-group">' +
      '<span class="form-label">Переменные окружения</span>' +
      '<textarea class="form-input script-env-input" id="scriptEnv" rows="3" spellcheck="false" placeholder="API_URL=http://localhost:3000">' + escapeHTML(script ? envToLines(script.env) : '') + '</textarea>' +
    '</div>' +
    '<div class="script-switches">' +
      switchRow('scriptConfirm', 'Спрашивать подтверждение', 'Показывать окно перед запуском.', script ? !!script.confirm : true) +
      switchRow('scriptAutoStart', 'Запускать при открытии проекта', 'Скрипт стартует автоматически при входе в проект.', script ? !!script.auto_start : false) +
    '</div>';

  const footer = '<button class="btn btn-secondary modal-close-x" type="button">Отмена</button>' +
    '<button class="btn btn-primary" id="modalSaveBtn" type="button">' + (isEdit ? 'Сохранить' : 'Добавить') + '</button>';

  const overlay = openModal(isEdit ? 'Редактировать скрипт' : 'Новый скрипт', body, async function(el) {
    const name = el.querySelector('#scriptName').value.trim();
    const command = el.querySelector('#scriptCommand').value.trim();
    const workdir = el.querySelector('#scriptWorkdir').value.trim();
    const shell = el.querySelector('#scriptShell').value;
    const autoStart = el.querySelector('#scriptAutoStart').checked;
    const confirm = autoStart ? false : el.querySelector('#scriptConfirm').checked;

    if (!name) { showToast('Укажите название', true); return false; }
    if (!command) { showToast('Укажите команду', true); return false; }

    let env;
    try {
      env = parseEnvLines(el.querySelector('#scriptEnv').value);
    } catch (err) {
      showToast(err.message, true);
      return false;
    }

    const payload = {
      name: name,
      command: command,
      workdir: workdir,
      shell: shell,
      env: env,
      confirm: confirm,
      auto_start: autoStart
    };

    try {
      if (isEdit) await api.updateScript(currentProject.id, script.id, payload);
      else await api.createScript(currentProject.id, payload);
      showToast(isEdit ? 'Скрипт сохранён' : 'Скрипт добавлен');
      await refreshAfterChange();
      return true;
    } catch (err) {
      showToast(err.message || 'Не удалось сохранить скрипт', true);
      return false;
    }
  }, { footer });

  const shellSelect = overlay.querySelector('#scriptShell');
  const shellHintEl = overlay.querySelector('#scriptShellHint');
  const autoStartInput = overlay.querySelector('#scriptAutoStart');
  const confirmInput = overlay.querySelector('#scriptConfirm');

  function updateShellHint() {
    shellHintEl.textContent = shellHint(shellSelect.value);
  }

  function updateAutoStart() {
    if (autoStartInput.checked) {
      confirmInput.checked = false;
      confirmInput.disabled = true;
    } else {
      confirmInput.disabled = false;
    }
  }

  shellSelect.addEventListener('change', updateShellHint);
  autoStartInput.addEventListener('change', updateAutoStart);
  updateAutoStart();
}

function bindScriptsTab(proj, opts) {
  currentProject = proj;
  refreshCallback = opts && opts.refresh ? opts.refresh : refreshCallback;
  ensureScriptEvents();

  const addBtn = document.getElementById('btnAddScript');
  if (addBtn) addBtn.addEventListener('click', function() { openScriptModal(null); });

  const refreshBtn = document.getElementById('btnRefreshScripts');
  if (refreshBtn) refreshBtn.addEventListener('click', function() { reloadScripts(); });

  const stopAllBtn = document.getElementById('btnStopAllScripts');
  if (stopAllBtn) stopAllBtn.addEventListener('click', stopAllScripts);

  const list = document.getElementById('scriptsList');
  if (list) {
    list.addEventListener('click', function(e) {
      const card = e.target.closest('.script-card');
      if (!card) return;
      const script = scriptsCache.find(function(s) { return s.id === card.dataset.scriptId; });
      if (!script) return;

      const actionEl = e.target.closest('[data-act]');
      const action = actionEl ? actionEl.dataset.act : 'select';

      if (action === 'select') {
        selectedScriptId = script.id;
        paintList();
        paintConsole();
      } else if (action === 'run') {
        runScript(script);
      } else if (action === 'restart') {
        restartScript(script);
      } else if (action === 'stop') {
        stopScript(script);
      } else if (action === 'edit') {
        openScriptModal(script);
      } else if (action === 'delete') {
        deleteScript(script);
      }
    });

    list.addEventListener('contextmenu', function(e) {
      const card = e.target.closest('.script-card');
      if (!card) return;
      const script = scriptsCache.find(function(s) { return s.id === card.dataset.scriptId; });
      if (!script) return;

      selectedScriptId = script.id;
      list.querySelectorAll('.script-card').forEach(function(item) {
        item.classList.toggle('active', item.dataset.scriptId === script.id);
      });
      paintConsole();

      const state = getState(script.id);
      const running = state.status === 'running';
      const canRun = !!(currentProject && currentProject.folder_path);
      const items = [
        { label: script.favorite ? 'Убрать из избранного' : 'В избранное', icon: script.favorite ? 'star-filled' : 'star', action: function() { toggleFavorite(script); } },
        { label: 'Дублировать', icon: 'duplicate', action: function() { duplicateScript(script); } },
        { separator: true },
        { label: 'Редактировать', icon: 'edit', action: function() { openScriptModal(script); } }
      ];

      if (running) {
        items.push({ label: 'Перезапустить', icon: 'refresh', action: function() { restartScript(script); } });
        items.push({ label: 'Остановить', icon: 'stop', danger: true, action: function() { stopScript(script); } });
      } else if (canRun) {
        items.push({ label: 'Запустить', icon: 'play', action: function() { runScript(script); } });
      }

      items.push({ separator: true });
      items.push({ label: 'Удалить', icon: 'trash', danger: true, action: function() { deleteScript(script); } });

      showMenu(e, items);
    });

    list.addEventListener('dragstart', function(e) {
      const card = e.target.closest('.script-card');
      if (!card) return;
      draggedScriptId = card.dataset.scriptId;
      card.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', draggedScriptId); } catch (err) {}
      }
    });

    list.addEventListener('dragover', function(e) {
      const card = e.target.closest('.script-card');
      if (!card || !draggedScriptId || card.dataset.scriptId === draggedScriptId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const previous = list.querySelector('.script-card.drag-over');
      if (previous && previous !== card) previous.classList.remove('drag-over');
      card.classList.add('drag-over');
    });

    list.addEventListener('dragleave', function(e) {
      const card = e.target.closest('.script-card');
      if (card && !card.contains(e.relatedTarget)) card.classList.remove('drag-over');
    });

    list.addEventListener('dragend', function() {
      draggedScriptId = null;
      list.querySelectorAll('.script-card.dragging, .script-card.drag-over').forEach(function(card) {
        card.classList.remove('dragging', 'drag-over');
      });
    });

    list.addEventListener('drop', async function(e) {
      const target = e.target.closest('.script-card');
      const sourceId = draggedScriptId || (e.dataTransfer ? e.dataTransfer.getData('text/plain') : '');
      if (!target || !sourceId) return;
      e.preventDefault();

      const fromIndex = scriptsCache.findIndex(function(s) { return s.id === sourceId; });
      const toIndex = scriptsCache.findIndex(function(s) { return s.id === target.dataset.scriptId; });
      draggedScriptId = null;
      list.querySelectorAll('.script-card.dragging, .script-card.drag-over').forEach(function(card) {
        card.classList.remove('dragging', 'drag-over');
      });

      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

      const moved = scriptsCache.splice(fromIndex, 1)[0];
      scriptsCache.splice(toIndex, 0, moved);
      selectedScriptId = moved.id;
      paintList();
      paintConsole();

      try {
        await api.reorderScripts(currentProject.id, scriptsCache.map(function(s) { return s.id; }));
      } catch (err) {
        showToast(err.message || 'Не удалось сохранить порядок скриптов', true);
        await reloadScripts();
      }
    });
  }

  const consoleEl = document.getElementById('scriptConsole');
  if (consoleEl) {
    consoleEl.addEventListener('click', function(e) {
      if (e.target.closest('#btnClearScriptConsole')) {
        if (!selectedScriptId) return;
        const state = getState(selectedScriptId);
        state.lines = [];
        state.pushed = 0;
        state.generation += 1;
        state.partial = { stdout: '', stderr: '' };
        paintConsole();
      } else if (e.target.closest('#btnCopyScriptConsole')) {
        if (!selectedScriptId) return;
        const state = getState(selectedScriptId);
        const text = state.lines.map(function(line) { return line.text; }).join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function() {
            showToast('Скопировано');
          }).catch(function() {
            showToast('Не удалось скопировать', true);
          });
        } else {
          showToast('Не удалось скопировать', true);
        }
      }
    });
  }

  paintList();
  paintConsole();
}

function maybeAutostart(proj) {
  if (!proj || !proj.id || !proj.folder_path) return;
  if (!Array.isArray(proj.scripts) || !proj.scripts.some(function(s) { return s.auto_start; })) return;

  api.autostartScripts(proj.id).then(function(result) {
    if (result && result.errors && result.errors.length) {
      showToast('Автостарт: ' + result.errors[0].error, true);
    }
  }).catch(function() {});
}

ensureScriptEvents();

export { renderScriptsTab, bindScriptsTab, maybeAutostart };
