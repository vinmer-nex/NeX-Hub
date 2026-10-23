var themeMode = localStorage.getItem('themeMode') || (localStorage.getItem('theme') === 'dark' ? 'dark' : 'light');
var prefersDark = typeof window !== 'undefined' && window.matchMedia &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

var store = {
  projects: [],
  trashProjects: [],
  currentView: 'list',
  currentProjectId: null,
  currentDetailTab: 'notes',
  currentSettingsTab: 'profile',
  searchQuery: '',
  sortOrder: 'newest',
  filterTag: '',
  filterStatus: '',
  filterFavorite: false,
  filterPriority: '',
  showTrash: false,
  selectionMode: false,
  selectedIds: [],
  themeMode: themeMode,
  isDark: themeMode === 'dark' || (themeMode === 'system' && prefersDark),
  accent: localStorage.getItem('accent') || 'blue',
  corners: localStorage.getItem('corners') || 'default',
  density: localStorage.getItem('density') || 'default',
  uiScale: parseInt(localStorage.getItem('uiScale'), 10) || 100,
  fontFamily: localStorage.getItem('fontFamily') || 'system',
  sidebarCollapsed: localStorage.getItem('sidebarCollapsed') === '1',
  hasPin: false,
  autoLockMinutes: 0,
  protectDangerous: false,
  remember: false,
  locked: false
};

if (store.isDark) {
  document.body.classList.add('dark-theme');
}

export default store;