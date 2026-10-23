import store from './store.js';
import auth from './auth.js';
import { showToast } from './utils/dom.js';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];

let idleTimer = null;
let activityBound = false;
let lockedModule = null;

export function applySecurity(sec) {
  if (!sec) return;
  store.hasPin = !!sec.hasPin;
  store.autoLockMinutes = Number(sec.autoLockMinutes) || 0;
  store.protectDangerous = !!sec.protectDangerous;
  store.remember = !!sec.remember;
}

export async function load() {
  try {
    applySecurity(await auth.getSecurity());
  } catch (e) {
    // настройки безопасности недоступны — оставляем значения по умолчанию
  }
}

/* ============================= Автоблокировка ============================= */

export function resetIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  const minutes = Number(store.autoLockMinutes) || 0;
  if (minutes <= 0 || !store.hasPin || store.locked) return;
  idleTimer = setTimeout(function() { lockNow(); }, minutes * 60 * 1000);
}

export function startIdleWatch() {
  if (!activityBound) {
    activityBound = true;
    ACTIVITY_EVENTS.forEach(function(ev) {
      window.addEventListener(ev, resetIdleTimer, { passive: true });
    });
  }
  resetIdleTimer();
}

/* ============================= Блокировка ============================= */

export async function lockNow() {
  if (store.locked || !store.hasPin) return;
  store.locked = true;
  const m = await import('./components/lock.js');
  lockedModule = m;
  m.showLockScreen(unlock);
}

export async function unlock(pin) {
  await auth.unlock(pin);
  store.locked = false;
  if (lockedModule) lockedModule.hideLockScreen();
  resetIdleTimer();
}

/* ============================= Подтверждение паролем ============================= */

export function requirePassword(label) {
  if (!store.protectDangerous) return Promise.resolve(true);

  const text = label || 'Для продолжения введите пароль';

  return import('./components/modal.js').then(function(m) {
    return new Promise(function(resolve) {
      const body =
        '<p class="settings-block-hint" style="margin-bottom:14px">' + text + '</p>' +
        '<div class="form-group"><span class="form-label">Пароль аккаунта</span>' +
        '<input class="form-input" type="password" id="dangerPw" placeholder="Введите пароль"></div>';
      const footer =
        '<button class="btn btn-secondary modal-close-x" type="button">Отмена</button>' +
        '<button class="btn btn-primary" id="modalSaveBtn" type="button">Подтвердить</button>';

      const overlay = m.openModal('Подтверждение', body, async function(el) {
        const pw = el.querySelector('#dangerPw').value;
        if (!pw) { showToast('Введите пароль', true); return false; }
        try {
          await auth.verifyPassword(pw);
          resolve(true);
          return true;
        } catch (err) {
          showToast(err.message || 'Неверный пароль', true);
          return false;
        }
      }, { footer: footer });

      const input = overlay.querySelector('#dangerPw');
      if (input) {
        input.focus();
        input.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            const btn = overlay.querySelector('#modalSaveBtn');
            if (btn) btn.click();
          }
        });
      }

      const observer = new MutationObserver(function() {
        if (!document.body.contains(overlay)) {
          observer.disconnect();
          resolve(false);
        }
      });
      observer.observe(document.body, { childList: true });
    });
  });
}

export default { load, applySecurity, startIdleWatch, resetIdleTimer, lockNow, unlock, requirePassword };
