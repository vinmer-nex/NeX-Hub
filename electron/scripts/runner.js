const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { BrowserWindow } = require('electron');
const { v4: uuidv4 } = require('uuid');
const shells = require('../lib/shells');

const MAX_RUNS = 5;
const MAX_COMMAND_LENGTH = 4000;
const MAX_OUTPUT_BYTES = 512 * 1024;

const runs = new Map();
const scriptRuns = new Map();
const runWaiters = new Map();

function runKey(projectId, scriptId) {
  return String(projectId) + ':' + String(scriptId);
}

function emit(payload) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    try {
      if (!win.isDestroyed()) win.webContents.send('nexhub:script:event', payload);
    } catch (e) {}
  }
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

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveCwd(project, workdir) {
  const root = path.resolve(project.folder_path || '');
  let stat;
  try { stat = fs.statSync(root); } catch (e) { stat = null; }
  if (!stat || !stat.isDirectory()) {
    const err = new Error('Папка проекта не найдена. Выберите её заново во вкладке «Файлы».');
    err.code = 'FOLDER_MISSING';
    throw err;
  }

  const rel = String(workdir || '').trim();
  if (rel && path.isAbsolute(rel)) {
    const err = new Error('Рабочая папка должна быть относительной');
    err.code = 'INVALID_WORKDIR';
    throw err;
  }

  const target = path.resolve(root, rel || '.');
  if (!isInside(root, target)) {
    const err = new Error('Рабочая папка выходит за пределы папки проекта');
    err.code = 'INVALID_WORKDIR';
    throw err;
  }

  let targetStat;
  try { targetStat = fs.statSync(target); } catch (e) { targetStat = null; }
  if (!targetStat || !targetStat.isDirectory()) {
    const err = new Error('Рабочая папка «' + rel + '» не существует');
    err.code = 'INVALID_WORKDIR';
    throw err;
  }

  return target;
}

function buildEnv(project, script, kind) {
  const env = { ...process.env };
  const custom = parseEnv(script.env);
  for (const key of Object.keys(custom)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = custom[key];
    if (value === null || value === undefined) continue;
    env[key] = String(value);
  }

  env.NEXHUB_PROJECT_ID = String(project.id || '');
  env.NEXHUB_PROJECT_NAME = String(project.name || '');
  env.NEXHUB_SCRIPT_ID = String(script.id || '');
  env.NEXHUB_SCRIPT_NAME = String(script.name || '');

  if (kind === 'bash' && !env.LANG) env.LANG = 'C.UTF-8';
  return env;
}

function emitChunk(run, type, chunk) {
  if (run.truncated) return;
  const size = Buffer.byteLength(chunk);
  if (run.outputBytes + size > MAX_OUTPUT_BYTES) {
    run.truncated = true;
    const left = Math.max(0, MAX_OUTPUT_BYTES - run.outputBytes);
    if (left > 0) {
      emit({
        type: type,
        runId: run.runId,
        projectId: run.projectId,
        scriptId: run.scriptId,
        chunk: chunk.slice(0, left)
      });
      run.outputBytes += left;
    }
    emit({
      type: 'stdout',
      runId: run.runId,
      projectId: run.projectId,
      scriptId: run.scriptId,
      chunk: '\n[вывод обрезан: превышен лимит ' + Math.round(MAX_OUTPUT_BYTES / 1024) + ' КБ]\n'
    });
    return;
  }
  run.outputBytes += size;
  emit({
    type: type,
    runId: run.runId,
    projectId: run.projectId,
    scriptId: run.scriptId,
    chunk: chunk
  });
}

function finish(run, code, signal) {
  if (run.finished) return;
  run.finished = true;

  runs.delete(run.runId);
  if (scriptRuns.get(run.key) === run.runId) scriptRuns.delete(run.key);

  emit({
    type: 'exit',
    runId: run.runId,
    projectId: run.projectId,
    scriptId: run.scriptId,
    code: code == null ? null : code,
    signal: signal || null,
    stopped: !!run.stopping,
    durationMs: Date.now() - run.startedAt
  });

  const waiters = runWaiters.get(run.runId);
  if (waiters) {
    runWaiters.delete(run.runId);
    waiters.forEach(function(resolve) { resolve(); });
  }
}

function killTree(runId) {
  const run = runs.get(runId);
  if (!run || run.finished) return false;
  run.stopping = true;

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(run.child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      }).on('error', function() {});
    } catch (e) {}
  } else {
    try {
      process.kill(-run.child.pid, 'SIGTERM');
    } catch (e) {
      try { run.child.kill('SIGTERM'); } catch (e2) {}
    }
    const timer = setTimeout(function() {
      try { process.kill(-run.child.pid, 'SIGKILL'); } catch (e) {}
    }, 3000);
    if (timer.unref) timer.unref();
  }

  return true;
}

function start(project, script, options) {
  if (!project || !project.id) throw new Error('Проект не найден');
  if (!script || !script.id) throw new Error('Скрипт не найден');
  if (!project.folder_path) {
    const err = new Error('У проекта не выбрана папка');
    err.code = 'FOLDER_MISSING';
    throw err;
  }

  const command = String(script.command || '').trim();
  if (!command) {
    const err = new Error('Команда скрипта пуста');
    err.code = 'INVALID_COMMAND';
    throw err;
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    const err = new Error('Команда слишком длинная (максимум ' + MAX_COMMAND_LENGTH + ' символов)');
    err.code = 'INVALID_COMMAND';
    throw err;
  }

  const key = runKey(project.id, script.id);
  const existing = scriptRuns.get(key);
  if (existing) {
    const err = new Error('Скрипт уже запущен');
    err.code = 'ALREADY_RUNNING';
    err.runId = existing;
    throw err;
  }

  if (runs.size >= MAX_RUNS) {
    const err = new Error('Слишком много одновременно запущенных скриптов (максимум ' + MAX_RUNS + ')');
    err.code = 'TOO_MANY_RUNS';
    throw err;
  }

  const cwd = resolveCwd(project, script.workdir);
  const scriptShell = String(script.shell || '').trim();
  const defaultShell = options && options.defaultShell ? String(options.defaultShell) : 'auto';
  const shellId = scriptShell && scriptShell !== 'auto' ? scriptShell : defaultShell;
  const invocation = shells.buildInvocation(shellId, command);
  const env = buildEnv(project, script, invocation.kind);

  let child;
  try {
    child = spawn(invocation.file, invocation.args, {
      cwd: cwd,
      env: env,
      windowsHide: true,
      detached: process.platform !== 'win32'
    });
  } catch (e) {
    const err = new Error('Не удалось запустить оболочку: ' + (e.message || e));
    err.code = 'SPAWN_FAILED';
    throw err;
  }

  const runId = uuidv4();
  const run = {
    runId: runId,
    key: key,
    projectId: project.id,
    scriptId: script.id,
    scriptName: script.name || '',
    command: command,
    shell: invocation.id,
    shellLabel: invocation.label,
    shellPath: invocation.path,
    cwd: cwd,
    child: child,
    startedAt: Date.now(),
    outputBytes: 0,
    truncated: false,
    stopping: false,
    finished: false
  };

  runs.set(runId, run);
  scriptRuns.set(key, runId);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', function(chunk) { emitChunk(run, 'stdout', chunk); });
  child.stderr.on('data', function(chunk) { emitChunk(run, 'stderr', chunk); });

  child.on('error', function(err) {
    if (run.finished) return;
    emit({
      type: 'error',
      runId: run.runId,
      projectId: run.projectId,
      scriptId: run.scriptId,
      message: 'Не удалось запустить процесс: ' + (err.message || err)
    });
    finish(run, null, null);
  });

  child.on('close', function(code, signal) {
    finish(run, code, signal);
  });

  emit({
    type: 'started',
    runId: runId,
    projectId: project.id,
    scriptId: script.id,
    scriptName: run.scriptName,
    command: command,
    shell: invocation.id,
    shellLabel: invocation.label,
    shellPath: invocation.path,
    cwd: cwd,
    startedAt: run.startedAt
  });

  return {
    runId: runId,
    shell: invocation.id,
    shellLabel: invocation.label,
    shellPath: invocation.path,
    cwd: cwd
  };
}

function waitForRunEnd(runId, timeoutMs) {
  return new Promise(function(resolve) {
    if (!runs.has(runId)) {
      resolve();
      return;
    }

    let settled = false;
    let timer = null;

    function finishWait() {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);

      const current = runWaiters.get(runId);
      if (current) {
        const index = current.indexOf(finishWait);
        if (index !== -1) current.splice(index, 1);
        if (!current.length) runWaiters.delete(runId);
      }

      resolve();
    }

    const waiters = runWaiters.get(runId) || [];
    waiters.push(finishWait);
    runWaiters.set(runId, waiters);

    timer = setTimeout(finishWait, timeoutMs || 5000);
    if (timer.unref) timer.unref();
  });
}

async function restart(project, script, options) {
  if (!project || !project.id) throw new Error('Проект не найден');
  if (!script || !script.id) throw new Error('Скрипт не найден');

  const key = runKey(project.id, script.id);
  const runId = scriptRuns.get(key);

  if (runId) {
    const wait = waitForRunEnd(runId, 8000);
    killTree(runId);
    await wait;

    if (isRunning(project.id, script.id)) {
      const err = new Error('Не удалось остановить скрипт для перезапуска');
      err.code = 'STOP_TIMEOUT';
      throw err;
    }
  }

  return start(project, script, options);
}

function stop(runId) {
  return killTree(runId);
}

function stopScript(projectId, scriptId) {
  const runId = scriptRuns.get(runKey(projectId, scriptId));
  return runId ? killTree(runId) : false;
}

function stopProject(projectId) {
  let count = 0;
  for (const [runId, run] of runs) {
    if (run.projectId === projectId && killTree(runId)) count++;
  }
  return count;
}

function stopAll() {
  let count = 0;
  for (const runId of Array.from(runs.keys())) {
    if (killTree(runId)) count++;
  }
  return count;
}

function stopAllSync() {
  for (const run of runs.values()) {
    if (!run.child || !run.child.pid) continue;
    run.stopping = true;
    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/pid', String(run.child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        });
      } catch (e) {}
    } else {
      try { process.kill(-run.child.pid, 'SIGKILL'); } catch (e) {}
    }
  }
  runs.clear();
  scriptRuns.clear();
}

function getRunId(projectId, scriptId) {
  return scriptRuns.get(runKey(projectId, scriptId)) || null;
}

function isRunning(projectId, scriptId) {
  return !!getRunId(projectId, scriptId);
}

function getActive(projectId) {
  const out = [];
  for (const run of runs.values()) {
    if (run.projectId !== projectId) continue;
    out.push({
      runId: run.runId,
      scriptId: run.scriptId,
      scriptName: run.scriptName,
      shell: run.shell,
      shellLabel: run.shellLabel,
      startedAt: run.startedAt
    });
  }
  return out;
}

module.exports = {
  start,
  restart,
  stop,
  stopScript,
  stopProject,
  stopAll,
  stopAllSync,
  getRunId,
  isRunning,
  getActive
};
