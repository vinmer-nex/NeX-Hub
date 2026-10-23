import auth from '../auth.js';
import { svgIcon, escapeHTML } from '../utils/dom.js';

let overlayEl = null;

export function showLockScreen(onSubmit) {
  if (overlayEl) return overlayEl;

  const name = (auth.user && auth.user.username) || '';

  overlayEl = document.createElement('div');
  overlayEl.className = 'lock-screen';
  overlayEl.innerHTML = `
    <div class="lock-card">
      <div class="lock-icon">${svgIcon('lock', 'xl')}</div>
      <h2 class="lock-title">Приложение заблокировано</h2>
      <p class="lock-sub">${name ? escapeHTML(name) : 'Введите PIN для продолжения'}</p>
      <input class="form-input lock-input" type="password" inputmode="numeric" autocomplete="off"
             maxlength="8" placeholder="PIN-код" id="lockPin">
      <p class="lock-error" id="lockError"></p>
      <button class="btn btn-primary lock-btn" id="lockBtn" type="button">Разблокировать</button>
    </div>
  `;
  document.body.appendChild(overlayEl);

  const input = overlayEl.querySelector('#lockPin');
  const btn = overlayEl.querySelector('#lockBtn');
  const error = overlayEl.querySelector('#lockError');

  async function submit() {
    const pin = input.value.trim();
    if (!pin) { error.textContent = 'Введите PIN'; return; }
    btn.disabled = true;
    error.textContent = '';
    try {
      await onSubmit(pin);
    } catch (err) {
      error.textContent = err.message || 'Неверный PIN';
      input.value = '';
      input.focus();
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submit();
  });

  setTimeout(function() { input.focus(); }, 50);
  return overlayEl;
}

export function hideLockScreen() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

export default { showLockScreen, hideLockScreen };
