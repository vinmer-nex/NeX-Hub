'use strict';

/*
 * Renderer/UI benchmark for the CURRENT (unoptimized) NeX Hub code.
 *
 * Run with the real Electron binary (NOT ELECTRON_RUN_AS_NODE):
 *   electron.exe scripts/bench/ui-bench.js --label baseline
 *
 * It uses a temp DB copy prepared with sqlite3 .backup, forces
 * remember_user_id=2 and removes pin_hash so the app auto-logs in.
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const PROCESS_START = Date.now();

const { app, BrowserWindow, protocol } = require('electron');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const {
  PROJECT_ROOT,
  USER_ID,
  parseLabel,
  prepareTempDb,
  ensureDir,
  removeIfExists,
} = require('./helpers');

const label = parseLabel();

// ---------- Temp DB / uploads / userData MUST be set before app ready ----------
const dbInfo = prepareTempDb(label, 'ui', Date.now());
process.env.DB_PATH = dbInfo.dbPath;
process.env.UPLOADS_PATH = dbInfo.uploadsDir;
process.env.APP_BASE_DIR = PROJECT_ROOT;
process.env.APP_DATA_DIR = dbInfo.workDir;
process.env.APP_UPLOADS_DIR = dbInfo.uploadsDir;

// Fresh userData (clears localStorage and caches) for deterministic startup.
removeIfExists(dbInfo.userDataDir);
fs.rmSync(dbInfo.userDataDir, { recursive: true, force: true });
ensureDir(dbInfo.userDataDir);
app.setPath('userData', dbInfo.userDataDir);

// Hidden-window benchmarking must not be throttled.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const SETUP_DONE = Date.now();

const electronDir = path.join(PROJECT_ROOT, 'electron');
const clientDir = path.join(PROJECT_ROOT, 'client');
const outDir = ensureDir(path.join(PROJECT_ROOT, 'scripts', 'bench'));
const outPath = path.join(outDir, 'ui-results-' + label + '.json');

const consoleErrors = [];
const boot = {
  process_start: PROCESS_START,
  setup_done: SETUP_DONE,
  app_ready: null,
  loading_hidden: null,
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function f(v) {
  return v == null ? 'null' : Number(v).toFixed(2);
}

async function writeAndQuit(results, exitCode) {
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(JSON.stringify(results, null, 2));
  console.log('');
  console.log('=== UI BENCH (' + label + ') ===');
  console.log('DB copy:        ' + dbInfo.dbPath);
  console.log('userData:       ' + dbInfo.userDataDir);
  console.log('startup_ms:     ' + f(results.startup_ms) + '   (process start -> loading hidden)');
  console.log('startup_core_ms:' + f(results.startup_core_ms) + '   (after harness DB prep -> loading hidden)');
  for (const [name, m] of Object.entries(results.scenarios || {})) {
    if (m && m.median != null) {
      console.log((name + ':').padEnd(24) + (f(m.median) + ' ms').padEnd(14) + 'p95=' + f(m.p95) + ' ms');
    } else {
      console.log((name + ':').padEnd(24) + 'null / error: ' + (m && m.error ? m.error : 'n/a'));
    }
  }
  if (results.errors && results.errors.length) {
    console.log('');
    console.log('SCENARIO ERRORS (' + results.errors.length + '):');
    results.errors.forEach(e => console.log(' - ' + e.label + ': ' + e.message));
  }
  if (consoleErrors.length) {
    console.log('');
    console.log('RENDERER CONSOLE ERRORS (' + consoleErrors.length + '):');
    consoleErrors.slice(0, 20).forEach(e => console.log(' - ' + e));
  }
  console.log('');
  console.log('Wrote ' + outPath);

  try { if (winRef && !winRef.isDestroyed()) winRef.destroy(); } catch (e) {}
  app.quit();
  setTimeout(() => process.exit(exitCode), 300).unref();
}

let winRef = null;

app.whenReady().then(async () => {
  boot.app_ready = Date.now();

  let win = null;
  try {
    const sessionMod = require(path.join(electronDir, 'session.js'));
    const registerProtocol = require(path.join(electronDir, 'registerProtocol.js'));
    const registerIpc = require(path.join(electronDir, 'ipc.js'));

    const restored = sessionMod.restoreSession();
    console.log('[ui-bench] session user: ' +
      (restored ? restored.username + ' (id ' + restored.id + ')' : 'NONE - auto-login will fail'));

    const paths = {
      baseDir: PROJECT_ROOT,
      dataDir: dbInfo.workDir,
      uploadsDir: dbInfo.uploadsDir,
    };
    registerProtocol.register(paths, electronDir);
    registerIpc.registerIpc(paths);

    win = new BrowserWindow({
      show: false,
      width: 1400,
      height: 900,
      backgroundColor: '#0b0b0f',
      webPreferences: {
        preload: path.join(electronDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    winRef = win;

    win.webContents.on('console-message', function (event, ...args) {
      let lvl;
      let msg;
      let src;
      let ln;
      if (args[0] && typeof args[0] === 'object') {
        const d = args[0];
        lvl = d.level;
        msg = d.message;
        src = d.sourceId;
        ln = d.lineNumber;
      } else {
        lvl = args[0];
        msg = args[1];
        ln = args[2];
        src = args[3];
      }
      const text = '[renderer:' + lvl + '] ' + msg + ' (' + src + ':' + ln + ')';
      if (String(lvl) === 'error' || lvl === 3) {
        consoleErrors.push(text);
        console.error(text);
      } else {
        console.log(text);
      }
    });
    win.webContents.on('did-fail-load', function (e, code, desc, url) {
      console.error('[ui-bench] did-fail-load ' + code + ' ' + desc + ' ' + url);
    });
    win.webContents.on('render-process-gone', function (e, details) {
      console.error('[ui-bench] render-process-gone ' + JSON.stringify(details));
    });
    win.webContents.on('preload-error', function (e, preloadPath, error) {
      console.error('[ui-bench] preload-error ' + preloadPath + ': ' + error);
    });

    await win.loadURL('app://nexhub/index.html');

    const readyExpr = `(() => {
      const store = window.store;
      const loading = document.getElementById('loading-screen');
      const display = loading ? getComputedStyle(loading).display : null;
      // Current app.js calls render() BEFORE hiding the loading screen, so by the
      // time rendering finishes #loading-screen has already been replaced/removed.
      // "Removed" therefore counts as hidden; .app-shell proves render() completed.
      const loadingHidden = !loading || display === 'none';
      const shell = !!document.querySelector('#app .app-shell');
      return {
        ready: !!(store && Array.isArray(store.projects) && store.projects.length > 0 && loadingHidden && shell),
        hasStore: !!store,
        projectCount: store && Array.isArray(store.projects) ? store.projects.length : null,
        loadingDisplay: display,
        loadingRemoved: !loading,
        shellRendered: shell,
        view: store ? store.currentView : null,
        locked: store ? !!store.locked : null,
        hasPin: store ? !!store.hasPin : null
      };
    })()`;

    const deadline = Date.now() + 90000;
    let state = null;
    while (Date.now() < deadline) {
      try {
        state = await win.webContents.executeJavaScript(readyExpr, true);
      } catch (e) {
        state = null;
      }
      if (state && state.ready) break;
      await sleep(50);
    }

    if (!state || !state.ready) {
      let diag = null;
      try {
        diag = await win.webContents.executeJavaScript(`(() => ({
          href: location.href,
          title: document.title,
          bodyText: (document.body && document.body.innerText || '').slice(0, 800),
          loadingDisplay: (() => { const el = document.getElementById('loading-screen'); return el ? getComputedStyle(el).display : null; })(),
          hasStore: !!window.store,
          projectCount: window.store ? window.store.projects.length : null,
          currentUser: localStorage.getItem('nexhub_user'),
          loginVisible: !!document.querySelector('.login-screen, [class*="login"]')
        }))()`, true);
      } catch (e) {
        diag = { error: String(e) };
      }
      const failed = {
        label,
        kind: 'ui',
        generatedAt: new Date().toISOString(),
        fatal: 'App did not reach loaded state (store.projects.length > 0 and loading screen hidden)',
        state,
        diagnostics: diag,
        sessionUser: sessionMod.getCurrentUser(),
        db: { tempCopy: dbInfo.dbPath, userId: USER_ID, rememberUserId: dbInfo.rememberUserId, pinHashCount: dbInfo.pinHashCount },
        startup_ms: null,
        startup_core_ms: null,
        scenarios: {},
        errors: [{ label: 'startup', message: 'App did not reach loaded state' }],
        consoleErrors,
      };
      await writeAndQuit(failed, 1);
      return;
    }

    boot.loading_hidden = Date.now();

    const measureScript = `(async () => {
      const appMod = await import('./js/app.js');
      const storeMod = await import('./js/store.js');
      const apiMod = await import('./js/api.js');
      const store = storeMod.default || storeMod;
      const api = apiMod.default || apiMod;

      const results = {};
      const errors = [];

      function median(sorted) {
        if (!sorted.length) return null;
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      }
      function p95(sorted) {
        if (!sorted.length) return null;
        const idx = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);
        return sorted[idx];
      }

      async function measure(label, fn, repeats, beforeEach) {
        const samples = [];
        try {
          for (let i = 0; i < repeats; i++) {
            if (beforeEach) await beforeEach();
            const t0 = performance.now();
            await fn();
            samples.push(performance.now() - t0);
          }
          const sorted = samples.slice().sort((a, b) => a - b);
          results[label] = {
            median: median(sorted),
            p95: p95(sorted),
            min: sorted[0],
            max: sorted[sorted.length - 1],
            samples: samples
          };
        } catch (e) {
          const msg = String(e && e.message ? e.message : e);
          errors.push({ label: label, message: msg });
          results[label] = { median: null, p95: null, samples: samples, error: msg };
        }
      }

      const resetList = async () => {
        await appMod.loadProjects();
        store.currentProjectId = null;
        store.currentDetailTab = 'notes';
      };

      // Discovery: project with the most notes (extra detail calls are NOT measured).
      let detailId = null;
      let detailNotes = -1;
      let detailChecklist = null;
      let detailPhotos = null;
      let discoveryError = null;
      for (const p of store.projects) {
        try {
          const d = await api.getProject(p.id);
          const n = (d.project.notes || []).length;
          if (n > detailNotes) {
            detailNotes = n;
            detailId = p.id;
            detailChecklist = (d.project.checklist || []).length;
            detailPhotos = (d.project.photos || []).length;
          }
        } catch (e) {
          discoveryError = String(e && e.message ? e.message : e);
        }
      }
      if (!detailId && store.projects.length) detailId = store.projects[0].id;

      await measure('list_load_render', async () => {
        await appMod.loadProjects();
        await appMod.render();
      }, 3);

      await appMod.loadProjects();
      store.currentView = 'list';
      store.currentProjectId = null;
      await measure('list_render_warm', async () => {
        await appMod.render();
      }, 5);

      await measure('detail_open', async () => {
        store.currentView = 'detail';
        store.currentProjectId = detailId;
        store.currentDetailTab = 'notes';
        await appMod.render();
      }, 5);

      for (const tab of ['checklist', 'versions', 'photos', 'notes']) {
        await measure('detail_tab_' + tab, async () => {
          store.currentView = 'detail';
          store.currentProjectId = detailId;
          store.currentDetailTab = tab;
          await appMod.render();
        }, 5);
      }

      await measure('kanban_open', async () => {
        store.currentView = 'kanban';
        store.currentProjectId = null;
        store.currentDetailTab = 'notes';
        await appMod.render();
      }, 3, resetList);

      await measure('calendar_open', async () => {
        store.currentView = 'calendar';
        store.currentProjectId = null;
        await appMod.render();
      }, 5, resetList);

      await measure('dashboard_open', async () => {
        store.currentView = 'dashboard';
        store.currentProjectId = null;
        await appMod.render();
      }, 5, resetList);

      store.currentView = 'list';
      store.currentProjectId = null;
      store.currentDetailTab = 'notes';
      try { await appMod.render(); } catch (e) {}

      return {
        results: results,
        errors: errors,
        detailProjectId: detailId,
        detailNotes: detailNotes,
        detailChecklist: detailChecklist,
        detailPhotos: detailPhotos,
        discoveryError: discoveryError,
        projectCount: store.projects.length
      };
    })()`;

    let scenarioData;
    try {
      scenarioData = await Promise.race([
        win.webContents.executeJavaScript(measureScript, true),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Renderer measurement timed out after 240s')), 240000)),
      ]);
    } catch (e) {
      const failed = {
        label,
        kind: 'ui',
        generatedAt: new Date().toISOString(),
        fatal: 'Renderer measurement failed: ' + String(e && e.message ? e.message : e),
        db: { tempCopy: dbInfo.dbPath, userId: USER_ID },
        startup_ms: boot.loading_hidden - PROCESS_START,
        startup_core_ms: boot.loading_hidden - SETUP_DONE,
        app_ready_ms: boot.app_ready - PROCESS_START,
        scenarios: {},
        errors: [{ label: 'measurement', message: String(e && e.message ? e.message : e) }],
        consoleErrors,
      };
      await writeAndQuit(failed, 1);
      return;
    }

    const scenarios = {};
    for (const [name, m] of Object.entries(scenarioData.results || {})) {
      scenarios[name] = m;
    }

    const errors = (scenarioData.errors || []).slice();
    consoleErrors.forEach(e => errors.push({ label: 'console', message: e }));

    const results = {
      label,
      kind: 'ui',
      generatedAt: new Date().toISOString(),
      runtime: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      },
      db: {
        source: path.join(PROJECT_ROOT, 'data', 'projecthub.db'),
        tempCopy: dbInfo.dbPath,
        uploads: dbInfo.uploadsDir,
        userData: dbInfo.userDataDir,
        userId: USER_ID,
        rememberUserId: dbInfo.rememberUserId,
        pinHashCount: dbInfo.pinHashCount,
      },
      boot: {
        process_start: PROCESS_START,
        setup_done: SETUP_DONE,
        app_ready: boot.app_ready,
        loading_hidden: boot.loading_hidden,
      },
      startup_ms: boot.loading_hidden - PROCESS_START,
      startup_core_ms: boot.loading_hidden - SETUP_DONE,
      app_ready_ms: boot.app_ready - PROCESS_START,
      loading_hidden_after_ready_ms: boot.loading_hidden - boot.app_ready,
      detailProjectId: scenarioData.detailProjectId,
      detailProjectNotes: scenarioData.detailNotes,
      detailProjectChecklist: scenarioData.detailChecklist,
      detailProjectPhotos: scenarioData.detailPhotos,
      discoveryError: scenarioData.discoveryError || null,
      projectCount: scenarioData.projectCount,
      scenarios,
      errors,
      consoleErrors,
    };

    await writeAndQuit(results, errors.length ? 2 : 0);
  } catch (e) {
    const failed = {
      label,
      kind: 'ui',
      generatedAt: new Date().toISOString(),
      fatal: String(e && e.stack ? e.stack : e),
      startup_ms: null,
      scenarios: {},
      errors: [{ label: 'startup', message: String(e && e.message ? e.message : e) }],
      consoleErrors,
    };
    await writeAndQuit(failed, 1);
  }
});

process.on('uncaughtException', function (e) {
  console.error('[ui-bench] uncaughtException: ' + (e && e.stack ? e.stack : e));
});
process.on('unhandledRejection', function (e) {
  console.error('[ui-bench] unhandledRejection: ' + (e && e.stack ? e.stack : e));
});
