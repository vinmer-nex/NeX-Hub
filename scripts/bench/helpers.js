'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TEMP_ROOT = path.join(
  process.env.LOCALAPPDATA || process.env.TEMP || 'C:\\Windows\\Temp',
  'Temp',
  'opencode',
  'nexbench'
);
const SQLITE3 = process.env.NEXBENCH_SQLITE3 || 'E:\\11111\\platform-tools\\sqlite3.exe';
const REAL_DB = path.join(PROJECT_ROOT, 'data', 'projecthub.db');
const UPLOADS_DIR = path.join(PROJECT_ROOT, 'uploads');
const USER_ID = 2;

function safeLabel(raw) {
  const label = String(raw == null || raw === '' ? 'baseline' : raw).trim();
  return label.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 64) || 'baseline';
}

function parseLabel(argv) {
  const args = argv || process.argv.slice(2);
  const i = args.indexOf('--label');
  if (i !== -1 && args[i + 1]) return safeLabel(args[i + 1]);
  const eq = args.find(a => a.startsWith('--label='));
  if (eq) return safeLabel(eq.slice('--label='.length));
  return 'baseline';
}

function sqliteQuotePath(p) {
  return String(p).replace(/\\/g, '/').replace(/'/g, "''");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function removeIfExists(file) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      if (fs.existsSync(file + suffix)) fs.unlinkSync(file + suffix);
    } catch (e) {
      // best-effort cleanup
    }
  }
}

/**
 * Create a consistent copy of the real DB with sqlite3 `.backup`,
 * then prepare it for unattended benchmarks:
 *   - remember_user_id = 2
 *   - pin_hash removed
 */
function prepareTempDb(label, prefix, stamp) {
  const workDir = ensureDir(path.join(TEMP_ROOT, safeLabel(label)));
  const tag = `${prefix || 'bench'}-${stamp || Date.now()}`;
  const dbPath = path.join(workDir, `${tag}.db`);

  removeIfExists(dbPath);

  execFileSync(
    SQLITE3,
    [REAL_DB, `.backup '${sqliteQuotePath(dbPath)}'`],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  execFileSync(
    SQLITE3,
    [
      dbPath,
      "DELETE FROM app_settings WHERE key = 'pin_hash';" +
        " INSERT OR REPLACE INTO app_settings (key, value) VALUES ('remember_user_id', '" + USER_ID + "');"
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const verify = execFileSync(
    SQLITE3,
    [
      dbPath,
      "SELECT (SELECT value FROM app_settings WHERE key = 'remember_user_id')," +
        " (SELECT COUNT(*) FROM app_settings WHERE key = 'pin_hash')," +
        " (SELECT COUNT(*) FROM users WHERE id = " + USER_ID + ")," +
        " (SELECT COUNT(*) FROM projects WHERE user_id = " + USER_ID + " AND deleted_at IS NULL);"
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  ).toString().trim();

  const parts = verify.split('|');
  if (parts[0] !== String(USER_ID) || Number(parts[1]) !== 0 || Number(parts[2]) < 1) {
    throw new Error('Temp DB is not ready for auto-login. sqlite verify => ' + verify);
  }

  return {
    workDir,
    dbPath,
    userDataDir: path.join(workDir, `${tag}-userdata`),
    uploadsDir: UPLOADS_DIR,
    projectCount: Number(parts[3]) || 0,
    rememberUserId: parts[0],
    pinHashCount: Number(parts[1]),
  };
}

module.exports = {
  PROJECT_ROOT,
  TEMP_ROOT,
  SQLITE3,
  REAL_DB,
  UPLOADS_DIR,
  USER_ID,
  safeLabel,
  parseLabel,
  prepareTempDb,
  ensureDir,
  removeIfExists,
};
