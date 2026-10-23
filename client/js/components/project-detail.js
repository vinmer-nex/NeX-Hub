import store from '../store.js';
import api from '../api.js';
import CONFIG from '../config.js';
import { svgIcon, escapeHTML, formatDate, showToast, projectAvatar } from '../utils/dom.js';
import { highlightText, renderMarkdown } from '../utils/format.js';
import { highlightCode } from '../utils/highlight.js';
import { parseMindmapFiles, hasUploadFile, hasPathFile, toggleUploadFile, togglePathFile } from '../utils/mindmap-files.js';
import { renderAttachmentChips, parseAttachments } from './attachments.js';
import { refsChipsHTML, bindRefsNavigation } from './entity-refs.js';
import { renderScriptsTab, bindScriptsTab, maybeAutostart } from './scripts.js';

let currentProjectData = null;
export function clearDetailCache() {
  currentProjectData = null;
}
const autostartedProjects = new Set();
let notesView = { search: '', sort: 'new', tags: [] };
let notesViewProjectId = null;
let checklistView = { search: '', category: 'all', hideDone: false, collapsed: {} };
let checklistViewProjectId = null;

const CHECKLIST_COLLAPSED_KEY = 'nexhub.checklistCollapsed';

function loadChecklistCollapsed(projectId) {
  try {
    const all = JSON.parse(localStorage.getItem(CHECKLIST_COLLAPSED_KEY) || '{}');
    return all[projectId] || {};
  } catch (e) {
    return {};
  }
}

function saveChecklistCollapsed(projectId) {
  if (!projectId) return;
  try {
    const all = JSON.parse(localStorage.getItem(CHECKLIST_COLLAPSED_KEY) || '{}');
    all[projectId] = checklistView.collapsed;
    localStorage.setItem(CHECKLIST_COLLAPSED_KEY, JSON.stringify(all));
  } catch (e) {}
}

const TAG_COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#40c8e0', '#ffd60a', '#64d2ff'];
function tagColor(label) {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

export async function renderProjectDetail() {
  if (!store.currentProjectId) {
    store.currentView = 'list';
    const { render } = await import('../app.js');
    render();
    return '';
  }

  if (!currentProjectData || currentProjectData.id !== store.currentProjectId) {
    try {
      const data = await api.getProject(store.currentProjectId);
      currentProjectData = data.project;
    } catch (err) {
      showToast('Проект не найден', true);
      store.currentView = 'list';
      const { render } = await import('../app.js');
      render();
      return '';
    }
  }

  const proj = currentProjectData;
  if (notesViewProjectId !== proj.id) {
    notesViewProjectId = proj.id;
    notesView = { search: '', sort: 'new', tags: [] };
  }
  if (checklistViewProjectId !== proj.id) {
    checklistViewProjectId = proj.id;
    checklistView = { search: '', category: 'all', hideDone: false, collapsed: loadChecklistCollapsed(proj.id) };
  }
  const over = proj.deadline && new Date(proj.deadline) < new Date();

  let html = `
    <button class="detail-back" id="btnGoBack">
      ${svgIcon('chevron-left', 'sm')} Все проекты
    </button>
    
    <div class="detail-header">
      <div class="detail-logo">
        ${projectAvatar(proj)}
      </div>
      <div class="detail-info">
        <h1>${escapeHTML(proj.name) || 'Без названия'}</h1>
        <div class="detail-desc">${escapeHTML(proj.description || 'Нет описания')}</div>
        <div class="detail-meta-row">
          <span class="badge badge-default">${CONFIG.STATUS_LABELS[proj.status] || proj.status}</span>
          ${proj.priority ? `<span class="priority-badge priority-${proj.priority}">${proj.priority.toUpperCase()}</span>` : ''}
          ${proj.favorite ? `<span class="badge" style="background:var(--yellow-light);color:var(--yellow)">⭐ Избранное</span>` : ''}
          ${proj.pinned ? `<span class="badge badge-accent">${svgIcon('pin-filled', 'sm')} Закреплён</span>` : ''}
          ${proj.deadline ? `<span class="badge ${over ? 'badge-danger' : 'badge-accent'}">${svgIcon('clock', 'sm')} ${formatDate(proj.deadline)}</span>` : ''}
          ${proj.start_date ? `<span class="badge badge-default">Старт: ${formatDate(proj.start_date)}</span>` : ''}
          ${proj.estimated_hours ? `<span class="badge badge-default">⏱ ${proj.estimated_hours}ч</span>` : ''}
          ${(proj.tags || []).map(t => `<span class="badge badge-default">${escapeHTML(t)}</span>`).join('')}
        </div>
        <div class="detail-actions">
          <button class="btn btn-sm btn-tertiary" id="btnEditProject">
            ${svgIcon('edit', 'sm')} Редактировать
          </button>
          <button class="btn btn-sm btn-tertiary" id="btnToggleFavorite">
            ${svgIcon(proj.favorite ? 'star-filled' : 'star', 'sm')} 
            ${proj.favorite ? 'В избранном' : 'В избранное'}
          </button>
          <button class="btn btn-sm btn-tertiary" id="btnTogglePin">
            ${svgIcon(proj.pinned ? 'pin-filled' : 'pin', 'sm')} 
            ${proj.pinned ? 'Открепить' : 'Закрепить'}
          </button>
          <button class="btn btn-sm btn-danger" id="btnDeleteProject">
            ${svgIcon('trash', 'sm')} В корзину
          </button>
        </div>
      </div>
    </div>

    <div class="detail-tabs">
      <button class="detail-tab ${store.currentDetailTab === 'notes' ? 'active' : ''}" data-tab="notes">${svgIcon('note', 'sm')} Заметки</button>
      <button class="detail-tab ${store.currentDetailTab === 'checklist' ? 'active' : ''}" data-tab="checklist">${svgIcon('check', 'sm')} Чеклист</button>
      <button class="detail-tab ${store.currentDetailTab === 'milestones' ? 'active' : ''}" data-tab="milestones">${svgIcon('flag', 'sm')} Вехи</button>
      <button class="detail-tab ${store.currentDetailTab === 'versions' ? 'active' : ''}" data-tab="versions">${svgIcon('git-branch', 'sm')} Версии</button>
      <button class="detail-tab ${store.currentDetailTab === 'photos' ? 'active' : ''}" data-tab="photos">${svgIcon('image', 'sm')} Фото</button>
      <button class="detail-tab ${store.currentDetailTab === 'comments' ? 'active' : ''}" data-tab="comments">${svgIcon('message-square', 'sm')} Комм.</button>
      <button class="detail-tab ${store.currentDetailTab === 'mindmap' ? 'active' : ''}" data-tab="mindmap">${svgIcon('mindmap', 'sm')} Mind Map</button>
      <button class="detail-tab ${store.currentDetailTab === 'activity' ? 'active' : ''}" data-tab="activity">${svgIcon('activity', 'sm')} Лог</button>
      <button class="detail-tab ${store.currentDetailTab === 'files' ? 'active' : ''}" data-tab="files">${svgIcon('folder', 'sm')} Файлы</button>
      <button class="detail-tab ${store.currentDetailTab === 'scripts' ? 'active' : ''}" data-tab="scripts">${svgIcon('terminal', 'sm')} Скрипты</button>
    </div>
  `;

  html += `<div id="tabContent">${renderTabContent(proj)}</div>`;

  setTimeout(() => bindDetailEvents(proj), 0);

  if (!autostartedProjects.has(proj.id)) {
    autostartedProjects.add(proj.id);
    setTimeout(() => maybeAutostart(proj), 120);
  }

  return html;
}

function renderTabContent(proj) {
  switch (store.currentDetailTab) {
    case 'notes': return renderNotesTab(proj);
    case 'checklist': return renderChecklistTab(proj);
    case 'milestones': return renderMilestonesTab(proj);
    case 'versions': return renderVersionsTab(proj);
    case 'photos': return renderPhotosTab(proj);
    case 'comments': return renderCommentsTab(proj);
    case 'mindmap': return renderMindMapTab(proj);
    case 'activity': return renderActivityShell();
    case 'files': return renderFilesTab(proj);
    case 'scripts': return renderScriptsTab(proj);
    default: return '';
  }
}

function renderMindMapTab(proj) {
  var containerId = 'mindmapContainer';
  var mindmapHTML = '';
  var mindmapModule = window._mindmapModule;

  if (mindmapModule) {
    mindmapHTML = mindmapModule.renderMindMap(containerId, proj);
  } else {
    mindmapHTML = '<p style="color:var(--text-secondary);padding:16px">Загрузка Mind Map...</p>';
    import('./mindmap.js').then(function(mod) {
      window._mindmapModule = mod;
      var container = document.getElementById(containerId);
      if (container && proj) {
        container.innerHTML = mod.renderMindMap(containerId, proj);
      }
    });
  }

  var rootLinksLabel = 'Связи с проектом';
  if (mindmapModule && typeof mindmapModule.isRootLinksVisible === 'function' && !mindmapModule.isRootLinksVisible()) {
    rootLinksLabel = 'Связи скрыты';
  }

  return '<div class="notes-section">' +
    '<div class="section-header">' +
      '<span class="section-title">' + svgIcon('mindmap') + ' Mind Map</span>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-sm btn-secondary" id="btnMmRootLinks" onclick="window._toggleMindMapRootLinks(this)">' + rootLinksLabel + '</button>' +
        '<button class="btn btn-sm btn-secondary" onclick="window._refreshMindMap()">Обновить</button>' +
      '</div>' +
    '</div>' +
    '<div id="' + containerId + '">' + mindmapHTML + '</div>' +
  '</div>';
}

window._toggleMindMapRootLinks = function(btn) {
  var mod = window._mindmapModule;
  if (!mod || typeof mod.toggleRootLinks !== 'function') return;
  var on = mod.toggleRootLinks();
  if (btn) btn.textContent = on ? 'Связи с проектом' : 'Связи скрыты';
};

window._refreshMindMap = function() {
  var container = document.getElementById('mindmapContainer');
  var mod = window._mindmapModule;
  if (container && mod && currentProjectData) {
    container.innerHTML = mod.renderMindMap('mindmapContainer', currentProjectData);
  }
};

window._refreshDetail = refreshDetail;

function bindDetailEvents(proj) {
  const tabContentForErrors = document.getElementById('tabContent');
  if (tabContentForErrors) {
    tabContentForErrors.addEventListener('error', function(e) {
      const img = e.target;
      if (!img || img.tagName !== 'IMG') return;
      const fallback = img.getAttribute('data-full-src');
      if (fallback) {
        img.removeAttribute('data-full-src');
        img.src = fallback;
      }
    }, true);
  }

  const btnBack = document.getElementById('btnGoBack');
  if (btnBack) btnBack.addEventListener('click', () => {
    if (store.currentProjectId) autostartedProjects.delete(store.currentProjectId);
    store.currentView = 'list';
    store.currentProjectId = null;
    import('../app.js').then(m => m.render());
  });

  document.querySelectorAll('.detail-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      store.currentDetailTab = tab.dataset.tab;
      // Обновляем активный класс на кнопках вкладок
      document.querySelectorAll('.detail-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === store.currentDetailTab);
      });
      if (store.currentDetailTab === 'activity') {
        const tabContent = document.getElementById('tabContent');
        if (tabContent) tabContent.innerHTML = renderActivityShell();
        bindActivityRefresh(proj);
        loadActivityInto(proj);
      } else {
        const { render } = await import('../app.js');
        render();
      }
    });
  });

  bindRefsNavigation(document.getElementById('tabContent'), navigateToRef);

  const btnEdit = document.getElementById('btnEditProject');
  if (btnEdit) btnEdit.addEventListener('click', async () => {
    const { openEditProjectModal } = await import('./modal-edit.js');
    openEditProjectModal(proj.id, refreshDetail);
  });

  const btnFav = document.getElementById('btnToggleFavorite');
  if (btnFav) btnFav.addEventListener('click', async () => {
    try {
      const next = !proj.favorite;
      await api.updateProject(proj.id, { favorite: next });
      if (currentProjectData) currentProjectData.favorite = next;
      syncProjectIntoStore(currentProjectData);
      const { render } = await import('../app.js');
      await render();
    } catch (err) { showToast('Ошибка', true); }
  });

  const btnPin = document.getElementById('btnTogglePin');
  if (btnPin) btnPin.addEventListener('click', async () => {
    try {
      const next = !proj.pinned;
      await api.updateProject(proj.id, { pinned: next });
      if (currentProjectData) currentProjectData.pinned = next;
      syncProjectIntoStore(currentProjectData);
      const { render } = await import('../app.js');
      await render();
      showToast(next ? 'Проект закреплён' : 'Проект откреплён');
    } catch (err) { showToast('Ошибка', true); }
  });

  const btnDel = document.getElementById('btnDeleteProject');
  if (btnDel) btnDel.addEventListener('click', async () => {
    const { requirePassword } = await import('../security.js');
    if (!(await requirePassword('Подтвердите перемещение проекта в корзину.'))) return;
    const { openModal } = await import('./modal.js');
    const body = `
      <p>Переместить проект <strong>${escapeHTML(proj.name)}</strong> в корзину?</p>
      <div class="form-row">
        <button class="btn btn-secondary modal-close-x">Отмена</button>
        <button class="btn btn-danger" id="modalSaveBtn">В корзину</button>
      </div>
    `;
    openModal('Удаление проекта', body, async () => {
      try {
        await api.deleteProject(proj.id);
        store.currentView = 'list';
        store.currentProjectId = null;
        const { loadProjects, render } = await import('../app.js');
        await loadProjects();
        render();
        showToast('Проект в корзине');
      } catch (err) { showToast('Ошибка', true); }
      return true;
    });
  });

  document.querySelectorAll('.btn-edit-note').forEach(btn => {
    btn.addEventListener('click', async () => {
      const noteId = btn.dataset.noteId;
      const note = (currentProjectData?.notes || []).find(n => n.id === noteId);
      if (note) {
        const { openAddNoteModal } = await import('./modal-forms.js');
        openAddNoteModal(proj.id, refreshDetail, note);
      }
    });
  });

  document.querySelectorAll('.btn-delete-note').forEach(btn => {
    btn.addEventListener('click', async () => {
      const noteId = btn.dataset.noteId;
      const note = (currentProjectData?.notes || []).find(n => n.id === noteId);
      const noteTitle = note ? (note.title || 'Без заголовка') : 'эту заметку';
      const { openModal } = await import('./modal.js');
      const body = `
        <p>Удалить заметку <strong>${escapeHTML(noteTitle)}</strong>?</p>
        <div class="form-row">
          <button class="btn btn-secondary modal-close-x">Отмена</button>
          <button class="btn btn-danger" id="modalSaveBtn">Удалить</button>
        </div>
      `;
      openModal('Удаление заметки', body, async () => {
        try {
          await api.deleteNote(proj.id, btn.dataset.noteId);
          await refreshDetail();
        } catch (err) { showToast('Ошибка', true); }
        return true;
      });
    });
  });

  const btnAddNote = document.getElementById('btnAddNote');
  if (btnAddNote) btnAddNote.addEventListener('click', async () => {
    const { openAddNoteModal } = await import('./modal-forms.js');
    openAddNoteModal(proj.id, refreshDetail);
  });

  const btnAddChecklist = document.getElementById('btnAddChecklist');
  if (btnAddChecklist) btnAddChecklist.addEventListener('click', async () => {
    const { openAddChecklistModal } = await import('./modal-forms.js');
    openAddChecklistModal(proj.id, refreshDetail);
  });

  const btnAddChecklistCategory = document.getElementById('btnAddChecklistCategory');
  if (btnAddChecklistCategory) btnAddChecklistCategory.addEventListener('click', async () => {
    const { openChecklistCategoryModal } = await import('./modal-forms.js');
    openChecklistCategoryModal(proj.id, refreshDetail);
  });

  document.querySelectorAll('.btn-add-checklist-in-cat').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { openAddChecklistModal } = await import('./modal-forms.js');
      openAddChecklistModal(proj.id, refreshDetail, null, btn.dataset.catId);
    });
  });

  document.querySelectorAll('.btn-edit-checklist-category').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const category = (currentProjectData?.checklistCategories || []).find(c => String(c.id) === String(btn.dataset.catId));
      if (!category) return;
      const { openChecklistCategoryModal } = await import('./modal-forms.js');
      openChecklistCategoryModal(proj.id, refreshDetail, category);
    });
  });

  document.querySelectorAll('.btn-delete-checklist-category').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const category = (currentProjectData?.checklistCategories || []).find(c => String(c.id) === String(btn.dataset.catId));
      if (!category) return;
      const { openModal } = await import('./modal.js');
      const body = `
        <p>Удалить категорию <strong>${escapeHTML(category.name)}</strong>?</p>
        <p style="font-size:12.5px;color:var(--text-secondary)">Задачи из этой категории не удалятся, а перейдут в «Без категории».</p>
        <div class="form-row">
          <button class="btn btn-secondary modal-close-x">Отмена</button>
          <button class="btn btn-danger" id="modalSaveBtn">Удалить</button>
        </div>
      `;
      openModal('Удаление категории', body, async () => {
        try {
          await api.deleteChecklistCategory(proj.id, category.id);
          showToast('Категория удалена, задачи перенесены');
          await refreshDetail();
        } catch (err) { showToast('Ошибка', true); }
        return true;
      });
    });
  });

  document.querySelectorAll('.checklist-item-clickable').forEach(el => {
    el.addEventListener('click', async () => {
      const itemId = parseInt(el.dataset.itemId);
      const item = (currentProjectData?.checklist || []).find(i => i.id === itemId);
      if (item) {
        try {
          await api.updateChecklistItem(proj.id, itemId, { done: !item.done });
          item.done = !item.done;
          const { render } = await import('../app.js');
          await render();
        } catch (err) { showToast('Ошибка', true); }
      }
    });
  });

  document.querySelectorAll('.btn-edit-checklist').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const itemId = parseInt(btn.dataset.itemId);
      const item = (currentProjectData?.checklist || []).find(i => i.id === itemId);
      if (item) {
        const { openAddChecklistModal } = await import('./modal-forms.js');
        openAddChecklistModal(proj.id, refreshDetail, item);
      }
    });
  });

  document.querySelectorAll('.btn-delete-checklist').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api.deleteChecklistItem(proj.id, parseInt(btn.dataset.itemId));
        await refreshDetail();
      } catch (err) { showToast('Ошибка', true); }
    });
  });

  document.querySelectorAll('.btn-add-subtask').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { openAddSubtaskModal } = await import('./modal-forms.js');
      openAddSubtaskModal(proj.id, parseInt(btn.dataset.itemId), refreshDetail);
    });
  });

  document.querySelectorAll('.subtask-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('button')) return;
      const itemId = parseInt(el.dataset.itemId);
      const subId = parseInt(el.dataset.subId);
      const item = (currentProjectData?.checklist || []).find(i => i.id === itemId);
      const sub = item ? (item.subtasks || []).find(s => s.id === subId) : null;
      if (!sub) return;
      try {
        await api.updateSubtask(proj.id, itemId, subId, { done: !sub.done });
        sub.done = !sub.done;
        const { render } = await import('../app.js');
        await render();
      } catch (err) { showToast('Ошибка', true); }
    });
  });

  document.querySelectorAll('.btn-edit-subtask').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const itemId = parseInt(btn.dataset.itemId);
      const subId = parseInt(btn.dataset.subId);
      const item = (currentProjectData?.checklist || []).find(i => i.id === itemId);
      const sub = item ? (item.subtasks || []).find(s => s.id === subId) : null;
      if (!sub) return;
      const { openAddSubtaskModal } = await import('./modal-forms.js');
      openAddSubtaskModal(proj.id, itemId, refreshDetail, sub);
    });
  });

  document.querySelectorAll('.btn-delete-subtask').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api.deleteSubtask(proj.id, parseInt(btn.dataset.itemId), parseInt(btn.dataset.subId));
        await refreshDetail();
      } catch (err) { showToast('Ошибка', true); }
    });
  });

  const btnAddMilestone = document.getElementById('btnAddMilestone');
  if (btnAddMilestone) btnAddMilestone.addEventListener('click', async () => {
    const { openAddMilestoneModal } = await import('./modal-forms.js');
    openAddMilestoneModal(proj.id, refreshDetail);
  });

  document.querySelectorAll('.btn-edit-milestone').forEach(btn => {
    btn.addEventListener('click', async () => {
      const milestone = (currentProjectData?.milestones || []).find(m => String(m.id) === btn.dataset.id);
      if (!milestone) return;
      const { openAddMilestoneModal } = await import('./modal-forms.js');
      openAddMilestoneModal(proj.id, refreshDetail, milestone);
    });
  });

  document.querySelectorAll('.btn-delete-milestone').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.deleteMilestone(proj.id, parseInt(btn.dataset.id));
        await refreshDetail();
      } catch (err) { showToast('Ошибка', true); }
    });
  });

  const btnAddVersion = document.getElementById('btnAddVersion');
  if (btnAddVersion) btnAddVersion.addEventListener('click', async () => {
    const { openAddVersionModal } = await import('./modal-forms.js');
    openAddVersionModal(proj.id, refreshDetail);
  });

  document.querySelectorAll('.btn-edit-version').forEach(btn => {
    btn.addEventListener('click', async () => {
      const version = (currentProjectData?.versions || []).find(v => String(v.id) === btn.dataset.id);
      if (!version) return;
      const { openAddVersionModal } = await import('./modal-forms.js');
      openAddVersionModal(proj.id, refreshDetail, version);
    });
  });

  document.querySelectorAll('.btn-delete-version').forEach(btn => {
    btn.addEventListener('click', async () => {
      const version = (currentProjectData?.versions || []).find(v => String(v.id) === btn.dataset.id);
      const { openModal } = await import('./modal.js');
      const body = `
        <p>Удалить версию <strong>${version ? escapeHTML(version.number) : ''}</strong>?</p>
        <div class="form-row">
          <button class="btn btn-secondary modal-close-x">Отмена</button>
          <button class="btn btn-danger" id="modalSaveBtn">Удалить</button>
        </div>
      `;
      openModal('Удаление версии', body, async () => {
        try {
          await api.deleteVersion(proj.id, btn.dataset.id);
          await refreshDetail();
          showToast('Версия удалена');
        } catch (err) { showToast('Ошибка', true); }
        return true;
      });
    });
  });

  const btnAddComment = document.getElementById('btnAddComment');
  if (btnAddComment) btnAddComment.addEventListener('click', async () => {
    const { openAddCommentModal } = await import('./modal-forms.js');
    openAddCommentModal(proj.id, refreshDetail);
  });

  document.querySelectorAll('.btn-edit-comment').forEach(btn => {
    btn.addEventListener('click', async () => {
      const comment = (currentProjectData?.comments || []).find(c => String(c.id) === btn.dataset.id);
      if (!comment) return;
      const { openAddCommentModal } = await import('./modal-forms.js');
      openAddCommentModal(proj.id, refreshDetail, comment);
    });
  });

  document.querySelectorAll('.btn-delete-comment').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { openModal } = await import('./modal.js');
      const body = `
        <p>Удалить этот комментарий?</p>
        <div class="form-row">
          <button class="btn btn-secondary modal-close-x">Отмена</button>
          <button class="btn btn-danger" id="modalSaveBtn">Удалить</button>
        </div>
      `;
      openModal('Удаление комментария', body, async () => {
        try {
          await api.deleteComment(proj.id, btn.dataset.id);
          await refreshDetail();
          showToast('Комментарий удалён');
        } catch (err) { showToast('Ошибка', true); }
        return true;
      });
    });
  });

  // ===== ФОТО =====
  const btnUploadPhotos = document.getElementById('btnUploadPhotos');
  if (btnUploadPhotos) {
    btnUploadPhotos.addEventListener('click', function() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = async function() {
        if (!input.files.length) return;
        try {
          await api.uploadPhotos(proj.id, Array.from(input.files));
          await refreshDetail();
          showToast('Фото загружены');
        } catch (err) {
          showToast('Ошибка загрузки', true);
        }
      };
      input.click();
    });
  }

  document.querySelectorAll('.photo-card').forEach(function(card) {
    card.addEventListener('click', function() {
      var photoId = parseInt(card.dataset.photoId);
      openPhotoViewer(proj, photoId);
    });
  });

  document.querySelectorAll('.btn-delete-photo').forEach(function(btn) {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      var photoId = parseInt(btn.dataset.photoId);
      const { openModal } = await import('./modal.js');
      const body = `
        <p>Удалить это фото?</p>
        <div class="form-row">
          <button class="btn btn-secondary modal-close-x">Отмена</button>
          <button class="btn btn-danger" id="modalSaveBtn">Удалить</button>
        </div>
      `;
      openModal('Удаление фото', body, async () => {
        try {
          await api.deletePhoto(proj.id, photoId);
          await refreshDetail();
          showToast('Фото удалено');
        } catch (err) {
          showToast('Ошибка', true);
        }
        return true;
      });
    });
  });

  // ===== ФАЙЛЫ =====
  const btnUploadFiles = document.getElementById('btnUploadFiles');
  if (btnUploadFiles) {
    btnUploadFiles.addEventListener('click', function() {
      var input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = async function() {
        if (!input.files.length) return;
        try {
          await api.uploadFiles(proj.id, Array.from(input.files));
          await refreshDetail();
          showToast('Файлы загружены');
        } catch (err) {
          showToast('Ошибка загрузки', true);
        }
      };
      input.click();
    });
  }

  bindFilesTab(proj);
  bindAttachmentChips();
  bindNotesView();
  bindChecklistView();
  if (store.currentDetailTab === 'scripts') bindScriptsTab(proj, { refresh: refreshDetail });

  // ===== ЗАМЕТКИ: закрепление / копирование / сворачивание =====
  document.querySelectorAll('.note-pin').forEach(btn => {
    btn.addEventListener('click', async () => {
      const note = (currentProjectData?.notes || []).find(n => String(n.id) === String(btn.dataset.noteId));
      if (!note) return;
      try {
        await api.updateNote(proj.id, note.id, { pinned: !note.pinned });
        note.pinned = !note.pinned;
        const { render } = await import('../app.js');
        await render();
      } catch (err) { showToast('Ошибка', true); }
    });
  });

  document.querySelectorAll('.btn-copy-note').forEach(btn => {
    btn.addEventListener('click', async () => {
      const note = (currentProjectData?.notes || []).find(n => String(n.id) === String(btn.dataset.noteId));
      if (!note) return;
      try {
        await navigator.clipboard.writeText(note.text || '');
        showToast('Текст скопирован');
      } catch (err) { showToast('Не удалось скопировать', true); }
    });
  });

  document.querySelectorAll('.note-expand').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = btn.closest('.note-card')?.querySelector('.note-body');
      if (!body) return;
      const collapsed = body.classList.toggle('collapsed');
      btn.innerHTML = svgIcon(collapsed ? 'chevron-down' : 'chevron-up', 'sm') + (collapsed ? ' Показать полностью' : ' Свернуть');
    });
  });

  if (store.currentDetailTab === 'activity') {
    bindActivityRefresh(proj);
    loadActivityInto(proj);
  }
}

export async function navigateToRef(type, id) {
  if (type === 'note') {
    store.currentDetailTab = 'notes';
    const { render } = await import('../app.js');
    await render();
    setTimeout(() => {
      const card = Array.from(document.querySelectorAll('.note-card'))
        .find(el => String(el.dataset.noteId) === String(id));
      if (!card) {
        showToast('Заметка не найдена', true);
        return;
      }
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashRefTarget(card);
    }, 60);
    return;
  }

  if (type === 'checklist') {
    store.currentDetailTab = 'checklist';
    const { render } = await import('../app.js');
    await render();
    setTimeout(() => {
      const item = Array.from(document.querySelectorAll('.checklist-item'))
        .find(el => String(el.dataset.itemId) === String(id));
      if (!item) {
        showToast('Задача не найдена', true);
        return;
      }
      const group = item.closest('.checklist-category');
      if (group) {
        group.classList.remove('collapsed');
        const key = group.dataset.categoryKey;
        if (key) checklistView.collapsed[key] = false;
        saveChecklistCollapsed(checklistViewProjectId);
      }
      item.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashRefTarget(item);
    }, 60);
  }
}

function flashRefTarget(el) {
  el.classList.add('ref-flash');
  setTimeout(() => el.classList.remove('ref-flash'), 1600);
}

function openPhotoViewer(proj, photoId) {
  var photos = proj.photos || [];
  var index = -1;
  for (var i = 0; i < photos.length; i++) {
    if (photos[i].id === photoId) { index = i; break; }
  }
  if (index < 0) return;

  var viewer = document.createElement('div');
  viewer.className = 'photo-viewer';
  viewer.innerHTML = '<img src="/uploads/photos/' + photos[index].filename + '" alt="">' +
    '<div class="photo-viewer-controls">' +
      '<button class="btn btn-sm btn-secondary" id="photoPrev">← Назад</button>' +
      '<span style="color:#fff;font-size:13px">' + (index + 1) + ' / ' + photos.length + '</span>' +
      '<button class="btn btn-sm btn-secondary" id="photoNext">Вперёд →</button>' +
      '<button class="btn btn-sm btn-danger" id="photoDelete">' + svgIcon('trash', 'sm') + '</button>' +
      '<button class="btn btn-sm btn-secondary" id="photoClose">Закрыть</button>' +
    '</div>';
  document.body.appendChild(viewer);

  var close = function() { viewer.remove(); };
  viewer.querySelector('#photoClose').addEventListener('click', close);
  viewer.addEventListener('click', function(e) { if (e.target === viewer) close(); });

  viewer.querySelector('#photoPrev').addEventListener('click', function(e) {
    e.stopPropagation();
    close();
    if (index > 0) openPhotoViewer(proj, photos[index - 1].id);
  });

  viewer.querySelector('#photoNext').addEventListener('click', function(e) {
    e.stopPropagation();
    close();
    if (index < photos.length - 1) openPhotoViewer(proj, photos[index + 1].id);
  });

  viewer.querySelector('#photoDelete').addEventListener('click', async function(e) {
    e.stopPropagation();
    try {
      await api.deletePhoto(proj.id, photoId);
      close();
      refreshDetail();
      showToast('Фото удалено');
    } catch (err) {
      showToast('Ошибка', true);
    }
  });

  document.addEventListener('keydown', function escH(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escH);
    }
  });
}

async function refreshDetail() {
  try {
    const data = await api.getProject(store.currentProjectId);
    currentProjectData = data.project;
    syncProjectIntoStore(currentProjectData);
    const { render } = await import('../app.js');
    await render();
  } catch (err) { console.error(err); }
}

// Обновляем запись проекта в списке, чтобы карточки не показывали устаревшие данные
// (например, только что добавленный тег) после редактирования со страницы проекта.
function syncProjectIntoStore(proj) {
  if (!proj || !proj.id) return;
  const lists = [store.projects, store.trashProjects];
  for (let l = 0; l < lists.length; l++) {
    const list = lists[l];
    if (!Array.isArray(list)) continue;
    const idx = list.findIndex(p => p.id === proj.id);
    if (idx !== -1) list[idx] = Object.assign({}, list[idx], proj);
  }
}

function renderNotesTab(proj) {
  const notes = proj.notes || [];

  // Собираем все теги для фильтра
  const tagMap = {};
  notes.forEach(n => (n.tags || []).forEach(t => { tagMap[t.toLowerCase()] = tagMap[t.toLowerCase()] || t; }));
  const allTags = Object.keys(tagMap).map(k => tagMap[k]).sort((a, b) => a.localeCompare(b, 'ru'));

  const sortOptions = [
    { v: 'new', l: 'Сначала новые' },
    { v: 'old', l: 'Сначала старые' },
    { v: 'title', l: 'По заголовку' }
  ];

  const tagFilterHTML = allTags.length ? `
    <div class="notes-tags-filter" id="notesTagFilter">
      ${allTags.map(t => `<button class="tag-chip tag-chip-filter ${notesView.tags.includes(t.toLowerCase()) ? 'active' : ''}" data-tag="${escapeHTML(t.toLowerCase())}" style="--tag-color:${tagColor(t)}">${escapeHTML(t)}</button>`).join('')}
    </div>` : '';

  let notesHTML = '';
  if (notes.length) {
    notesHTML = notes.map(n => renderNoteCard(n, proj)).join('');
  } else {
    notesHTML = '<p class="notes-empty">Заметок пока нет.</p>';
  }

  const toolbarHTML = notes.length ? `
    <div class="notes-toolbar">
      <div class="notes-search-wrap">
        ${svgIcon('search', 'sm')}
        <input class="form-input notes-search" id="notesSearch" placeholder="Поиск по заметкам" value="${escapeHTML(notesView.search)}">
      </div>
      <select class="form-select notes-sort" id="notesSort">
        ${sortOptions.map(o => `<option value="${o.v}" ${notesView.sort === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}
      </select>
    </div>
    ${tagFilterHTML}
  ` : '';

  return `
    <div class="notes-section">
      <div class="section-header">
        <span class="section-title">${svgIcon('note')} Заметки ${notes.length ? `<span class="section-count">${notes.length}</span>` : ''}</span>
        <button class="btn btn-sm btn-primary" id="btnAddNote">${svgIcon('plus', 'sm')} Добавить</button>
      </div>
      ${toolbarHTML}
      <div class="notes-list" id="notesList">
        ${notesHTML}
        <p class="notes-empty notes-no-results" id="notesNoResults" style="display:none">Ничего не найдено.</p>
      </div>
    </div>
  `;
}

function renderNoteCard(n, proj) {
  const text = n.text || '';
  const collapsed = text.length > 320;
  const updated = n.updated_at && n.updated_at !== n.created_at;
  const timeLabel = updated ? 'Обновлено ' + formatDate(n.updated_at) : formatDate(n.created_at);
  const timeTitle = 'Создано: ' + formatDate(n.created_at) + (updated ? '\nОбновлено: ' + formatDate(n.updated_at) : '');

  const tagsHTML = (n.tags && n.tags.length) ? `
    <div class="note-tags">
      ${n.tags.map(t => `<span class="tag-chip" style="--tag-color:${tagColor(t)}">${escapeHTML(t)}</span>`).join('')}
    </div>` : '';

  const linksHTML = refsChipsHTML(n, proj, { showNotes: false });

  return `
    <div class="note-card ${n.pinned ? 'pinned' : ''}"
         data-note-id="${n.id}"
         data-title="${escapeHTML((n.title || '').toLowerCase())}"
         data-tags="${(n.tags || []).map(t => t.toLowerCase()).join('|')}"
         data-created="${n.created_at || ''}"
         data-updated="${n.updated_at || ''}"
         data-pinned="${n.pinned ? 1 : 0}">
      <div class="note-top">
        <button class="note-pin ${n.pinned ? 'active' : ''}" data-note-id="${n.id}" title="${n.pinned ? 'Открепить' : 'Закрепить'}">${svgIcon('pin', 'sm')}</button>
        <span class="note-title">${svgIcon('note', 'sm')} ${escapeHTML(n.title || 'Без заголовка')}</span>
        <span class="note-time" title="${timeTitle}">${timeLabel}</span>
      </div>
      ${tagsHTML}
      <div class="note-body ${collapsed ? 'collapsed' : ''}">${renderMarkdown(text)}</div>
      ${collapsed ? `<button class="note-expand" data-note-id="${n.id}">${svgIcon('chevron-down', 'sm')} Показать полностью</button>` : ''}
      ${renderAttachmentChips(n.attachments, proj)}
      ${linksHTML}
      <div class="note-footer">
        <button class="btn btn-xs btn-tertiary btn-copy-note" data-note-id="${n.id}" title="Копировать текст">${svgIcon('copy', 'sm')}</button>
        <button class="btn btn-xs btn-tertiary btn-edit-note" data-note-id="${n.id}" title="Редактировать">${svgIcon('edit', 'sm')}</button>
        <button class="btn btn-xs btn-danger btn-delete-note" data-note-id="${n.id}" title="Удалить">${svgIcon('trash', 'sm')}</button>
      </div>
    </div>
  `;
}

// Применяет поиск/сортировку/фильтр тегов к текущему DOM списка заметок
function applyNotesView() {
  const list = document.getElementById('notesList');
  if (!list) return;
  const cards = Array.from(list.querySelectorAll('.note-card'));
  const q = notesView.search.trim().toLowerCase();
  const activeTags = notesView.tags;

  let visible = 0;
  cards.forEach(card => {
    const title = card.dataset.title || '';
    const bodyText = (card.querySelector('.note-body')?.textContent || '').toLowerCase();
    const tags = (card.dataset.tags || '');
    const matchSearch = !q || title.includes(q) || bodyText.includes(q);
    const matchTags = activeTags.every(t => tags.split('|').includes(t));
    if (matchSearch && matchTags) { card.style.display = ''; visible++; }
    else { card.style.display = 'none'; }
  });

  // Сортировка
  const sorted = cards.slice().sort((a, b) => {
    const pa = parseInt(a.dataset.pinned, 10), pb = parseInt(b.dataset.pinned, 10);
    if (pa !== pb) return pb - pa;
    if (notesView.sort === 'title') {
      return (a.dataset.title || '').localeCompare(b.dataset.title || '', 'ru');
    }
    const ca = a.dataset.created || '', cb = b.dataset.created || '';
    return notesView.sort === 'old' ? ca.localeCompare(cb) : cb.localeCompare(ca);
  });
  sorted.forEach(card => list.appendChild(card));

  const noRes = document.getElementById('notesNoResults');
  if (noRes) noRes.style.display = visible ? 'none' : '';
}

function bindNotesView() {
  const search = document.getElementById('notesSearch');
  if (search) {
    search.addEventListener('input', () => { notesView.search = search.value; applyNotesView(); });
  }
  const sort = document.getElementById('notesSort');
  if (sort) {
    sort.addEventListener('change', () => { notesView.sort = sort.value; applyNotesView(); });
  }
  const tagFilter = document.getElementById('notesTagFilter');
  if (tagFilter) {
    tagFilter.addEventListener('click', (e) => {
      const chip = e.target.closest('.tag-chip-filter');
      if (!chip) return;
      const tag = chip.dataset.tag;
      const idx = notesView.tags.indexOf(tag);
      if (idx === -1) notesView.tags.push(tag); else notesView.tags.splice(idx, 1);
      chip.classList.toggle('active');
      applyNotesView();
    });
  }
  applyNotesView();
}

function renderChecklistTab(proj) {
  const items = proj.checklist || [];
  const categories = proj.checklistCategories || [];
  const doneCount = items.filter(i => i.done).length;

  const validFilters = ['all', 'uncat'].concat(categories.map(c => String(c.id)));
  if (!validFilters.includes(checklistView.category)) checklistView.category = 'all';

  const categoryOptions = [
    `<option value="all" ${checklistView.category === 'all' ? 'selected' : ''}>Все категории</option>`,
    ...categories.map(c => `<option value="${c.id}" ${checklistView.category === String(c.id) ? 'selected' : ''}>${escapeHTML(c.name)}</option>`),
    `<option value="uncat" ${checklistView.category === 'uncat' ? 'selected' : ''}>Без категории</option>`
  ].join('');

  const categoryIds = new Set(categories.map(c => String(c.id)));
  let groupsHTML = '';
  categories.forEach(cat => {
    groupsHTML += renderChecklistCategory(cat, items.filter(i => String(i.category_id || '') === String(cat.id)), proj);
  });
  groupsHTML += renderChecklistCategory(null, items.filter(i => !i.category_id || !categoryIds.has(String(i.category_id))), proj);

  const toolbarHTML = items.length || categories.length ? `
    <div class="checklist-toolbar">
      <div class="notes-search-wrap checklist-search-wrap">
        ${svgIcon('search', 'sm')}
        <input class="form-input notes-search" id="checklistSearch" placeholder="Поиск по задачам и подзадачам" value="${escapeHTML(checklistView.search)}">
      </div>
      <select class="form-select notes-sort" id="checklistCategoryFilter">${categoryOptions}</select>
      <label class="checklist-hide-done" title="Скрыть выполненные задачи">
        <input type="checkbox" id="checklistHideDone" ${checklistView.hideDone ? 'checked' : ''}>
        <span>Скрыть выполненные</span>
      </label>
    </div>
  ` : '';

  return `
    <div class="notes-section">
      <div class="section-header">
        <span class="section-title">${svgIcon('check')} Чеклист ${items.length ? `(${doneCount}/${items.length})` : ''}</span>
        <div class="checklist-header-actions">
          <button class="btn btn-sm btn-secondary" id="btnAddChecklistCategory">${svgIcon('folder', 'sm')} Категория</button>
          <button class="btn btn-sm btn-primary" id="btnAddChecklist">${svgIcon('plus', 'sm')} Добавить</button>
        </div>
      </div>
      ${toolbarHTML}
      <div class="checklist-categories" id="checklistCategories" data-total="${items.length}">
        ${groupsHTML}
        <p class="notes-empty checklist-no-results" id="checklistNoResults" style="display:none">Ничего не найдено.</p>
        ${!items.length && !categories.length ? `<div class="checklist-empty-state">
          <p>Чеклист пуст. Создайте категорию или добавьте первую задачу.</p>
        </div>` : ''}
      </div>
    </div>
  `;
}

function renderChecklistCategory(cat, items, proj) {
  const key = cat ? String(cat.id) : 'uncat';
  const collapsed = !!checklistView.collapsed[key];
  const done = items.filter(i => i.done).length;
  const pct = items.length ? Math.round(done / items.length * 100) : 0;
  const color = cat ? (cat.color || 'var(--accent)') : 'var(--text-tertiary)';
  const name = cat ? cat.name : 'Без категории';
  const canManage = !!cat;

  const itemsHTML = items.length
    ? items.map(item => renderChecklistItem(item, proj)).join('')
    : '<p class="checklist-category-empty">В этой категории пока нет задач.</p>';

  return `
    <div class="checklist-category ${collapsed ? 'collapsed' : ''}" data-category-key="${key}" style="--category-color:${color}">
      <div class="checklist-category-head">
        <button class="checklist-category-toggle" type="button" aria-label="Свернуть категорию">
          ${svgIcon('chevron-down', 'sm')}
        </button>
        <span class="checklist-category-dot"></span>
        <span class="checklist-category-name">${escapeHTML(name)}</span>
        <span class="checklist-category-count">${done}/${items.length}</span>
        <span class="checklist-category-progress"><span style="width:${pct}%"></span></span>
        <div class="checklist-category-actions">
          ${canManage ? `
            <button class="delete-checklist-btn btn-add-checklist-in-cat" data-cat-id="${cat.id}" title="Добавить задачу в категорию">${svgIcon('plus', 'sm')}</button>
            <button class="delete-checklist-btn btn-edit-checklist-category" data-cat-id="${cat.id}" title="Редактировать категорию">${svgIcon('edit', 'sm')}</button>
            <button class="delete-checklist-btn btn-delete-checklist-category" data-cat-id="${cat.id}" title="Удалить категорию">${svgIcon('x', 'sm')}</button>
          ` : ''}
        </div>
      </div>
      <div class="checklist-category-body">
        ${itemsHTML}
      </div>
    </div>
  `;
}

function renderChecklistItem(item, proj) {
  const subs = item.subtasks || [];
  const subDone = subs.filter(s => s.done).length;
  const categoryKey = item.category_id ? String(item.category_id) : 'uncat';
  const searchText = [item.text].concat(subs.map(s => s.text)).join(' ').toLowerCase();
  const subsHTML = subs.map(s => `
    <div class="subtask-item ${s.done ? 'checked' : ''}" data-sub-id="${s.id}" data-item-id="${item.id}">
      <input type="checkbox" ${s.done ? 'checked' : ''} tabindex="-1">
      <span>${escapeHTML(s.text)}</span>
      <button class="subtask-btn btn-edit-subtask" data-sub-id="${s.id}" data-item-id="${item.id}" title="Редактировать">${svgIcon('edit', 'sm')}</button>
      <button class="subtask-btn btn-delete-subtask" data-sub-id="${s.id}" data-item-id="${item.id}" title="Удалить">${svgIcon('x', 'sm')}</button>
    </div>
  `).join('');

  return `
    <div class="checklist-group" data-category="${categoryKey}">
      <div class="checklist-item checklist-item-clickable ${item.done ? 'checked' : ''}"
           data-item-id="${item.id}" data-category="${categoryKey}" data-done="${item.done ? 1 : 0}" data-search="${escapeHTML(searchText)}">
        <input type="checkbox" ${item.done ? 'checked' : ''} tabindex="-1">
        <span>${escapeHTML(item.text)}</span>
        <span class="checklist-item-meta">
          ${item.priority ? `<span class="priority-badge priority-${item.priority}">${item.priority.toUpperCase()}</span>` : ''}
          ${subs.length ? `<span class="subtask-count" title="Подзадачи">${subDone}/${subs.length}</span>` : ''}
        </span>
        <button class="delete-checklist-btn btn-add-subtask" data-item-id="${item.id}" title="Добавить подзадачу">${svgIcon('plus', 'sm')}</button>
        <button class="delete-checklist-btn btn-edit-checklist" data-item-id="${item.id}">${svgIcon('edit', 'sm')}</button>
        <button class="delete-checklist-btn btn-delete-checklist" data-item-id="${item.id}">${svgIcon('x', 'sm')}</button>
      </div>
      ${renderAttachmentChips(item.attachments, proj)}
      ${subs.length ? `<div class="subtasks">${subsHTML}</div>` : ''}
    </div>
  `;
}

function applyChecklistView() {
  const container = document.getElementById('checklistCategories');
  if (!container) return;
  const query = checklistView.search.trim().toLowerCase();
  const filter = checklistView.category;
  const total = parseInt(container.dataset.total || '0', 10);
  let visible = 0;
  let shownGroups = 0;

  container.querySelectorAll('.checklist-category').forEach(group => {
    const key = group.dataset.categoryKey;
    const matchCategory = filter === 'all' || filter === key;
    let groupVisible = 0;

    group.querySelectorAll('.checklist-group').forEach(itemGroup => {
      const item = itemGroup.querySelector('.checklist-item');
      if (!item) return;
      const searchText = item.dataset.search || '';
      const isDone = item.dataset.done === '1';
      const show = matchCategory
        && (!query || searchText.includes(query))
        && (!checklistView.hideDone || !isDone);
      itemGroup.style.display = show ? '' : 'none';
      if (show) groupVisible++;
    });

    const showEmptyCategory = matchCategory && !query && !checklistView.hideDone && key !== 'uncat';
    const showGroup = matchCategory && (groupVisible || showEmptyCategory);
    group.style.display = showGroup ? '' : 'none';
    if (showGroup) shownGroups++;
    visible += groupVisible;
  });

  const noResults = document.getElementById('checklistNoResults');
  if (noResults) noResults.style.display = (visible || shownGroups || !total) ? 'none' : '';
}

function bindChecklistView() {
  const search = document.getElementById('checklistSearch');
  if (search) {
    search.addEventListener('input', () => {
      checklistView.search = search.value;
      applyChecklistView();
    });
  }

  const filter = document.getElementById('checklistCategoryFilter');
  if (filter) {
    filter.addEventListener('change', () => {
      checklistView.category = filter.value;
      applyChecklistView();
    });
  }

  const hideDone = document.getElementById('checklistHideDone');
  if (hideDone) {
    hideDone.addEventListener('change', () => {
      checklistView.hideDone = hideDone.checked;
      applyChecklistView();
    });
  }

  document.querySelectorAll('.checklist-category-head').forEach(head => {
    head.addEventListener('click', async (e) => {
      if (e.target.closest('.checklist-category-actions')) return;
      const group = head.closest('.checklist-category');
      if (!group) return;
      const key = group.dataset.categoryKey;
      checklistView.collapsed[key] = !checklistView.collapsed[key];
      group.classList.toggle('collapsed', checklistView.collapsed[key]);
      saveChecklistCollapsed(checklistViewProjectId);
    });
  });

  applyChecklistView();
}

function renderMilestonesTab(proj) {
  const milestones = proj.milestones || [];
  let html = '';
  if (milestones.length) {
    html = milestones.map(m => `
      <div class="version-card" style="display:flex;align-items:center;gap:12px">
        <div class="version-dot" style="background:var(--purple)"></div>
        <div class="version-info" style="flex:1">
          <div class="ver-number">${svgIcon('flag', 'sm')} ${escapeHTML(m.title)}</div>
          ${m.description ? `<div class="ver-desc">${escapeHTML(m.description)}</div>` : ''}
        </div>
        ${m.created_at ? `<div class="ver-date" style="font-size:11px;color:var(--text-tertiary);white-space:nowrap">${formatDate(m.created_at)}</div>` : ''}
        <div class="version-actions">
          <button class="btn btn-xs btn-secondary btn-edit-milestone" data-id="${m.id}" title="Редактировать">${svgIcon('edit', 'sm')}</button>
          <button class="btn btn-xs btn-danger btn-delete-milestone" data-id="${m.id}" title="Удалить">${svgIcon('trash', 'sm')}</button>
        </div>
      </div>
    `).join('');
  } else {
    html = '<p style="color:var(--text-secondary);font-size:13px">Вех пока нет.</p>';
  }

  return `
    <div class="notes-section">
      <div class="section-header">
        <span class="section-title">${svgIcon('flag')} Вехи</span>
        <button class="btn btn-sm btn-primary" id="btnAddMilestone">${svgIcon('plus', 'sm')} Добавить</button>
      </div>
      ${html}
    </div>
  `;
}

function renderVersionsTab(proj) {
  const versions = proj.versions || [];
  let html = '';
  if (versions.length) {
        html = versions.map(v => {
        const parts = (v.number || '0.0.0').split('.');
        const isMajor = parts[1] === '0' && parts[2] === '0';
        const isMinor = parts[2] === '0' && !isMajor;
        const dotClass = isMajor ? 'major' : isMinor ? 'minor' : 'patch';
        const refsHTML = refsChipsHTML(v, proj);
        return `
            <div class="version-card" style="display:flex;align-items:flex-start;gap:12px">
            <div class="version-dot ${dotClass}"></div>
            <div class="version-info" style="flex:1">
                <div class="ver-number">v${v.number}</div>
                ${v.description ? `<div class="ver-desc">${escapeHTML(v.description)}</div>` : ''}
                ${refsHTML}
            </div>
            <div class="ver-date" style="font-size:11px;color:var(--text-tertiary);white-space:nowrap">${formatDate(v.date)}</div>
            <div class="version-actions">
              <button class="btn btn-xs btn-secondary btn-edit-version" data-id="${v.id}" title="Редактировать">${svgIcon('edit', 'sm')}</button>
              <button class="btn btn-xs btn-danger btn-delete-version" data-id="${v.id}" title="Удалить">${svgIcon('trash', 'sm')}</button>
            </div>
            </div>
        `;
        }).join('');
  } else {
    html = '<p style="color:var(--text-secondary);font-size:13px">Версий пока нет.</p>';
  }

  return `
    <div class="notes-section">
      <div class="section-header">
        <span class="section-title">${svgIcon('git-branch')} Версии</span>
        <button class="btn btn-sm btn-primary" id="btnAddVersion">${svgIcon('plus', 'sm')} Новая</button>
      </div>
      ${html}
    </div>
  `;
}

function renderPhotosTab(proj) {
  var photos = proj.photos || [];
  if (!photos.length) {
    return '<div class="notes-section">' +
      '<div class="section-header">' +
        '<span class="section-title">' + svgIcon('image') + ' Фото (0)</span>' +
        '<button class="btn btn-sm btn-primary" id="btnUploadPhotos">' + svgIcon('plus', 'sm') + ' Добавить</button>' +
      '</div>' +
      '<p style="color:var(--text-secondary);font-size:13px">Фотографий пока нет.</p>' +
    '</div>';
  }

  var html = '<div class="notes-section">' +
    '<div class="section-header">' +
      '<span class="section-title">' + svgIcon('image') + ' Фото (' + photos.length + ')</span>' +
      '<button class="btn btn-sm btn-primary" id="btnUploadPhotos">' + svgIcon('plus', 'sm') + ' Добавить</button>' +
    '</div>' +
    '<div class="photo-grid">';

  var unsupported = ['gif', 'svg', 'avif', 'ico', 'tiff', 'tif'];

  for (var i = 0; i < photos.length; i++) {
    var ph = photos[i];
    var ext = (ph.filename.split('.').pop() || '').toLowerCase();
    var full = '/uploads/photos/' + ph.filename;
    var src = unsupported.includes(ext) ? full : '/uploads/photos/thumb_' + ph.filename + '.jpg';
    var fallbackAttr = src === full ? '' : ' data-full-src="' + escapeHTML(full) + '"';
    html += '<div class="photo-card" data-photo-id="' + ph.id + '">' +
      '<img src="' + escapeHTML(src) + '"' + fallbackAttr + ' alt="' + escapeHTML(ph.original_name || 'Фото') + '" loading="lazy" decoding="async">' +
      '<div class="photo-info">' +
        '<span>' + escapeHTML((ph.original_name || '').slice(0, 15)) + '</span>' +
        '<button class="btn btn-xs btn-delete-photo" data-photo-id="' + ph.id + '" style="color:var(--red)">' + svgIcon('trash', 'sm') + '</button>' +
      '</div>' +
    '</div>';
  }

  html += '</div></div>';
  return html;
}

function renderCommentsTab(proj) {
  const comments = proj.comments || [];
  let html = '';
  if (comments.length) {
    html = comments.map(c => `
    <div class="activity-item comment-item" data-comment-id="${c.id}" style="display:flex;align-items:flex-start;gap:10px">
        <div class="activity-icon" style="background:var(--accent-light);color:var(--accent);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0">${svgIcon('message-square', 'sm')}</div>
        <div class="activity-content" style="flex:1;font-size:13px;line-height:1.4"><strong>${escapeHTML(c.author || 'Аноним')}</strong><br>${escapeHTML(c.text)}</div>
        <div class="activity-time" style="margin-left:auto;font-size:10px;color:var(--text-tertiary);white-space:nowrap">${formatDate(c.created_at)}</div>
        <div class="comment-actions">
          <button class="btn btn-xs btn-tertiary btn-edit-comment" data-id="${c.id}" title="Редактировать">${svgIcon('edit', 'sm')}</button>
          <button class="btn btn-xs btn-danger btn-delete-comment" data-id="${c.id}" title="Удалить">${svgIcon('trash', 'sm')}</button>
        </div>
    </div>
    `).join('');
  } else {
    html = '<p style="color:var(--text-secondary);font-size:13px">Комментариев пока нет.</p>';
  }

  return `
    <div class="notes-section">
      <div class="section-header">
        <span class="section-title">${svgIcon('message-square')} Комментарии</span>
        <button class="btn btn-sm btn-primary" id="btnAddComment">${svgIcon('plus', 'sm')} Добавить</button>
      </div>
      ${html}
    </div>
  `;
}

// Иконка, цвета и подпись для каждого типа события в журнале активности
const ACTIVITY_META = {
  created:           { icon: 'plus',           color: 'var(--accent)', light: 'var(--accent-light)', label: 'Проект создан' },
  edited:            { icon: 'edit',           color: 'var(--orange)', light: 'var(--orange-light)', label: 'Проект изменён' },
  folder_set:        { icon: 'folder',         color: 'var(--accent)', light: 'var(--accent-light)', label: 'Выбрана папка' },
  note_add:          { icon: 'note',           color: 'var(--accent)', light: 'var(--accent-light)', label: 'Заметка добавлена' },
  note_edit:         { icon: 'edit',           color: 'var(--accent)', light: 'var(--accent-light)', label: 'Заметка изменена' },
  note_delete:       { icon: 'trash',          color: 'var(--red)',    light: 'var(--red-light)',    label: 'Заметка удалена' },
  version_add:       { icon: 'git-branch',     color: 'var(--purple)', light: 'var(--purple-light)', label: 'Новая версия' },
  checklist_add:     { icon: 'check',          color: 'var(--green)',  light: 'var(--green-light)',  label: 'Задача добавлена' },
  checklist_toggle:  { icon: 'check',          color: 'var(--green)',  light: 'var(--green-light)',  label: 'Задача обновлена' },
  milestone_add:     { icon: 'flag',           color: 'var(--purple)', light: 'var(--purple-light)', label: 'Новая веха' },
  comment_add:       { icon: 'message-square', color: 'var(--accent)', light: 'var(--accent-light)', label: 'Комментарий' },
  comment_edit:      { icon: 'edit',           color: 'var(--accent)', light: 'var(--accent-light)', label: 'Комментарий изменён' },
  comment_delete:    { icon: 'trash',          color: 'var(--red)',    light: 'var(--red-light)',    label: 'Комментарий удалён' },
  photos_add:        { icon: 'image',          color: 'var(--purple)', light: 'var(--purple-light)', label: 'Фото добавлены' },
  photo_delete:      { icon: 'trash',          color: 'var(--red)',    light: 'var(--red-light)',    label: 'Фото удалено' },
  files_add:         { icon: 'upload',         color: 'var(--accent)', light: 'var(--accent-light)', label: 'Файлы добавлены' },
  file_delete:       { icon: 'trash',          color: 'var(--red)',    light: 'var(--red-light)',    label: 'Файл удалён' },
  script_add:        { icon: 'terminal',       color: 'var(--accent)', light: 'var(--accent-light)', label: 'Скрипт добавлен' },
  script_edit:       { icon: 'edit',           color: 'var(--accent)', light: 'var(--accent-light)', label: 'Скрипт изменён' },
  script_delete:     { icon: 'trash',          color: 'var(--red)',    light: 'var(--red-light)',    label: 'Скрипт удалён' },
  script_run:        { icon: 'play',           color: 'var(--green)',  light: 'var(--green-light)',  label: 'Скрипт запущен' },
  script_stop:       { icon: 'stop',           color: 'var(--orange)', light: 'var(--orange-light)', label: 'Скрипт остановлен' },
  script_autostart:  { icon: 'terminal',       color: 'var(--accent)', light: 'var(--accent-light)', label: 'Скрипт запущен автоматически' },
  trashed:           { icon: 'trash',          color: 'var(--red)',    light: 'var(--red-light)',    label: 'В корзину' },
  restored:          { icon: 'undo',           color: 'var(--green)',  light: 'var(--green-light)',  label: 'Восстановлен' },
  deleted_permanent: { icon: 'trash',          color: 'var(--red)',    light: 'var(--red-light)',    label: 'Удалён навсегда' },
  import:            { icon: 'database',       color: 'var(--accent)', light: 'var(--accent-light)', label: 'Импорт данных' }
};

function activityMeta(type) {
  return ACTIVITY_META[type] || { icon: 'activity', color: 'var(--text-secondary)', light: 'var(--surface-3)', label: 'Событие' };
}

function parseActivityDate(iso) {
  if (!iso) return new Date(NaN);
  if (iso.indexOf('T') !== -1 || iso.indexOf('Z') !== -1 || iso.indexOf('+') !== -1) return new Date(iso);
  return new Date(String(iso).replace(' ', 'T') + 'Z');
}

function activityDayKey(iso) {
  const d = parseActivityDate(iso);
  if (isNaN(d.getTime())) return 'zzz';
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}

function activityDayLabel(iso) {
  const d = parseActivityDate(iso);
  if (isNaN(d.getTime())) return 'Ранее';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru', {
    day: 'numeric', month: 'long',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

function activityTime(iso) {
  const d = parseActivityDate(iso);
  if (isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return time;
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' }) + ', ' + time;
}

function renderActivityShell() {
  return '<div class="notes-section">' +
    '<div class="section-header">' +
      '<span class="section-title">' + svgIcon('activity') + ' Лог активности</span>' +
      '<button class="btn btn-sm btn-secondary" id="btnRefreshActivity" title="Обновить">' + svgIcon('refresh', 'sm') + ' Обновить</button>' +
    '</div>' +
    '<div id="activityList" class="activity-list"><p class="activity-empty">Загрузка…</p></div>' +
  '</div>';
}

function bindActivityRefresh(proj) {
  const btn = document.getElementById('btnRefreshActivity');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', function() { loadActivityInto(proj); });
}

async function loadActivityInto(proj) {
  const list = document.getElementById('activityList');
  if (!list) return;
  list.innerHTML = '<p class="activity-empty">Загрузка…</p>';
  let activity = [];
  try {
    const data = await api.getActivity(proj.id);
    activity = data.activity || [];
  } catch (e) { /* */ }
  list.innerHTML = renderActivityList(activity);
}

function renderActivityList(activity) {
  if (!activity.length) {
    return '<div class="activity-empty-state">' +
      '<span class="activity-empty-icon">' + svgIcon('activity', 'lg') + '</span>' +
      '<p>Пока нет записей</p>' +
      '<span class="activity-empty-sub">Здесь появятся действия по проекту</span>' +
    '</div>';
  }

  let html = '';
  let lastKey = null;
  for (let i = 0; i < activity.length; i++) {
    const a = activity[i];
    const key = activityDayKey(a.timestamp);
    if (key !== lastKey) {
      lastKey = key;
      html += '<div class="activity-day">' + escapeHTML(activityDayLabel(a.timestamp)) + '</div>';
    }
    const meta = activityMeta(a.type);
    html += '<div class="activity-item">' +
      '<div class="activity-badge" style="background:' + meta.light + ';color:' + meta.color + '">' + svgIcon(meta.icon, 'sm') + '</div>' +
      '<div class="activity-content">' +
        '<div class="activity-text">' + escapeHTML(a.detail || meta.label) + '</div>' +
        '<div class="activity-time">' + escapeHTML(activityTime(a.timestamp)) + '</div>' +
      '</div>' +
    '</div>';
  }
  return html;
}

function renderFilesTab(proj) {
  var folder = proj.folder_path || '';
  var uploaded = proj.files || [];
  var pinned = parseMindmapFiles(proj.mindmap_files);
  var usage = fileUsageIndex(proj);

  var html = '<div class="notes-section">';

  html += '<div class="section-header">';
  html += '<span class="section-title">' + svgIcon('folder') + ' Файлы проекта</span>';
  html += '<div class="files-actions">';
  html += '<button class="btn btn-sm btn-primary" id="btnPickFolder">' + svgIcon('folder', 'sm') + ' ' + (folder ? 'Сменить папку' : 'Выбрать папку') + '</button>';
  if (folder) {
    html += '<button class="btn btn-sm btn-secondary btn-dropdown" id="btnOpenVscode" title="Открыть в редакторе">' + svgIcon('code', 'sm') + ' Редактор ' + svgIcon('chevron-down', 'sm') + '</button>';
    html += '<button class="btn btn-sm btn-secondary" id="btnOpenExplorer">' + svgIcon('external-link', 'sm') + ' Проводник</button>';
    html += '<button class="btn btn-sm btn-secondary" id="btnRefreshTree" title="Обновить дерево">' + svgIcon('refresh', 'sm') + '</button>';
  }
  html += '</div></div>';

  if (folder) {
    html += '<div class="folder-current">' + svgIcon('folder-open', 'sm') + ' <span class="folder-path">' + escapeHTML(folder) + '</span></div>';
    html += '<div class="files-layout">';
    html += '<div class="file-tree" id="fileTree"><p class="fp-empty">Загрузка…</p></div>';
    html += '<div class="file-preview" id="filePreview"><p class="fp-empty">Выберите файл в дереве</p></div>';
    html += '</div>';
  } else {
    html += '<div class="folder-empty">' + svgIcon('folder', 'lg') +
      '<p>Папка проекта не выбрана</p>' +
      '<p class="fp-sub">Нажмите «Выбрать папку», чтобы подключить её и увидеть дерево файлов.</p>' +
    '</div>';
  }

  html += '<div class="section-subheader">' +
    '<span>' + svgIcon('upload', 'sm') + ' Загруженные файлы (' + uploaded.length + ')</span>' +
    '<button class="btn btn-sm btn-secondary" id="btnUploadFiles">' + svgIcon('plus', 'sm') + ' Загрузить</button>' +
  '</div>';

  if (uploaded.length) {
    for (var i = 0; i < uploaded.length; i++) {
      var f = uploaded[i];
      var uMap = hasUploadFile(pinned, f.id);
      var uNote = !!usage.noteUpload[f.id];
      var uCheck = !!usage.checkUpload[f.id];
      html += '<div class="uploaded-file-row" data-file-id="' + f.id + '"' +
        ' data-usage-map="' + (uMap ? '1' : '') + '" data-usage-note="' + (uNote ? '1' : '') + '" data-usage-check="' + (uCheck ? '1' : '') + '">' +
        '<span>' + svgIcon(f.type === 'image' ? 'image' : 'file', 'sm') + '</span>' +
        '<a href="/uploads/files/' + f.filename + '" target="_blank">' + escapeHTML(f.original_name) + '</a>' +
        '<span class="file-size">' + formatFileSize(f.size) + '</span>' +
        usageBadgesHTML(uMap, uNote, uCheck) +
      '</div>';
    }
  } else {
    html += '<p class="fp-empty" style="padding:4px 0">Загруженных файлов нет.</p>';
  }

  html += '</div>';
  return html;
}

function isImageExt(ext) {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tiff', 'tif', 'svg']
    .indexOf((ext || '').toLowerCase()) !== -1;
}

function renderTreeEntries(entries) {
  if (!entries || !entries.length) {
    return '<p class="fp-empty tree-empty">Пусто</p>';
  }
  return entries.map(function(e) {
    if (e.type === 'dir') {
      var arrow = e.hasChildren ? svgIcon('chevron-right', 'sm') : '';
      return '<div class="tree-node" data-path="' + escapeHTML(e.path) + '">' +
        '<div class="tree-row tree-dir' + (e.hasChildren ? ' has-children' : '') + '" data-type="dir" data-path="' + escapeHTML(e.path) + '">' +
          '<span class="tree-arrow">' + arrow + '</span>' +
          svgIcon('folder', 'sm') + ' <span class="tree-name">' + escapeHTML(e.name) + '</span>' +
        '</div>' +
        '<div class="tree-children" style="display:none"></div>' +
      '</div>';
    }
    return '<div class="tree-row tree-file" data-type="file" data-path="' + escapeHTML(e.path) + '">' +
      '<span class="tree-arrow"></span>' +
      svgIcon(isImageExt(e.ext) ? 'image' : 'file', 'sm') + ' <span class="tree-name">' + escapeHTML(e.name) + '</span>' +
    '</div>';
  }).join('');
}

function bindTreeEvents(projectId) {
  var pinned = parseMindmapFiles((currentProjectData && currentProjectData.mindmap_files) || '[]');
  var usage = fileUsageIndex(currentProjectData || {});
  document.querySelectorAll('#fileTree .tree-row').forEach(function(row) {
    if (row.dataset.type === 'file') {
      setRowUsageBadges(row, {
        map: hasPathFile(pinned, row.dataset.path),
        note: !!usage.notePath[row.dataset.path],
        check: !!usage.checkPath[row.dataset.path]
      });
    }
    if (row.dataset.bound) return;
    row.dataset.bound = '1';
    row.addEventListener('click', function() {
      if (row.dataset.type === 'dir') toggleTreeNode(projectId, row);
      else openFilePreview(projectId, row);
    });
  });
}

async function loadFileTree(projectId, relPath, container) {
  var treeEl = document.getElementById('fileTree');
  if (!treeEl) return;
  var target = container || treeEl;
  if (!container) target.innerHTML = '<p class="fp-empty">Загрузка…</p>';
  try {
    const data = await api.getFileTree(projectId, relPath);
    target.innerHTML = renderTreeEntries(data.entries);
    bindTreeEvents(projectId);
  } catch (err) {
    var msg = (err && err.message === 'folder_missing') ? 'Папка недоступна' : (err.message || 'Ошибка');
    target.innerHTML = '<p class="fp-empty">' + escapeHTML(msg) + '</p>';
  }
}

async function toggleTreeNode(projectId, row) {
  var children = row.nextElementSibling;
  if (!children || !children.classList.contains('tree-children')) return;
  var arrow = row.querySelector('.tree-arrow');
  var isOpen = children.style.display !== 'none';

  if (children.dataset.loaded === '1') {
    children.style.display = isOpen ? 'none' : '';
    row.classList.toggle('expanded', !isOpen);
    if (arrow) arrow.innerHTML = !isOpen ? svgIcon('chevron-down', 'sm') : svgIcon('chevron-right', 'sm');
    return;
  }

  children.style.display = '';
  children.innerHTML = '<p class="fp-empty tree-empty">Загрузка…</p>';
  try {
    const data = await api.getFileTree(projectId, row.dataset.path);
    children.innerHTML = renderTreeEntries(data.entries);
    children.dataset.loaded = '1';
    row.classList.add('expanded');
    if (arrow) arrow.innerHTML = svgIcon('chevron-down', 'sm');
    bindTreeEvents(projectId);
  } catch (err) {
    children.innerHTML = '<p class="fp-empty tree-empty">Ошибка</p>';
  }
}

async function openFilePreview(projectId, row) {
  var panel = document.getElementById('filePreview');
  if (!panel) return;
  document.querySelectorAll('#fileTree .tree-row.active').forEach(function(r) { r.classList.remove('active'); });
  row.classList.add('active');
  var relPath = row.dataset.path;
  var nameEl = row.querySelector('.tree-name');
  var name = nameEl ? nameEl.textContent : relPath;
  panel.innerHTML = '<p class="fp-empty">Загрузка…</p>';
  try {
    const info = await api.readFile(projectId, relPath);
    renderFilePreview(panel, projectId, relPath, name, info);
  } catch (err) {
    panel.innerHTML = '<p class="fp-empty">' + escapeHTML(err.message || 'Ошибка') + '</p>';
  }
}

async function renderFilePreview(panel, projectId, relPath, name, info) {
  var head = '<div class="preview-head">' +
    '<span class="preview-name">' + svgIcon('file', 'sm') + ' ' + escapeHTML(name) + '</span>' +
    '<span class="preview-size">' + formatFileSize(info.size) + '</span>' +
    '<div class="preview-actions">' +
      '<button class="btn btn-xs btn-secondary btn-dropdown" data-act="editor" title="Открыть в редакторе">' + svgIcon('code', 'sm') + ' Редактор ' + svgIcon('chevron-down', 'sm') + '</button>' +
      '<button class="btn btn-xs btn-secondary" data-act="explorer" title="Открыть в проводнике">' + svgIcon('external-link', 'sm') + '</button>' +
    '</div>' +
  '</div>';

  if (info.type === 'text') {
    if (info.tooLarge) {
      panel.innerHTML = head + '<p class="fp-empty">Файл слишком большой для предпросмотра (' + formatFileSize(info.size) + ')</p>';
    } else {
      panel.innerHTML = head + '<pre class="preview-code">' + highlightCode(info.content || '', info.ext) + '</pre>';
    }
  } else if (info.type === 'image') {
    panel.innerHTML = head + '<div class="preview-image"><p class="fp-empty">Загрузка…</p></div>';
    try {
      const blob = await api.readFileRaw(projectId, relPath);
      var wrap = panel.querySelector('.preview-image');
      if (wrap) wrap.innerHTML = '<img src="' + URL.createObjectURL(blob) + '" alt="">';
    } catch (e) {
      panel.innerHTML = head + '<p class="fp-empty">Не удалось загрузить изображение</p>';
    }
  } else {
    panel.innerHTML = head + '<p class="fp-empty">Предпросмотр недоступен для этого типа файла (' +
      escapeHTML(info.ext || '?') + ').<br>Откройте во внешнем приложении.</p>';
  }

  panel.querySelectorAll('[data-act]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      if (btn.dataset.act === 'editor') { showEditorMenu(btn, projectId, relPath); return; }
      try {
        const r = await api.openPath(projectId, relPath, btn.dataset.act);
        showToast(r.message || 'Открыто');
      } catch (err) {
        showToast(err.message || 'Ошибка', true);
      }
    });
  });
}

var _editorsCache = null;
var _editorMenuEl = null;
var _editorMenuCleanup = null;

function closeEditorMenu() {
  if (_editorMenuCleanup) { _editorMenuCleanup(); _editorMenuCleanup = null; }
  if (_editorMenuEl && _editorMenuEl.parentNode) _editorMenuEl.parentNode.removeChild(_editorMenuEl);
  _editorMenuEl = null;
}

async function showEditorMenu(anchor, projectId, relPath) {
  var wasOpen = !!_editorMenuEl;
  closeEditorMenu();
  if (wasOpen) return; // повторный клик по той же кнопке закрывает меню

  var menu = document.createElement('div');
  menu.className = 'editor-menu';
  menu.innerHTML = '<div class="editor-menu-empty">Загрузка…</div>';
  document.body.appendChild(menu);
  _editorMenuEl = menu;

  var rect = anchor.getBoundingClientRect();
  var place = function() {
    var margin = 8;
    var w = menu.offsetWidth || 200;
    var h = menu.offsetHeight || 0;
    // если справа не хватает места — выравниваем меню по правому краю кнопки
    var left = (rect.left + w > window.innerWidth - margin) ? (rect.right - w) : rect.left;
    left = Math.max(margin, Math.min(left, Math.max(margin, window.innerWidth - w - margin)));
    var top = rect.bottom + 6;
    if (top + h > window.innerHeight - margin) top = Math.max(margin, rect.top - h - 6);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  };

  var onDocClick = function(e) {
    if (_editorMenuEl && !_editorMenuEl.contains(e.target) && e.target !== anchor) closeEditorMenu();
  };
  var onKey = function(e) { if (e.key === 'Escape') closeEditorMenu(); };
  var onClose = function() { closeEditorMenu(); };
  var timer = setTimeout(function() {
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
  }, 0);
  _editorMenuCleanup = function() {
    clearTimeout(timer);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onClose);
    window.removeEventListener('scroll', onClose, true);
  };

  try {
    var data = _editorsCache || (await api.getEditors());
    _editorsCache = data;
    if (!_editorMenuEl) return;
    var renderList = function(editors) {
      if (!editors.length) {
        menu.innerHTML = '<div class="editor-menu-empty">Редакторы не найдены</div>';
        return;
      }
      menu.innerHTML = editors.map(function(ed) {
        return '<button type="button" class="editor-menu-item" data-cmd="' + escapeHTML(ed.cmd) + '">' +
          svgIcon('code', 'sm') + '<span class="editor-menu-name">' + escapeHTML(ed.name) + '</span>' +
        '</button>';
      }).join('') +
        '<div class="editor-menu-sep"></div>' +
        '<button type="button" class="editor-menu-item editor-menu-refresh">' +
          svgIcon('refresh', 'sm') + '<span class="editor-menu-name">Обновить список</span>' +
        '</button>';
      menu.querySelectorAll('.editor-menu-item[data-cmd]').forEach(function(item) {
        item.addEventListener('click', async function() {
          closeEditorMenu();
          try {
            var r = await api.openPath(projectId, relPath || '', 'editor', item.dataset.cmd);
            showToast(r.message || 'Открыто');
          } catch (err) { showToast(err.message || 'Ошибка', true); }
        });
      });
      var rf = menu.querySelector('.editor-menu-refresh');
      if (rf) rf.addEventListener('click', async function() {
        _editorsCache = null;
        menu.innerHTML = '<div class="editor-menu-empty">Поиск редакторов…</div>';
        try {
          var d = await api.getEditors(true);
          _editorsCache = d;
          if (_editorMenuEl === menu) { renderList((d && d.editors) || []); place(); }
        } catch (e) {
          if (_editorMenuEl === menu) menu.innerHTML = '<div class="editor-menu-empty">Ошибка</div>';
        }
      });
    };

    var editors = (data && data.editors) || [];
    renderList(editors);
  } catch (err) {
    if (_editorMenuEl) menu.innerHTML = '<div class="editor-menu-empty">Не удалось получить список редакторов</div>';
  }

  place();
}

function showFilesContextMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  var old = document.querySelector('.context-menu');
  if (old) old.remove();
  var menu = document.createElement('div');
  menu.className = 'context-menu';
  items.forEach(function(it) {
    if (it.separator) {
      var s = document.createElement('div');
      s.className = 'context-menu-separator';
      menu.appendChild(s);
      return;
    }
    var el = document.createElement('div');
    el.className = 'context-menu-item' + (it.danger ? ' danger' : '');
    el.innerHTML = (it.icon ? svgIcon(it.icon, 'sm') + ' ' : '') + escapeHTML(it.label);
    el.addEventListener('click', function(ev) {
      ev.stopPropagation();
      menu.remove();
      it.action();
    });
    menu.appendChild(el);
  });
  menu.style.left = Math.min(e.clientX, window.innerWidth - 240) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - items.length * 40 - 20) + 'px';
  document.body.appendChild(menu);
  setTimeout(function() {
    function close() {
      menu.remove();
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
  }, 0);
}

// Индекс использования файлов в заметках и задачах чеклиста
function fileUsageIndex(proj) {
  var acc = { noteUpload: {}, notePath: {}, checkUpload: {}, checkPath: {} };
  function scan(list, tag) {
    (list || []).forEach(function(item) {
      parseAttachments(item && item.attachments).forEach(function(a) {
        if (a.kind === 'upload') acc[tag + 'Upload'][a.id] = true;
        else if (a.kind === 'path') acc[tag + 'Path'][a.path] = true;
      });
    });
  }
  scan(proj.notes, 'note');
  scan(proj.checklist, 'check');
  return acc;
}

function usageBadgesHTML(map, note, check) {
  var h = '';
  if (map) h += '<span class="usage-badge usage-map" title="Есть на Mind Map">' + svgIcon('mindmap', 'sm') + '</span>';
  if (note) h += '<span class="usage-badge usage-note" title="Упоминается в заметке">' + svgIcon('note', 'sm') + '</span>';
  if (check) h += '<span class="usage-badge usage-check" title="Упоминается в задаче">' + svgIcon('check', 'sm') + '</span>';
  return h ? '<span class="file-badges">' + h + '</span>' : '';
}

function applyRowUsageBadges(row) {
  var existing = row.querySelector('.file-badges');
  if (existing) existing.remove();
  var html = usageBadgesHTML(
    row.dataset.usageMap === '1',
    row.dataset.usageNote === '1',
    row.dataset.usageCheck === '1'
  );
  if (html) row.insertAdjacentHTML('beforeend', html);
}

function setRowUsageBadges(row, u) {
  row.dataset.usageMap = u.map ? '1' : '';
  row.dataset.usageNote = u.note ? '1' : '';
  row.dataset.usageCheck = u.check ? '1' : '';
  applyRowUsageBadges(row);
}

function setRowMapBadge(row, on) {
  row.dataset.usageMap = on ? '1' : '';
  applyRowUsageBadges(row);
}

async function openFilePathPreview(projectId, relPath) {
  var panel = document.getElementById('filePreview');
  if (!panel) return;
  document.querySelectorAll('#fileTree .tree-row.active').forEach(function(r) { r.classList.remove('active'); });
  document.querySelectorAll('#fileTree .tree-row').forEach(function(r) {
    if (r.dataset.path === relPath && r.dataset.type === 'file') {
      r.classList.add('active');
      if (r.scrollIntoView) r.scrollIntoView({ block: 'nearest' });
    }
  });
  var name = relPath.split('/').pop() || relPath;
  panel.innerHTML = '<p class="fp-empty">Загрузка…</p>';
  try {
    const info = await api.readFile(projectId, relPath);
    renderFilePreview(panel, projectId, relPath, name, info);
  } catch (err) {
    panel.innerHTML = '<p class="fp-empty">' + escapeHTML(err.message || 'Ошибка') + '</p>';
  }
}

function findTreeRow(container, path, type) {
  var rows = container.querySelectorAll('.tree-row');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].dataset.path === path && rows[i].dataset.type === type) return rows[i];
  }
  return null;
}

async function expandTreeNode(projectId, row) {
  var children = row.nextElementSibling;
  if (!children || !children.classList.contains('tree-children')) return;
  var arrow = row.querySelector('.tree-arrow');
  if (children.dataset.loaded !== '1') {
    children.style.display = '';
    children.innerHTML = '<p class="fp-empty tree-empty">Загрузка…</p>';
    try {
      const data = await api.getFileTree(projectId, row.dataset.path);
      children.innerHTML = renderTreeEntries(data.entries);
      children.dataset.loaded = '1';
      bindTreeEvents(projectId);
    } catch (err) {
      children.innerHTML = '<p class="fp-empty tree-empty">Ошибка</p>';
      return;
    }
  } else {
    children.style.display = '';
  }
  row.classList.add('expanded');
  if (arrow) arrow.innerHTML = svgIcon('chevron-down', 'sm');
}

// Разворачивает папки по пути и открывает файл в просмотре
async function revealAndPreview(projectId, relPath) {
  var treeEl = document.getElementById('fileTree');
  if (!treeEl) return;
  var segs = relPath.split('/').filter(Boolean);
  if (!segs.length) return;

  var container = treeEl;
  var prefix = '';
  for (var i = 0; i < segs.length - 1; i++) {
    prefix = prefix ? prefix + '/' + segs[i] : segs[i];
    var dirRow = findTreeRow(container, prefix, 'dir');
    if (!dirRow) return openFilePathPreview(projectId, relPath);
    var children = dirRow.nextElementSibling;
    var isOpen = children && children.classList.contains('tree-children') && children.style.display !== 'none';
    if (!isOpen) await expandTreeNode(projectId, dirRow);
    container = dirRow.nextElementSibling;
    if (!container) return openFilePathPreview(projectId, relPath);
  }

  await openFilePathPreview(projectId, relPath);
}

async function toggleMapFile(proj, entry) {
  var list = parseMindmapFiles(proj.mindmap_files);
  var added = entry.kind === 'upload' ? toggleUploadFile(list, entry.id) : togglePathFile(list, entry.path);
  try {
    await api.updateProject(proj.id, { mindmap_files: JSON.stringify(list) });
    proj.mindmap_files = JSON.stringify(list);

    // Обновляем индикатор «на карте» в списке/дереве
    if (entry.kind === 'upload') {
      var urow = document.querySelector('.uploaded-file-row[data-file-id="' + entry.id + '"]');
      if (urow) setRowMapBadge(urow, added);
    } else {
      document.querySelectorAll('#fileTree .tree-row[data-type="file"]').forEach(function(r) {
        if (r.dataset.path === entry.path) setRowMapBadge(r, added);
      });
    }

    showToast(added ? 'Файл добавлен на карту' : 'Файл убран с карты');
  } catch (err) {
    showToast('Ошибка', true);
  }
}

async function deleteUploadedFile(proj, fileId, name) {
  const { openModal } = await import('./modal.js');
  var body = '<p>Удалить файл <strong>' + escapeHTML(name) + '</strong>?</p>' +
    '<div class="form-row">' +
      '<button class="btn btn-secondary modal-close-x">Отмена</button>' +
      '<button class="btn btn-danger" id="modalSaveBtn">Удалить</button>' +
    '</div>';
  openModal('Удаление файла', body, async function() {
    try {
      await api.deleteFile(proj.id, fileId);
      await refreshDetail();
      showToast('Файл удалён');
    } catch (err) {
      showToast('Ошибка', true);
    }
    return true;
  });
}

function bindAttachmentChips() {
  document.querySelectorAll('.attach-chip').forEach(chip => {
    chip.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (chip.dataset.kind === 'upload') {
        if (chip.dataset.url) window.open(chip.dataset.url, '_blank');
      } else if (chip.dataset.kind === 'path') {
        var p = chip.dataset.path || '';
        openAttachmentPreview(store.currentProjectId, p, p.split('/').pop());
      }
    });
  });
}

function openAttachmentPreview(projectId, relPath, name) {
  var existing = document.getElementById('attachPreviewOverlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.className = 'attach-preview-overlay';
  overlay.id = 'attachPreviewOverlay';
  overlay.innerHTML =
    '<div class="attach-preview-card">' +
      '<div class="attach-preview-bar">' +
        '<span class="attach-preview-title">' + svgIcon('file', 'sm') + ' ' + escapeHTML(name || relPath) + '</span>' +
        '<button type="button" class="btn btn-icon attach-preview-close">' + svgIcon('x', 'sm') + '</button>' +
      '</div>' +
      '<div class="file-preview attach-preview-body"><p class="fp-empty">Загрузка…</p></div>' +
    '</div>';
  document.body.appendChild(overlay);

  var onKey = function(e) { if (e.key === 'Escape') close(); };
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
  overlay.querySelector('.attach-preview-close').addEventListener('click', close);

  var panel = overlay.querySelector('.attach-preview-body');
  api.readFile(projectId, relPath)
    .then(function(info) { renderFilePreview(panel, projectId, relPath, name || relPath, info); })
    .catch(function(err) { panel.innerHTML = '<p class="fp-empty">' + escapeHTML(err.message || 'Ошибка') + '</p>'; });
}

function bindFilesTab(proj) {
  var pick = document.getElementById('btnPickFolder');
  if (pick) pick.addEventListener('click', async () => {
    const { openFolderPicker } = await import('./folder-picker.js');
    openFolderPicker(proj.id, proj.folder_path || '', async () => { await refreshDetail(); });
  });

  var openVs = document.getElementById('btnOpenVscode');
  if (openVs) openVs.addEventListener('click', function() { showEditorMenu(openVs, proj.id, ''); });

  var openExplorer = document.getElementById('btnOpenExplorer');
  if (openExplorer) openExplorer.addEventListener('click', async () => {
    try { const r = await api.openPath(proj.id, '', 'explorer'); showToast(r.message || 'Открыто'); }
    catch (err) { showToast(err.message || 'Ошибка', true); }
  });

  var refresh = document.getElementById('btnRefreshTree');
  if (refresh) refresh.addEventListener('click', function() { loadFileTree(proj.id, ''); });

  // ПКМ по загруженным файлам
  document.querySelectorAll('.uploaded-file-row').forEach(function(row) {
    row.addEventListener('contextmenu', function(e) {
      var fileId = parseInt(row.dataset.fileId);
      var file = (proj.files || []).filter(function(x) { return x.id === fileId; })[0];
      if (!file) return;
      var onMap = hasUploadFile(parseMindmapFiles(proj.mindmap_files), fileId);
      showFilesContextMenu(e, [
        { label: onMap ? 'Убрать с карты' : 'Добавить на карту', icon: 'mindmap',
          action: function() { toggleMapFile(proj, { kind: 'upload', id: fileId }); } },
        { label: 'Открыть в новой вкладке', icon: 'external-link',
          action: function() { window.open('/uploads/files/' + file.filename, '_blank'); } },
        { separator: true },
        { label: 'Удалить', icon: 'trash', danger: true,
          action: function() { deleteUploadedFile(proj, fileId, file.original_name); } }
      ]);
    });
  });

  // ПКМ по файлам из папки проекта
  var treeEl = document.getElementById('fileTree');
  if (treeEl && !treeEl.dataset.ctxBound) {
    treeEl.dataset.ctxBound = '1';
    treeEl.addEventListener('contextmenu', function(e) {
      var row = e.target.closest && e.target.closest('.tree-row');
      if (!row || row.dataset.type !== 'file') return;
      var path = row.dataset.path;
      var nameEl = row.querySelector('.tree-name');
      var name = nameEl ? nameEl.textContent : path;
      var onMap = hasPathFile(parseMindmapFiles(proj.mindmap_files), path);
      showFilesContextMenu(e, [
        { label: onMap ? 'Убрать с карты' : 'Добавить на карту', icon: 'mindmap',
          action: function() { toggleMapFile(proj, { kind: 'path', path: path }); } },
        { label: 'Открыть', icon: 'external-link',
          action: function() { openFilePreview(proj.id, row); } }
      ]);
    });
  }

  // Открыть файл из Mind Map во вкладке «Файлы»
  if (proj.folder_path) {
    var treePromise = loadFileTree(proj.id, '');
    if (store.pendingFilePreview) {
      var pendingPath = store.pendingFilePreview;
      store.pendingFilePreview = null;
      treePromise.then(function() { revealAndPreview(proj.id, pendingPath); });
    }
  } else if (store.pendingFilePreview) {
    store.pendingFilePreview = null;
  }
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}