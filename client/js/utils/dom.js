export function $(selector, parent) {
  parent = parent || document;
  return parent.querySelector(selector);
}

export function $$(selector, parent) {
  parent = parent || document;
  return Array.from(parent.querySelectorAll(selector));
}

export function create(tag, attrs, children) {
  attrs = attrs || {};
  children = children || [];
  var el = document.createElement(tag);
  Object.keys(attrs).forEach(function(k) {
    var v = attrs[k];
    if (k === 'className') el.className = v;
    else if (k === 'innerHTML') el.innerHTML = v;
    else if (k === 'textContent') el.textContent = v;
    else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  });
  children.forEach(function(c) {
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  });
  return el;
}

export function svgIcon(name, size) {
  size = size || '';
  return '<svg class="icon-svg ' + size + '"><use href="#icon-' + name + '"/></svg>';
}

export function escapeHTML(s) {
  if (!s) return '';
  var div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// Аватар проекта: логотип, либо первая буква названия на цветном градиенте (как в Telegram)
const AVATAR_GRADIENTS = [
  ['#ff885e', '#ff516a'],
  ['#ffcd6a', '#ffa85c'],
  ['#82b1ff', '#665fff'],
  ['#a0de7e', '#54cb68'],
  ['#53edd6', '#28c9b7'],
  ['#72d5fd', '#2a9ef1'],
  ['#e0a2f3', '#d669ed']
];

function avatarGradient(key) {
  const s = String(key == null ? '' : key);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

export function projectAvatar(proj) {
  proj = proj || {};
  if (proj.logo) {
    return '<img src="' + escapeHTML(proj.logo) + '" alt="" loading="lazy">';
  }
  var name = (proj.name || '').trim();
  var initial = name ? name.charAt(0).toUpperCase() : '?';
  var pair = avatarGradient(proj.id != null ? proj.id : name);
  var bg = 'linear-gradient(135deg, ' + pair[0] + ', ' + pair[1] + ')';
  return '<span class="avatar-initial" style="background:' + bg + '">' + escapeHTML(initial) + '</span>';
}

export function formatDate(iso) {
  if (!iso) return '';
  var d = parseDate(iso);
  var now = new Date();
  if (isNaN(d.getTime())) return iso;
  
  // Если дата без времени (только YYYY-MM-DD) — показываем как есть
  if (iso.length === 10 && iso.indexOf('T') === -1) {
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  }
  
  var diff = now - d;
  if (diff < 0) diff = 0;
  if (diff < 60000) return 'Только что';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' мин.';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' ч.';
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' дн.';
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

export function formatDateShort(iso) {
  if (!iso) return '';
  var d = parseDate(iso);
  var now = new Date();
  var diff = now - d;
  if (diff < 0) diff = 0;
  if (diff < 60000) return 'Только что';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' мин.';
  if (diff < 86400000) return 'Сегодня';
  if (diff < 172800000) return 'Вчера';
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}

// Парсит дату корректно, учитывая что SQLite хранит даты как строки без часового пояса
// Эти строки представляют собой UTC время, поэтому парсим их как UTC
function parseDate(iso) {
  if (!iso) return new Date(NaN);
  
  // Если уже есть 'T' или 'Z' — стандартный ISO формат, используем обычный парсинг
  if (iso.indexOf('T') !== -1 || iso.indexOf('Z') !== -1 || iso.indexOf('+') !== -1) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? new Date(NaN) : d;
  }
  
  // Формат SQLite: "YYYY-MM-DD HH:MM:SS" — это UTC время
  // Заменяем проброс на T для корректного парсинга
  var d = new Date(iso.replace(' ', 'T') + 'Z');
  if (!isNaN(d.getTime())) return d;
  
  // Если это просто дата без времени (YYYY-MM-DD)
  if (iso.length === 10) {
    return new Date(iso + 'T00:00:00Z');
  }
  
  // Фоллбэк — обычный парсинг
  d = new Date(iso);
  return isNaN(d.getTime()) ? new Date(NaN) : d;
}

export function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

export function showToast(msg, error) {
  var root = document.getElementById('toast-root');
  if (!root) return;
  var toast = create('div', {
    className: 'toast' + (error ? ' error' : ''),
    textContent: msg
  });
  root.appendChild(toast);

  requestAnimationFrame(function() {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
  });

  setTimeout(function() {
    toast.style.transform = 'translateY(8px)';
    toast.style.opacity = '0';
    setTimeout(function() { toast.remove(); }, 300);
  }, 2500);
}