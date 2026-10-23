const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');
const shells = require('./lib/shells');
const runner = require('./scripts/runner');

let currentUserId = null;

// ===== Глобальные настройки приложения (app_settings) =====

function getSetting(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  if (value === null || value === undefined) {
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
    return;
  }
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

function requireCurrentUser() {
  if (!currentUserId) throw err('AUTH', 'Требуется авторизация');
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(currentUserId);
  if (!row) {
    currentUserId = null;
    throw err('AUTH', 'Требуется авторизация');
  }
  return row;
}

function normalizeCode(s) {
  return String(s || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function err(code, msg) {
  const e = new Error(msg);
  e.code = code;
  return e;
}

function generateRecoveryCode() {
  const raw = crypto.randomBytes(10).toString('hex').toUpperCase();
  const groups = [];
  for (let i = 0; i < raw.length; i += 5) {
    groups.push(raw.slice(i, i + 5));
  }
  return groups.join('-');
}

function listAccounts() {
  return db.prepare(
    'SELECT id, username, avatar, created_at FROM users ORDER BY username COLLATE NOCASE'
  ).all();
}

function getCurrentUser() {
  if (!currentUserId) return null;
  const user = db.prepare(
    'SELECT id, username, avatar, email, created_at FROM users WHERE id = ?'
  ).get(currentUserId);
  if (!user) {
    currentUserId = null;
    return null;
  }
  return user;
}

function createAccount({ username, password } = {}) {
  const name = String(username || '').trim();
  if (!name) throw err('VALIDATION', 'Логин не может быть пустым');
  if (!password || String(password).length < 3) {
    throw err('VALIDATION', 'Пароль минимум 3 символа');
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(name);
  if (existing) throw err('CONFLICT', 'Пользователь уже существует');

  const passwordHash = bcrypt.hashSync(String(password), 10);
  const recoveryCode = generateRecoveryCode();
  const recoveryHash = bcrypt.hashSync(normalizeCode(recoveryCode), 10);

  const result = db.prepare(
    'INSERT INTO users (username, password_hash, recovery_hash, email) VALUES (?, ?, ?, NULL)'
  ).run(name, passwordHash, recoveryHash);

  currentUserId = Number(result.lastInsertRowid);
  const user = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(currentUserId);

  return { user, recoveryCode };
}

function login({ username, password, remember } = {}) {
  const name = String(username || '').trim();
  if (!name || !password) throw err('VALIDATION', 'Логин и пароль обязательны');

  const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(name);
  if (!row) throw err('AUTH', 'Неверный логин или пароль');

  const valid = bcrypt.compareSync(String(password), row.password_hash);
  if (!valid) throw err('AUTH', 'Неверный логин или пароль');

  currentUserId = row.id;
  if (remember) setSetting('remember_user_id', String(row.id));
  else setSetting('remember_user_id', null);

  const user = db.prepare('SELECT id, username, email, avatar FROM users WHERE id = ?').get(row.id);
  return { user };
}

function logout() {
  currentUserId = null;
  setSetting('remember_user_id', null);
}

function resetPassword({ username, recoveryCode, newPassword } = {}) {
  const name = String(username || '').trim();
  if (!name) throw err('VALIDATION', 'Логин обязателен');
  if (!newPassword || String(newPassword).length < 3) {
    throw err('VALIDATION', 'Пароль минимум 3 символа');
  }

  const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(name);
  if (!row || !row.recovery_hash) throw err('AUTH', 'Неверный код восстановления');

  const valid = bcrypt.compareSync(normalizeCode(recoveryCode), row.recovery_hash);
  if (!valid) throw err('AUTH', 'Неверный код восстановления');

  const passwordHash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, row.id);

  return { ok: true };
}

function changePassword({ currentPassword, newPassword } = {}) {
  if (!currentUserId) throw err('AUTH', 'Требуется авторизация');
  if (!newPassword || String(newPassword).length < 3) {
    throw err('VALIDATION', 'Пароль минимум 3 символа');
  }

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(currentUserId);
  if (!row) throw err('AUTH', 'Требуется авторизация');

  const valid = bcrypt.compareSync(String(currentPassword || ''), row.password_hash);
  if (!valid) throw err('AUTH', 'Неверный текущий пароль');

  const passwordHash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, row.id);
  return { ok: true };
}

function updateAccount({ id, username, currentPassword, newPassword } = {}) {
  const current = requireCurrentUser();
  const targetId = id === undefined || id === null || id === '' ? current.id : parseInt(id, 10);
  if (!targetId) throw err('VALIDATION', 'Некорректный аккаунт');

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!row) throw err('AUTH', 'Аккаунт не найден');

  const valid = bcrypt.compareSync(String(currentPassword || ''), row.password_hash);
  if (!valid) throw err('AUTH', 'Неверный пароль');

  const name = String(username || '').trim();
  if (!name) throw err('VALIDATION', 'Имя не может быть пустым');
  if (name.length > 64) throw err('VALIDATION', 'Имя слишком длинное (макс. 64 символа)');

  const clash = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(name, targetId);
  if (clash) throw err('CONFLICT', 'Пользователь с таким именем уже существует');

  let passwordHash = row.password_hash;
  if (newPassword !== undefined && newPassword !== null && String(newPassword) !== '') {
    if (String(newPassword).length < 3) throw err('VALIDATION', 'Пароль минимум 3 символа');
    passwordHash = bcrypt.hashSync(String(newPassword), 10);
  }

  db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(name, passwordHash, targetId);

  const user = db.prepare('SELECT id, username, avatar, email, created_at FROM users WHERE id = ?').get(targetId);
  return { user };
}

function regenerateRecovery({ password } = {}) {
  if (!currentUserId) throw err('AUTH', 'Требуется авторизация');

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(currentUserId);
  if (!row) throw err('AUTH', 'Требуется авторизация');

  const valid = bcrypt.compareSync(String(password || ''), row.password_hash);
  if (!valid) throw err('AUTH', 'Неверный пароль');

  const recoveryCode = generateRecoveryCode();
  const recoveryHash = bcrypt.hashSync(normalizeCode(recoveryCode), 10);
  db.prepare('UPDATE users SET recovery_hash = ? WHERE id = ?').run(recoveryHash, row.id);

  return { recoveryCode };
}

function deleteAccount({ password } = {}) {
  if (!currentUserId) throw err('AUTH', 'Требуется авторизация');

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(currentUserId);
  if (!row) throw err('AUTH', 'Требуется авторизация');

  const valid = bcrypt.compareSync(String(password || ''), row.password_hash);
  if (!valid) throw err('AUTH', 'Неверный пароль');

  db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
  currentUserId = null;
  setSetting('remember_user_id', null);
  return { ok: true };
}

function deleteAccountById({ id, password } = {}) {
  const targetId = parseInt(id, 10);
  if (!targetId) throw err('VALIDATION', 'Некорректный аккаунт');

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!row) throw err('AUTH', 'Аккаунт не найден');

  const valid = bcrypt.compareSync(String(password || ''), row.password_hash);
  if (!valid) throw err('AUTH', 'Неверный пароль');

  db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
  if (currentUserId === row.id) {
    currentUserId = null;
    setSetting('remember_user_id', null);
  }
  return { ok: true };
}

/* ============================= Безопасность ============================= */

function getSecurity() {
  const pin = getSetting('pin_hash');
  return {
    hasPin: !!pin,
    autoLockMinutes: parseInt(getSetting('auto_lock_minutes') || '0', 10) || 0,
    protectDangerous: (getSetting('protect_dangerous') || '0') === '1',
    remember: !!getSetting('remember_user_id')
  };
}

function setPin({ currentPassword, pin } = {}) {
  const row = requireCurrentUser();
  const valid = bcrypt.compareSync(String(currentPassword || ''), row.password_hash);
  if (!valid) throw err('DENIED', 'Неверный пароль');

  const code = String(pin || '').trim();
  if (!/^\d{4,8}$/.test(code)) throw err('VALIDATION', 'PIN должен содержать 4–8 цифр');

  setSetting('pin_hash', bcrypt.hashSync(code, 10));
  return { ok: true };
}

function removePin({ password } = {}) {
  const row = requireCurrentUser();
  const valid = bcrypt.compareSync(String(password || ''), row.password_hash);
  if (!valid) throw err('DENIED', 'Неверный пароль');

  setSetting('pin_hash', null);
  return { ok: true };
}

function verifyPin({ pin } = {}) {
  const stored = getSetting('pin_hash');
  if (!stored) return { ok: true, hasPin: false };

  const valid = bcrypt.compareSync(String(pin || ''), stored);
  if (!valid) throw err('DENIED', 'Неверный PIN');
  return { ok: true, hasPin: true };
}

function verifyPassword({ password } = {}) {
  const row = requireCurrentUser();
  const valid = bcrypt.compareSync(String(password || ''), row.password_hash);
  if (!valid) throw err('DENIED', 'Неверный пароль');
  return { ok: true };
}

function getDefaultShellId() {
  const stored = getSetting('script_shell') || 'auto';
  return shells.isKnownShellId(stored) ? stored : 'auto';
}

function getTerminalSettings(refresh) {
  requireCurrentUser();
  const list = shells.detectShells(!!refresh);
  const shell = getDefaultShellId();
  return {
    shell: shell,
    shells: list,
    missing: shell !== 'auto' && !shells.isAvailable(shell)
  };
}

function updateTerminalSettings({ shell } = {}) {
  requireCurrentUser();
  const id = String(shell || 'auto');
  if (!shells.isKnownShellId(id)) throw err('VALIDATION', 'Неизвестная оболочка');
  if (id !== 'auto' && !shells.isAvailable(id)) {
    throw err('VALIDATION', 'Эта оболочка не найдена на компьютере');
  }
  setSetting('script_shell', id);
  return getTerminalSettings(false);
}

function updateSecurity({ autoLockMinutes, protectDangerous } = {}) {
  requireCurrentUser();

  if (autoLockMinutes !== undefined) {
    const minutes = parseInt(autoLockMinutes, 10);
    if (isNaN(minutes) || minutes < 0) throw err('VALIDATION', 'Некорректное значение автоблокировки');
    setSetting('auto_lock_minutes', String(minutes));
  }
  if (protectDangerous !== undefined) {
    setSetting('protect_dangerous', protectDangerous ? '1' : '0');
  }
  return getSecurity();
}

/* ============================= Статистика и данные ============================= */

const PROJECTS_SUBQUERY = '(SELECT id FROM projects WHERE user_id = ?)';

function getStats() {
  const row = requireCurrentUser();
  const uid = row.id;

  const sub = PROJECTS_SUBQUERY;

  const r = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM projects WHERE user_id = ? AND deleted_at IS NULL) AS projects,
      (SELECT COUNT(*) FROM projects WHERE user_id = ? AND deleted_at IS NOT NULL) AS trash,
      (SELECT COUNT(*) FROM notes WHERE project_id IN ${sub}) AS notes,
      (SELECT COUNT(*) FROM versions WHERE project_id IN ${sub}) AS versions,
      (SELECT COUNT(*) FROM checklist_items WHERE project_id IN ${sub}) AS checklist,
      (SELECT COUNT(*) FROM checklist_items WHERE done = 1 AND project_id IN ${sub}) AS "checklistDone",
      (SELECT COUNT(*) FROM milestones WHERE project_id IN ${sub}) AS milestones,
      (SELECT COUNT(*) FROM comments WHERE project_id IN ${sub}) AS comments,
      (SELECT COUNT(*) FROM photos WHERE project_id IN ${sub}) AS photos,
      (SELECT COUNT(*) FROM files WHERE project_id IN ${sub}) AS files,
      (SELECT COALESCE(SUM(size), 0) FROM files WHERE project_id IN ${sub}) AS file_bytes,
      (SELECT COALESCE(SUM(size), 0) FROM photos WHERE project_id IN ${sub}) AS photo_bytes
  `).get(uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, uid, uid);

  const stats = {
    projects: r.projects,
    trash: r.trash,
    notes: r.notes,
    versions: r.versions,
    checklist: r.checklist,
    checklistDone: r.checklistDone,
    milestones: r.milestones,
    comments: r.comments,
    photos: r.photos,
    files: r.files,
    createdAt: row.created_at || null
  };

  stats.storageBytes = (r.file_bytes || 0) + (r.photo_bytes || 0);

  return stats;
}

function resetData({ password } = {}) {
  const row = requireCurrentUser();
  const valid = bcrypt.compareSync(String(password || ''), row.password_hash);
  if (!valid) throw err('DENIED', 'Неверный пароль');

  const projects = db.prepare('SELECT id FROM projects WHERE user_id = ?').all(row.id);
  const uploadsPath = process.env.UPLOADS_PATH || './uploads';
  let removedFiles = 0;

  const removeFile = (sub, filename) => {
    if (!filename) return;
    const full = path.join(uploadsPath, sub, filename);
    try {
      if (fs.existsSync(full)) { fs.unlinkSync(full); removedFiles++; }
    } catch (e) { /* файл мог быть уже удалён */ }
  };

  for (const p of projects) {
    runner.stopProject(p.id);
    db.prepare('SELECT filename FROM photos WHERE project_id = ?').all(p.id)
      .forEach(ph => removeFile('photos', ph.filename));
    db.prepare('SELECT filename FROM files WHERE project_id = ?').all(p.id)
      .forEach(f => removeFile('files', f.filename));
  }

  db.prepare('DELETE FROM projects WHERE user_id = ?').run(row.id);

  return { ok: true, projects: projects.length, files: removedFiles };
}

/* ============================= «Запомнить меня» ============================= */

function setRemember(id) {
  setSetting('remember_user_id', id === null || id === undefined ? null : String(id));
}

function restoreSession() {
  if (currentUserId) return getCurrentUser();

  const stored = getSetting('remember_user_id');
  if (!stored) return null;

  const id = parseInt(stored, 10);
  if (!id) { setSetting('remember_user_id', null); return null; }

  const row = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!row) { setSetting('remember_user_id', null); return null; }

  currentUserId = id;
  return getCurrentUser();
}

module.exports = {
  listAccounts,
  getCurrentUser,
  createAccount,
  login,
  logout,
  resetPassword,
  changePassword,
  updateAccount,
  regenerateRecovery,
  deleteAccount,
  deleteAccountById,
  normalizeCode,
  getSecurity,
  setPin,
  removePin,
  verifyPin,
  verifyPassword,
  updateSecurity,
  getDefaultShellId,
  getTerminalSettings,
  updateTerminalSettings,
  getStats,
  resetData,
  setRemember,
  restoreSession
};
