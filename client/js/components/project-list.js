import store from '../store.js';
import CONFIG from '../config.js';
import api from '../api.js';
import { svgIcon, escapeHTML, formatDate, formatDateShort, showToast, projectAvatar } from '../utils/dom.js';
import { highlightText } from '../utils/format.js';

var searchTimer = null;

export function renderProjectList() {
  var projects = getFilteredProjects();
  var allTags = getAllTags();

  if (projects.length === 0 && !store.searchQuery && !store.filterTag && !store.filterFavorite && !store.filterStatus && !store.filterPriority && !store.showTrash) {
    var emptyHTML = renderEmptyState();
    setTimeout(function() { bindListEvents(); }, 0);
    return emptyHTML;
  }

  var html = '';

  if (store.showTrash) {
    html += '<button class="detail-back" id="btnExitTrash">' + svgIcon('chevron-left', 'sm') + ' К проектам</button>';
    html += '<div class="trash-head">';
    html += '<span class="trash-head-icon">' + svgIcon('trash') + '</span>';
    html += '<div>';
    html += '<h2 class="trash-head-title">Корзина</h2>';
    html += '<p class="trash-head-sub">Удалённые проекты</p>';
    html += '</div>';
    html += '</div>';
  }

  if (store.selectionMode) {
    html += renderSelectionBar();
  } else {
    html += '<div class="toolbar">';
    html += '<div class="toolbar-left">';
    html += '<div class="search-wrapper">';
    html += '<span class="search-icon">' + svgIcon('search', 'sm') + '</span>';
    html += '<input class="search-input" type="text" placeholder="Поиск проектов..." value="' + escapeHTML(store.searchQuery) + '" id="searchInput">';
    if (store.searchQuery) {
      html += '<button type="button" class="search-clear visible" id="searchClear">' + svgIcon('x', 'sm') + '</button>';
    }
    html += '</div>';
    html += '<button class="sort-btn" id="sortBtn">' + svgIcon('chevron-down', 'sm') + ' ' + getSortLabel() + '</button>';
    html += '<button class="view-btn ' + (store.filterFavorite ? 'active' : '') + '" id="favoriteFilterBtn">' + svgIcon(store.filterFavorite ? 'star-filled' : 'star', 'sm') + ' Избранное</button>';
    if (store.filterStatus) {
      html += '<button class="view-btn active" id="clearStatusFilter" title="Убрать фильтр статуса">' + (CONFIG.STATUS_LABELS[store.filterStatus] || store.filterStatus) + ' ' + svgIcon('x', 'sm') + '</button>';
    }
    if (store.filterPriority) {
      html += '<button class="view-btn active" id="clearPriorityFilter" title="Убрать фильтр приоритета">' + store.filterPriority.toUpperCase() + ' ' + svgIcon('x', 'sm') + '</button>';
    }
    html += '</div>';
    html += '<div class="toolbar-right">';
    html += '<span id="projectsCount" style="font-size:12px;color:var(--text-tertiary)">' + projects.length + ' проектов</span>';
    html += '<button class="btn-icon" id="btnSaveFile" title="ЛКМ — сохранить | ПКМ — загрузить">' + svgIcon('save') + '</button>';
    if (store.hasPin) {
      html += '<button class="btn-icon" id="btnLockNow" title="Заблокировать приложение">' + svgIcon('lock') + '</button>';
    }
    html += '</div>';
    html += '</div>';
  }

  if (!store.showTrash && !store.selectionMode && allTags.length > 0) {
    html += '<div class="tags-bar">';
    html += '<span class="tags-bar-label">Теги:</span>';
    for (var i = 0; i < allTags.length; i++) {
      var t = allTags[i];
      var activeClass = store.filterTag === t ? ' active' : '';
      var count = 0;
      for (var j = 0; j < store.projects.length; j++) {
        if (!store.projects[j].deleted_at && (store.projects[j].tags || []).indexOf(t) !== -1) count++;
      }
      html += '<span class="tag-chip' + activeClass + '" data-tag="' + escapeHTML(t) + '">' + escapeHTML(t) + '<span class="tag-count">' + count + '</span></span>';
    }
    if (store.filterTag) {
      html += '<span class="tag-chip" style="border-color:var(--red);color:var(--red)" id="clearTagFilter">✕ Сбросить</span>';
    }
    html += '</div>';
  }

  html += '<div id="projectsResults">' + renderResults(projects) + '</div>';

  setTimeout(function() { bindListEvents(); }, 0);

  return html;
}

function renderResults(projects) {
  var html = '';
  if (projects.length === 0) {
    html += '<div class="empty-state">';
    if (store.showTrash) {
      html += '<p class="empty-state-text empty-state-text-lg">Корзина пуста</p>';
    } else {
      html += '<p class="empty-state-text">Ничего не найдено</p>';
      html += '<button class="btn btn-sm btn-secondary" id="clearAllFilters">Сбросить фильтры</button>';
    }
    html += '</div>';
  } else {
    html += '<div class="projects-grid">';
    for (var k = 0; k < projects.length; k++) {
      html += renderProjectCard(projects[k]);
    }
    html += '</div>';
  }
  return html;
}

function applySearch() {
  var projects = getFilteredProjects();
  var results = document.getElementById('projectsResults');
  if (results) {
    results.innerHTML = renderResults(projects);
    bindResultEvents();
  }
  var count = document.getElementById('projectsCount');
  if (count) count.textContent = projects.length + ' проектов';
  var clear = document.getElementById('searchClear');
  if (store.searchQuery && !clear) {
    var wrap = document.querySelector('.search-wrapper');
    if (wrap) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-clear visible';
      btn.id = 'searchClear';
      btn.innerHTML = svgIcon('x', 'sm');
      wrap.appendChild(btn);
    }
  } else if (!store.searchQuery && clear) {
    clear.remove();
  }
}

function onSearchClear() {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  store.searchQuery = '';
  var input = document.getElementById('searchInput');
  if (input) {
    input.value = '';
    input.focus();
  }
  applySearch();
}

function renderSelectionBar() {
  var count = store.selectedIds.length;
  var list = store.showTrash ? store.trashProjects : getFilteredProjects();
  var total = list.length;
  var allSelected = total > 0 && count === total;
  var disabled = count === 0 ? ' disabled' : '';

  var html = '';
  html += '<div class="selection-bar">';
  html += '<div class="selection-info">';
  html += '<span class="selection-badge">' + count + '</span> <span>выбрано</span>';
  html += '</div>';
  html += '<div class="selection-actions">';
  html += '<button class="btn btn-sm btn-secondary" id="selectAllBtn">' + (allSelected ? 'Снять выделение' : 'Выделить все') + '</button>';

  if (store.showTrash) {
    html += '<button class="btn btn-sm btn-secondary" id="bulkRestoreBtn"' + disabled + '>' + svgIcon('undo', 'sm') + ' Восстановить</button>';
    html += '<button class="btn btn-sm btn-danger" id="bulkDeleteBtn"' + disabled + '>' + svgIcon('trash', 'sm') + ' Удалить навсегда</button>';
  } else {
    html += '<select class="form-select selection-status" id="bulkStatus"' + disabled + '>';
    html += '<option value="">Сменить статус…</option>';
    html += '<option value="active">В работе</option>';
    html += '<option value="paused">На паузе</option>';
    html += '<option value="done">Завершён</option>';
    html += '<option value="archive">Архив</option>';
    html += '</select>';
    html += '<button class="btn btn-sm btn-danger" id="bulkTrashBtn"' + disabled + '>' + svgIcon('trash', 'sm') + ' В корзину</button>';
  }

  html += '<button class="btn btn-sm btn-tertiary" id="cancelSelection">Отмена</button>';
  html += '</div></div>';
  return html;
}

function renderNow() {
  import('../app.js').then(function(m) { m.render(); });
}

function toggleSelected(id) {
  var i = store.selectedIds.indexOf(id);
  if (i === -1) store.selectedIds.push(id);
  else store.selectedIds.splice(i, 1);
  if (store.selectedIds.length === 0) {
    exitSelection();
    return;
  }
  renderNow();
}

function exitSelection() {
  store.selectionMode = false;
  store.selectedIds = [];
  renderNow();
}

function toggleSelectAll() {
  var list = store.showTrash ? store.trashProjects : getFilteredProjects();
  var ids = list.map(function(p) { return p.id; });
  var allSelected = ids.length > 0 && ids.every(function(id) { return store.selectedIds.indexOf(id) !== -1; });
  if (allSelected) {
    exitSelection();
    return;
  }
  store.selectedIds = ids;
  renderNow();
}

async function reloadList(keepTrash) {
  var app = await import('../app.js');
  await app.loadProjects();
  store.showTrash = !!keepTrash;
  store.selectionMode = false;
  store.selectedIds = [];
  app.render();
}

async function bulkChangeStatus(status) {
  var ids = store.selectedIds.slice();
  if (!ids.length) return;
  try {
    for (var i = 0; i < ids.length; i++) {
      await api.updateProject(ids[i], { status: status });
    }
    await reloadList(false);
    showToast('Статус изменён: ' + ids.length);
  } catch (err) {
    showToast('Ошибка', true);
  }
}

async function bulkMoveToTrash() {
  var ids = store.selectedIds.slice();
  if (!ids.length) return;
  var { requirePassword } = await import('../security.js');
  if (!(await requirePassword('Подтвердите перемещение проектов в корзину.'))) return;
  var body = '<p>Переместить в корзину <strong>' + ids.length + '</strong> проект(ов)?</p>' +
    '<div class="form-row">' +
    '<button class="btn btn-secondary modal-close-x">Отмена</button>' +
    '<button class="btn btn-danger" id="modalSaveBtn">В корзину</button>' +
    '</div>';
  import('./modal.js').then(function(m) {
    m.openModal('Удаление проектов', body, async function() {
      try {
        for (var i = 0; i < ids.length; i++) {
          await api.deleteProject(ids[i]);
        }
        await reloadList(false);
        showToast('Перемещено в корзину: ' + ids.length);
      } catch (err) {
        showToast('Ошибка', true);
      }
      return true;
    });
  });
}

async function bulkRestore() {
  var ids = store.selectedIds.slice();
  if (!ids.length) return;
  try {
    for (var i = 0; i < ids.length; i++) {
      await api.deleteProject(ids[i]);
    }
    await reloadList(true);
    showToast('Восстановлено: ' + ids.length);
  } catch (err) {
    showToast('Ошибка', true);
  }
}

async function bulkPermanentDelete() {
  var ids = store.selectedIds.slice();
  if (!ids.length) return;
  var { requirePassword } = await import('../security.js');
  if (!(await requirePassword('Подтвердите безвозвратное удаление проектов.'))) return;
  var body = '<p>Удалить навсегда <strong>' + ids.length + '</strong> проект(ов)?</p>' +
    '<p style="font-size:12px;color:var(--text-secondary)">Это действие нельзя отменить.</p>' +
    '<div class="form-row">' +
    '<button class="btn btn-secondary modal-close-x">Отмена</button>' +
    '<button class="btn btn-danger" id="modalSaveBtn">Удалить навсегда</button>' +
    '</div>';
  import('./modal.js').then(function(m) {
    m.openModal('Удалить навсегда', body, async function() {
      try {
        for (var i = 0; i < ids.length; i++) {
          await api.deleteProject(ids[i], true);
        }
        await reloadList(true);
        showToast('Удалено: ' + ids.length);
      } catch (err) {
        showToast('Ошибка', true);
      }
      return true;
    });
  });
}

function bindSelectionEvents() {
  var selectAllBtn = document.getElementById('selectAllBtn');
  if (selectAllBtn) selectAllBtn.addEventListener('click', toggleSelectAll);

  var cancel = document.getElementById('cancelSelection');
  if (cancel) cancel.addEventListener('click', exitSelection);

  var bulkStatus = document.getElementById('bulkStatus');
  if (bulkStatus) bulkStatus.addEventListener('change', function() {
    if (bulkStatus.value) bulkChangeStatus(bulkStatus.value);
  });

  var bulkTrashBtn = document.getElementById('bulkTrashBtn');
  if (bulkTrashBtn) bulkTrashBtn.addEventListener('click', bulkMoveToTrash);

  var bulkRestoreBtn = document.getElementById('bulkRestoreBtn');
  if (bulkRestoreBtn) bulkRestoreBtn.addEventListener('click', bulkRestore);

  var bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
  if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', bulkPermanentDelete);
}

function bindSaveButton() {
  var saveBtn = document.getElementById('btnSaveFile');
  if (saveBtn) {
    saveBtn.addEventListener('click', function(e) {
      e.preventDefault();
      import('../utils/data-io.js').then(function(m) { m.saveProjectsToFile(); });
    });
    saveBtn.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      import('../utils/data-io.js').then(function(m) { m.importProjectsFromFile(); });
    });
  }

  var lockBtn = document.getElementById('btnLockNow');
  if (lockBtn) {
    lockBtn.addEventListener('click', function(e) {
      e.preventDefault();
      import('../security.js').then(function(m) { m.lockNow(); });
    });
  }
}

function bindListEvents() {
  if (store.selectionMode) bindSelectionEvents();
  bindSaveButton();
  var searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', function(e) {
      store.searchQuery = e.target.value;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function() {
        searchTimer = null;
        applySearch();
      }, 120);
    });
  }
  var searchWrap = document.querySelector('.search-wrapper');
  if (searchWrap) {
    searchWrap.addEventListener('mousedown', function(e) {
      if (e.target.closest && e.target.closest('.search-clear')) e.preventDefault();
    });
    searchWrap.addEventListener('click', function(e) {
      if (e.target.closest && e.target.closest('.search-clear')) onSearchClear();
    });
  }

  var sortBtn = document.getElementById('sortBtn');
  if (sortBtn) {
    sortBtn.addEventListener('click', function() {
      var orders = ['newest', 'oldest', 'name', 'deadline'];
      var idx = orders.indexOf(store.sortOrder);
      store.sortOrder = orders[(idx + 1) % orders.length];
      import('../app.js').then(function(m) { m.render(); });
    });
  }

  var favBtn = document.getElementById('favoriteFilterBtn');
  if (favBtn) {
    favBtn.addEventListener('click', function() {
      store.filterFavorite = !store.filterFavorite;
      import('../app.js').then(function(m) { m.render(); });
    });
  }

  var clearStatus = document.getElementById('clearStatusFilter');
  if (clearStatus) {
    clearStatus.addEventListener('click', function() {
      store.filterStatus = '';
      import('../app.js').then(function(m) { m.render(); });
    });
  }

  var clearPriority = document.getElementById('clearPriorityFilter');
  if (clearPriority) {
    clearPriority.addEventListener('click', function() {
      store.filterPriority = '';
      import('../app.js').then(function(m) { m.render(); });
    });
  }

  var tagChips = document.querySelectorAll('.tag-chip[data-tag]');
  for (var i = 0; i < tagChips.length; i++) {
    (function(chip) {
      chip.addEventListener('click', function() {
        var tag = chip.dataset.tag;
        store.filterTag = store.filterTag === tag ? '' : tag;
        import('../app.js').then(function(m) { m.render(); });
      });
    })(tagChips[i]);
  }

  var clearTag = document.getElementById('clearTagFilter');
  if (clearTag) {
    clearTag.addEventListener('click', function() {
      store.filterTag = '';
      import('../app.js').then(function(m) { m.render(); });
    });
  }

  var btnExitTrash = document.getElementById('btnExitTrash');
  if (btnExitTrash) {
    btnExitTrash.addEventListener('click', function() {
      store.showTrash = false;
      store.searchQuery = '';
      store.selectionMode = false;
      store.selectedIds = [];
      import('../app.js').then(function(m) { m.render(); });
    });
  }

  bindResultEvents();
}

function bindResultEvents() {
  var clearAll = document.getElementById('clearAllFilters');
  if (clearAll) {
    clearAll.addEventListener('click', function() {
      store.filterTag = '';
      store.filterFavorite = false;
      store.filterStatus = '';
      store.filterPriority = '';
      store.searchQuery = '';
      import('../app.js').then(function(m) { m.render(); });
    });
  }

  var cards = document.querySelectorAll('.project-card');
  for (var j = 0; j < cards.length; j++) {
    (function(card) {
      card.addEventListener('click', function() {
        var id = card.dataset.id;
        if (!id) return;
        if (store.selectionMode) {
          toggleSelected(id);
          return;
        }
        if (!store.showTrash) {
          store.currentProjectId = id;
          store.currentView = 'detail';
          store.currentDetailTab = 'notes';
          import('../app.js').then(function(m) { m.render(); });
        }
      });

      card.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var id = card.dataset.id;
        if (id) {
          import('./context-menu.js').then(function(m) { m.showContextMenu(e, id); });
        }
        return false;
      });
    })(cards[j]);
  }

  var templates = document.querySelectorAll('.template-card');
  for (var k = 0; k < templates.length; k++) {
    (function(card) {
      card.addEventListener('click', function() {
        var name = card.dataset.name;
        var description = card.dataset.desc;
        var tags = card.dataset.tags;
        var status = card.dataset.status;
        if (name) {
          import('../api.js').then(function(apiModule) {
            apiModule.default.createProject({
              name: name,
              description: description,
              tags: tags ? tags.split(',').map(function(t) { return t.trim(); }) : [],
              status: status
            }).then(function() {
              import('../app.js').then(function(m) {
                m.loadProjects().then(function() { m.render(); });
              });
              showToast('Проект создан из шаблона');
            }).catch(function(err) {
              console.error(err);
            });
          });
        }
      });
    })(templates[k]);
  }

  var emptyBtn = document.getElementById('emptyCreateBtn');
  if (emptyBtn) {
    emptyBtn.addEventListener('click', function() {
      import('./modal.js').then(function(modal) {
        import('../app.js').then(function(app) {
          modal.openCreateProjectModal(function() {
            app.loadProjects().then(function() { app.render(); });
          });
        });
      });
    });
  }
}

export function renderProjectCard(proj) {
  var logoHTML = projectAvatar(proj);

  var checklistDone = 0;
  var checklistTotal = 0;
  if (proj.checklist) {
    checklistTotal = proj.checklist.length;
    for (var i = 0; i < proj.checklist.length; i++) {
      if (proj.checklist[i].done) checklistDone++;
    }
  }

  var over = proj.deadline && new Date(proj.deadline) < new Date();
  var latestVersion = proj.latestVersion || null;

  var trashClass = store.showTrash ? ' trashed' : '';
  var selected = store.selectionMode && store.selectedIds.indexOf(proj.id) !== -1;
  var selectClasses = store.selectionMode ? ' selectable' : '';
  if (selected) selectClasses += ' selected';

  var html = '';
  html += '<div class="project-card ' + (proj.favorite ? 'favorite' : '') + (proj.pinned ? ' pinned' : '') + trashClass + selectClasses + '" data-id="' + proj.id + '">';
  html += '<div class="card-color-bar" style="background:' + (proj.color || CONFIG.COLORS[0]) + '"></div>';
  if (store.selectionMode) {
    html += '<span class="card-check">' + (selected ? svgIcon('check', 'sm') : '') + '</span>';
  }
  if (proj.pinned) {
    html += '<span class="card-pin" title="Закреплён">' + svgIcon('pin-filled', 'sm') + '</span>';
  }
  html += '<div class="card-top">';
  html += '<div class="card-logo">' + logoHTML + '</div>';
  html += '<div class="card-info">';
  html += '<h3>' + highlightText(proj.name || 'Без названия', store.searchQuery) + '</h3>';
  html += '<div class="card-desc">' + highlightText(proj.description || 'Нет описания', store.searchQuery) + '</div>';
  html += '</div></div>';
  html += '<div class="card-meta">';
  html += '<span class="badge badge-default">' + (CONFIG.STATUS_LABELS[proj.status] || proj.status) + '</span>';
  if (proj.priority) {
    html += '<span class="priority-badge priority-' + proj.priority + '">' + proj.priority.toUpperCase() + '</span>';
  }
  if (latestVersion) {
    html += '<span class="badge badge-accent">' + svgIcon('git-branch', 'sm') + ' v' + latestVersion + '</span>';
  }
  if (proj.notes && proj.notes.length > 0) {
    html += '<span class="badge badge-accent">' + svgIcon('note', 'sm') + ' ' + proj.notes.length + '</span>';
  }
  if (checklistTotal > 0) {
    html += '<span class="badge ' + (checklistDone === checklistTotal ? 'badge-success' : 'badge-default') + '">' + svgIcon('check', 'sm') + ' ' + checklistDone + '/' + checklistTotal + '</span>';
  }
  if (proj.deadline) {
    html += '<span class="badge ' + (over ? 'badge-danger' : '') + '">' + svgIcon('clock', 'sm') + ' ' + formatDate(proj.deadline) + '</span>';
  }
  if (proj.tags) {
    for (var j = 0; j < proj.tags.length; j++) {
      html += '<span class="badge badge-default">' + escapeHTML(proj.tags[j]) + '</span>';
    }
  }
    html += '<span style="margin-left:auto;font-size:10px;opacity:0.6">' + formatDate(proj.created_at) + '</span>';
  html += '</div></div>';

  return html;
}

function renderEmptyState() {
  var html = '';
  html += '<div class="empty-state">';
  html += '<button class="btn-icon empty-save" id="btnSaveFile" title="ЛКМ — сохранить | ПКМ — загрузить">' + svgIcon('save') + '</button>';
  if (store.hasPin) {
    html += '<button class="btn-icon empty-lock" id="btnLockNow" title="Заблокировать приложение">' + svgIcon('lock') + '</button>';
  }
  html += '<div class="empty-icon">' + svgIcon('layers', 'xl') + '</div>';
  html += '<h2>Нет проектов</h2>';
  html += '<p style="margin-bottom:20px">Создайте первый проект или используйте шаблон</p>';
  html += '<button class="btn btn-primary" id="emptyCreateBtn">' + svgIcon('plus', 'sm') + ' Создать проект</button>';
  html += '<div class="templates-grid" style="margin-top:24px">';
  for (var i = 0; i < CONFIG.DEFAULT_TEMPLATES.length; i++) {
    var t = CONFIG.DEFAULT_TEMPLATES[i];
    html += '<div class="template-card" data-name="' + escapeHTML(t.name) + '" data-desc="' + escapeHTML(t.description) + '" data-tags="' + (t.tags || []).join(',') + '" data-status="' + t.status + '">';
    html += '<strong>' + t.name + '</strong>';
    html += '<p>' + t.description + '</p>';
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

function getFilteredProjects() {
  var source = store.showTrash ? store.trashProjects : store.projects;
  var filtered = [];

  for (var i = 0; i < source.length; i++) {
    filtered.push(source[i]);
  }

  if (store.searchQuery) {
    var q = store.searchQuery.toLowerCase();
    filtered = filtered.filter(function(p) {
      if ((p.name || '').toLowerCase().indexOf(q) !== -1) return true;
      if ((p.description || '').toLowerCase().indexOf(q) !== -1) return true;
      if (p.tags) {
        for (var j = 0; j < p.tags.length; j++) {
          if (p.tags[j].toLowerCase().indexOf(q) !== -1) return true;
        }
      }
      return false;
    });
  }

  if (!store.showTrash && store.filterTag) {
    filtered = filtered.filter(function(p) {
      return p.tags && p.tags.indexOf(store.filterTag) !== -1;
    });
  }

  if (!store.showTrash && store.filterFavorite) {
    filtered = filtered.filter(function(p) { return p.favorite; });
  }

  if (!store.showTrash && store.filterStatus) {
    filtered = filtered.filter(function(p) { return (p.status || 'active') === store.filterStatus; });
  }

  if (!store.showTrash && store.filterPriority) {
    filtered = filtered.filter(function(p) { return p.priority === store.filterPriority; });
  }

  // ===== ИСПРАВЛЕННАЯ СОРТИРОВКА =====
  if (store.sortOrder === 'newest') {
    filtered.sort(function(a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    });
  } else if (store.sortOrder === 'oldest') {
    filtered.sort(function(a, b) {
      return new Date(a.created_at) - new Date(b.created_at);
    });
  } else if (store.sortOrder === 'name') {
    filtered.sort(function(a, b) {
      var nameA = (a.name || '').toLowerCase();
      var nameB = (b.name || '').toLowerCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return 0;
    });
  } else if (store.sortOrder === 'deadline') {
    filtered.sort(function(a, b) {
      // Сначала проекты без дедлайна (в конец)
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    });
  } else {
    // По умолчанию — новые
    filtered.sort(function(a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }

  // Закреплённые проекты всегда сверху (сортировка стабильна)
  filtered.sort(function(a, b) {
    return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
  });

  return filtered;
}

function getAllTags() {
  var tagSet = {};
  for (var i = 0; i < store.projects.length; i++) {
    var p = store.projects[i];
    if (p.deleted_at) continue;
    if (p.tags) {
      for (var j = 0; j < p.tags.length; j++) {
        tagSet[p.tags[j]] = true;
      }
    }
  }
  var tags = Object.keys(tagSet);
  tags.sort();
  return tags;
}

function getSortLabel() {
  if (store.sortOrder === 'newest') return 'Новые';
  if (store.sortOrder === 'oldest') return 'Старые';
  if (store.sortOrder === 'name') return 'По имени';
  if (store.sortOrder === 'deadline') return 'По дедлайну';
  return 'Сортировка';
}