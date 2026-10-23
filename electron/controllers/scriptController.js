const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const runner = require('../scripts/runner');
const shells = require('../lib/shells');
const session = require('../session');

const MAX_NAME = 80;
const MAX_COMMAND = 4000;
const MAX_ENV_KEYS = 50;
const MAX_ENV_VALUE = 2000;

function logActivity(userId, projectId, type, detail) {
  db.prepare(
    'INSERT INTO activity_log (user_id, project_id, type, detail) VALUES (?, ?, ?, ?)'
  ).run(userId, projectId, type, detail);
}

function getOwnedProject(req) {
  return db.prepare('SELECT id, name, folder_path FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
}

function getOwnedScript(req) {
  return db.prepare(
    'SELECT s.* FROM project_scripts s ' +
    'JOIN projects p ON p.id = s.project_id ' +
    'WHERE s.id = ? AND s.project_id = ? AND p.user_id = ?'
  ).get(req.params.scriptId, req.params.id, req.user.id);
}

function parseEnv(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function serializeScript(row) {
  return {
    ...row,
    env: parseEnv(row.env),
    confirm: !!row.confirm,
    auto_start: !!row.auto_start,
    favorite: !!row.favorite,
    running: runner.isRunning(row.project_id, row.id),
    runId: runner.getRunId(row.project_id, row.id)
  };
}

function sanitizeName(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_NAME);
}

function sanitizeCommand(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_COMMAND);
}

function sanitizeWorkdir(value) {
  const raw = String(value == null ? '' : value).trim().replace(/\\/g, '/');
  if (!raw || raw === '.') return '';
  if (path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    const err = new Error('Рабочая папка должна быть относительной');
    err.code = 'VALIDATION';
    throw err;
  }
  const parts = raw.split('/').filter(function(part) { return part && part !== '.'; });
  if (parts.indexOf('..') !== -1) {
    const err = new Error('Рабочая папка не может выходить за пределы проекта');
    err.code = 'VALIDATION';
    throw err;
  }
  return parts.join('/');
}

function sanitizeShell(value) {
  const shell = String(value == null ? '' : value).trim();
  if (!shell) return '';
  if (!shells.isKnownShellId(shell)) {
    const err = new Error('Неизвестная оболочка');
    err.code = 'VALIDATION';
    throw err;
  }
  return shell;
}

function sanitizeEnv(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  const keys = Object.keys(source).slice(0, MAX_ENV_KEYS);
  for (const key of keys) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      const err = new Error('Некорректное имя переменной окружения: ' + key);
      err.code = 'VALIDATION';
      throw err;
    }
    const raw = source[key];
    if (raw === null || raw === undefined) continue;
    out[key] = String(raw).slice(0, MAX_ENV_VALUE);
  }
  return out;
}

function boolValue(value, fallback) {
  if (value === undefined) return fallback;
  return value ? 1 : 0;
}

function sendError(res, err) {
  const code = err && err.code;
  if (code === 'ALREADY_RUNNING') {
    return res.status(409).json({ error: err.message, runId: err.runId || null });
  }
  if (code === 'TOO_MANY_RUNS') {
    return res.status(429).json({ error: err.message });
  }
  if (code === 'FOLDER_MISSING' || code === 'INVALID_WORKDIR' || code === 'INVALID_COMMAND' ||
      code === 'SHELL_MISSING' || code === 'VALIDATION' || code === 'SPAWN_FAILED' ||
      code === 'STOP_TIMEOUT') {
    return res.status(400).json({ error: err.message });
  }
  console.error('script error:', err);
  return res.status(500).json({ error: 'Ошибка сервера' });
}

function list(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const rows = db.prepare(
      'SELECT * FROM project_scripts WHERE project_id = ? ORDER BY position ASC, created_at ASC'
    ).all(project.id).map(serializeScript);

    res.json({ scripts: rows });
  } catch (err) {
    sendError(res, err);
  }
}

function create(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const body = req.body || {};
    const name = sanitizeName(body.name);
    const command = sanitizeCommand(body.command);
    if (!name) return res.status(400).json({ error: 'Укажите название скрипта' });
    if (!command) return res.status(400).json({ error: 'Укажите команду' });

    const workdir = sanitizeWorkdir(body.workdir);
    const shell = sanitizeShell(body.shell);
    const env = sanitizeEnv(body.env);
    const autoStart = boolValue(body.auto_start, 0);
    const confirm = autoStart ? 0 : boolValue(body.confirm, 1);
    const favorite = boolValue(body.favorite, 0);
    const position = db.prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM project_scripts WHERE project_id = ?'
    ).get(project.id).pos;

    const id = uuidv4();
    db.prepare(`
      INSERT INTO project_scripts
        (id, project_id, name, command, workdir, shell, env, confirm, auto_start, favorite, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, project.id, name, command, workdir, shell, JSON.stringify(env),
      confirm, autoStart, favorite, position
    );

    logActivity(req.user.id, project.id, 'script_add', 'Скрипт: ' + name);

    const row = db.prepare('SELECT * FROM project_scripts WHERE id = ?').get(id);
    res.status(201).json({ script: serializeScript(row) });
  } catch (err) {
    sendError(res, err);
  }
}

function update(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const script = getOwnedScript(req);
    if (!script) return res.status(404).json({ error: 'Скрипт не найден' });

    const body = req.body || {};
    const name = body.name !== undefined ? sanitizeName(body.name) : script.name;
    const command = body.command !== undefined ? sanitizeCommand(body.command) : script.command;
    if (!name) return res.status(400).json({ error: 'Укажите название скрипта' });
    if (!command) return res.status(400).json({ error: 'Укажите команду' });

    const workdir = body.workdir !== undefined ? sanitizeWorkdir(body.workdir) : script.workdir;
    const shell = body.shell !== undefined ? sanitizeShell(body.shell) : script.shell;
    const env = body.env !== undefined ? sanitizeEnv(body.env) : parseEnv(script.env);
    const autoStart = boolValue(body.auto_start, script.auto_start);
    const confirm = autoStart ? 0 : boolValue(body.confirm, script.confirm);
    const favorite = boolValue(body.favorite, script.favorite);

    db.prepare(`
      UPDATE project_scripts SET
        name = ?, command = ?, workdir = ?, shell = ?, env = ?,
        confirm = ?, auto_start = ?, favorite = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name, command, workdir, shell, JSON.stringify(env),
      confirm, autoStart, favorite, script.id
    );

    logActivity(req.user.id, project.id, 'script_edit', 'Скрипт: ' + name);

    const row = db.prepare('SELECT * FROM project_scripts WHERE id = ?').get(script.id);
    res.json({ script: serializeScript(row) });
  } catch (err) {
    sendError(res, err);
  }
}

function remove(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const script = getOwnedScript(req);
    if (!script) return res.status(404).json({ error: 'Скрипт не найден' });

    runner.stopScript(project.id, script.id);
    db.prepare('DELETE FROM project_scripts WHERE id = ?').run(script.id);
    logActivity(req.user.id, project.id, 'script_delete', 'Скрипт: ' + script.name);

    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}

function run(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const script = getOwnedScript(req);
    if (!script) return res.status(404).json({ error: 'Скрипт не найден' });

    const result = runner.start(project, script, { defaultShell: session.getDefaultShellId() });
    logActivity(req.user.id, project.id, 'script_run', 'Скрипт: ' + script.name);

    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

function reorder(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const order = req.body && Array.isArray(req.body.order) ? req.body.order.map(String) : null;
    if (!order) {
      const err = new Error('Не передан порядок скриптов');
      err.code = 'VALIDATION';
      throw err;
    }

    const existing = db.prepare('SELECT id FROM project_scripts WHERE project_id = ?')
      .all(project.id)
      .map(function(row) { return String(row.id); });
    const existingSet = new Set(existing);
    const seen = new Set();

    if (order.length !== existing.length) {
      const err = new Error('Порядок должен содержать все скрипты проекта');
      err.code = 'VALIDATION';
      throw err;
    }

    for (const id of order) {
      if (seen.has(id) || !existingSet.has(id)) {
        const err = new Error('Некорректный список скриптов');
        err.code = 'VALIDATION';
        throw err;
      }
      seen.add(id);
    }

    const update = db.prepare(
      'UPDATE project_scripts SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?'
    );
    db.transaction(function() {
      order.forEach(function(id, index) {
        update.run(index, id, project.id);
      });
    })();

    logActivity(req.user.id, project.id, 'script_edit', 'Изменён порядок скриптов');

    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}

async function restart(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const script = getOwnedScript(req);
    if (!script) return res.status(404).json({ error: 'Скрипт не найден' });

    const result = await runner.restart(project, script, { defaultShell: session.getDefaultShellId() });
    logActivity(req.user.id, project.id, 'script_run', 'Перезапуск. Скрипт: ' + script.name);

    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
}

function stop(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const script = getOwnedScript(req);
    if (!script) return res.status(404).json({ error: 'Скрипт не найден' });

    const stopped = runner.stopScript(project.id, script.id);
    if (stopped) {
      logActivity(req.user.id, project.id, 'script_stop', 'Скрипт: ' + script.name);
    }

    res.json({ ok: true, stopped: stopped });
  } catch (err) {
    sendError(res, err);
  }
}

function stopAll(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const count = runner.stopProject(project.id);
    if (count) {
      logActivity(req.user.id, project.id, 'script_stop', 'Остановлено скриптов: ' + count);
    }

    res.json({ ok: true, stopped: count });
  } catch (err) {
    sendError(res, err);
  }
}

function status(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    res.json({ runs: runner.getActive(project.id) });
  } catch (err) {
    sendError(res, err);
  }
}

function autostart(req, res) {
  try {
    const project = getOwnedProject(req);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const scripts = db.prepare(
      'SELECT * FROM project_scripts WHERE project_id = ? AND auto_start = 1 ORDER BY position ASC, created_at ASC'
    ).all(project.id);

    const started = [];
    const errors = [];

    for (const script of scripts) {
      if (runner.isRunning(project.id, script.id)) continue;
      try {
        const result = runner.start(project, script, { defaultShell: session.getDefaultShellId() });
        started.push({ scriptId: script.id, name: script.name, runId: result.runId });
        logActivity(req.user.id, project.id, 'script_autostart', 'Скрипт: ' + script.name);
      } catch (e) {
        errors.push({ scriptId: script.id, name: script.name, error: e.message || String(e) });
      }
    }

    res.json({ started: started, errors: errors });
  } catch (err) {
    sendError(res, err);
  }
}

module.exports = {
  list,
  create,
  update,
  remove,
  reorder,
  run,
  restart,
  stop,
  stopAll,
  status,
  autostart
};
