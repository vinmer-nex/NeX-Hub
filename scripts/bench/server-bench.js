'use strict';

/*
 * Backend benchmark for the CURRENT (unoptimized) NeX Hub code.
 *
 * Runs under Electron's bundled Node:
 *   $env:ELECTRON_RUN_AS_NODE='1'; electron.exe scripts/bench/server-bench.js --label baseline
 *
 * It never calls initPaths(); DB_PATH / UPLOADS_PATH are set before requiring
 * electron/db.js and electron/session.js.
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const {
  PROJECT_ROOT,
  USER_ID,
  parseLabel,
  prepareTempDb,
  ensureDir,
} = require('./helpers');

function argValue(name, fallback) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--' + name);
  if (i !== -1 && args[i + 1] != null) return args[i + 1];
  const eq = args.find(a => a.startsWith('--' + name + '='));
  if (eq) return eq.slice(name.length + 3);
  return fallback;
}

const label = parseLabel();
const PASSES = Math.max(1, Number(argValue('passes', 3)) || 3);
const ITERATIONS = Math.max(1, Number(argValue('iterations', 15)) || 15);
const WARMUPS = Math.max(0, Number(argValue('warmups', 3)) || 0);

// ---------- Temp DB (consistent sqlite3 .backup + session prep) ----------
const dbInfo = prepareTempDb(label, 'server', Date.now());
process.env.DB_PATH = dbInfo.dbPath;
process.env.UPLOADS_PATH = dbInfo.uploadsDir;

// ---------- db_init_ms (measured exactly once, fresh process) ----------
const dbInitStart = performance.now();
const db = require(path.join(PROJECT_ROOT, 'electron', 'db.js'));
const dbInitMs = performance.now() - dbInitStart;

const controller = require(path.join(PROJECT_ROOT, 'electron', 'controllers', 'projectController.js'));
const session = require(path.join(PROJECT_ROOT, 'electron', 'session.js'));

// Restore the session from the temp DB (remember_user_id = 2, no pin_hash).
let restoredUser = null;
try {
  restoredUser = session.restoreSession();
} catch (e) {
  console.error('[bench] restoreSession failed:', e.message);
}

// ---------- Pick projects / detail target ----------
const projectRows = db.prepare(
  'SELECT id FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC'
).all(USER_ID);
const projectIds = projectRows.map(r => r.id);

const detailRow = db.prepare(`
  SELECT p.id,
    (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id) AS note_count,
    (SELECT COUNT(*) FROM checklist_items c WHERE c.project_id = p.id) AS checklist_count,
    ((SELECT COUNT(*) FROM notes n2 WHERE n2.project_id = p.id) +
     (SELECT COUNT(*) FROM checklist_items c2 WHERE c2.project_id = p.id)) AS score
  FROM projects p
  WHERE p.user_id = ? AND p.deleted_at IS NULL
  ORDER BY score DESC, p.created_at DESC
  LIMIT 1
`).get(USER_ID);
const detailProjectId = detailRow ? detailRow.id : null;

// ---------- Instrumentation (installed before any controller/session call) ----------
let prepareCalls = 0;
let statCalls = 0;
let existsCalls = 0;

const originalPrepare = db.prepare.bind(db);
function instrumentedPrepare(sql) {
  prepareCalls++;
  return originalPrepare(sql);
}
try {
  db.prepare = instrumentedPrepare;
} catch (e) {
  Object.defineProperty(db, 'prepare', {
    value: instrumentedPrepare,
    configurable: true,
    writable: true,
  });
}
if (db.prepare !== instrumentedPrepare) {
  throw new Error('Failed to instrument db.prepare');
}

const originalStatSync = fs.statSync;
fs.statSync = function () {
  statCalls++;
  return originalStatSync.apply(fs, arguments);
};
const originalExistsSync = fs.existsSync;
fs.existsSync = function () {
  existsCalls++;
  return originalExistsSync.apply(fs, arguments);
};

function resetCounters() {
  prepareCalls = 0;
  statCalls = 0;
  existsCalls = 0;
}

function runInstrumented(fn) {
  resetCounters();
  const t0 = performance.now();
  const value = fn();
  const ms = performance.now() - t0;
  return {
    ms,
    prepare: prepareCalls,
    stat: statCalls,
    exists: existsCalls,
    value,
  };
}

// ---------- Mock req/res ----------
function makeReq(extra) {
  return Object.assign(
    { query: {}, params: {}, body: {}, user: { id: USER_ID }, files: [], headers: {} },
    extra || {}
  );
}

function invoke(handler, req) {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    setHeader() { return this; },
    type() { return this; },
  };
  handler(req, res);
  if (res.statusCode >= 400) {
    const msg = res.body && res.body.error ? res.body.error : 'HTTP ' + res.statusCode;
    throw new Error('Controller returned ' + res.statusCode + ': ' + msg);
  }
  return res.body;
}

const listReq = makeReq();
const detailReq = makeReq({ params: { id: detailProjectId } });
const boardReq = makeReq();

function timedGetAll() {
  return invoke(controller.getAll, listReq);
}

function timedGetOne() {
  if (!detailProjectId) throw new Error('No project found for user ' + USER_ID);
  return invoke(controller.getOne, detailReq);
}

function timedKanbanOld() {
  let count = 0;
  for (const id of projectIds) {
    invoke(controller.getOne, makeReq({ params: { id } }));
    count++;
  }
  return count;
}

const hasGetBoard = typeof controller.getBoard === 'function';
function timedKanbanNew() {
  return invoke(controller.getBoard, boardReq);
}

function timedStats() {
  if (!restoredUser) throw new Error('session.restoreSession() did not restore a user');
  return session.getStats();
}

function timedDbInit() {
  return dbInitMs;
}

const metrics = {
  list: { kind: 'api', fn: timedGetAll, counters: true },
  detail: { kind: 'api', fn: timedGetOne, counters: true },
  kanban_old: { kind: 'api', fn: timedKanbanOld, counters: true },
  kanban_new: { kind: 'api', fn: timedKanbanNew, counters: true, skip: !hasGetBoard, note: 'controller.getBoard does not exist yet' },
  stats: { kind: 'api', fn: timedStats, counters: true },
};

function quantile(sorted, q) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.ceil(q * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function summarize(values) {
  const clean = values.filter(v => typeof v === 'number' && isFinite(v));
  if (!clean.length) return { median: null, p95: null, min: null, max: null, samples: [] };
  const sorted = clean.slice().sort((a, b) => a - b);
  return {
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    samples: clean,
  };
}

const samples = {};
const counterSamples = {};
for (const name of Object.keys(metrics)) {
  samples[name] = [];
  counterSamples[name] = { prepare: [], stat: [], exists: [] };
}
samples.db_init = [dbInitMs];
counterSamples.db_init = { prepare: [], stat: [], exists: [] };

const passMedians = {};
for (const name of Object.keys(metrics)) passMedians[name] = [];

const errors = [];

for (let pass = 1; pass <= PASSES; pass++) {
  for (const name of Object.keys(metrics)) {
    const def = metrics[name];
    if (def.skip) continue;

    const passValues = [];
    try {
      for (let w = 0; w < WARMUPS; w++) def.fn();
      for (let i = 0; i < ITERATIONS; i++) {
        const r = runInstrumented(def.fn);
        samples[name].push(r.ms);
        counterSamples[name].prepare.push(r.prepare);
        counterSamples[name].stat.push(r.stat);
        counterSamples[name].exists.push(r.exists);
        passValues.push(r.ms);
      }
      passMedians[name].push(quantile(passValues.slice().sort((a, b) => a - b), 0.5));
    } catch (e) {
      errors.push({ metric: name, pass, message: String(e && e.stack ? e.stack : e) });
      console.error('[bench] ' + name + ' pass ' + pass + ' failed: ' + e.message);
    }
  }
}

const metricResults = {};
for (const name of Object.keys(metrics)) {
  if (metrics[name].skip) {
    metricResults[name] = {
      median: null,
      p95: null,
      min: null,
      max: null,
      samples: [],
      skipped: true,
      note: metrics[name].note,
    };
    continue;
  }
  metricResults[name] = summarize(samples[name]);
  metricResults[name].pass_medians = passMedians[name];
  metricResults[name].prepare_calls = summarize(counterSamples[name].prepare).median;
  metricResults[name].stat_calls = summarize(counterSamples[name].stat).median;
  metricResults[name].exists_calls = summarize(counterSamples[name].exists).median;
}

metricResults.db_init = summarize(samples.db_init);

const results = {
  label,
  generatedAt: new Date().toISOString(),
  kind: 'server',
  runtime: {
    electronAsNode: process.env.ELECTRON_RUN_AS_NODE === '1',
    node: process.versions.node,
    modules: process.versions.modules,
  },
  db: {
    source: path.join(PROJECT_ROOT, 'data', 'projecthub.db'),
    tempCopy: dbInfo.dbPath,
    uploads: dbInfo.uploadsDir,
    userId: USER_ID,
    restoredUsername: restoredUser ? restoredUser.username : null,
    nonDeletedProjects: projectIds.length,
    detailProjectId,
    detailProjectNotes: detailRow ? detailRow.note_count : null,
    detailProjectChecklist: detailRow ? detailRow.checklist_count : null,
  },
  config: { passes: PASSES, warmups: WARMUPS, iterations: ITERATIONS },
  // Top-level scalar baselines (median unless noted).
  db_init_ms: dbInitMs,
  list_ms: metricResults.list.median,
  detail_ms: metricResults.detail.median,
  kanban_old_ms: metricResults.kanban_old.median,
  kanban_new_ms: metricResults.kanban_new.median,
  stats_ms: metricResults.stats.median,
  list_prepare_calls: metricResults.list.prepare_calls,
  list_stat_calls: metricResults.list.stat_calls,
  detail_prepare_calls: metricResults.detail.prepare_calls,
  detail_stat_calls: metricResults.detail.stat_calls,
  kanban_old_prepare_calls: metricResults.kanban_old.prepare_calls,
  kanban_old_stat_calls: metricResults.kanban_old.stat_calls,
  kanban_new_prepare_calls: metricResults.kanban_new.prepare_calls == null ? null : metricResults.kanban_new.prepare_calls,
  kanban_new_stat_calls: metricResults.kanban_new.stat_calls == null ? null : metricResults.kanban_new.stat_calls,
  metrics: metricResults,
  errors,
};

const outDir = ensureDir(path.join(PROJECT_ROOT, 'scripts', 'bench'));
const outPath = path.join(outDir, 'results-' + label + '.json');
fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');

// ---------- Readable summary ----------
const f = v => (v == null ? 'null' : Number(v).toFixed(2));
const c = v => (v == null ? 'null' : String(v));
console.log('');
console.log('=== SERVER BENCH (' + label + ') ===');
console.log('DB copy:             ' + dbInfo.dbPath);
console.log('User:                ' + USER_ID + ' (' + (restoredUser ? restoredUser.username : 'not restored') + ')');
console.log('Projects (active):   ' + projectIds.length);
console.log('Detail project:      ' + detailProjectId +
  ' (notes=' + (detailRow ? detailRow.note_count : '?') +
  ', checklist=' + (detailRow ? detailRow.checklist_count : '?') + ')');
console.log('Config:              ' + PASSES + ' passes x ' + ITERATIONS + ' iterations, ' + WARMUPS + ' warmups');
console.log('');
console.log('db_init_ms:          ' + f(results.db_init_ms) + '   (single, fresh process)');
for (const name of ['list', 'detail', 'kanban_old', 'kanban_new', 'stats']) {
  const m = metricResults[name];
  if (m.skipped) {
    console.log((name + '_ms').padEnd(21) + ' null   (' + m.note + ')');
    continue;
  }
  console.log(
    (name + '_ms').padEnd(21) +
    (f(m.median) + ' ms').padEnd(14) +
    'p95=' + f(m.p95) + ' ms' +
    '   prepare=' + c(m.prepare_calls) +
    ' stat=' + c(m.stat_calls) +
    ' exists=' + c(m.exists_calls)
  );
}
if (errors.length) {
  console.log('');
  console.log('ERRORS (' + errors.length + '):');
  errors.forEach(e => console.log(' - ' + e.metric + ' pass ' + e.pass + ': ' + e.message.split('\n')[0]));
}
console.log('');
console.log('Wrote ' + outPath);

if (errors.length) process.exitCode = 1;
