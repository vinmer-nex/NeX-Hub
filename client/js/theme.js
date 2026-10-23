import store from './store.js';
import { setThemeMode } from './appearance.js';

export function applyTheme(isDark) {
  setThemeMode(isDark ? 'dark' : 'light');
  return store.isDark;
}

export function toggleTheme() {
  setThemeMode(store.isDark ? 'light' : 'dark');
  return store.isDark;
}

export default { applyTheme, toggleTheme };
