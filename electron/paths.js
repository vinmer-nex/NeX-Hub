const path = require('path');
const fs = require('fs');

// Простой загрузчик .env (без зависимости dotenv).
// Не перезаписывает уже установленные переменные окружения.
function loadEnvFile(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  } catch (e) {
    // некорректный .env — игнорируем
  }
}

function initPaths(app) {
  const baseDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'NeXHub')
    : path.join(__dirname, '..');

  const dataDir = path.join(baseDir, 'data');
  const uploadsDir = path.join(baseDir, 'uploads');

  loadEnvFile(baseDir);

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(uploadsDir, 'photos'), { recursive: true });
  fs.mkdirSync(path.join(uploadsDir, 'files'), { recursive: true });

  process.env.DB_PATH = path.join(dataDir, 'projecthub.db');
  process.env.UPLOADS_PATH = uploadsDir;
  process.env.APP_BASE_DIR = baseDir;
  process.env.APP_DATA_DIR = dataDir;
  process.env.APP_UPLOADS_DIR = uploadsDir;

  return { baseDir, dataDir, uploadsDir };
}

module.exports = { initPaths };
