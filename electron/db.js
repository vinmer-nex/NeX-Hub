const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH;
if (!dbPath) {
  throw new Error('DB_PATH не установлен! Сначала вызовите initPaths(app) из electron/paths.js.');
}

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

// Включаем WAL-режим для скорости и конкурентного доступа
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -65536');
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456');
db.pragma('journal_size_limit = 67108864');

// Глобальный кеш подготовленных выражений (переиспользуем prepared statements)
const _origPrepare = db.prepare.bind(db);
const _stmtCache = new Map();
db.prepare = (sql) => {
  let s = _stmtCache.get(sql);
  if (!s) {
    s = _origPrepare(sql);
    if (_stmtCache.size >= 500) {
      _stmtCache.delete(_stmtCache.keys().next().value);
    }
    _stmtCache.set(sql, s);
  }
  return s;
};

// Создаём таблицы
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    logo TEXT,
    tags TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','done','archive')),
    priority TEXT DEFAULT 'p3' CHECK(priority IN ('p0','p1','p2','p3','p4')),
    color TEXT DEFAULT '#0071e3',
    favorite INTEGER DEFAULT 0,
    pinned INTEGER DEFAULT 0,
    deadline TEXT,
    start_date TEXT,
    estimated_hours REAL,
    folder_path TEXT DEFAULT '',
    mindmap_positions TEXT DEFAULT NULL,
    mindmap_graph TEXT DEFAULT NULL,
    mindmap_files TEXT DEFAULT NULL,
    mindmap_headings TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT DEFAULT '',
    text TEXT DEFAULT '',
    language TEXT DEFAULT 'javascript',
    attachments TEXT DEFAULT NULL,
    pinned INTEGER DEFAULT 0,
    tags TEXT DEFAULT NULL,
    links TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    number TEXT NOT NULL,
    description TEXT DEFAULT '',
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS checklist_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#2f6df6',
    position INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    text TEXT NOT NULL,
    priority TEXT DEFAULT 'p3',
    done INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    attachments TEXT DEFAULT NULL,
    category_id INTEGER DEFAULT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checklist_item_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    FOREIGN KEY (checklist_item_id) REFERENCES checklist_items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    date TEXT,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    author TEXT DEFAULT 'Аноним',
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    width INTEGER DEFAULT 0,
    height INTEGER DEFAULT 0,
    size INTEGER DEFAULT 0,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    type TEXT DEFAULT 'file',
    size INTEGER DEFAULT 0,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    trigger_name TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    author TEXT DEFAULT '',
    version TEXT DEFAULT '1.0.0',
    trigger_name TEXT DEFAULT 'manual',
    code TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS project_scripts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    workdir TEXT DEFAULT '',
    shell TEXT DEFAULT '',
    env TEXT DEFAULT '{}',
    confirm INTEGER DEFAULT 1,
    auto_start INTEGER DEFAULT 0,
    favorite INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    project_id TEXT,
    type TEXT NOT NULL,
    detail TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
  CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
  CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
  CREATE INDEX IF NOT EXISTS idx_checklist_project ON checklist_items(project_id);
  CREATE INDEX IF NOT EXISTS idx_checklist_categories_project ON checklist_categories(project_id);
  CREATE INDEX IF NOT EXISTS idx_photos_project ON photos(project_id);
  CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_scripts_project ON project_scripts(project_id);
  CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_log(project_id);
  CREATE INDEX IF NOT EXISTS idx_notes_project_created ON notes(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_versions_project_date ON versions(project_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_checklist_project_position ON checklist_items(project_id, position);
  CREATE INDEX IF NOT EXISTS idx_milestones_project_date ON milestones(project_id, date);
  CREATE INDEX IF NOT EXISTS idx_comments_project_created ON comments(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_user_timestamp ON activity_log(user_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_project_timestamp ON activity_log(project_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_photos_project_added ON photos(project_id, added_at);
  CREATE INDEX IF NOT EXISTS idx_files_project_added ON files(project_id, added_at);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS entity_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, source_type, source_id, target_type, target_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_entity_links_source
    ON entity_links(project_id, source_type, source_id);
  CREATE INDEX IF NOT EXISTS idx_entity_links_target
    ON entity_links(project_id, target_type, target_id);

  CREATE TRIGGER IF NOT EXISTS trg_entity_links_note_cleanup
  AFTER DELETE ON notes
  BEGIN
    DELETE FROM entity_links
    WHERE project_id = OLD.project_id
      AND ((source_type = 'note' AND source_id = CAST(OLD.id AS TEXT))
        OR (target_type = 'note' AND target_id = CAST(OLD.id AS TEXT)));
  END;

  CREATE TRIGGER IF NOT EXISTS trg_entity_links_version_cleanup
  AFTER DELETE ON versions
  BEGIN
    DELETE FROM entity_links
    WHERE project_id = OLD.project_id
      AND source_type = 'version'
      AND source_id = CAST(OLD.id AS TEXT);
  END;

  CREATE TRIGGER IF NOT EXISTS trg_entity_links_checklist_cleanup
  AFTER DELETE ON checklist_items
  BEGIN
    DELETE FROM entity_links
    WHERE project_id = OLD.project_id
      AND ((source_type = 'checklist' AND source_id = CAST(OLD.id AS TEXT))
        OR (target_type = 'checklist' AND target_id = CAST(OLD.id AS TEXT)));
  END;

  CREATE TRIGGER IF NOT EXISTS trg_entity_links_project_cleanup
  AFTER DELETE ON projects
  BEGIN
    DELETE FROM entity_links WHERE project_id = OLD.id;
  END;
`);

// Если база уже существует без mindmap_positions — добавляем колонку
try {
  db.exec(`ALTER TABLE projects ADD COLUMN mindmap_positions TEXT DEFAULT NULL`);
} catch (e) {
  // Колонка уже существует — игнорируем
}

// Если база уже существует без mindmap_graph — добавляем колонку
try {
  db.exec(`ALTER TABLE projects ADD COLUMN mindmap_graph TEXT DEFAULT NULL`);
} catch (e) {
  // Колонка уже существует — игнорируем
}

// Если база уже существует без mindmap_files — добавляем колонку
try {
  db.exec(`ALTER TABLE projects ADD COLUMN mindmap_files TEXT DEFAULT NULL`);
} catch (e) {
  // Колонка уже существует — игнорируем
}

// Если база уже существует без mindmap_headings — добавляем колонку
try {
  db.exec(`ALTER TABLE projects ADD COLUMN mindmap_headings TEXT DEFAULT NULL`);
} catch (e) {
  // Колонка уже существует — игнорируем
}

// Если у проектов ещё нет закрепления — добавляем колонку
try {
  db.exec(`ALTER TABLE projects ADD COLUMN pinned INTEGER DEFAULT 0`);
} catch (e) {
  // Колонка уже существует — игнорируем
}

// Если у вех ещё нет created_at — добавляем и заполняем текущим временем
try {
  const msCols = db.prepare('PRAGMA table_info(milestones)').all().map(c => c.name);
  if (!msCols.includes('created_at')) {
    db.exec('ALTER TABLE milestones ADD COLUMN created_at DATETIME');
    db.exec("UPDATE milestones SET created_at = datetime('now') WHERE created_at IS NULL");
  }
} catch (e) {
  // Колонка уже существует — игнорируем
}

// Если у заметок ещё нет attachments — добавляем колонку
try {
  db.exec(`ALTER TABLE notes ADD COLUMN attachments TEXT DEFAULT NULL`);
} catch (e) {
  // Колонка уже существует — игнорируем
}

// Если у заметок ещё нет закрепления/тегов/связей/updated_at — добавляем
try { db.exec(`ALTER TABLE notes ADD COLUMN pinned INTEGER DEFAULT 0`); } catch (e) {}
try { db.exec(`ALTER TABLE notes ADD COLUMN tags TEXT DEFAULT NULL`); } catch (e) {}
try { db.exec(`ALTER TABLE notes ADD COLUMN links TEXT DEFAULT NULL`); } catch (e) {}
try { db.exec(`ALTER TABLE notes ADD COLUMN updated_at DATETIME DEFAULT NULL`); } catch (e) {}

// Если у задач чеклиста ещё нет attachments — добавляем колонку
try {
  db.exec(`ALTER TABLE checklist_items ADD COLUMN attachments TEXT DEFAULT NULL`);
} catch (e) {
  // Колонка уже существует — игнорируем
}

// Если у задач чеклиста ещё нет категории — добавляем колонку
try {
  db.exec(`ALTER TABLE checklist_items ADD COLUMN category_id INTEGER DEFAULT NULL`);
} catch (e) {
  // Колонка уже существует — игнорируем
}

try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_checklist_category ON checklist_items(category_id)`);
} catch (e) {
  // Индекс уже существует — игнорируем
}

// Если у пользователей ещё нет кода восстановления — добавляем колонку
try {
  db.exec("ALTER TABLE users ADD COLUMN recovery_hash TEXT DEFAULT NULL");
} catch (e) {
  // Колонка уже существует — игнорируем
}

// Вложения и прикреплённые заметки/задачи чеклиста для версий — обратная совместимость
try { db.exec("ALTER TABLE versions ADD COLUMN attachments TEXT DEFAULT NULL"); } catch (e) {}
try { db.exec("ALTER TABLE versions ADD COLUMN note_ids TEXT DEFAULT NULL"); } catch (e) {}
try { db.exec("ALTER TABLE versions ADD COLUMN checklist_ids TEXT DEFAULT NULL"); } catch (e) {}

// ==================== МИГРАЦИЯ СВЯЗЕЙ ====================
// Переносим старые JSON-поля в единую таблицу entity_links один раз.
function parseLegacyIds(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function migrateEntityLinks() {
  const migrationKey = 'entity_links_migrated_v1';
  const done = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(migrationKey);
  if (done) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO entity_links
      (project_id, source_type, source_id, target_type, target_id, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const noteExists = db.prepare('SELECT id FROM notes WHERE id = ? AND project_id = ?');
  const itemExists = db.prepare('SELECT id FROM checklist_items WHERE id = ? AND project_id = ?');

  db.transaction(() => {
    const notes = db.prepare('SELECT id, project_id, links FROM notes').all();
    notes.forEach(note => {
      parseLegacyIds(note.links).forEach((rawId, index) => {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id) || !itemExists.get(id, note.project_id)) return;
        insert.run(note.project_id, 'note', String(note.id), 'checklist', String(id), index);
      });
    });

    const versions = db.prepare('SELECT id, project_id, note_ids, checklist_ids FROM versions').all();
    versions.forEach(version => {
      parseLegacyIds(version.note_ids).forEach((rawId, index) => {
        const id = String(rawId == null ? '' : rawId).trim();
        if (!id || !noteExists.get(id, version.project_id)) return;
        insert.run(version.project_id, 'version', String(version.id), 'note', id, index);
      });
      parseLegacyIds(version.checklist_ids).forEach((rawId, index) => {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id) || !itemExists.get(id, version.project_id)) return;
        insert.run(version.project_id, 'version', String(version.id), 'checklist', String(id), index);
      });
    });

    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
      .run(migrationKey, '1');
  })();
}

try {
  migrateEntityLinks();
} catch (e) {
  console.error('entity_links migration error:', e);
}

module.exports = db;
