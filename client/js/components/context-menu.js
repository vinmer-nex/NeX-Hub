import store from '../store.js';
import api from '../api.js';
import { svgIcon, showToast, escapeHTML } from '../utils/dom.js';
import { openModal } from './modal.js';

let contextMenuEl = null;

export function showMenu(e, items) {
  if (!e || !Array.isArray(items) || !items.length) return;

  e.preventDefault();
  e.stopPropagation();
  hideContextMenu();

  document.body.style.userSelect = 'none';
  setTimeout(() => { document.body.style.userSelect = ''; }, 100);

  contextMenuEl = document.createElement('div');
  contextMenuEl.className = 'context-menu';

  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      contextMenuEl.appendChild(sep);
    } else if (item.children) {
      const parent = document.createElement('div');
      parent.className = 'context-menu-item';
      parent.innerHTML = `${item.icon ? svgIcon(item.icon, 'sm') : ''} ${item.label} ▸`;
      parent.style.position = 'relative';

      const submenu = document.createElement('div');
      submenu.className = 'context-menu';
      submenu.style.position = 'absolute';
      submenu.style.left = '100%';
      submenu.style.top = '0';
      submenu.style.display = 'none';

      item.children.forEach(child => {
        const childEl = document.createElement('div');
        childEl.className = 'context-menu-item';
        childEl.textContent = child.label;
        childEl.addEventListener('click', (ev) => {
          ev.stopPropagation();
          hideContextMenu();
          child.action();
        });
        submenu.appendChild(childEl);
      });

      parent.addEventListener('mouseenter', () => {
        submenu.style.display = 'block';
        const pad = 8;
        // Ориентируемся на позицию родительского пункта, а не на текущее
        // положение подменю — иначе при повторном наведении сторона
        // переключается каждый раз и меню уходит за экран.
        const parentRect = parent.getBoundingClientRect();
        const subWidth = submenu.offsetWidth;
        if (parentRect.right + subWidth > window.innerWidth - pad) {
          submenu.style.left = 'auto';
          submenu.style.right = '100%';
        } else {
          submenu.style.left = '100%';
          submenu.style.right = 'auto';
        }
        const subHeight = submenu.offsetHeight;
        if (parentRect.top + subHeight > window.innerHeight - pad) {
          submenu.style.top = 'auto';
          submenu.style.bottom = '0';
        } else {
          submenu.style.top = '0';
          submenu.style.bottom = 'auto';
        }
      });
      parent.addEventListener('mouseleave', () => { submenu.style.display = 'none'; });

      parent.appendChild(submenu);
      contextMenuEl.appendChild(parent);
    } else {
      const mi = document.createElement('div');
      mi.className = 'context-menu-item' + (item.danger ? ' danger' : '');
      mi.innerHTML = `${item.icon ? svgIcon(item.icon, 'sm') : ''} ${item.label}`;
      mi.addEventListener('click', (ev) => {
        ev.stopPropagation();
        hideContextMenu();
        if (item.action) item.action();
      });
      contextMenuEl.appendChild(mi);
    }
  });

  document.body.appendChild(contextMenuEl);

  // Позиционируем по фактическим размерам меню, чтобы оно не уходило за экран
  const pad = 8;
  const menuW = contextMenuEl.offsetWidth;
  const menuH = contextMenuEl.offsetHeight;
  let x = e.clientX;
  let y = e.clientY;
  if (x + menuW > window.innerWidth - pad) x = window.innerWidth - menuW - pad;
  if (x < pad) x = pad;
  if (y + menuH > window.innerHeight - pad) y = window.innerHeight - menuH - pad;
  if (y < pad) y = pad;
  contextMenuEl.style.left = x + 'px';
  contextMenuEl.style.top = y + 'px';

  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') hideContextMenu();
    }, { once: true });
  }, 0);
}

export function showContextMenu(e, projectId) {
  let proj = null;
  if (store.showTrash) {
    proj = store.trashProjects.find(p => p.id === projectId);
  } else {
    proj = store.projects.find(p => p.id === projectId);
  }
  if (!proj) return;

  let items = [];

  if (store.showTrash) {
    // Меню для корзины
    items = [
      { label: 'Восстановить', icon: 'undo', action: () => restoreFromTrash(projectId) },
      { label: 'Выделить', icon: 'check', action: () => startSelection(projectId) },
      { separator: true },
      { label: 'Удалить навсегда', icon: 'trash', danger: true, action: () => permanentlyDelete(projectId, proj) }
    ];
  } else {
    // Обычное меню
    items = [
      { label: 'Открыть', icon: 'folder', action: () => openProjectFromMenu(projectId) },
      { label: 'Редактировать', icon: 'edit', action: () => editProjectFromMenu(projectId) },
      { label: 'Дублировать', icon: 'duplicate', action: () => duplicateProjectFromMenu(projectId) },
      { label: proj.favorite ? 'Убрать из избранного' : 'В избранное', icon: proj.favorite ? 'star-filled' : 'star', action: () => toggleFavoriteFromMenu(projectId) },
      { label: proj.pinned ? 'Открепить' : 'Закрепить', icon: 'pin', action: () => togglePinnedFromMenu(projectId) },
      { label: 'Выделить', icon: 'check', action: () => startSelection(projectId) },
      { separator: true },
      { label: 'Изменить статус', icon: 'clock', children: [
        { label: '→ В работе', action: () => changeStatusFromMenu(projectId, 'active') },
        { label: '→ На паузе', action: () => changeStatusFromMenu(projectId, 'paused') },
        { label: '→ Завершён', action: () => changeStatusFromMenu(projectId, 'done') },
        { label: '→ Архив', action: () => changeStatusFromMenu(projectId, 'archive') }
      ]},
      { separator: true },
      { label: 'В корзину', icon: 'trash', danger: true, action: () => moveToTrash(projectId, proj) }
    ];
  }

  showMenu(e, items);
}

function hideContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
}

// ============ ОБЫЧНЫЕ ДЕЙСТВИЯ ============

async function startSelection(id) {
  store.selectionMode = true;
  store.selectedIds = [id];
  const { render } = await import('../app.js');
  render();
}

async function openProjectFromMenu(id) {
  store.currentProjectId = id;
  store.currentView = 'detail';
  store.currentDetailTab = 'notes';
  const { render } = await import('../app.js');
  render();
}

async function editProjectFromMenu(id) {
  const { openEditProjectModal } = await import('./modal-edit.js');
  const { loadProjects, render } = await import('../app.js');
  openEditProjectModal(id, async () => {
    await loadProjects();
    render();
  });
}

async function duplicateProjectFromMenu(id) {
  const proj = store.projects.find(p => p.id === id);
  if (!proj) return;
  try {
    await api.createProject({
      name: (proj.name || '') + ' (копия)',
      description: proj.description,
      tags: proj.tags || [],
      status: proj.status,
      priority: proj.priority,
      color: proj.color,
      deadline: proj.deadline,
      startDate: proj.start_date,
      estimatedHours: proj.estimated_hours
    });
    const { loadProjects, render } = await import('../app.js');
    await loadProjects();
    render();
    showToast('Проект дублирован');
  } catch (err) {
    showToast('Ошибка', true);
  }
}

async function toggleFavoriteFromMenu(id) {
  const proj = store.projects.find(p => p.id === id);
  if (!proj) return;
  try {
    await api.updateProject(id, { favorite: !proj.favorite });
    const { loadProjects, render } = await import('../app.js');
    await loadProjects();
    render();
  } catch (err) {
    showToast('Ошибка', true);
  }
}

async function togglePinnedFromMenu(id) {
  const proj = store.projects.find(p => p.id === id);
  if (!proj) return;
  try {
    await api.updateProject(id, { pinned: !proj.pinned });
    const { loadProjects, render } = await import('../app.js');
    await loadProjects();
    render();
    showToast(proj.pinned ? 'Проект откреплён' : 'Проект закреплён');
  } catch (err) {
    showToast('Ошибка', true);
  }
}

async function changeStatusFromMenu(id, status) {
  try {
    await api.updateProject(id, { status });
    const { loadProjects, render } = await import('../app.js');
    await loadProjects();
    render();
    showToast('Статус изменён');
  } catch (err) {
    showToast('Ошибка', true);
  }
}

// ============ КОРЗИНА ============

async function moveToTrash(id, proj) {
  const { requirePassword } = await import('../security.js');
  if (!(await requirePassword('Подтвердите перемещение проекта в корзину.'))) return;

  const body = `
    <p>Переместить проект <strong>${escapeHTML(proj.name)}</strong> в корзину?</p>
    <div class="form-row">
      <button class="btn btn-secondary modal-close-x">Отмена</button>
      <button class="btn btn-danger" id="modalSaveBtn">В корзину</button>
    </div>
  `;

  openModal('Удаление проекта', body, async () => {
    try {
      await api.deleteProject(id);
      const { loadProjects, render } = await import('../app.js');
      await loadProjects();
      render();
      showToast('Проект в корзине');
    } catch (err) {
      showToast('Ошибка', true);
    }
    return true;
  });
}

async function restoreFromTrash(id) {
  try {
    await api.deleteProject(id);
    const { loadProjects, render } = await import('../app.js');
    await loadProjects();
    store.showTrash = true;
    render();
    showToast('Проект восстановлен');
  } catch (err) {
    showToast('Ошибка', true);
  }
}

async function permanentlyDelete(id, proj) {
  const { requirePassword } = await import('../security.js');
  if (!(await requirePassword('Подтвердите безвозвратное удаление проекта.'))) return;

  const body = `
    <p>Удалить проект <strong>${escapeHTML(proj.name)}</strong> навсегда?</p>
    <p style="font-size:12px;color:var(--text-secondary)">Это действие нельзя отменить.</p>
    <div class="form-row">
      <button class="btn btn-secondary modal-close-x">Отмена</button>
      <button class="btn btn-danger" id="modalSaveBtn">Удалить навсегда</button>
    </div>
  `;

  openModal('Удалить навсегда', body, async () => {
    try {
      await api.deleteProject(id, true);
      const { loadProjects, render } = await import('../app.js');
      await loadProjects();
      store.showTrash = true;
      render();
      showToast('Проект удалён');
    } catch (err) {
      showToast('Ошибка', true);
    }
    return true;
  });
}