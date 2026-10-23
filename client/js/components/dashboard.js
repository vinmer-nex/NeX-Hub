import store from '../store.js';
import CONFIG from '../config.js';
import auth from '../auth.js';
import api from '../api.js';
import { svgIcon, escapeHTML, formatDate } from '../utils/dom.js';

const STATUS_ORDER = ['active', 'paused', 'done', 'archive'];
const STATUS_COLORS = {
  active: 'var(--accent)',
  paused: 'var(--orange)',
  done: 'var(--green)',
  archive: 'var(--text-tertiary)'
};

// Иконка и подпись для типов событий ленты активности
const ACTIVITY_MAP = {
  created: { icon: 'folder', cls: '', label: 'создан проект' },
  edited: { icon: 'edit', cls: '', label: 'изменён проект' },
  folder_set: { icon: 'folder-open', cls: '', label: 'выбрана папка' },
  trashed: { icon: 'trash', cls: 'red', label: 'перемещён в корзину' },
  restored: { icon: 'refresh', cls: 'green', label: 'восстановлен из корзины' },
  deleted_permanent: { icon: 'trash', cls: 'red', label: 'удалён навсегда' },
  note_add: { icon: 'note', cls: 'green', label: 'добавлена заметка' },
  note_edit: { icon: 'note', cls: '', label: 'изменена заметка' },
  note_delete: { icon: 'trash', cls: 'red', label: 'удалена заметка' },
  version_add: { icon: 'git-branch', cls: '', label: 'добавлена версия' },
  checklist_add: { icon: 'check', cls: '', label: 'добавлена задача' },
  checklist_toggle: { icon: 'check', cls: 'green', label: 'изменена задача' },
  milestone_add: { icon: 'flag', cls: 'orange', label: 'добавлена веха' },
  comment_add: { icon: 'message-square', cls: '', label: 'добавлен комментарий' },
  photos_add: { icon: 'image', cls: 'purple', label: 'загружены фото' },
  photo_delete: { icon: 'trash', cls: 'red', label: 'удалено фото' },
  files_add: { icon: 'file', cls: 'purple', label: 'загружены файлы' },
  file_delete: { icon: 'trash', cls: 'red', label: 'удалён файл' },
  script_add: { icon: 'terminal', cls: '', label: 'добавлен скрипт' },
  script_edit: { icon: 'terminal', cls: '', label: 'изменён скрипт' },
  script_delete: { icon: 'trash', cls: 'red', label: 'удалён скрипт' },
  script_run: { icon: 'play', cls: 'green', label: 'запущен скрипт' },
  script_stop: { icon: 'stop', cls: 'orange', label: 'остановлен скрипт' },
  script_autostart: { icon: 'terminal', cls: 'green', label: 'автостарт скрипта' },
  import: { icon: 'upload', cls: '', label: 'импорт проектов' }
};

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseDate(str) {
  if (!str) return null;
  const s = String(str);
  let d;
  if (s.indexOf('T') !== -1 || s.indexOf('Z') !== -1) {
    d = new Date(s);
  } else if (s.length === 10) {
    d = new Date(s + 'T00:00:00');
  } else {
    d = new Date(s.replace(' ', 'T') + 'Z');
  }
  return isNaN(d.getTime()) ? null : d;
}

function formatStorage(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' Б';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' КБ';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' МБ';
  return (n / 1073741824).toFixed(2) + ' ГБ';
}

function daysWord(n) {
  return n === 1 ? 'день' : 'дня';
}

export async function renderDashboard() {
  const projects = store.projects.filter(p => !p.deleted_at);
  const total = projects.length;

  let stats = null;
  let activity = [];
  try {
    const [s, a] = await Promise.all([
      auth.getStats(),
      api.getRecentActivity(20)
    ]);
    stats = s;
    activity = (a && a.activity) || [];
  } catch (e) {
    // статистика не критична — дашборд отрисуется без неё
  }

  const header = `
    <button class="detail-back" id="btnBackToList">
      ${svgIcon('chevron-left', 'sm')} К проектам
    </button>
    <div class="dash-head">
      <div>
        <div class="dash-title">Дашборд</div>
        <div class="dash-sub">${greeting()}, ${escapeHTML((auth.user && auth.user.username) || 'пользователь')} · ${todayLabel()}</div>
      </div>
      <button class="btn btn-sm btn-secondary" id="btnDashRefresh">
        ${svgIcon('refresh', 'sm')} Обновить
      </button>
    </div>
  `;

  const body = total === 0 ? renderEmpty() : renderBody(projects, stats, activity);

  setTimeout(() => bindDashboardEvents(), 0);

  return header + body;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function todayLabel() {
  return new Date().toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderEmpty() {
  return `
    <div class="dash-empty">
      ${svgIcon('folder', 'xl')}
      <div class="dash-empty-title">Пока нет проектов</div>
      <div class="dash-empty-sub">Создайте первый проект, чтобы увидеть статистику, дедлайны и активность.</div>
      <button class="btn btn-primary" id="btnQuickCreate">
        ${svgIcon('plus', 'sm')} Создать проект
      </button>
    </div>
  `;
}

function renderBody(projects, stats, activity) {
  const total = projects.length;
  const activeCount = projects.filter(p => p.status === 'active').length;
  const doneCount = projects.filter(p => p.status === 'done').length;

  const today = startOfDay(new Date());
  const overdueCount = projects.filter(p => {
    if (!p.deadline || p.status === 'done' || p.status === 'archive') return false;
    const d = parseDate(p.deadline);
    return d && startOfDay(d) < today;
  }).length;

  const tasksTotal = (stats && stats.checklist) || 0;
  const tasksDone = (stats && stats.checklistDone) || 0;
  const tasksPct = tasksTotal ? Math.round(tasksDone / tasksTotal * 100) : 0;
  const photosTotal = (stats && stats.photos) || 0;
  const filesTotal = (stats && stats.files) || 0;
  const storageBytes = (stats && stats.storageBytes) || 0;

  const tasksCard = stats
    ? `<div class="stat-value">${tasksDone}<span class="stat-dim">/${tasksTotal}</span></div>
       <div class="stat-sub">${tasksPct}% выполнено</div>
       <div class="mini-bar"><div class="mini-bar-fill" style="width:${tasksPct}%;background:var(--green)"></div></div>`
    : `<div class="stat-value">—</div><div class="stat-sub">нет данных</div>`;

  const storageBody = storageBytes > 0
    ? `<div class="dash-storage-value">${formatStorage(storageBytes)}</div>
       <div class="dash-storage-sub">${photosTotal} фото · ${filesTotal} файлов</div>
       ${storageStack(photosTotal, filesTotal)}`
    : `<div class="dash-hint" style="margin-top:10px">Файлы и фото пока не загружены.</div>`;

  const legend = STATUS_ORDER.map(s => {
    const count = projects.filter(p => p.status === s).length;
    const pct = total ? Math.round(count / total * 100) : 0;
    return `
      <button class="dash-legend-row" data-status="${s}" title="Показать «${CONFIG.STATUS_LABELS[s]}»">
        <span class="dash-legend-dot" style="background:${STATUS_COLORS[s]}"></span>
        <span class="dash-legend-name">${CONFIG.STATUS_LABELS[s]}</span>
        <span class="dash-legend-val">${count}</span>
        <span class="dash-legend-pct">${pct}%</span>
      </button>
    `;
  }).join('');

  const priorityChips = CONFIG.PRIORITIES.map(p => {
    const count = projects.filter(x => x.priority === p).length;
    return `<button class="priority-badge priority-${p} dash-chip" data-priority="${p}" title="Показать проекты с приоритетом ${p.toUpperCase()}">${p.toUpperCase()} · ${count}</button>`;
  }).join('');

  return `
    <div class="dash-stats">
      <div class="stat-card stat-click" data-goto="list">
        <h3>Проекты ${statIcon('folder', 'accent')}</h3>
        <div class="stat-value">${total}</div>
        <div class="stat-sub">${activeCount} в работе · ${doneCount} завершено · ${overdueCount} просрочено</div>
        <div class="mini-bar">
          <div class="mini-bar-fill" style="width:${total ? Math.round(activeCount / total * 100) : 0}%;background:var(--accent)"></div>
        </div>
      </div>

      <div class="stat-card">
        <h3>Задачи ${statIcon('check', 'green')}</h3>
        ${tasksCard}
      </div>

      <div class="stat-card">
        <h3>Фото и файлы ${statIcon('image', 'purple')}</h3>
        <div class="stat-value">${photosTotal + filesTotal}</div>
        <div class="stat-sub">${photosTotal} фото · ${filesTotal} файлов</div>
      </div>

      <div class="stat-card stat-click ${overdueCount ? 'stat-danger' : ''}" data-overdue="1">
        <h3>Просрочено ${statIcon('alert', 'red')}</h3>
        <div class="stat-value"${overdueCount ? ' style="color:var(--red)"' : ''}>${overdueCount}</div>
        <div class="stat-sub">${overdueCount ? 'требует внимания · клик — к списку' : 'всё под контролем'}</div>
      </div>
    </div>

    <div class="dash-row">
      <div class="stat-card dash-status-card">
        <h3>Проекты по статусам</h3>
        <div class="dash-donut-wrap">
          ${donut(projects, total)}
          <div class="dash-legend">${legend}</div>
        </div>
        <div class="dash-divider"></div>
        <h3 style="margin-bottom:8px">Приоритеты</h3>
        <div class="dash-chips">${priorityChips}</div>
        <div class="dash-hint">Клик — фильтр проектов по приоритету</div>
      </div>

      <div class="dash-col">
        <div class="stat-card">
          <h3>Быстрые действия</h3>
          <div class="dash-quick">
            <button class="btn btn-sm btn-primary" id="btnQuickCreate">
              ${svgIcon('plus', 'sm')} Создать проект
            </button>
            <button class="btn btn-sm btn-secondary" id="btnQuickKanban">
              ${svgIcon('columns', 'sm')} Открыть Kanban
            </button>
            <button class="btn btn-sm btn-secondary" id="btnQuickCalendar">
              ${svgIcon('calendar', 'sm')} Открыть календарь
            </button>
          </div>
        </div>
        <div class="stat-card">
          <h3>Хранилище ${statIcon('drive', 'purple')}</h3>
          ${storageBody}
        </div>
      </div>
    </div>

    <div class="dash-row even">
      ${renderDeadlines(projects)}
      ${renderMonths(projects)}
    </div>

    ${renderActivity(activity)}
  `;
}

function storageStack(photos, files) {
  const total = photos + files;
  if (!total) return '';
  const pct = Math.round(photos / total * 100);
  return `
    <div class="dash-stack">
      <span style="width:${pct}%;background:var(--purple)"></span>
      <span style="width:${100 - pct}%;background:var(--accent)"></span>
    </div>
    <div class="dash-stack-legend">
      <span><i class="dash-legend-dot" style="background:var(--purple)"></i>Фото <b>${photos}</b></span>
      <span><i class="dash-legend-dot" style="background:var(--accent)"></i>Файлы <b>${files}</b></span>
    </div>
  `;
}

function statIcon(name, tone) {
  return `<span class="dash-stat-ic tone-${tone}">${svgIcon(name, 'sm')}</span>`;
}

function donut(projects, total) {
  let gradient = 'var(--surface-3)';
  if (total > 0) {
    const sum = total || 1;
    let acc = 0;
    const stops = [];
    STATUS_ORDER.forEach(s => {
      const count = projects.filter(p => p.status === s).length;
      if (count === 0) return;
      const from = (acc / sum * 100).toFixed(2);
      acc += count;
      const to = (acc / sum * 100).toFixed(2);
      stops.push(`${STATUS_COLORS[s]} ${from}% ${to}%`);
    });
    gradient = `conic-gradient(from -90deg, ${stops.join(', ')})`;
  }
  return `
    <div class="dash-donut" style="background:${gradient}">
      <div class="dash-donut-hole">
        <span class="dash-donut-num">${total}</span>
        <span class="dash-donut-cap">${plural(total, 'проект', 'проекта', 'проектов')}</span>
      </div>
    </div>
  `;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function collectDeadlines(projects) {
  const today = startOfDay(new Date());
  const items = [];

  projects.forEach(p => {
    if (p.deadline) {
      const d = parseDate(p.deadline);
      if (d && p.status !== 'done' && p.status !== 'archive') {
        const day = startOfDay(d);
        items.push({
          projectId: p.id,
          projectName: p.name,
          type: 'deadline',
          title: 'дедлайн',
          status: p.status,
          date: day,
          diff: Math.round((day - today) / 86400000)
        });
      }
    }
    if (p.status === 'done' || p.status === 'archive') return;
    (p.milestones || []).forEach(m => {
      if (!m.date) return;
      const d = parseDate(m.date);
      if (!d) return;
      const day = startOfDay(d);
      items.push({
        projectId: p.id,
        projectName: p.name,
        type: 'milestone',
        title: m.title || 'веха',
        status: p.status,
        date: day,
        diff: Math.round((day - today) / 86400000)
      });
    });
  });

  const overdue = items.filter(i => i.diff < 0).sort((a, b) => a.date - b.date);
  const upcoming = items.filter(i => i.diff >= 0 && i.diff <= 14).sort((a, b) => a.date - b.date);
  return { overdue, upcoming };
}

function renderDeadlines(projects) {
  const { overdue, upcoming } = collectDeadlines(projects);
  const list = overdue.concat(upcoming).slice(0, 20);

  if (list.length === 0) {
    return `
      <div class="stat-card dash-deadline-empty">
        <h3>Дедлайны и вехи ${statIcon('clock', 'accent')}</h3>
        <div class="dash-empty-note">Ближайших дедлайнов на 2 недели нет.</div>
      </div>
    `;
  }

  const rows = list.map(i => {
    const tone = i.diff < 0 ? 'overdue' : (i.diff <= 3 ? 'soon' : '');
    const icon = i.type === 'milestone' ? 'flag' : (i.diff < 0 ? 'alert' : 'clock');
    let when;
    if (i.diff < 0) when = `просрочено на ${Math.abs(i.diff)} ${daysWord(Math.abs(i.diff))}`;
    else if (i.diff === 0) when = 'сегодня';
    else if (i.diff === 1) when = 'завтра';
    else when = `через ${i.diff} ${daysWord(i.diff)}`;
    return `
      <button class="dash-deadline ${tone}" data-project-id="${i.projectId}">
        <span class="dash-deadline-ic">${svgIcon(icon, 'sm')}</span>
        <span class="dash-deadline-body">
          <span class="dash-deadline-name">${escapeHTML(i.projectName)} — ${escapeHTML(i.title)}</span>
          <span class="dash-deadline-meta">${CONFIG.STATUS_LABELS[i.status] || ''} · ${when}</span>
        </span>
        <span class="dash-deadline-when">${i.date.toLocaleDateString('ru', { day: 'numeric', month: 'short' })}</span>
      </button>
    `;
  }).join('');

  return `
    <div class="stat-card">
      <h3>Дедлайны и вехи ${statIcon('clock', 'accent')}</h3>
      <div class="dash-deadline-list">${rows}</div>
    </div>
  `;
}

function renderMonths(projects) {
  const monthNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const now = new Date();
  const buckets = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ y: d.getFullYear(), m: d.getMonth(), label: monthNames[d.getMonth()], count: 0 });
  }
  projects.forEach(p => {
    const cd = parseDate(p.created_at);
    if (!cd) return;
    buckets.forEach(b => {
      if (cd.getFullYear() === b.y && cd.getMonth() === b.m) b.count++;
    });
  });
  const max = Math.max(1, ...buckets.map(b => b.count));

  const bars = buckets.map(b => {
    const h = b.count ? Math.max(6, Math.round(b.count / max * 100)) : 0;
    return `
      <div class="dash-bar-col" title="${b.label}: ${b.count}">
        <span class="dash-bar-count">${b.count}</span>
        <div class="dash-bar-shape" style="height:${h}%"></div>
        <span class="dash-bar-label">${b.label}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="stat-card">
      <h3>Создано проектов ${statIcon('bar-chart', 'accent')}</h3>
      <div class="dash-bars">${bars}</div>
      <div class="dash-hint">За последние 6 месяцев</div>
    </div>
  `;
}

function renderActivity(activity) {
  const items = activity.slice(0, 8);
  if (items.length === 0) {
    return `
      <div class="stat-card dash-activity">
        <h3>Последняя активность ${statIcon('activity', 'accent')}</h3>
        <div class="dash-hint" style="margin-top:10px">Активность появится здесь по мере работы над проектами.</div>
      </div>
    `;
  }

  const rows = items.map(a => {
    const meta = ACTIVITY_MAP[a.type] || { icon: 'activity', cls: '', label: escapeHTML(a.type || 'событие') };
    const name = a.project_name ? escapeHTML(a.project_name) : 'Без проекта';
    return `
      <div class="dash-feed-item">
        <span class="dash-feed-dot ${meta.cls}">${svgIcon(meta.icon, 'sm')}</span>
        <span class="dash-feed-text">${meta.label} · <b>${name}</b></span>
        <span class="dash-feed-time">${formatDate(a.timestamp)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="stat-card dash-activity">
      <h3>Последняя активность ${statIcon('activity', 'accent')}</h3>
      <div class="dash-feed">${rows}</div>
    </div>
  `;
}

function bindDashboardEvents() {
  const btnBack = document.getElementById('btnBackToList');
  if (btnBack) {
    btnBack.addEventListener('click', () => goList());
  }

  const btnRefresh = document.getElementById('btnDashRefresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      const { loadProjects, render } = await import('../app.js');
      await loadProjects();
      render();
    });
  }

  const btnCreate = document.getElementById('btnQuickCreate');
  if (btnCreate) {
    btnCreate.addEventListener('click', async () => {
      const { openCreateProjectModal } = await import('./modal.js');
      const { loadProjects, render } = await import('../app.js');
      openCreateProjectModal(async () => {
        await loadProjects();
        render();
      });
    });
  }

  const btnKanban = document.getElementById('btnQuickKanban');
  if (btnKanban) {
    btnKanban.addEventListener('click', () => goView('kanban'));
  }

  const btnCalendar = document.getElementById('btnQuickCalendar');
  if (btnCalendar) {
    btnCalendar.addEventListener('click', () => goView('calendar'));
  }

  // Клик по карточке «Проекты» → просто список проектов
  document.querySelectorAll('.stat-card[data-goto="list"]').forEach(card => {
    card.addEventListener('click', () => goList());
  });

  // Клик по карточке «Просрочено» → список, сортировка по дедлайну
  const overdueCard = document.querySelector('.stat-card[data-overdue]');
  if (overdueCard) {
    overdueCard.addEventListener('click', () => goList(s => { s.sortOrder = 'deadline'; }));
  }

  // Статусы в легенде
  document.querySelectorAll('.dash-legend-row[data-status]').forEach(row => {
    row.addEventListener('click', () => goList(s => { s.filterStatus = row.dataset.status; }));
  });

  // Приоритеты
  document.querySelectorAll('.dash-chip[data-priority]').forEach(chip => {
    chip.addEventListener('click', () => goList(s => { s.filterPriority = chip.dataset.priority; }));
  });

  // Дедлайны → открыть проект
  document.querySelectorAll('.dash-deadline[data-project-id]').forEach(el => {
    el.addEventListener('click', () => openProject(el.dataset.projectId));
  });
}

async function goList(setup) {
  store.currentView = 'list';
  store.currentProjectId = null;
  store.showTrash = false;
  store.selectionMode = false;
  store.selectedIds = [];
  store.searchQuery = '';
  store.filterTag = '';
  store.filterFavorite = false;
  store.filterStatus = '';
  store.filterPriority = '';
  if (typeof setup === 'function') setup(store);
  const { render } = await import('../app.js');
  render();
}

async function goView(view) {
  store.currentView = view;
  store.currentProjectId = null;
  store.showTrash = false;
  const { render } = await import('../app.js');
  render();
}

async function openProject(id) {
  if (!id) return;
  store.currentProjectId = id;
  store.currentView = 'detail';
  store.currentDetailTab = 'notes';
  const { render } = await import('../app.js');
  render();
}
