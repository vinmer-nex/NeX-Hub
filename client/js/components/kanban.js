import store from '../store.js';
import CONFIG from '../config.js';
import api from '../api.js';
import { svgIcon, escapeHTML, showToast, formatDate, projectAvatar } from '../utils/dom.js';

// ===== Локальное состояние доски (живёт, пока открыта вкладка) =====
var kb = {
  query: '',
  priority: '',
  favorite: false,
  group: 'status',
  collapsed: {},
  lastMove: null,
  activity: null,
  details: new Map()
};

var STALE_DAYS = 14;

export async function renderKanban() {
  await Promise.all([loadBoard(), loadActivity()]);

  var html = shellHTML();

  setTimeout(function () {
    bindShellEvents();
    renderBoard();
  }, 0);

  return html;
}

// ============================================================
// Загрузка данных
// ============================================================

// Лёгкая загрузка доски: агрегаты по каждому проекту без полных деталей
async function loadBoard() {
  try {
    var data = await api.getBoard();
    if (data && Array.isArray(data.projects)) store.projects = data.projects;
  } catch (e) {
    // оставляем уже загруженный store.projects, чтобы доска всё равно отрисовалась
  }
}

// Последняя активность по проектам — для индикатора «застоя».
// Перезагружаем при каждом открытии доски, чтобы свежие действия учитывались.
async function loadActivity() {
  kb.activity = {};
  try {
    var data = await api.getLastActivity();
    (data.activity || []).forEach(function (a) {
      if (!a.project_id) return;
      kb.activity[a.project_id] = a.last;
    });
    return;
  } catch (e) {
    // эндпоинта может не быть на старой сборке — пробуем ленту активности
  }
  try {
    var recent = await api.getRecentActivity(100);
    (recent.activity || []).forEach(function (a) {
      if (!a.project_id) return;
      var prev = kb.activity[a.project_id];
      if (!prev || String(a.timestamp) > String(prev)) kb.activity[a.project_id] = a.timestamp;
    });
  } catch (e) {
    kb.activity = {};
  }
}

// ============================================================
// Утилиты
// ============================================================

function parseTs(ts) {
  if (!ts) return NaN;
  if (typeof ts === 'string' && ts.indexOf('T') === -1) return Date.parse(ts.replace(' ', 'T') + 'Z');
  return Date.parse(ts);
}

function allProjects() {
  return store.projects.filter(function (p) { return !p.deleted_at; });
}

function getFiltered() {
  var list = allProjects();
  if (kb.priority) list = list.filter(function (p) { return p.priority === kb.priority; });
  if (kb.favorite) list = list.filter(function (p) { return p.favorite; });
  if (kb.query) {
    var q = kb.query.toLowerCase();
    list = list.filter(function (p) {
      if ((p.name || '').toLowerCase().indexOf(q) !== -1) return true;
      if ((p.description || '').toLowerCase().indexOf(q) !== -1) return true;
      return (p.tags || []).some(function (t) { return String(t).toLowerCase().indexOf(q) !== -1; });
    });
  }
  return list;
}

function checklistStats(p) {
  if (p.stats && typeof p.stats.checklistTotal === 'number' && typeof p.stats.checklistDone === 'number') {
    var sDone = p.stats.checklistDone;
    var sTotal = p.stats.checklistTotal;
    return { done: sDone, total: sTotal, pct: sTotal ? Math.round(sDone / sTotal * 100) : 0 };
  }
  var items = Array.isArray(p.checklist) ? p.checklist : [];
  var done = items.filter(function (i) { return i.done; }).length;
  return { done: done, total: items.length, pct: items.length ? Math.round(done / items.length * 100) : 0 };
}

function dueChip(p) {
  if (!p.deadline) return '';
  var d = new Date(String(p.deadline) + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var days = Math.round((d - today) / 86400000);
  var cls = '';
  var label;
  if (days < 0) { cls = 'over'; label = 'просрочено'; }
  else if (days === 0) { cls = 'today'; label = 'сегодня'; }
  else if (days <= 3) { cls = 'soon'; label = 'через ' + days + ' дн.'; }
  else label = d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
  return '<span class="kb-due ' + cls + '" title="Дедлайн: ' + escapeHTML(formatDate(p.deadline)) + '">' +
    svgIcon('clock', 'sm') + label + '</span>';
}

function isStale(p) {
  if (p.status === 'done' || p.status === 'archive') return false;
  var ts = (kb.activity && kb.activity[p.id]) || p.created_at;
  var time = parseTs(ts);
  if (isNaN(time)) return false;
  return (Date.now() - time) > STALE_DAYS * 86400000;
}

function findProject(id) {
  for (var i = 0; i < store.projects.length; i++) {
    if (String(store.projects[i].id) === String(id)) return store.projects[i];
  }
  return null;
}

// ============================================================
// Разметка
// ============================================================

function shellHTML() {
  return `
    <div class="kb-page">
      <button class="detail-back" id="btnBackToList">
        ${svgIcon('chevron-left', 'sm')} К проектам
      </button>
      <div class="kb-head">
        <div>
          <h2 class="kb-title">${svgIcon('columns')} Kanban</h2>
          <div class="kb-sub" id="kbSub"></div>
        </div>
        <div class="kb-head-actions">
          <button class="btn btn-secondary btn-sm" id="kbUndo">${svgIcon('undo', 'sm')} Отменить</button>
          <button class="btn btn-primary btn-sm" id="kbCreate">${svgIcon('plus', 'sm')} Проект</button>
        </div>
      </div>

      <div class="kb-overview" id="kbOverview"></div>

      <div class="kb-toolbar">
        <div class="search-wrapper">
          <span class="search-icon">${svgIcon('search', 'sm')}</span>
          <input class="search-input" type="text" id="kbSearch" placeholder="Поиск по карточкам..." value="${escapeHTML(kb.query)}">
        </div>
        <div class="kb-chips" id="kbChips"></div>
        <button class="view-btn ${kb.favorite ? 'active' : ''}" id="kbFav">${svgIcon(kb.favorite ? 'star-filled' : 'star', 'sm')} Избранное</button>
        <div class="kb-toolbar-right">
          <label class="kb-group-label">Группировка</label>
          <select class="form-select kb-group" id="kbGroup">
            <option value="status"${kb.group === 'status' ? ' selected' : ''}>По статусу</option>
            <option value="priority"${kb.group === 'priority' ? ' selected' : ''}>По приоритету</option>
            <option value="tag"${kb.group === 'tag' ? ' selected' : ''}>По тегу</option>
          </select>
        </div>
      </div>

      <div class="kb-board-root" id="kbBoard"></div>
    </div>
  `;
}

function overviewHTML() {
  var list = allProjects();
  var total = list.length || 1;

  var counts = CONFIG.STATUSES.map(function (st) {
    return { st: st, n: list.filter(function (p) { return (p.status || 'active') === st; }).length };
  });

  var seg = counts.map(function (c) {
    return '<span class="kb-seg-part kb-seg-' + c.st + '" style="width:' + (c.n / total * 100) + '%"></span>';
  }).join('');

  var legend = counts.map(function (c) {
    return '<span class="kb-legend-item"><i class="kb-seg-dot kb-seg-' + c.st + '"></i>' +
      CONFIG.STATUS_LABELS[c.st] + ' · ' + c.n + '</span>';
  }).join('');

  var tasksTotal = 0, tasksDone = 0, overdue = 0, stale = 0, doneProjects = 0;
  list.forEach(function (p) {
    var cs = checklistStats(p);
    tasksTotal += cs.total;
    tasksDone += cs.done;
    if (p.status === 'done') doneProjects++;
    if (p.deadline && p.status !== 'done' && p.status !== 'archive') {
      var d = new Date(String(p.deadline) + 'T00:00:00');
      var today = new Date(); today.setHours(0, 0, 0, 0);
      if (!isNaN(d.getTime()) && d < today) overdue++;
    }
    if (isStale(p)) stale++;
  });
  var pct = tasksTotal ? Math.round(tasksDone / tasksTotal * 100) : 0;

  return `
    <div class="kb-panel">
      <h4>Распределение по статусам</h4>
      <div class="kb-seg">${seg}</div>
      <div class="kb-legend">${legend}</div>
    </div>
    <div class="kb-panel kb-kpis">
      <div class="kb-kpi"><b>${pct}%</b><span>Задач выполнено (${tasksDone}/${tasksTotal})</span></div>
      <div class="kb-kpi"><b class="txt-danger">${overdue}</b><span>Просрочено</span></div>
      <div class="kb-kpi"><b class="txt-warning">${stale}</b><span>Застой &gt;${STALE_DAYS} дн.</span></div>
      <div class="kb-kpi"><b class="txt-success">${doneProjects}</b><span>Завершено проектов</span></div>
    </div>
  `;
}

function chipsHTML() {
  return CONFIG.PRIORITIES.map(function (k) {
    var active = kb.priority === k ? ' active' : '';
    return '<button class="kb-chip' + active + '" data-prio="' + k + '">' +
      '<span class="kb-chip-dot" style="background:var(--' + k + ')"></span>' + k.toUpperCase() + '</button>';
  }).join('');
}

function cardHTML(p, opts) {
  var cs = checklistStats(p);
  var stale = isStale(p);
  var draggable = !(opts && opts.noDrag);
  var logo = projectAvatar(p);
  var tags = (p.tags || []).slice(0, 2).map(function (t) {
    return '<span class="kb-tag">' + escapeHTML(t) + '</span>';
  }).join('');
  var moreTags = (p.tags || []).length > 2 ? '<span class="kb-tag">+' + (p.tags.length - 2) + '</span>' : '';

  var prog = cs.total ? `
    <div class="kb-prog">
      <div class="kb-prog-lbl"><span>${svgIcon('check', 'sm')} Задачи</span><span>${cs.done}/${cs.total}</span></div>
      <div class="kb-bar"><i style="width:${cs.pct}%;background:${cs.pct === 100 ? 'var(--green)' : 'var(--accent)'}"></i></div>
    </div>` : '';

  var st = p.stats || {};
  var notesCount = st.notes != null ? st.notes : (p.notes || []).length;
  var filesCount = st.files != null ? st.files : (p.files || []).length;
  var photosCount = st.photos != null ? st.photos : (p.photos || []).length;
  var commentsCount = st.comments != null ? st.comments : (p.comments || []).length;

  var meta = `
    <div class="kb-meta">
      <span class="kb-m"><span>${svgIcon('note', 'sm')}</span>${notesCount}</span>
      <span class="kb-m"><span>${svgIcon('file', 'sm')}</span>${filesCount}</span>
      <span class="kb-m"><span>${svgIcon('image', 'sm')}</span>${photosCount}</span>
      <span class="kb-m"><span>${svgIcon('message-square', 'sm')}</span>${commentsCount}</span>
      ${p.estimated_hours ? '<span class="kb-m"><span>' + svgIcon('clock', 'sm') + '</span>' + p.estimated_hours + 'ч</span>' : ''}
    </div>`;

  var staleBadge = stale ? '<span class="kb-stale">' + svgIcon('alert', 'sm') + 'застой</span>' : '';
  var due = dueChip(p);
  var rowEnd = (due || staleBadge)
    ? '<span class="kb-row-end">' + due + staleBadge + '</span>'
    : '';

  return `
    <div class="kanban-card" draggable="${draggable}" data-id="${p.id}">
      <span class="kb-rail" style="background:${p.color || 'var(--accent)'}"></span>
      <div class="kb-card-top">
        <div class="kb-logo" style="background:${p.color || 'var(--accent)'}">${logo}</div>
        <div class="kb-card-main">
          <div class="kb-card-title">${escapeHTML(p.name || 'Без названия')}</div>
          ${p.description ? '<div class="kb-card-desc">' + escapeHTML(p.description) + '</div>' : ''}
        </div>
        <button class="kb-star${p.favorite ? ' on' : ''}" data-fav="${p.id}" title="В избранное">
          ${svgIcon(p.favorite ? 'star-filled' : 'star', 'sm')}
        </button>
      </div>
      <div class="kb-row">
        ${p.priority ? '<span class="priority-badge priority-' + p.priority + '">' + p.priority.toUpperCase() + '</span>' : ''}
        ${tags}
        ${moreTags}
        ${rowEnd}
      </div>
      ${prog}
      ${meta}
    </div>
  `;
}

function columnHTML(status, projects) {
  var label = CONFIG.STATUS_LABELS[status];
  var isCollapsed = !!kb.collapsed[status];
  var totalHours = projects.reduce(function (a, p) { return a + (Number(p.estimated_hours) || 0); }, 0);

  var body = projects.length
    ? projects.map(function (p) { return cardHTML(p); }).join('')
    : '<div class="kb-empty">Пусто</div>';

  return `
    <div class="kanban-column${isCollapsed ? ' collapsed' : ''}" data-status="${status}">
      <div class="kb-colhead">
        <span class="kb-col-dot" style="background:var(--kb-' + status + ')"></span>
        <h3>${label}</h3>
        <span class="kb-count">${projects.length}</span>
        <button class="kb-colbtn" data-toggle="${status}" title="${isCollapsed ? 'Развернуть' : 'Свернуть'}">
          ${svgIcon(isCollapsed ? 'expand' : 'collapse', 'sm')}
        </button>
      </div>
      <div class="kanban-cards" data-drop="${status}">${body}</div>
      <button class="kb-add" data-add="${status}">${svgIcon('plus', 'sm')} Добавить</button>
      ${!isCollapsed && projects.length ? '<div class="kb-colfoot">Суммарно ≈ ' + totalHours + 'ч</div>' : ''}
    </div>
  `;
}

function boardHTML() {
  var list = getFiltered();

  if (kb.group === 'status') {
    return '<div class="kanban-board">' + CONFIG.STATUSES.map(function (st) {
      return columnHTML(st, list.filter(function (p) { return (p.status || 'active') === st; }));
    }).join('') + '</div>';
  }

  if (kb.group === 'priority') {
    var order = CONFIG.PRIORITIES;
    return order.map(function (pr) {
      var items = list.filter(function (p) { return p.priority === pr; });
      return laneHTML(CONFIG.PRIORITY_LABELS[pr], 'var(--' + pr + ')', items);
    }).join('');
  }

  // по тегу
  var tags = {};
  list.forEach(function (p) {
    (p.tags || []).forEach(function (t) { tags[t] = true; });
  });
  var tagList = Object.keys(tags).sort();
  if (!tagList.length) return '<div class="kanban-board">' + CONFIG.STATUSES.map(function (st) { return columnHTML(st, []); }).join('') + '</div>';

  return tagList.map(function (t) {
    return laneHTML('#' + t, 'var(--purple)', list.filter(function (p) { return (p.tags || []).indexOf(t) !== -1; }));
  }).join('');
}

function laneHTML(title, dotColor, items) {
  var body = items.length
    ? '<div class="kb-lane-cards">' + items.map(function (p) { return cardHTML(p, { noDrag: true }); }).join('') + '</div>'
    : '<div class="kb-lane-cards"><div class="kb-empty">Пусто</div></div>';

  return `
    <div class="kb-lane">
      <div class="kb-lane-head">
        <span class="kb-col-dot" style="background:${dotColor}"></span>
        <span>${escapeHTML(title)}</span>
        <span class="kb-count">${items.length}</span>
      </div>
      ${body}
    </div>
  `;
}

// ============================================================
// Рендер (частичный)
// ============================================================

function renderBoard() {
  var overview = document.getElementById('kbOverview');
  if (overview) overview.innerHTML = overviewHTML();

  var chips = document.getElementById('kbChips');
  if (chips) {
    chips.innerHTML = chipsHTML();
    bindChips();
  }

  var board = document.getElementById('kbBoard');
  if (!board) return;

  var sub = document.getElementById('kbSub');
  if (sub) {
    var list = allProjects();
    var shown = getFiltered().length;
    sub.textContent = shown === list.length
      ? list.length + ' проектов'
      : shown + ' из ' + list.length + ' проектов';
  }

  board.innerHTML = boardHTML();
  bindBoardEvents();
}

// ============================================================
// События
// ============================================================

function bindShellEvents() {
  // Назад к проектам
  var btnBack = document.getElementById('btnBackToList');
  if (btnBack) {
    btnBack.addEventListener('click', async function () {
      store.currentView = 'list';
      store.currentProjectId = null;
      var m = await import('../app.js');
      m.render();
    });
  }

  var search = document.getElementById('kbSearch');
  if (search) {
    search.addEventListener('input', function () {
      kb.query = search.value;
      if (kb._searchTimer) clearTimeout(kb._searchTimer);
      kb._searchTimer = setTimeout(function () {
        kb._searchTimer = null;
        renderBoard();
      }, 120);
    });
  }

  var fav = document.getElementById('kbFav');
  if (fav) {
    fav.addEventListener('click', function () {
      kb.favorite = !kb.favorite;
      fav.classList.toggle('active', kb.favorite);
      fav.innerHTML = svgIcon(kb.favorite ? 'star-filled' : 'star', 'sm') + ' Избранное';
      renderBoard();
    });
  }

  var group = document.getElementById('kbGroup');
  if (group) {
    group.addEventListener('change', function () {
      kb.group = group.value;
      renderBoard();
    });
  }

  var undo = document.getElementById('kbUndo');
  if (undo) undo.addEventListener('click', undoMove);

  var create = document.getElementById('kbCreate');
  if (create) {
    create.addEventListener('click', async function () {
      var m = await import('./modal.js');
      var app = await import('../app.js');
      m.openCreateProjectModal(async function () {
        await app.loadProjects();
        // сбрасываем кэш деталей у новых проектов
        app.render();
      });
    });
  }
}

function bindChips() {
  document.querySelectorAll('#kbChips .kb-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var k = chip.dataset.prio;
      kb.priority = kb.priority === k ? '' : k;
      renderBoard();
    });
  });
}

function bindBoardEvents() {
  // Карточки
  document.querySelectorAll('#kbBoard .kanban-card').forEach(function (card) {
    card.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', card.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', function () {
      card.classList.remove('dragging');
      removePlaceholder();
    });
    card.addEventListener('click', async function (e) {
      if (e.target.closest('.kb-star')) return;
      await openPeek(card.dataset.id);
    });
  });

  // Звёздочка «избранное»
  document.querySelectorAll('#kbBoard .kb-star').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleFavorite(btn.dataset.fav);
    });
  });

  // Сворачивание колонок
  document.querySelectorAll('#kbBoard [data-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var st = btn.dataset.toggle;
      if (kb.collapsed[st]) delete kb.collapsed[st]; else kb.collapsed[st] = true;
      renderBoard();
    });
  });

  // Добавление в колонку
  document.querySelectorAll('#kbBoard [data-add]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var st = btn.dataset.add;
      var m = await import('./modal.js');
      var app = await import('../app.js');
      m.openCreateProjectModal(async function () {
        await app.loadProjects();
        app.render();
      });
      showToast('Создание в «' + CONFIG.STATUS_LABELS[st] + '»');
    });
  });

  // Drop-зоны
  document.querySelectorAll('#kbBoard .kanban-cards[data-drop]').forEach(function (zone) {
    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      var col = zone.closest('.kanban-column');
      if (col) col.classList.add('drop-zone-active');
      movePlaceholder(zone, e.clientY);
    });
    zone.addEventListener('dragleave', function (e) {
      if (!zone.contains(e.relatedTarget)) {
        var col = zone.closest('.kanban-column');
        if (col) col.classList.remove('drop-zone-active');
      }
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      var col = zone.closest('.kanban-column');
      if (col) col.classList.remove('drop-zone-active');
      removePlaceholder();
      var id = e.dataTransfer.getData('text/plain');
      if (id) moveProject(id, zone.dataset.drop);
    });
  });
}

// ============================================================
// Действия
// ============================================================

async function moveProject(id, status) {
  var p = findProject(id);
  if (!p || (p.status || 'active') === status) return;
  var from = p.status || 'active';
  p.status = status;
  kb.lastMove = { id: id, from: from };
  kb.details.delete(p.id);
  renderBoard();
  try {
    await api.updateProject(id, { status: status });
    showToast('Статус: ' + CONFIG.STATUS_LABELS[status]);
  } catch (err) {
    p.status = from;
    renderBoard();
    showToast('Ошибка изменения статуса', true);
  }
}

async function undoMove() {
  if (!kb.lastMove) { showToast('Нечего отменять'); return; }
  var mv = kb.lastMove;
  kb.lastMove = null;
  var p = findProject(mv.id);
  var prev = p ? (p.status || 'active') : null;
  if (p) p.status = mv.from;
  renderBoard();
  try {
    await api.updateProject(mv.id, { status: mv.from });
    showToast('Перемещение отменено');
  } catch (err) {
    if (p) p.status = prev;
    renderBoard();
    showToast('Не удалось отменить', true);
  }
}

async function toggleFavorite(id) {
  var p = findProject(id);
  if (!p) return;
  var next = !p.favorite;
  p.favorite = next;
  kb.details.delete(p.id);
  renderBoard();
  try {
    await api.updateProject(id, { favorite: next });
  } catch (err) {
    p.favorite = !next;
    renderBoard();
    showToast('Не удалось обновить', true);
  }
}

// ============================================================
// Превью проекта
// ============================================================

function closePeek() {
  var scrim = document.getElementById('kbScrim');
  var peek = document.getElementById('kbPeek');
  if (kb._esc) {
    document.removeEventListener('keydown', kb._esc, true);
    kb._esc = null;
  }
  if (!scrim && !peek) return;
  if (scrim) scrim.classList.remove('show');
  if (peek) peek.classList.remove('show');
  // Ждём завершения анимации «заезда», затем убираем из DOM
  setTimeout(function () {
    if (scrim) scrim.remove();
    if (peek) peek.remove();
  }, 260);
}

async function openPeek(id) {
  var p = findProject(id);
  if (!p) return;

  // Мгновенно убираем предыдущую панель (без анимации)
  var oldScrim = document.getElementById('kbScrim');
  var oldPeek = document.getElementById('kbPeek');
  if (oldScrim) oldScrim.remove();
  if (oldPeek) oldPeek.remove();
  if (kb._esc) {
    document.removeEventListener('keydown', kb._esc, true);
    kb._esc = null;
  }

  var peekSeq = (kb._peekSeq || 0) + 1;
  kb._peekSeq = peekSeq;

  // Полные детали нужны только для открываемого проекта; кэшируем после первого раза.
  var full = kb.details.get(p.id);
  if (!full) {
    try {
      var d = await api.getProject(p.id);
      full = d.project;
      kb.details.set(p.id, full);
    } catch (e) {
      full = null;
    }
  }
  if (kb._peekSeq !== peekSeq) return;
  p = findProject(id) || p;

  var st = p.stats || {};
  var notesCount, filesCount, photosCount, commentsCount;
  if (full) {
    notesCount = (full.notes || []).length;
    filesCount = (full.files || []).length;
    photosCount = (full.photos || []).length;
    commentsCount = (full.comments || []).length;
  } else {
    notesCount = st.notes != null ? st.notes : 0;
    filesCount = st.files != null ? st.files : 0;
    photosCount = st.photos != null ? st.photos : 0;
    commentsCount = st.comments != null ? st.comments : 0;
  }

  var cs = checklistStats(full || p);
  var checklistSource = full ? (full.checklist || []) : [];
  var checklist = checklistSource.map(function (i) {
    return '<div class="kb-cl-item' + (i.done ? ' done' : '') + '">' +
      '<span class="kb-cl-box">' + (i.done ? svgIcon('check', 'sm') : '') + '</span>' +
      '<span>' + escapeHTML(i.text) + '</span></div>';
  }).join('');

  var scrim = document.createElement('div');
  scrim.className = 'kb-scrim';
  scrim.id = 'kbScrim';

  var peek = document.createElement('aside');
  peek.className = 'kb-peek';
  peek.id = 'kbPeek';
  peek.innerHTML = `
    <div class="kb-peek-head">
      <div class="kb-peek-logo" style="background:${p.color || 'var(--accent)'}">${projectAvatar(p)}</div>
      <div class="kb-peek-titles">
        <h2>${escapeHTML(p.name || 'Без названия')}</h2>
        <p>${escapeHTML(p.description || '')}</p>
      </div>
      <button class="kb-peek-close" id="kbPeekClose">${svgIcon('x', 'sm')}</button>
    </div>
    <div class="kb-peek-body">
      <div class="kb-peek-sec">
        <h5>Прогресс</h5>
        <div class="kb-prog-lbl"><span>Задачи</span><span>${cs.done}/${cs.total} · ${cs.pct}%</span></div>
        <div class="kb-bar"><i style="width:${cs.pct}%"></i></div>
      </div>
      <div class="kb-peek-sec">
        <h5>Детали</h5>
        <div class="kb-kv"><span>Статус</span><span>${CONFIG.STATUS_LABELS[p.status] || p.status}</span></div>
        <div class="kb-kv"><span>Приоритет</span><span>${p.priority ? p.priority.toUpperCase() : '—'}</span></div>
        <div class="kb-kv"><span>Оценка</span><span>${p.estimated_hours ? p.estimated_hours + ' ч' : '—'}</span></div>
        <div class="kb-kv"><span>Дедлайн</span><span>${p.deadline ? escapeHTML(formatDate(p.deadline)) : '—'}</span></div>
        ${p.latestVersion ? '<div class="kb-kv"><span>Версия</span><span>v' + escapeHTML(p.latestVersion) + '</span></div>' : ''}
        <div class="kb-kv"><span>Создан</span><span>${escapeHTML(formatDate(p.created_at))}</span></div>
      </div>
      <div class="kb-peek-sec">
        <h5>Чеклист</h5>
        ${checklist || '<p class="kb-peek-empty">Пусто</p>'}
      </div>
      <div class="kb-peek-sec">
        <h5>Активность</h5>
        <div class="kb-kv"><span>Заметки</span><span>${notesCount}</span></div>
        <div class="kb-kv"><span>Файлы</span><span>${filesCount}</span></div>
        <div class="kb-kv"><span>Фото</span><span>${photosCount}</span></div>
        <div class="kb-kv"><span>Комментарии</span><span>${commentsCount}</span></div>
      </div>
    </div>
    <div class="kb-peek-foot">
      <button class="btn btn-primary" id="kbPeekOpen" style="flex:1">${svgIcon('external-link', 'sm')} Открыть проект</button>
      <button class="btn btn-secondary" id="kbPeekClose2">Закрыть</button>
    </div>
  `;

  var host = document.querySelector('.kb-page') || document.body;
  host.appendChild(scrim);
  host.appendChild(peek);
  requestAnimationFrame(function () {
    scrim.classList.add('show');
    peek.classList.add('show');
  });

  kb._esc = function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); closePeek(); }
  };
  document.addEventListener('keydown', kb._esc, true);

  function close() { closePeek(); }
  document.getElementById('kbPeekClose').addEventListener('click', close);
  document.getElementById('kbPeekClose2').addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.getElementById('kbPeekOpen').addEventListener('click', function () {
    closePeek();
    store.currentProjectId = p.id;
    store.currentView = 'detail';
    store.currentDetailTab = 'notes';
    import('../app.js').then(function (m) { m.render(); });
  });
}

// ============================================================
// Drag & drop: позиция вставки
// ============================================================

function movePlaceholder(zone, y) {
  var ph = zone.querySelector('.kb-placeholder');
  if (!ph) {
    ph = document.createElement('div');
    ph.className = 'kb-placeholder';
  }
  var cards = Array.prototype.slice.call(zone.querySelectorAll('.kanban-card:not(.dragging)'));
  var after = null;
  for (var i = 0; i < cards.length; i++) {
    var rect = cards[i].getBoundingClientRect();
    if (y < rect.top + rect.height / 2) { after = cards[i]; break; }
  }
  if (after) zone.insertBefore(ph, after);
  else zone.appendChild(ph);
}

function removePlaceholder() {
  document.querySelectorAll('.kb-placeholder').forEach(function (ph) { ph.remove(); });
}
