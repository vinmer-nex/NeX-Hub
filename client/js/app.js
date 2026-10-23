import auth from './auth.js';
import api from './api.js';
import store from './store.js';
import { $, showToast } from './utils/dom.js';
import { renderHeader, bindHeaderEvents } from './components/header.js';
import { renderLoginScreen } from './components/login.js';
import { renderProjectList } from './components/project-list.js';
import { renderProjectDetail, clearDetailCache } from './components/project-detail.js';
import { renderDashboard } from './components/dashboard.js';
import { renderCalendar } from './components/calendar.js';
import { renderKanban } from './components/kanban.js';
import { renderSettings } from './components/settings.js';
import { loadSvgIcons } from './icons.js';
import { applyAppearance } from './appearance.js';
import security from './security.js';

window.store = store;

let firstInitDone = false;

async function init() {
  loadSvgIcons();
  applyAppearance();

  const isFirstInit = !firstInitDone;
  firstInitDone = true;

  const ok = await auth.checkSession();
  if (ok) {
    await security.load();
    await loadProjects();
    await render();
    security.startIdleWatch();
    if (store.hasPin && isFirstInit) security.lockNow();
  } else {
    renderLoginScreen();
  }

  document.addEventListener('keydown', handleKeydown);

  const loading = $('#loading-screen');
  if (loading) loading.style.display = 'none';
}

async function loadProjects() {
  try {
    var params = {};
    if (store.sortOrder) params.sort = store.sortOrder;
    var results = await Promise.all([
      api.getProjects(params),
      (async function() {
        // Загружаем удалённые проекты для корзины
        try {
          return await api.getProjects({ deleted: 'true' });
        } catch (e) {
          return null;
        }
      })()
    ]);
    var data = results[0];
    var trashData = results[1];
    store.projects = data.projects;
    store.trashProjects = trashData ? trashData.projects : [];
  } catch (err) {
    console.error('Ошибка загрузки проектов:', err);
  }
}

async function render() {
  const app = $('#app');
  if (!app) return;

  if (store.currentView !== 'detail') clearDetailCache();

  const prevActive = document.activeElement;
  const prevId = prevActive && prevActive.id ? prevActive.id : null;
  const prevSelStart = prevActive && prevActive.selectionStart != null ? prevActive.selectionStart : null;
  const prevSelEnd = prevActive && prevActive.selectionEnd != null ? prevActive.selectionEnd : null;

  const headerHTML = renderHeader();
  let contentHTML = '';

  switch (store.currentView) {
    case 'list':
      contentHTML = renderProjectList();
      break;
    case 'detail':
      contentHTML = await renderProjectDetail();
      break;
    case 'dashboard':
      contentHTML = await renderDashboard();
      break;
    case 'calendar':
      contentHTML = renderCalendar();
      break;
    case 'kanban':
      contentHTML = await renderKanban(); 
      break;
    case 'settings':
      contentHTML = renderSettings();
      break;
  }

  app.innerHTML = `
    <div class="app-shell">
      ${headerHTML}
      <main class="app-main">
        <div class="container">${contentHTML}</div>
      </main>
    </div>
  `;

  if (prevId) {
    const el = document.getElementById(prevId);
    if (el && el.focus && el !== document.activeElement) {
      el.focus();
      if (prevSelStart != null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(prevSelStart, prevSelEnd != null ? prevSelEnd : prevSelStart); } catch (e) {}
      }
    }
  }

  bindHeaderEvents();
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    const modal = document.querySelector('.modal-overlay');
    if (modal) { modal.remove(); return; }
    if (store.selectionMode) {
      store.selectionMode = false;
      store.selectedIds = [];
      render();
      return;
    }
    if (store.currentView !== 'list') {
      store.currentView = 'list';
      store.currentProjectId = null;
      render();
    }
  }

  if (e.ctrlKey && e.key === 'n') {
    e.preventDefault();
    import('./components/modal.js').then(m => m.openCreateProjectModal(render));
  }

  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault();
    const input = $('#searchInput');
    if (input) input.focus();
  }
}

export { render, loadProjects, store };
export default init;

document.addEventListener('DOMContentLoaded', init);