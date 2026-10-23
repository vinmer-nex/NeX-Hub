import store from '../store.js';
import auth from '../auth.js';
import api from '../api.js';
import { svgIcon, escapeHTML, showToast, formatDate } from '../utils/dom.js';
import {
  ACCENTS, CORNERS, DENSITIES, SCALES, FONTS,
  setThemeMode, setAccent, setCorners, setDensity, setScale, setFont
} from '../appearance.js';
import security from '../security.js';
import { openModal } from './modal.js';

const SECTIONS = [
  { id: 'profile', label: 'Профиль', icon: 'user', desc: 'Личные данные и аватар' },
  { id: 'account', label: 'Аккаунт', icon: 'shield', desc: 'Аккаунты и пароль' },
  { id: 'security', label: 'Безопасность', icon: 'lock', desc: 'PIN, автоблокировка и защита' },
  { id: 'notifications', label: 'Уведомления', icon: 'bell', desc: 'Оповещения и напоминания' },
  { id: 'appearance', label: 'Оформление', icon: 'palette', desc: 'Тема и внешний вид' },
  { id: 'scripts', label: 'Скрипты', icon: 'terminal', desc: 'Оболочка и запуск команд' },
  { id: 'data', label: 'Данные', icon: 'database', desc: 'Экспорт, импорт и хранилище' },
  { id: 'about', label: 'О программе', icon: 'info', desc: 'Версия и информация' }
];

function escapeAttr(value) {
  return escapeHTML(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderSettings() {
  const active = store.currentSettingsTab || 'profile';

  let html = '';
  html += '<div class="settings-page">';
  html += '<div class="settings-head">';
  html += '<h2 class="page-title">Настройки</h2>';
  html += '<p class="settings-sub">Управление аккаунтом и приложением</p>';
  html += '</div>';
  html += '<div class="settings-layout">';
  html += '<nav class="settings-nav">';
  for (let i = 0; i < SECTIONS.length; i++) {
    const s = SECTIONS[i];
    html += '<button class="settings-nav-item ' + (s.id === active ? 'active' : '') + '" data-tab="' + s.id + '">';
    html += svgIcon(s.icon) + '<span>' + s.label + '</span>';
    html += '</button>';
  }
  html += '</nav>';
  html += '<div class="settings-content">' + renderSection(active) + '</div>';
  html += '</div></div>';

  setTimeout(function() { bindSettingsEvents(); }, 0);
  return html;
}

function renderSection(id) {
  const section = SECTIONS.find(function(s) { return s.id === id; }) || SECTIONS[0];

  let body = '';
  if (id === 'profile') body = renderProfile();
  else if (id === 'account') body = renderAccount();
  else if (id === 'security') body = renderSecurity();
  else if (id === 'appearance') body = renderAppearance();
  else if (id === 'scripts') body = renderScriptsSettings();
  else if (id === 'data') body = renderData();
  else if (id === 'about') body = renderAbout();
  else body = renderDevPlaceholder();

  let html = '';
  html += '<div class="settings-section">';
  html += '<div class="settings-section-head">';
  html += '<span class="settings-section-icon">' + svgIcon(section.icon) + '</span>';
  html += '<div>';
  html += '<h3 class="settings-section-title">' + escapeHTML(section.label) + '</h3>';
  html += '<p class="settings-section-desc">' + escapeHTML(section.desc) + '</p>';
  html += '</div>';
  html += '</div>';
  html += body;
  html += '</div>';
  return html;
}

/* ============================= Профиль ============================= */

function switchRow(id, label, desc, checked) {
  let html = '';
  html += '<label class="switch-row" for="' + id + '">';
  html += '<span class="switch-text">';
  html += '<span class="switch-label">' + label + '</span>';
  if (desc) html += '<span class="switch-desc">' + desc + '</span>';
  html += '</span>';
  html += '<span class="switch"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><span class="switch-track"></span></span>';
  html += '</label>';
  return html;
}

function renderProfile() {
  const user = auth.user || {};
  const name = user.username || 'Пользователь';
  const initial = (name.charAt(0) || 'U').toUpperCase();

  const meta = [];
  if (user.id != null) meta.push('ID: ' + String(user.id));
  if (user.created_at) meta.push('Создан: ' + (formatDate(user.created_at) || String(user.created_at)));

  let html = '';
  html += '<div class="settings-block">';
  html += '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">';
  html += '<span class="avatar" style="width:72px;height:72px;font-size:28px">' + escapeHTML(initial) + '</span>';
  html += '<div style="min-width:0">';
  html += '<div style="font-size:18px;font-weight:720;letter-spacing:-.02em">' + escapeHTML(name) + '</div>';
  html += '<div style="font-size:12.5px;color:var(--text-secondary);margin-top:3px">' + escapeHTML(meta.length ? meta.join(' · ') : 'Локальный аккаунт') + '</div>';
  html += '</div>';
  html += '</div>';
  html += '<div style="margin-top:18px">';
  html += '<button class="btn btn-secondary" id="btnSwitchAccount">' + svgIcon('log-out', 'sm') + ' Сменить аккаунт</button>';
  html += '</div>';
  html += '</div>';

  // Вход
  html += '<div class="settings-block" style="margin-top:22px">';
  html += switchRow('profileRemember', 'Запомнить меня', 'Не выходить из аккаунта при перезапуске приложения.', !!store.remember);
  html += '</div>';

  // Статистика
  html += '<div class="settings-block" style="margin-top:22px">';
  html += '<div class="settings-block-label">Статистика аккаунта</div>';
  html += '<p class="settings-block-hint">Данные, сохранённые в этом аккаунте.</p>';
  html += '<div class="stats-grid" id="profileStats"><span class="settings-block-hint">Загрузка…</span></div>';
  html += '</div>';

  // Опасная зона
  html += '<div class="settings-block" style="margin-top:22px">';
  html += '<div class="settings-block-label" style="color:var(--red)">Опасная зона</div>';
  html += '<p class="settings-block-hint">Безвозвратное удаление всех проектов, заметок и файлов аккаунта. Сам аккаунт сохранится.</p>';
  html += '<button class="btn btn-danger btn-sm" id="btnResetData">' + svgIcon('trash', 'sm') + ' Сбросить данные аккаунта</button>';
  html += '</div>';

  return html;
}

function bindProfileEvents() {
  const btn = document.getElementById('btnSwitchAccount');
  if (btn) btn.addEventListener('click', function() {
    Promise.resolve(auth.logout()).then(function() {
      return import('./login.js');
    }).then(function(m) { m.renderLoginScreen(); });
  });

  const remember = document.getElementById('profileRemember');
  if (remember) remember.addEventListener('change', function() {
    auth.setRemember(remember.checked).then(function(val) {
      store.remember = !!val;
      showToast(val ? 'Вход будет запомнен' : 'Запоминание входа выключено');
    }).catch(function() {
      remember.checked = !remember.checked;
      showToast('Не удалось сохранить', true);
    });
  });

  const resetBtn = document.getElementById('btnResetData');
  if (resetBtn) resetBtn.addEventListener('click', openResetDataModal);

  loadStats();
}

function loadStats() {
  const box = document.getElementById('profileStats');
  if (!box) return;
  auth.getStats().then(function(s) {
    box.innerHTML = statsCards(s);
  }).catch(function() {
    box.innerHTML = '<span class="settings-block-hint">Не удалось загрузить статистику</span>';
  });
}

function statsCards(s) {
  if (!s) return '';
  const items = [
    ['Проектов', s.projects],
    ['В корзине', s.trash],
    ['Заметок', s.notes],
    ['Версий', s.versions],
    ['Задач', s.checklist],
    ['Вех', s.milestones],
    ['Комментариев', s.comments],
    ['Фото', s.photos],
    ['Файлов', s.files]
  ];
  let html = '';
  items.forEach(function(it) {
    html += '<div class="stat-card"><span class="stat-value">' + (it[1] || 0) + '</span><span class="stat-label">' + it[0] + '</span></div>';
  });
  html += '<div class="stat-card"><span class="stat-value">' + formatBytes(s.storageBytes || 0) + '</span><span class="stat-label">Занято</span></div>';
  return html;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' Б';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' МБ';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' ГБ';
}

function openResetDataModal() {
  const body = '' +
    '<p class="settings-block-hint" style="margin-bottom:14px">Все проекты, заметки, версии и файлы будут удалены безвозвратно. Аккаунт сохранится.</p>' +
    '<div class="form-group"><span class="form-label">Пароль аккаунта</span>' +
    '<input class="form-input" type="password" id="resetDataPw" placeholder="Введите пароль"></div>';

  openModal('Сбросить данные аккаунта', body, async function(el) {
    const pw = el.querySelector('#resetDataPw').value;
    if (!pw) { showToast('Введите пароль', true); return false; }
    try {
      await auth.resetData(pw);
      const app = await import('../app.js');
      await app.loadProjects();
      await app.render();
      showToast('Данные аккаунта сброшены');
      return true;
    } catch (err) {
      showToast(err.message || 'Не удалось сбросить данные', true);
      return false;
    }
  }, { footer: modalFooter('Сбросить', 'btn-danger') });
}

/* ============================= Аккаунт ============================= */

let accountsCache = [];

function renderAccount() {
  accountsCache = [];
  let html = '';
  html += '<div class="settings-block">';
  html += '<div class="settings-block-label">Локальные аккаунты</div>';
  html += '<p class="settings-block-hint">Аккаунты, сохранённые на этом компьютере. Текущий аккаунт выделен.</p>';
  html += '<div id="accountsList" style="display:flex;flex-direction:column;gap:10px">';
  html += '<div class="settings-block-hint" id="accountsLoading">Загрузка аккаунтов…</div>';
  html += '</div>';
  html += '<div style="margin-top:16px">';
  html += '<button class="btn btn-primary btn-sm" id="btnAddAccount">' + svgIcon('plus', 'sm') + ' Добавить аккаунт</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

function renderAccountRow(acc) {
  const name = acc.username || 'Аккаунт';
  const initial = (name.charAt(0) || 'U').toUpperCase();
  const isCurrent = !!(auth.user && Number(acc.id) === Number(auth.user.id));

  let html = '';
  html += '<div class="account-row" data-id="' + escapeHTML(String(acc.id)) + '" style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid ' + (isCurrent ? 'var(--accent)' : 'var(--border)') + ';border-radius:var(--radius);background:var(--surface-2)">';
  html += '<span class="avatar" style="width:40px;height:40px;font-size:16px">' + escapeHTML(initial) + '</span>';
  html += '<div style="flex:1;min-width:0">';
  html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
  html += '<span style="font-size:13.5px;font-weight:650">' + escapeHTML(name) + '</span>';
  if (isCurrent) html += '<span class="badge badge-accent">Текущий</span>';
  html += '</div>';
  html += '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px">' + escapeHTML(acc.created_at ? ('Создан: ' + (formatDate(acc.created_at) || String(acc.created_at))) : 'Локальный аккаунт') + '</div>';
  html += '</div>';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">';
  html += '<button class="btn btn-secondary btn-xs" data-action="edit">' + svgIcon('edit', 'sm') + ' Изменить</button>';
  if (isCurrent) {
    html += '<button class="btn btn-secondary btn-xs" data-action="recovery">Новый код</button>';
  } else {
    html += '<button class="btn btn-primary btn-xs" data-action="switch">Войти</button>';
  }
  html += '<button class="btn btn-danger btn-xs" data-action="delete">Удалить</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

async function loadAccounts() {
  const container = document.getElementById('accountsList');
  if (!container) return;

  let accounts;
  try {
    accounts = await auth.listAccounts();
  } catch (err) {
    container.innerHTML = '<div class="settings-block-hint">Не удалось загрузить аккаунты: ' + escapeHTML(err.message || 'ошибка') + '</div>';
    return;
  }

  accountsCache = accounts || [];

  if (!accountsCache.length) {
    container.innerHTML = '<div class="settings-block-hint">Аккаунты не найдены.</div>';
    return;
  }

  let html = '';
  for (let i = 0; i < accountsCache.length; i++) html += renderAccountRow(accountsCache[i]);
  container.innerHTML = html;
}

function bindAccountEvents() {
  const addBtn = document.getElementById('btnAddAccount');
  if (addBtn) addBtn.addEventListener('click', function() {
    import('./login.js').then(function(m) { m.renderLoginScreen(); });
  });

  const container = document.getElementById('accountsList');
  if (container) container.addEventListener('click', function(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('[data-id]');
    const id = row ? row.getAttribute('data-id') : null;
    const acc = accountsCache.find(function(a) { return String(a.id) === String(id); }) || null;
    const action = btn.dataset.action;

    if (action === 'switch' && acc) openSwitchAccountModal(acc);
    else if (action === 'edit' && acc) openEditAccountModal(acc);
    else if (action === 'recovery') openRecoveryModal();
    else if (action === 'delete' && acc) openDeleteAccountModal(acc);
  });
}

function modalFooter(saveLabel, saveClass) {
  return '<button class="btn btn-secondary modal-close-x" type="button">Отмена</button>' +
    '<button class="btn ' + (saveClass || 'btn-primary') + '" id="modalSaveBtn" type="button">' + saveLabel + '</button>';
}

function openEditAccountModal(acc) {
  const isCurrent = !!(auth.user && Number(acc.id) === Number(auth.user.id));
  const body = '' +
    '<div class="form-group"><span class="form-label">Имя аккаунта</span>' +
    '<input class="form-input" id="accEditName" maxlength="64" placeholder="Имя аккаунта" value="' + escapeAttr(acc.username || '') + '"></div>' +
    '<div class="form-group"><span class="form-label">Текущий пароль</span>' +
    '<input class="form-input" type="password" id="accEditPw" placeholder="Пароль этого аккаунта"></div>' +
    '<div class="form-group"><span class="form-label">Новый пароль</span>' +
    '<input class="form-input" type="password" id="accEditNewPw" placeholder="Оставьте пустым, чтобы не менять"></div>' +
    '<div class="form-group"><span class="form-label">Повторите новый пароль</span>' +
    '<input class="form-input" type="password" id="accEditNewPw2" placeholder="Повторите пароль"></div>' +
    '<p class="form-hint">Для сохранения изменений подтвердите текущий пароль аккаунта.</p>';

  openModal('Изменить аккаунт', body, async function(el) {
    const name = el.querySelector('#accEditName').value.trim();
    const cur = el.querySelector('#accEditPw').value;
    const np = el.querySelector('#accEditNewPw').value;
    const np2 = el.querySelector('#accEditNewPw2').value;

    if (!name) { showToast('Введите имя аккаунта', true); return false; }
    if (!cur) { showToast('Введите текущий пароль', true); return false; }
    if (np && np.length < 3) { showToast('Пароль минимум 3 символа', true); return false; }
    if (np !== np2) { showToast('Пароли не совпадают', true); return false; }

    try {
      const user = await auth.updateAccount(acc.id, {
        username: name,
        currentPassword: cur,
        newPassword: np || null
      });
      if (isCurrent) {
        const app = await import('../app.js');
        await app.render();
      } else {
        loadAccounts();
      }
      showToast('Аккаунт обновлён' + (user && user.username ? ': ' + user.username : ''));
      return true;
    } catch (err) {
      showToast(err.message || 'Не удалось обновить аккаунт', true);
      return false;
    }
  }, { footer: modalFooter('Сохранить') });
}

function openRecoveryModal() {
  const body = '' +
    '<p class="settings-block-hint" style="margin-bottom:14px">Старый код восстановления перестанет работать. Новый код покажется один раз.</p>' +
    '<div class="form-group"><span class="form-label">Пароль</span>' +
    '<input class="form-input" type="password" id="accRecPw" placeholder="Введите пароль"></div>';

  openModal('Новый код восстановления', body, async function(el) {
    const pw = el.querySelector('#accRecPw').value;
    if (!pw) { showToast('Введите пароль', true); return false; }
    try {
      const res = await auth.regenerateRecovery(pw);
      const code = res && res.recoveryCode ? res.recoveryCode : res;
      showToast('Новый код создан');
      showRecoveryCodeModal(code);
      return true;
    } catch (err) {
      showToast(err.message || 'Не удалось создать код', true);
      return false;
    }
  }, { footer: modalFooter('Создать') });
}

function showRecoveryCodeModal(code) {
  const body = '' +
    '<p class="settings-block-hint" style="margin-bottom:14px">Сохраните код — он показывается только один раз и понадобится, если забудете пароль.</p>' +
    '<div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:20px;font-weight:600;letter-spacing:2px;text-align:center;padding:16px;background:var(--bg);border:1px dashed var(--border);border-radius:var(--radius-lg);word-break:break-all;user-select:all">' + escapeHTML(code || '') + '</div>';

  const footer = '' +
    '<button class="btn btn-secondary" id="copyRecovery" type="button">Скопировать</button>' +
    '<button class="btn btn-secondary" id="downloadRecovery" type="button">' + svgIcon('download', 'sm') + ' Скачать .txt</button>' +
    '<button class="btn btn-primary modal-close-x" type="button">Готово</button>';

  const overlay = openModal('Код восстановления', body, null, { footer });
  const copyBtn = overlay.querySelector('#copyRecovery');
  if (copyBtn) copyBtn.addEventListener('click', function() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code || '').then(function() {
        showToast('Скопировано');
      }).catch(function() {
        showToast('Не удалось скопировать', true);
      });
    } else {
      showToast('Не удалось скопировать', true);
    }
  });

  const downloadBtn = overlay.querySelector('#downloadRecovery');
  if (downloadBtn) downloadBtn.addEventListener('click', function() {
    const name = (auth.user && auth.user.username) || 'nexhub';
    const text = 'NeX Hub — код восстановления\r\nАккаунт: ' + name + '\r\n\r\n' + (code || '') + '\r\n\r\nСохраните этот файл в надёжном месте.';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexhub-recovery-' + name + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    showToast('Файл сохранён');
  });
}

function openDeleteAccountModal(acc) {
  const name = acc.username || 'аккаунт';
  const isCurrent = !!(auth.user && Number(acc.id) === Number(auth.user.id));

  const body = '' +
    '<p class="settings-block-hint" style="margin-bottom:14px">Удалить аккаунт «' + escapeHTML(name) + '»? Это действие необратимо.</p>' +
    '<div class="form-group"><span class="form-label">Пароль аккаунта</span>' +
    '<input class="form-input" type="password" id="accDelPw" placeholder="Введите пароль"></div>';

  openModal('Удалить аккаунт', body, async function(el) {
    const pw = el.querySelector('#accDelPw').value;
    if (!pw) { showToast('Введите пароль', true); return false; }
    try {
      if (isCurrent) {
        await auth.deleteAccount(pw);
      } else {
        await auth.deleteAccountById(acc.id, pw);
      }
      showToast('Аккаунт удалён');
      if (isCurrent) {
        const m = await import('./login.js');
        m.renderLoginScreen();
      } else {
        loadAccounts();
      }
      return true;
    } catch (err) {
      showToast(err.message || 'Не удалось удалить аккаунт', true);
      return false;
    }
  }, { footer: modalFooter('Удалить', 'btn-danger') });
}

function openSwitchAccountModal(acc) {
  const name = acc.username || 'аккаунт';
  const body = '' +
    '<p class="settings-block-hint" style="margin-bottom:14px">Войти как «' + escapeHTML(name) + '»</p>' +
    '<div class="form-group"><span class="form-label">Пароль</span>' +
    '<input class="form-input" type="password" id="accSwPw" placeholder="Введите пароль"></div>';

  openModal('Сменить аккаунт', body, async function(el) {
    const pw = el.querySelector('#accSwPw').value;
    if (!pw) { showToast('Введите пароль', true); return false; }
    try {
      await auth.login(acc.username, pw);
      const app = await import('../app.js');
      await app.loadProjects();
      await app.render();
      showToast('Вы вошли как ' + name);
      return true;
    } catch (err) {
      showToast(err.message || 'Не удалось войти', true);
      return false;
    }
  }, { footer: modalFooter('Войти') });
}

/* ============================= Оформление ============================= */

function themeCard(mode) {
  const active = store.themeMode === mode.id;
  let html = '';
  html += '<button type="button" class="theme-option' + (active ? ' active' : '') + '" data-theme="' + mode.id + '">';
  html += '<div class="theme-preview theme-preview-' + mode.id + '">';
  html += '<span class="tp-side"></span><span class="tp-body"><span class="tp-line"></span><span class="tp-line short"></span></span>';
  html += '</div>';
  html += '<div class="theme-option-meta">';
  html += '<span class="theme-option-name">' + svgIcon(mode.icon, 'sm') + ' ' + mode.label + '</span>';
  html += (active ? '<span class="theme-option-check">' + svgIcon('check', 'sm') + '</span>' : '');
  html += '</div></button>';
  return html;
}

function optChip(group, value, label, active, style) {
  return '<button type="button" class="opt-chip' + (active ? ' active' : '') + '" data-group="' + group + '" data-value="' + value + '"' +
    (style ? ' style="' + style + '"' : '') + '>' + label + '</button>';
}

function renderAppearance() {
  const themeMode = store.themeMode || 'light';
  const accent = store.accent || 'blue';
  const corners = store.corners || 'default';
  const density = store.density || 'default';
  const scale = Number(store.uiScale) || 100;
  const font = store.fontFamily || 'system';

  let html = '';

  html += '<div class="settings-block">';
  html += '<div class="settings-block-label">Тема оформления</div>';
  html += '<p class="settings-block-hint">Выберите, как выглядит интерфейс NeX Hub.</p>';
  html += '<div class="theme-options">';
  html += themeCard({ id: 'light', label: 'Светлая', icon: 'sun' });
  html += themeCard({ id: 'dark', label: 'Тёмная', icon: 'moon' });
  html += themeCard({ id: 'system', label: 'Системная', icon: 'monitor' });
  html += '</div></div>';

  html += '<div class="settings-block" style="margin-top:22px">';
  html += '<div class="settings-block-label">Акцентный цвет</div>';
  html += '<p class="settings-block-hint">Цвет кнопок, ссылок и активных элементов.</p>';
  html += '<div class="accent-grid">';
  ACCENTS.forEach(function(a) {
    html += '<button type="button" class="accent-swatch' + (a.id === accent ? ' active' : '') + '" data-accent="' + a.id + '" title="' + a.label + '" style="background:' + a.light.accent + '"></button>';
  });
  html += '</div></div>';

  html += '<div class="settings-block" style="margin-top:22px">';
  html += '<div class="settings-block-label">Форма и плотность</div>';
  html += '<p class="settings-block-hint">Настройте скругления углов и компактность интерфейса.</p>';
  html += '<div class="opt-field"><span class="opt-field-label">Скругления</span><div class="opt-grid">';
  CORNERS.forEach(function(c) { html += optChip('corners', c.id, c.label, corners === c.id); });
  html += '</div></div>';
  html += '<div class="opt-field"><span class="opt-field-label">Плотность</span><div class="opt-grid">';
  DENSITIES.forEach(function(d) { html += optChip('density', d.id, d.label, density === d.id); });
  html += '</div></div>';
  html += '</div>';

  html += '<div class="settings-block" style="margin-top:22px">';
  html += '<div class="settings-block-label">Масштаб и шрифт</div>';
  html += '<p class="settings-block-hint">Размер элементов интерфейса и гарнитура текста.</p>';
  html += '<div class="opt-field"><span class="opt-field-label">Масштаб</span><div class="opt-grid">';
  SCALES.forEach(function(s) { html += optChip('scale', String(s), s + '%', scale === s); });
  html += '</div></div>';
  html += '<div class="opt-field"><span class="opt-field-label">Шрифт</span><div class="opt-grid">';
  FONTS.forEach(function(f) {
    html += optChip('font', f.id, escapeHTML(f.label), font === f.id, 'font-family:' + f.stack);
  });
  html += '</div></div>';
  html += '</div>';

  return html;
}

/* ============================= Безопасность ============================= */

const AUTO_LOCK_OPTIONS = [
  { value: 0, label: 'Никогда' },
  { value: 1, label: '1 мин' },
  { value: 5, label: '5 мин' },
  { value: 10, label: '10 мин' },
  { value: 15, label: '15 мин' },
  { value: 30, label: '30 мин' }
];

function renderSecurity() {
  let html = '';

  html += '<div class="settings-block">';
  html += '<div class="settings-block-label">PIN-код</div>';
  html += '<p class="settings-block-hint">Блокировка приложения 4–8-значным PIN-кодом. Запрашивается при запуске и после бездействия.</p>';
  if (store.hasPin) {
    html += '<div class="sec-status">' + svgIcon('check', 'sm') + ' PIN установлен</div>';
    html += '<div class="sec-actions">';
    html += '<button class="btn btn-secondary btn-sm" id="btnChangePin">Сменить PIN</button>';
    html += '<button class="btn btn-danger btn-sm" id="btnRemovePin">Удалить PIN</button>';
    html += '</div>';
  } else {
    html += '<div class="sec-status sec-status-off">' + svgIcon('lock', 'sm') + ' PIN не установлен</div>';
    html += '<div class="sec-actions"><button class="btn btn-primary btn-sm" id="btnSetPin">' + svgIcon('lock', 'sm') + ' Установить PIN</button></div>';
  }
  html += '</div>';

  html += '<div class="settings-block' + (store.hasPin ? '' : ' sec-disabled') + '" style="margin-top:22px">';
  html += '<div class="settings-block-label">Автоблокировка по бездействию</div>';
  html += '<p class="settings-block-hint">' + (store.hasPin
    ? 'Через сколько блокировать приложение без действий.'
    : 'Сначала установите PIN-код, чтобы включить автоблокировку.') + '</p>';
  html += '<div class="opt-grid">';
  AUTO_LOCK_OPTIONS.forEach(function(o) {
    html += optChip('autolock', String(o.value), o.label, Number(store.autoLockMinutes) === o.value);
  });
  html += '</div></div>';

  html += '<div class="settings-block" style="margin-top:22px">';
  html += switchRow('secProtect', 'Требовать пароль для опасных действий', 'Подтверждать паролем удаление проектов и экспорт данных.', !!store.protectDangerous);
  html += '</div>';

  html += '<div class="settings-block" style="margin-top:22px">';
  html += '<div class="settings-block-label">Код восстановления</div>';
  html += '<p class="settings-block-hint">Понадобится, если вы забудете пароль. Создайте новый код и сохраните его в файл.</p>';
  html += '<button class="btn btn-secondary btn-sm" id="btnNewRecovery">' + svgIcon('key', 'sm') + ' Создать новый код</button>';
  html += '</div>';

  return html;
}

function rerenderSecurity() {
  const content = document.querySelector('.settings-content');
  if (content) content.innerHTML = renderSection('security');
  bindSecurityEvents();
}

function bindSecurityEvents() {
  const setPinBtn = document.getElementById('btnSetPin');
  if (setPinBtn) setPinBtn.addEventListener('click', function() { openPinModal(false); });

  const changePinBtn = document.getElementById('btnChangePin');
  if (changePinBtn) changePinBtn.addEventListener('click', function() { openPinModal(true); });

  const removePinBtn = document.getElementById('btnRemovePin');
  if (removePinBtn) removePinBtn.addEventListener('click', openRemovePinModal);

  const newRecoveryBtn = document.getElementById('btnNewRecovery');
  if (newRecoveryBtn) newRecoveryBtn.addEventListener('click', openRecoveryModal);

  document.querySelectorAll('.opt-chip[data-group="autolock"]').forEach(function(chip) {
    chip.addEventListener('click', function() {
      const val = Number(chip.dataset.value);
      if (val === Number(store.autoLockMinutes)) return;
      auth.updateSecurity({ autoLockMinutes: val }).then(function(sec) {
        security.applySecurity(sec);
        security.resetIdleTimer();
        rerenderSecurity();
      }).catch(function() { showToast('Не удалось сохранить', true); });
    });
  });

  const protect = document.getElementById('secProtect');
  if (protect) protect.addEventListener('change', function() {
    auth.updateSecurity({ protectDangerous: protect.checked }).then(function(sec) {
      security.applySecurity(sec);
      showToast(sec.protectDangerous ? 'Защита опасных действий включена' : 'Защита опасных действий выключена');
    }).catch(function() {
      protect.checked = !protect.checked;
      showToast('Не удалось сохранить', true);
    });
  });
}

function openPinModal(isChange) {
  const body = '' +
    '<div class="form-group"><span class="form-label">' + (isChange ? 'Текущий пароль' : 'Пароль аккаунта') + '</span>' +
    '<input class="form-input" type="password" id="pinPw" placeholder="Введите пароль"></div>' +
    '<div class="form-group"><span class="form-label">Новый PIN</span>' +
    '<input class="form-input" type="password" inputmode="numeric" maxlength="8" id="pinNew" placeholder="4–8 цифр"></div>' +
    '<div class="form-group"><span class="form-label">Повторите PIN</span>' +
    '<input class="form-input" type="password" inputmode="numeric" maxlength="8" id="pinNew2" placeholder="Повторите PIN"></div>';

  openModal(isChange ? 'Сменить PIN-код' : 'Установить PIN-код', body, async function(el) {
    const pw = el.querySelector('#pinPw').value;
    const pin = el.querySelector('#pinNew').value.trim();
    const pin2 = el.querySelector('#pinNew2').value.trim();
    if (!pw) { showToast('Введите пароль', true); return false; }
    if (!/^\d{4,8}$/.test(pin)) { showToast('PIN должен содержать 4–8 цифр', true); return false; }
    if (pin !== pin2) { showToast('PIN-коды не совпадают', true); return false; }
    try {
      const sec = await auth.setPin(pw, pin);
      security.applySecurity(sec);
      showToast('PIN установлен');
      rerenderSecurity();
      return true;
    } catch (err) {
      showToast(err.message || 'Не удалось установить PIN', true);
      return false;
    }
  }, { footer: modalFooter('Сохранить') });
}

function openRemovePinModal() {
  const body = '' +
    '<p class="settings-block-hint" style="margin-bottom:14px">Блокировка по PIN будет отключена.</p>' +
    '<div class="form-group"><span class="form-label">Пароль аккаунта</span>' +
    '<input class="form-input" type="password" id="pinPw" placeholder="Введите пароль"></div>';

  openModal('Удалить PIN-код', body, async function(el) {
    const pw = el.querySelector('#pinPw').value;
    if (!pw) { showToast('Введите пароль', true); return false; }
    try {
      const sec = await auth.removePin(pw);
      security.applySecurity(sec);
      security.resetIdleTimer();
      showToast('PIN удалён');
      rerenderSecurity();
      return true;
    } catch (err) {
      showToast(err.message || 'Не удалось удалить PIN', true);
      return false;
    }
  }, { footer: modalFooter('Удалить', 'btn-danger') });
}

/* ============================= Данные ============================= */

function renderData() {
  let html = '';
  html += '<div class="settings-block">';
  html += '<div class="settings-block-label">Папка с данными</div>';
  html += '<p class="settings-block-hint">Здесь хранятся проекты, файлы и база данных NeX Hub на этом компьютере.</p>';
  html += '<div id="dataDirPath" style="font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;font-size:12.5px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);word-break:break-all;color:var(--text-secondary)">Определение пути…</div>';
  html += '<div style="margin-top:12px">';
  html += '<button class="btn btn-secondary btn-sm" id="btnOpenDataDir">' + svgIcon('folder-open', 'sm') + ' Открыть папку</button>';
  html += '</div>';
  html += '</div>';

  html += '<div class="settings-block" style="margin-top:22px">';
  html += '<div class="settings-block-label">Резервная копия</div>';
  html += '<p class="settings-block-hint">Данные хранятся локально. Резервная копия — это экспортированный файл. Импорт добавляет проекты из такого файла.</p>';
  html += '<div style="display:flex;gap:10px;flex-wrap:wrap">';
  html += '<button class="btn btn-primary btn-sm" id="btnExportProjects">' + svgIcon('download', 'sm') + ' Экспорт проектов в файл</button>';
  html += '<button class="btn btn-secondary btn-sm" id="btnImportProjects">' + svgIcon('upload', 'sm') + ' Импорт проектов из файла</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

async function loadDataDir() {
  const el = document.getElementById('dataDirPath');
  if (!el) return;
  if (!window.nexhub || !window.nexhub.getDataDir) {
    el.textContent = 'Недоступно вне приложения';
    return;
  }
  try {
    const dir = await window.nexhub.getDataDir();
    el.textContent = dir || '—';
  } catch (err) {
    el.textContent = 'Не удалось определить путь';
  }
}

function bindDataEvents() {
  const openBtn = document.getElementById('btnOpenDataDir');
  if (openBtn) openBtn.addEventListener('click', function() {
    if (window.nexhub && window.nexhub.openDataDir) {
      Promise.resolve(window.nexhub.openDataDir()).catch(function() {
        showToast('Не удалось открыть папку', true);
      });
    } else {
      showToast('Недоступно вне приложения', true);
    }
  });

  const exportBtn = document.getElementById('btnExportProjects');
  if (exportBtn) exportBtn.addEventListener('click', function() {
    import('../utils/data-io.js')
      .then(function(m) { return m.saveProjectsToFile(); })
      .catch(function(err) { showToast('Ошибка экспорта: ' + (err.message || err), true); });
  });

  const importBtn = document.getElementById('btnImportProjects');
  if (importBtn) importBtn.addEventListener('click', function() {
    import('../utils/data-io.js')
      .then(function(m) { return m.importProjectsFromFile(); })
      .catch(function(err) { showToast('Ошибка импорта: ' + (err.message || err), true); });
  });
}

/* ============================= О программе ============================= */

function renderAbout() {
  let html = '';
  html += '<div class="settings-block">';
  html += '<div class="settings-block-label">NeX Hub</div>';
  html += '<p class="settings-block-hint">Версия: <span id="aboutVersion">…</span></p>';
  html += '<p class="settings-block-hint">Локальное оффлайн-приложение для управления проектами.</p>';
  html += '</div>';
  return html;
}

async function loadVersion() {
  const el = document.getElementById('aboutVersion');
  if (!el) return;
  if (!window.nexhub || !window.nexhub.getVersion) {
    el.textContent = '—';
    return;
  }
  try {
    const v = await window.nexhub.getVersion();
    el.textContent = v || '—';
  } catch (err) {
    el.textContent = '—';
  }
}

/* ============================= Заглушка ============================= */

let terminalSettingsCache = null;

function renderScriptsSettings() {
  let html = '';
  html += '<div class="settings-block">';
  html += '<div class="settings-block-label">Оболочка по умолчанию</div>';
  html += '<p class="settings-block-hint">Используется для скриптов, у которых не выбрана собственная оболочка. «Авто» означает cmd на Windows и sh на Unix.</p>';
  html += '<div id="scriptShellBox"><span class="settings-block-hint">Загрузка…</span></div>';
  html += '</div>';

  html += '<div class="settings-block" style="margin-top:22px">';
  html += '<div class="settings-block-label">Как это работает</div>';
  html += '<p class="settings-block-hint">Скрипты запускаются из карточки проекта на вкладке «Скрипты». Вывод отображается в реальном времени, процесс можно остановить. Скрипты с включённым автостартом запускаются при открытии проекта.</p>';
  html += '</div>';
  return html;
}

async function loadTerminalSettings(force) {
  const box = document.getElementById('scriptShellBox');
  if (!box) return;

  if (force) {
    const btn = document.getElementById('btnRefreshShells');
    if (btn) btn.disabled = true;
  } else if (!terminalSettingsCache) {
    box.innerHTML = '<span class="settings-block-hint">Загрузка…</span>';
  }

  try {
    const data = await api.getTerminalSettings(!!force);
    terminalSettingsCache = data;
    paintTerminalSettings(data);
  } catch (err) {
    const current = document.getElementById('scriptShellBox');
    if (!current) return;
    current.innerHTML = '<p class="settings-block-hint" style="color:var(--red)">' + escapeHTML(err.message || 'Не удалось загрузить настройки оболочки') + '</p>';
  }
}

function paintTerminalSettings(data) {
  const box = document.getElementById('scriptShellBox');
  if (!box) return;

  const shells = Array.isArray(data.shells) ? data.shells : [];
  const current = data.shell || 'auto';
  const defaultShell = shells.find(function(s) { return s.default; });
  const autoLabel = 'Авто' + (defaultShell ? ' (' + defaultShell.label + ')' : '');

  let options = '<option value="auto"' + (current === 'auto' ? ' selected' : '') + '>' + escapeHTML(autoLabel) + '</option>';
  shells.forEach(function(shell) {
    const disabled = !shell.available && shell.id !== current;
    options += '<option value="' + escapeHTML(shell.id) + '"' +
      (current === shell.id ? ' selected' : '') +
      (disabled ? ' disabled' : '') + '>' +
      escapeHTML(shell.label) + (shell.available ? '' : ' — не найдена') +
      '</option>';
  });

  let rows = '';
  shells.forEach(function(shell) {
    rows += '<div class="script-shell-item' + (shell.available ? '' : ' missing') + '">';
    rows += '<span class="script-shell-name">' + escapeHTML(shell.label) +
      (shell.available ? '' : ' <span class="script-shell-badge">не найдена</span>') + '</span>';
    rows += '<span class="script-shell-path" title="' + escapeHTML(shell.path || '') + '">' +
      escapeHTML(shell.path || 'Не обнаружена в системе') + '</span>';
    rows += '</div>';
  });

  box.innerHTML = '' +
    '<div class="form-group">' +
      '<label class="form-label" for="settingsScriptShell">Оболочка</label>' +
      '<select class="form-select" id="settingsScriptShell">' + options + '</select>' +
      '<p class="form-hint">Изменение сохраняется сразу. У каждого скрипта можно выбрать свою оболочку.</p>' +
    '</div>' +
    (data.missing ? '<p class="form-hint" style="color:var(--red)">Выбранная оболочка не найдена на компьютере. Выберите другую.</p>' : '') +
    '<div class="script-shell-list">' + rows + '</div>' +
    '<div style="margin-top:12px">' +
      '<button class="btn btn-secondary btn-sm" id="btnRefreshShells">' + svgIcon('refresh', 'sm') + ' Обновить список</button>' +
    '</div>';

  const select = document.getElementById('settingsScriptShell');
  if (select) {
    select.addEventListener('change', async function() {
      const value = select.value;
      select.disabled = true;
      try {
        const next = await api.updateTerminalSettings(value);
        terminalSettingsCache = next;
        paintTerminalSettings(next);
        showToast('Оболочка сохранена');
      } catch (err) {
        select.disabled = false;
        select.value = current;
        showToast(err.message || 'Не удалось сохранить оболочку', true);
      }
    });
  }

  const refresh = document.getElementById('btnRefreshShells');
  if (refresh) {
    refresh.addEventListener('click', function() {
      loadTerminalSettings(true);
    });
  }
}

function renderDevPlaceholder() {
  let html = '';
  html += '<div class="dev-placeholder">';
  html += '<div class="dev-icon">' + svgIcon('settings', 'xl') + '</div>';
  html += '<h3>В разработке</h3>';
  html += '<p>Этот раздел скоро появится. Мы уже работаем над ним.</p>';
  html += '</div>';
  return html;
}

/* ============================= События ============================= */

function bindSettingsEvents() {
  const navItems = document.querySelectorAll('.settings-nav-item');
  for (let i = 0; i < navItems.length; i++) {
    (function(item) {
      item.addEventListener('click', function() {
        const tab = item.dataset.tab;
        if (tab === store.currentSettingsTab) return;
        store.currentSettingsTab = tab;

        document.querySelectorAll('.settings-nav-item').forEach(function(el) {
          el.classList.toggle('active', el.dataset.tab === tab);
        });

        const content = document.querySelector('.settings-content');
        if (content) content.innerHTML = renderSection(tab);

        bindSectionEvents(tab);
      });
    })(navItems[i]);
  }

  bindSectionEvents(store.currentSettingsTab || 'profile');
}

function bindSectionEvents(tab) {
  if (tab === 'profile') {
    bindProfileEvents();
  } else if (tab === 'account') {
    bindAccountEvents();
    loadAccounts();
  } else if (tab === 'security') {
    bindSecurityEvents();
  } else if (tab === 'appearance') {
    bindAppearanceEvents();
  } else if (tab === 'scripts') {
    loadTerminalSettings(false);
  } else if (tab === 'data') {
    bindDataEvents();
    loadDataDir();
  } else if (tab === 'about') {
    loadVersion();
  }
}

function rerenderAppearance() {
  const content = document.querySelector('.settings-content');
  if (content) content.innerHTML = renderSection('appearance');
  bindAppearanceEvents();
}

function bindAppearanceEvents() {
  document.querySelectorAll('.theme-option').forEach(function(opt) {
    opt.addEventListener('click', function() {
      const mode = opt.dataset.theme;
      if (mode === store.themeMode) return;
      setThemeMode(mode);
      rerenderAppearance();
    });
  });

  document.querySelectorAll('.accent-swatch[data-accent]').forEach(function(sw) {
    sw.addEventListener('click', function() {
      if (sw.dataset.accent === store.accent) return;
      setAccent(sw.dataset.accent);
      rerenderAppearance();
    });
  });

  document.querySelectorAll('.opt-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      const group = chip.dataset.group;
      const value = chip.dataset.value;
      if (group === 'corners') { if (value === store.corners) return; setCorners(value); }
      else if (group === 'density') { if (value === store.density) return; setDensity(value); }
      else if (group === 'scale') { if (Number(value) === store.uiScale) return; setScale(Number(value)); }
      else if (group === 'font') { if (value === store.fontFamily) return; setFont(value); }
      rerenderAppearance();
    });
  });
}

export { SECTIONS };
