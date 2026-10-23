import store from '../store.js';
import auth from '../auth.js';
import { svgIcon } from '../utils/dom.js';

export function renderHeader() {
  if (!auth.isLoggedIn()) return '';

  var initial = (auth.user?.username || 'U').charAt(0).toUpperCase();

  var activeView = store.showTrash ? 'trash' : (store.currentView === 'detail' ? 'list' : store.currentView);
  var navClass = function(view) {
    return 'nav-item' + (activeView === view ? ' active' : '');
  };

  var collapsed = store.sidebarCollapsed;

  return `
    <aside class="sidebar${collapsed ? ' collapsed' : ''}">
      <div class="brand">
        <div class="brand-icon">
          <svg class="brand-mark" viewBox="0 0 40 40" role="img" aria-label="NeX Hub">
            <defs>
              <linearGradient id="nxBrandBg" x1="0" y1="0" x2=".35" y2="1">
                <stop offset="0" stop-color="#1d1d21"/>
                <stop offset=".45" stop-color="#0b0b0d"/>
                <stop offset="1" stop-color="#000000"/>
              </linearGradient>
              <linearGradient id="nxBrandInk" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#ffffff"/>
                <stop offset=".55" stop-color="#f1efec"/>
                <stop offset="1" stop-color="#c3bfb6"/>
              </linearGradient>
            </defs>
            <rect width="40" height="40" fill="url(#nxBrandBg)"/>
            <text x="20" y="25.6" text-anchor="middle" font-size="16" font-weight="600" letter-spacing=".35" fill="url(#nxBrandInk)">NX</text>
            <rect x="17.8" y="29.8" width="4.4" height=".4" rx=".2" fill="#c9a96a" opacity=".85"/>
          </svg>
        </div>
        <div class="brand-text">
          <div class="brand-name">NeX Hub</div>
          <div class="brand-sub">Project Manager</div>
        </div>
        <button class="sidebar-toggle" id="btnSidebarToggle" type="button" title="${collapsed ? 'Развернуть меню' : 'Свернуть меню'}">
          ${svgIcon('panel-left', 'sm')}
        </button>
      </div>
      <div class="sidebar-actions">
        <button class="btn btn-primary btn-block" id="btnCreate" title="Создать проект">
          ${svgIcon('plus', 'sm')} <span>Создать проект</span>
        </button>
      </div>
      <nav class="nav">
        <div class="nav-label">Основное</div>
        <button class="${navClass('list')}" id="btnList" title="Проекты">
          ${svgIcon('folder')} <span>Проекты</span>
        </button>
        <button class="${navClass('dashboard')}" id="btnDashboard" title="Дашборд">
          ${svgIcon('bar-chart')} <span>Дашборд</span>
        </button>
        <button class="${navClass('calendar')}" id="btnCalendar" title="Календарь">
          ${svgIcon('calendar')} <span>Календарь</span>
        </button>
        <button class="${navClass('kanban')}" id="btnKanban" title="Kanban">
          ${svgIcon('columns')} <span>Kanban</span>
        </button>
        <button class="${navClass('trash')}" id="btnTrash" title="Корзина">
          ${svgIcon('trash')} <span>Корзина</span>
        </button>
      </nav>
      <div class="sidebar-foot">
        <div class="profile-wrap">
          <div class="profile-menu" role="menu">
            <button class="profile-menu-item" id="btnSettings" role="menuitem">
              ${svgIcon('settings', 'sm')} <span>Настройки</span>
            </button>
            <button class="profile-menu-item danger" id="btnLogout" role="menuitem">
              ${svgIcon('log-out', 'sm')} <span>Выйти</span>
            </button>
          </div>
          <button class="user-card" id="btnProfile" title="Профиль">
            <span class="avatar">${initial}</span>
            <span class="user-name">${auth.user?.username || 'Профиль'}</span>
            <span class="user-more">${svgIcon('ellipsis', 'sm')}</span>
          </button>
        </div>
      </div>
    </aside>
  `;
}

export function bindHeaderEvents() {
  const btnList = document.getElementById('btnList');
  const btnDashboard = document.getElementById('btnDashboard');
  const btnCalendar = document.getElementById('btnCalendar');
  const btnKanban = document.getElementById('btnKanban');
  const btnTrash = document.getElementById('btnTrash');
  const btnSettings = document.getElementById('btnSettings');
  const btnLogout = document.getElementById('btnLogout');
  const btnCreate = document.getElementById('btnCreate');
  const btnSidebarToggle = document.getElementById('btnSidebarToggle');

  if (btnSidebarToggle) btnSidebarToggle.addEventListener('click', () => {
    store.sidebarCollapsed = !store.sidebarCollapsed;
    localStorage.setItem('sidebarCollapsed', store.sidebarCollapsed ? '1' : '0');
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.toggle('collapsed', store.sidebarCollapsed);
    btnSidebarToggle.title = store.sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню';
  });

  if (btnList) btnList.addEventListener('click', () => {
    store.showTrash = false;
    switchView('list');
  });
  if (btnDashboard) btnDashboard.addEventListener('click', () => {
    store.showTrash = false;
    switchView('dashboard');
  });
  if (btnCalendar) btnCalendar.addEventListener('click', () => {
    store.showTrash = false;
    switchView('calendar');
  });
  if (btnKanban) btnKanban.addEventListener('click', () => {
    store.showTrash = false;
    switchView('kanban');
  });

  if (btnTrash) {
    btnTrash.addEventListener('click', async () => {
      store.showTrash = true;
      store.currentView = 'list';
      store.filterFavorite = false;
      store.searchQuery = '';
      store.filterTag = '';
      store.selectionMode = false;
      store.selectedIds = [];
      const { render } = await import('../app.js');
      render();
    });
  }

  if (btnSettings) btnSettings.addEventListener('click', () => openSettings());

  if (btnLogout) btnLogout.addEventListener('click', () => {
    auth.logout().then(() => import('./login.js').then(m => m.renderLoginScreen()));
  });

  if (btnCreate) btnCreate.addEventListener('click', async () => {
    const { openCreateProjectModal } = await import('./modal.js');
    const { loadProjects, render } = await import('../app.js');
    openCreateProjectModal(async () => {
      await loadProjects();
      render();
    });
  });
}

async function switchView(view) {
  store.currentView = view;
  store.currentProjectId = null;
  store.showTrash = false;
  store.selectionMode = false;
  store.selectedIds = [];
  const { render } = await import('../app.js');
  render();
}

async function openSettings(tab) {
  store.currentView = 'settings';
  store.currentProjectId = null;
  store.showTrash = false;
  store.selectionMode = false;
  store.selectedIds = [];
  if (tab) store.currentSettingsTab = tab;
  const { render } = await import('../app.js');
  render();
}
