import store from './store.js';

export const THEME_MODES = [
  { id: 'light', label: 'Светлая', icon: 'sun' },
  { id: 'dark', label: 'Тёмная', icon: 'moon' },
  { id: 'system', label: 'Системная', icon: 'monitor' }
];

export const ACCENTS = [
  { id: 'blue', label: 'Синий', light: { accent: '#2f6df6', hover: '#1f57d6', light: '#eaf0ff' }, dark: { accent: '#4b84ff', hover: '#6f9bff', light: 'rgba(75,132,255,.14)' } },
  { id: 'purple', label: 'Фиолетовый', light: { accent: '#7a45d6', hover: '#6a38c2', light: '#f0eafa' }, dark: { accent: '#a97cf0', hover: '#bc93f7', light: 'rgba(169,124,240,.14)' } },
  { id: 'green', label: 'Зелёный', light: { accent: '#1a9e57', hover: '#158048', light: '#e6f5ed' }, dark: { accent: '#3ed07f', hover: '#5adb92', light: 'rgba(62,208,127,.14)' } },
  { id: 'teal', label: 'Бирюзовый', light: { accent: '#0aa2b5', hover: '#088a9b', light: '#e0f6f9' }, dark: { accent: '#2ec7d9', hover: '#4fd3e2', light: 'rgba(46,199,217,.14)' } },
  { id: 'orange', label: 'Оранжевый', light: { accent: '#c9770a', hover: '#ac6508', light: '#fbf0dd' }, dark: { accent: '#e0a33a', hover: '#eab35a', light: 'rgba(224,163,58,.14)' } },
  { id: 'pink', label: 'Розовый', light: { accent: '#d6336c', hover: '#bd2a5e', light: '#fde9f0' }, dark: { accent: '#ff6ba1', hover: '#ff86b3', light: 'rgba(255,107,161,.14)' } },
  { id: 'red', label: 'Красный', light: { accent: '#db3b34', hover: '#c22f29', light: '#fceae9' }, dark: { accent: '#ff6b63', hover: '#ff8880', light: 'rgba(255,107,99,.14)' } },
  { id: 'graphite', label: 'Графит', light: { accent: '#556070', hover: '#454f5d', light: '#eef0f4' }, dark: { accent: '#9aa3b2', hover: '#b3bcc9', light: 'rgba(154,163,178,.16)' } }
];

export const CORNERS = [
  { id: 'sharp', label: 'Острые', vars: { '--radius-xs': '2px', '--radius-sm': '3px', '--radius': '4px', '--radius-lg': '6px', '--radius-xl': '8px', '--radius-2xl': '10px' } },
  { id: 'default', label: 'Обычные', vars: { '--radius-xs': '6px', '--radius-sm': '8px', '--radius': '9px', '--radius-lg': '12px', '--radius-xl': '16px', '--radius-2xl': '22px' } },
  { id: 'round', label: 'Круглые', vars: { '--radius-xs': '10px', '--radius-sm': '14px', '--radius': '18px', '--radius-lg': '24px', '--radius-xl': '30px', '--radius-2xl': '40px' } }
];

export const DENSITIES = [
  { id: 'compact', label: 'Компактно' },
  { id: 'default', label: 'Обычно' },
  { id: 'spacious', label: 'Просторно' }
];

export const SCALES = [90, 100, 110, 125];

export const FONTS = [
  { id: 'system', label: 'Системный', stack: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
  { id: 'arial', label: 'Arial', stack: "Arial, 'Helvetica Neue', Helvetica, sans-serif" },
  { id: 'verdana', label: 'Verdana', stack: "Verdana, Geneva, Tahoma, sans-serif" },
  { id: 'tahoma', label: 'Tahoma', stack: "Tahoma, Verdana, 'Segoe UI', sans-serif" },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: "'Trebuchet MS', 'Lucida Grande', 'Lucida Sans Unicode', sans-serif" },
  { id: 'calibri', label: 'Calibri', stack: "Calibri, Candara, 'Segoe UI', sans-serif" },
  { id: 'georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'cambria', label: 'Cambria', stack: "Cambria, Georgia, 'Times New Roman', serif" },
  { id: 'times', label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
  { id: 'serif', label: 'С засечками', stack: "Georgia, 'Times New Roman', 'Noto Serif', serif" },
  { id: 'consolas', label: 'Consolas', stack: "Consolas, 'Courier New', monospace" },
  { id: 'mono', label: 'Моно', stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace" }
];

// Убираем настройки из предыдущих версий (свой шрифт и свой акцентный цвет)
function cleanupLegacyAppearance() {
  try {
    localStorage.removeItem('nexhubCustomFont');
    localStorage.removeItem('customAccent');
    if (localStorage.getItem('fontFamily') === 'custom') {
      localStorage.setItem('fontFamily', 'system');
      store.fontFamily = 'system';
    }
    if (localStorage.getItem('accent') === 'custom') {
      localStorage.setItem('accent', 'blue');
      store.accent = 'blue';
    }
  } catch (e) { /* localStorage может быть недоступен */ }
}

cleanupLegacyAppearance();

function prefersDark() {
  return typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveIsDark() {
  if (store.themeMode === 'dark') return true;
  if (store.themeMode === 'light') return false;
  return prefersDark();
}

function applyScale(scale) {
  const factor = (Number(scale) || 100) / 100;
  const body = document.body;
  if (window.nexhub && typeof window.nexhub.setZoomFactor === 'function') {
    body.style.zoom = '';
    try { window.nexhub.setZoomFactor(factor); } catch (e) { /* вне Electron */ }
    return;
  }
  body.style.zoom = factor === 1 ? '' : String(factor);
}

export function applyAppearance() {
  if (typeof document === 'undefined') return;
  const dark = resolveIsDark();
  store.isDark = dark;
  document.body.classList.toggle('dark-theme', dark);

  const acc = ACCENTS.find(a => a.id === store.accent) || ACCENTS[0];
  const c = dark ? acc.dark : acc.light;
  const st = document.body.style;
  st.setProperty('--accent', c.accent);
  st.setProperty('--accent-hover', c.hover);
  st.setProperty('--accent-light', c.light);

  const corner = CORNERS.find(x => x.id === store.corners) || CORNERS[1];
  Object.keys(corner.vars).forEach(k => st.setProperty(k, corner.vars[k]));

  const font = FONTS.find(f => f.id === store.fontFamily) || FONTS[0];
  st.setProperty('--font-family', font.stack);

  document.body.classList.remove('density-compact', 'density-spacious');
  if (store.density === 'compact') document.body.classList.add('density-compact');
  else if (store.density === 'spacious') document.body.classList.add('density-spacious');

  applyScale(store.uiScale);
}

export function setThemeMode(mode) {
  store.themeMode = mode;
  localStorage.setItem('themeMode', mode);
  applyAppearance();
}

export function setAccent(id) {
  store.accent = id;
  localStorage.setItem('accent', id);
  applyAppearance();
}

export function setCorners(id) {
  store.corners = id;
  localStorage.setItem('corners', id);
  applyAppearance();
}

export function setDensity(id) {
  store.density = id;
  localStorage.setItem('density', id);
  applyAppearance();
}

export function setScale(value) {
  store.uiScale = Number(value) || 100;
  localStorage.setItem('uiScale', String(store.uiScale));
  applyAppearance();
}

export function setFont(id) {
  store.fontFamily = id;
  localStorage.setItem('fontFamily', id);
  applyAppearance();
}

if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if (store.themeMode === 'system') applyAppearance(); };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

export default {
  THEME_MODES, ACCENTS, CORNERS, DENSITIES, SCALES, FONTS,
  applyAppearance, resolveIsDark,
  setThemeMode, setAccent, setCorners, setDensity, setScale, setFont
};
