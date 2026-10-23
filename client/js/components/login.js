import auth from '../auth.js';
import { showToast, escapeHTML } from '../utils/dom.js';

let mode = 'list';
let selected = null;
let accounts = [];
let loadingAccounts = false;
let recoveryCode = '';

export function renderLoginScreen() {
  mode = 'list';
  selected = null;
  accounts = [];
  recoveryCode = '';
  loadingAccounts = true;
  render();
  loadAccounts();
}

async function loadAccounts() {
  try {
    accounts = await auth.listAccounts();
  } catch (err) {
    accounts = [];
    showToast(err.message || 'Не удалось загрузить аккаунты', true);
  }
  loadingAccounts = false;
  if (mode !== 'list') return;
  if (accounts.length === 0) {
    mode = 'create';
  }
  render();
}

function render() {
  const app = document.getElementById('app');
  if (!app) return;

  let subtitle = 'Выберите аккаунт';
  if (mode === 'password') subtitle = selected ? selected.username : '';
  else if (mode === 'create') subtitle = 'Новый аккаунт';
  else if (mode === 'recovery') subtitle = 'Код восстановления';
  else if (mode === 'reset') subtitle = 'Восстановление пароля';

  let body = '';
  if (mode === 'list') body = listBody();
  else if (mode === 'password') body = passwordBody();
  else if (mode === 'create') body = createBody();
  else if (mode === 'recovery') body = recoveryBody();
  else if (mode === 'reset') body = resetBody();

  app.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg)">
      <div style="background:var(--card-bg-solid);padding:40px;border-radius:var(--radius-xl);width:100%;max-width:420px;box-shadow:var(--shadow-md);border:1px solid var(--border)">
        <div style="text-align:center;margin-bottom:32px">
          <h1 style="font-size:24px;font-weight:700;margin-bottom:4px">NeX Hub</h1>
          <p style="color:var(--text-secondary);font-size:14px">${escapeHTML(subtitle)}</p>
        </div>
        ${body}
      </div>
    </div>
  `;

  bind();
}

function listBody() {
  if (loadingAccounts) {
    return `<p style="text-align:center;color:var(--text-secondary);padding:24px 0">Загрузка аккаунтов…</p>`;
  }

  let rows = '';
  accounts.forEach(function(a) {
    const name = a.username || '';
    const initial = (name || '?').charAt(0).toUpperCase();
    const date = formatCreated(a.created_at);
    rows += `
      <button type="button" class="account-row" data-id="${escapeHTML(String(a.id))}" style="display:flex;align-items:center;gap:12px;width:100%;padding:12px;margin-bottom:8px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-lg);cursor:pointer;text-align:left">
        <span style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#82b1ff,#665fff);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;flex:0 0 auto">${escapeHTML(initial)}</span>
        <span style="flex:1;min-width:0">
          <span style="display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(name)}</span>
          <span style="display:block;font-size:12px;color:var(--text-secondary)">${escapeHTML(date)}</span>
        </span>
      </button>`;
  });

  return `
    <div id="account-list">${rows}</div>
    <button class="btn btn-primary" id="btnAddAccount" type="button" style="width:100%;justify-content:center;padding:14px">
      + Добавить аккаунт
    </button>
  `;
}

function passwordBody() {
  return `
    <form id="password-form" onsubmit="return false">
      <div class="form-group">
        <span class="form-label">Пароль</span>
        <input class="form-input" type="password" id="pwInput" placeholder="Введите пароль">
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:13px;color:var(--text-secondary);cursor:pointer">
        <input type="checkbox" id="rememberChk">
        <span>Запомнить меня</span>
      </label>
      <button class="btn btn-primary" style="width:100%;justify-content:center;padding:14px" id="pwSubmit" type="button">
        Войти
      </button>
      <p style="text-align:center;margin-top:16px;font-size:13px">
        <a href="#" id="linkForgot" style="color:var(--accent);cursor:pointer">Забыли пароль?</a>
      </p>
      <p style="text-align:center;margin-top:8px;font-size:13px">
        <a href="#" id="linkBack" style="color:var(--text-secondary);cursor:pointer">← Назад</a>
      </p>
    </form>
  `;
}

function createBody() {
  const back = accounts.length > 0
    ? `<p style="text-align:center;margin-top:8px;font-size:13px">
         <a href="#" id="linkBack" style="color:var(--text-secondary);cursor:pointer">← Назад</a>
       </p>`
    : '';

  return `
    <form id="create-form" onsubmit="return false">
      <div class="form-group">
        <span class="form-label">Имя</span>
        <input class="form-input" id="createUsername" placeholder="Ваше имя">
      </div>
      <div class="form-group">
        <span class="form-label">Пароль</span>
        <input class="form-input" type="password" id="createPassword" placeholder="Минимум 3 символа">
      </div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;padding:14px" id="createSubmit" type="button">
        Создать
      </button>
      ${back}
    </form>
  `;
}

function recoveryBody() {
  return `
    <p style="font-size:14px;color:var(--text-secondary);margin-bottom:16px">
      Сохраните код восстановления. Он показывается один раз и понадобится, если забудете пароль.
    </p>
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:20px;font-weight:600;letter-spacing:2px;text-align:center;padding:16px;background:var(--bg);border:1px dashed var(--border);border-radius:var(--radius-lg);margin-bottom:16px;word-break:break-all;user-select:all">
      ${escapeHTML(recoveryCode)}
    </div>
    <button class="btn" id="copyCode" type="button" style="width:100%;justify-content:center;padding:14px;margin-bottom:8px">
      Скопировать
    </button>
    <button class="btn btn-primary" id="continueBtn" type="button" style="width:100%;justify-content:center;padding:14px">
      Продолжить
    </button>
  `;
}

function resetBody() {
  const username = selected ? (selected.username || '') : '';
  return `
    <form id="reset-form" onsubmit="return false">
      <div class="form-group">
        <span class="form-label">Имя аккаунта</span>
        <input class="form-input" id="resetUsername" value="${escapeHTML(username)}" placeholder="Имя аккаунта">
      </div>
      <div class="form-group">
        <span class="form-label">Код восстановления</span>
        <input class="form-input" id="resetCode" placeholder="Код восстановления">
      </div>
      <div class="form-group">
        <span class="form-label">Новый пароль</span>
        <input class="form-input" type="password" id="resetPassword" placeholder="Минимум 3 символа">
      </div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;padding:14px" id="resetSubmit" type="button">
        Сбросить пароль
      </button>
      <p style="text-align:center;margin-top:8px;font-size:13px">
        <a href="#" id="linkBack" style="color:var(--text-secondary);cursor:pointer">← Назад</a>
      </p>
    </form>
  `;
}

function bind() {
  if (mode === 'list') {
    const add = document.getElementById('btnAddAccount');
    if (add) add.addEventListener('click', function() {
      mode = 'create';
      render();
    });
    document.querySelectorAll('.account-row').forEach(function(el) {
      el.addEventListener('click', function() {
        const id = el.getAttribute('data-id');
        selected = accounts.find(function(a) { return String(a.id) === String(id); }) || null;
        mode = 'password';
        render();
      });
    });
    return;
  }

  if (mode === 'password') {
    const input = document.getElementById('pwInput');
    const submit = document.getElementById('pwSubmit');
    if (submit) submit.addEventListener('click', handleLogin);
    if (input) {
      input.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleLogin(); });
      input.focus();
    }
    const back = document.getElementById('linkBack');
    if (back) back.addEventListener('click', function(e) {
      e.preventDefault();
      mode = 'list';
      render();
    });
    const forgot = document.getElementById('linkForgot');
    if (forgot) forgot.addEventListener('click', function(e) {
      e.preventDefault();
      mode = 'reset';
      render();
    });
    return;
  }

  if (mode === 'create') {
    const nameInput = document.getElementById('createUsername');
    const pwInput = document.getElementById('createPassword');
    const submit = document.getElementById('createSubmit');
    if (submit) submit.addEventListener('click', handleCreate);
    if (nameInput) nameInput.focus();
    if (pwInput) pwInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleCreate(); });
    const back = document.getElementById('linkBack');
    if (back) back.addEventListener('click', function(e) {
      e.preventDefault();
      mode = 'list';
      render();
    });
    return;
  }

  if (mode === 'recovery') {
    const copy = document.getElementById('copyCode');
    if (copy) copy.addEventListener('click', function() {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(recoveryCode).then(function() {
          showToast('Скопировано');
        }).catch(function() {
          showToast('Не удалось скопировать', true);
        });
      } else {
        showToast('Не удалось скопировать', true);
      }
    });
    const cont = document.getElementById('continueBtn');
    if (cont) cont.addEventListener('click', async function() {
      const init = (await import('../app.js')).default;
      await init();
    });
    return;
  }

  if (mode === 'reset') {
    const userInput = document.getElementById('resetUsername');
    const codeInput = document.getElementById('resetCode');
    const pwInput = document.getElementById('resetPassword');
    const submit = document.getElementById('resetSubmit');
    if (submit) submit.addEventListener('click', handleReset);
    if (codeInput) codeInput.focus();
    if (pwInput) pwInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleReset(); });
    const back = document.getElementById('linkBack');
    if (back) back.addEventListener('click', function(e) {
      e.preventDefault();
      mode = selected ? 'password' : 'list';
      render();
    });
    return;
  }
}

async function handleLogin() {
  if (!selected) return;
  const input = document.getElementById('pwInput');
  const password = input ? input.value : '';
  if (!password) {
    showToast('Введите пароль', true);
    return;
  }

  const btn = document.getElementById('pwSubmit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Вход...';
  }

  const rememberChk = document.getElementById('rememberChk');

  try {
    await auth.login(selected.username, password, rememberChk && rememberChk.checked);
    const init = (await import('../app.js')).default;
    await init();
  } catch (err) {
    showToast(err.message || 'Ошибка входа', true);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Войти';
    }
  }
}

async function handleCreate() {
  const nameInput = document.getElementById('createUsername');
  const pwInput = document.getElementById('createPassword');
  const username = nameInput ? nameInput.value.trim() : '';
  const password = pwInput ? pwInput.value : '';

  if (!username) {
    showToast('Введите имя', true);
    return;
  }
  if (password.length < 3) {
    showToast('Пароль минимум 3 символа', true);
    return;
  }

  const btn = document.getElementById('createSubmit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Создание...';
  }

  try {
    const res = await auth.createAccount(username, password);
    selected = res.user || { username: username };
    recoveryCode = res.recoveryCode || '';
    mode = 'recovery';
    render();
  } catch (err) {
    showToast(err.message || 'Ошибка создания', true);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Создать';
    }
  }
}

async function handleReset() {
  const userInput = document.getElementById('resetUsername');
  const codeInput = document.getElementById('resetCode');
  const pwInput = document.getElementById('resetPassword');
  const username = userInput ? userInput.value.trim() : '';
  const code = codeInput ? codeInput.value.trim() : '';
  const password = pwInput ? pwInput.value : '';

  if (!username) {
    showToast('Введите имя аккаунта', true);
    return;
  }
  if (!code) {
    showToast('Введите код восстановления', true);
    return;
  }
  if (password.length < 3) {
    showToast('Пароль минимум 3 символа', true);
    return;
  }

  const btn = document.getElementById('resetSubmit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Сброс...';
  }

  try {
    await auth.resetPassword(username, code, password);
    showToast('Пароль изменён, войдите');
    selected = { username: username };
    mode = 'password';
    render();
  } catch (err) {
    showToast(err.message || 'Ошибка сброса пароля', true);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Сбросить пароль';
    }
  }
}

function formatCreated(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}
