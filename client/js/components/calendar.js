import store from '../store.js';
import api from '../api.js';
import { svgIcon, escapeHTML, showToast } from '../utils/dom.js';

const MN = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MNS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const DW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DWF = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

const TYPES = {
  deadline: { label: 'Дедлайн', icon: 'clock', solid: true },
  start: { label: 'Старт', icon: 'activity' },
  milestone: { label: 'Веха', icon: 'flag' }
};

let cursor = new Date();
let view = 'month';
let query = '';
const hiddenProjects = new Set();
const hiddenTypes = new Set();
let eventsCache = [];
let byDate = {};
let globalsBound = false;
let drawerKey = null;

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseYmd(s) {
  if (!s) return null;
  const p = String(s).slice(0, 10).split('-');
  if (p.length !== 3) return null;
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return isNaN(d.getTime()) ? null : d;
}
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function firstDow(y, m) { return (new Date(y, m, 1).getDay() + 6) % 7; }
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}
function todayKey() { return ymd(new Date()); }
function diffDays(a, b) {
  return Math.round((parseYmd(a) - parseYmd(b)) / 86400000);
}
function humanDate(s) {
  const d = parseYmd(s);
  return d ? (d.getDate() + ' ' + MNS[d.getMonth()] + ' ' + d.getFullYear()) : s;
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function collectEvents() {
  const list = [];
  store.projects.filter(p => !p.deleted_at).forEach(p => {
    const color = p.color || '#2f6df6';
    if (p.deadline) {
      list.push({ key: 'd:' + p.id, type: 'deadline', projectId: p.id, projectName: p.name,
        title: p.name, date: String(p.deadline).slice(0, 10), color, status: p.status });
    }
    if (p.start_date) {
      list.push({ key: 's:' + p.id, type: 'start', projectId: p.id, projectName: p.name,
        title: 'Старт: ' + p.name, date: String(p.start_date).slice(0, 10), color, status: p.status });
    }
    (p.milestones || []).forEach(m => {
      if (!m.date) return;
      list.push({ key: 'm:' + m.id, type: 'milestone', projectId: p.id, milestoneId: m.id,
        projectName: p.name, title: m.title || 'Веха', date: String(m.date).slice(0, 10),
        color, status: p.status });
    });
  });
  return list;
}

function isOverdue(e) {
  return e.type === 'deadline' && e.date < todayKey() && e.status !== 'done' && e.status !== 'archive';
}

function isVisible(e) {
  if (hiddenProjects.has(e.projectId) || hiddenTypes.has(e.type)) return false;
  if (query) {
    const q = query.toLowerCase();
    if ((e.title + ' ' + e.projectName).toLowerCase().indexOf(q) === -1) return false;
  }
  return true;
}

function groupByDate(list) {
  const m = {};
  list.forEach(e => { (m[e.date] = m[e.date] || []).push(e); });
  Object.keys(m).forEach(k => m[k].sort((a, b) => {
    const sa = TYPES[a.type].solid ? 0 : 1, sb = TYPES[b.type].solid ? 0 : 1;
    return sa - sb || a.title.localeCompare(b.title);
  }));
  return m;
}

function evHTML(e, compact) {
  const solid = TYPES[e.type].solid;
  const ovd = isOverdue(e);
  const cls = 'cal-ev' + (solid ? ' solid' : '') + (ovd ? ' overdue' : '');
  const icon = compact ? '' : svgIcon(TYPES[e.type].icon, 'xs');
  return '<div class="' + cls + '" style="--cal:' + e.color + '" draggable="true"' +
    ' title="' + escapeHTML(e.title + ' · ' + e.projectName) + '"' +
    ' data-key="' + e.key + '" data-project="' + e.projectId + '">' +
    icon + '<span>' + escapeHTML(e.title) + '</span></div>';
}

function emptyBox(text) {
  return '<div class="cal-panel cal-empty">' + svgIcon('calendar', 'xl') +
    '<div class="cal-empty-title">' + escapeHTML(text) + '</div>' +
    '<div class="cal-empty-sub">Добавьте дедлайны и вехи в проектах — они появятся здесь.</div></div>';
}

function countdownBadge(cd) {
  const cls = cd === 0 ? ' cal-cd-over' : (cd <= 3 ? ' cal-cd-soon' : '');
  const txt = cd === 0 ? 'сегодня' : (cd > 0 ? 'через ' + cd + ' ' + plural(cd, 'день', 'дня', 'дней') : cd + ' дн.');
  return '<span class="cal-cd' + cls + '">' + txt + '</span>';
}

function renderMonth() {
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const rows = Math.ceil((firstDow(y, m) + daysInMonth(y, m)) / 7);
  let day = 1 - firstDow(y, m);
  let h = '<div class="cal-grid">';
  h += '<div class="cal-wk"></div>';
  DW.forEach((d, i) => { h += '<div class="cal-dow' + (i > 4 ? ' we' : '') + '">' + d + '</div>'; });
  for (let r = 0; r < rows; r++) {
    h += '<div class="cal-wk">' + isoWeek(new Date(y, m, day)) + '</div>';
    for (let i = 0; i < 7; i++, day++) {
      const d = new Date(y, m, day);
      const key = ymd(d);
      const mute = d.getMonth() !== m;
      const isToday = key === todayKey();
      const we = i > 4;
      const list = mute ? [] : (byDate[key] || []);
      const ovd = list.some(isOverdue);
      h += '<div class="cal-day' + (mute ? ' mute' : '') + (we ? ' we' : '') + (isToday ? ' today' : '') + '" data-day="' + key + '">';
      if (ovd) h += '<span class="cal-ovd-dot" title="Есть просроченный дедлайн"></span>';
      h += '<button class="cal-day-add" data-add-day="' + key + '" title="Добавить событие" aria-label="Добавить событие">' + svgIcon('plus', 'xs') + '</button>';
      h += '<div class="cal-day-num">' + d.getDate() + '</div>';
      list.slice(0, 3).forEach(e => { h += evHTML(e, true); });
      if (list.length > 3) h += '<div class="cal-ev-more" data-more="' + key + '">+' + (list.length - 3) + ' ещё</div>';
      h += '</div>';
    }
  }
  return h + '</div>';
}

function renderWeek() {
  const off = (cursor.getDay() + 6) % 7;
  const start = new Date(cursor);
  start.setDate(cursor.getDate() - off);
  let h = '<div class="cal-grid cal-week">';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = ymd(d);
    const list = byDate[key] || [];
    h += '<div class="cal-day' + (i > 4 ? ' we' : '') + (key === todayKey() ? ' today' : '') + '" data-day="' + key + '">';
    h += '<button class="cal-day-add" data-add-day="' + key + '" title="Добавить событие" aria-label="Добавить событие">' + svgIcon('plus', 'xs') + '</button>';
    h += '<div class="cal-dow' + (i > 4 ? ' we' : '') + '">' + DW[i] + ' · ' + d.getDate() + ' ' + MNS[d.getMonth()] + '</div>';
    if (!list.length) h += '<div class="cal-week-empty">—</div>';
    list.forEach(e => { h += evHTML(e, false); });
    h += '</div>';
  }
  return h + '</div>';
}

function renderAgenda() {
  const keys = Object.keys(byDate).filter(k => k >= todayKey()).sort();
  if (!keys.length) return emptyBox('Нет предстоящих событий');
  let h = '<div class="cal-panel cal-agenda">';
  keys.forEach(k => {
    const d = parseYmd(k);
    const cd = diffDays(k, todayKey());
    h += '<div class="cal-ag-day"><div class="cal-ag-left">' +
      '<div class="cal-ag-date">' + d.getDate() + ' ' + MNS[d.getMonth()] + '</div>' +
      '<div class="cal-ag-dow">' + DWF[(d.getDay() + 6) % 7] + '</div></div>' +
      '<div class="cal-ag-items">';
    byDate[k].forEach(e => {
      h += '<div class="cal-ag-item" data-project="' + e.projectId + '">' +
        '<span class="cal-dot" style="background:' + e.color + '"></span>' +
        '<span class="cal-ag-ic">' + svgIcon(TYPES[e.type].icon, 'sm') + '</span>' +
        '<span class="cal-ag-title">' + escapeHTML(e.title) + '</span>' +
        (e.title !== e.projectName ? '<span class="cal-ag-proj">' + escapeHTML(e.projectName) + '</span>' : '') +
        countdownBadge(cd) + '</div>';
    });
    h += '</div></div>';
  });
  return h + '</div>';
}

function renderTimeline() {
  if (!eventsCache.length) return emptyBox('Нет событий');
  const times = eventsCache.map(e => parseYmd(e.date).getTime());
  const min = new Date(Math.min.apply(null, times));
  min.setDate(1);
  min.setHours(0, 0, 0, 0);
  const max = new Date(Math.max.apply(null, times));
  max.setMonth(max.getMonth() + 1, 0);
  const span = max - min || 1;
  const months = [];
  for (let d = new Date(min); d <= max; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(new Date(d));
  const pos = ds => ((parseYmd(ds).getTime() - min.getTime()) / span * 100);

  const projects = [];
  const seen = new Set();
  eventsCache.forEach(e => { if (!seen.has(e.projectId)) { seen.add(e.projectId); projects.push({ id: e.projectId, name: e.projectName, color: e.color }); } });

  const tk = todayKey();
  const showToday = pos(tk) >= 0 && pos(tk) <= 100;

  let h = '<div class="cal-panel cal-tl">';
  h += '<div class="cal-tl-head"><div class="cal-tl-namecol">Проект</div><div class="cal-tl-months">' +
    months.map(mo => '<div class="cal-tl-mo">' + MN[mo.getMonth()] + ' ' + String(mo.getFullYear()).slice(2) + '</div>').join('') +
    '</div></div>';
  h += '<div class="cal-tl-body">';
  if (showToday) h += '<div class="cal-tl-today" style="left:calc(190px + (100% - 190px) * ' + (pos(tk) / 100) + ')"></div>';
  projects.forEach(p => {
    const pe = eventsCache.filter(e => e.projectId === p.id);
    const pts = pe.map(e => parseYmd(e.date).getTime());
    const left = pos(ymd(new Date(Math.min.apply(null, pts))));
    const right = pos(ymd(new Date(Math.max.apply(null, pts))));
    const width = Math.max(3, right - left);
    h += '<div class="cal-tl-row">' +
      '<div class="cal-tl-name"><span class="cal-dot" style="background:' + p.color + '"></span>' + escapeHTML(p.name) + '</div>' +
      '<div class="cal-tl-track"><div class="cal-tl-grid">' + months.map(() => '<div></div>').join('') + '</div>' +
      '<div class="cal-tl-bar" style="left:' + left + '%;width:' + width + '%;background:' + p.color + '">' + pe.length + '</div></div></div>';
  });
  return h + '</div></div>';
}

function renderStage() {
  if (view === 'week') return renderWeek();
  if (view === 'agenda') return renderAgenda();
  if (view === 'timeline') return renderTimeline();
  return renderMonth();
}

function renderStats() {
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const inMonth = eventsCache.filter(e => { const d = parseYmd(e.date); return d && d.getMonth() === m && d.getFullYear() === y; }).length;
  const overdue = eventsCache.filter(isOverdue).length;
  const todayN = (byDate[todayKey()] || []).length;
  const nextDl = eventsCache.filter(e => e.type === 'deadline' && e.date >= todayKey())
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const cd = nextDl ? diffDays(nextDl.date, todayKey()) : null;

  const card = (icon, cls, value, label, color) =>
    '<div class="cal-stat"><div class="cal-stat-ic ' + cls + '">' + svgIcon(icon) + '</div>' +
    '<div class="cal-stat-body"><div class="cal-stat-v"' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</div>' +
    '<div class="cal-stat-l">' + label + '</div></div></div>';

  return '<div class="cal-stats" id="calStats">' +
    card('calendar', 'accent', inMonth, 'событий в месяце') +
    card('clock', 'red', overdue, 'просрочено', overdue ? 'var(--red)' : '') +
    card('flag', 'green', todayN, 'сегодня', todayN ? 'var(--green)' : '') +
    card('tag', 'orange', cd === null ? '—' : (cd === 0 ? 'сегодня' : 'через ' + cd + ' ' + plural(cd, 'день', 'дня', 'дней')),
      nextDl ? 'до ' + escapeHTML(nextDl.title.slice(0, 24)) : 'ближайший дедлайн') +
    '</div>';
}

function renderUpcoming() {
  const up = eventsCache.filter(e => e.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7);
  let h = '<div class="cal-side-h"><span class="cal-side-title">Ближайшие события</span>' +
    '<span class="cal-side-count">' + up.length + '</span></div>';
  if (!up.length) return h + '<div class="cal-side-empty">Нет предстоящих событий</div>';
  h += up.map(e => {
    const d = parseYmd(e.date);
    const cd = diffDays(e.date, todayKey());
    return '<button class="cal-up" data-project="' + e.projectId + '" data-day="' + e.date + '">' +
      '<span class="cal-up-date"><span class="cal-up-dow">' + DW[(d.getDay() + 6) % 7] + '</span>' +
      '<span class="cal-up-day">' + d.getDate() + '</span></span>' +
      '<span class="cal-up-body"><span class="cal-up-title">' + escapeHTML(e.title) + '</span>' +
      '<span class="cal-up-meta"><span class="cal-dot" style="background:' + e.color + '"></span>' +
      (e.title !== e.projectName ? escapeHTML(e.projectName) : TYPES[e.type].label) +
      countdownBadge(cd) + '</span></span></button>';
  }).join('');
  return h;
}

function renderFilters(allEvents) {
  const projMap = {};
  allEvents.forEach(e => { projMap[e.projectId] = { name: e.projectName, color: e.color }; });
  let h = '<div class="cal-side-h"><span class="cal-side-title">Фильтры</span>' +
    (hiddenProjects.size || hiddenTypes.size ? '<button class="cal-side-reset" id="calResetFilters">Сбросить</button>' : '') +
    '</div><div class="cal-filters">';
  h += '<div class="cal-filters-label">Проекты</div>';
  Object.keys(projMap).forEach(id => {
    const p = projMap[id];
    h += '<button class="cal-fchip' + (hiddenProjects.has(id) ? ' off' : '') + '" data-fp="' + id + '">' +
      '<span class="cal-dot" style="background:' + p.color + '"></span>' + escapeHTML(p.name) + '</button>';
  });
  h += '<div class="cal-filters-label">Типы</div>';
  Object.keys(TYPES).forEach(t => {
    h += '<button class="cal-fchip' + (hiddenTypes.has(t) ? ' off' : '') + '" data-ft="' + t + '">' +
      svgIcon(TYPES[t].icon, 'xs') + TYPES[t].label + '</button>';
  });
  h += '</div>';
  h += '<div class="cal-legend">' +
    '<div class="cal-legend-row"><span class="cal-legend-chip" style="background:var(--red)"></span> Дедлайн (твёрдая плашка)</div>' +
    '<div class="cal-legend-row"><span class="cal-legend-chip soft"></span> Веха · Старт</div>' +
    '<div class="cal-legend-row"><span class="cal-legend-chip ring"></span> Просрочено</div>' +
    '</div>';
  return h;
}

function title() {
  if (view === 'agenda') return '<span>Повестка</span> <small>от ' + humanDate(todayKey()) + '</small>';
  if (view === 'timeline') return '<span>Таймлайн</span> <small>проектов по событиям</small>';
  if (view === 'week') {
    const off = (cursor.getDay() + 6) % 7;
    const s = new Date(cursor); s.setDate(cursor.getDate() - off);
    const e = new Date(s); e.setDate(s.getDate() + 6);
    return '<span>' + MN[s.getMonth()] + ' ' + s.getFullYear() + '</span> <small>' + s.getDate() + ' ' + MNS[s.getMonth()] + ' — ' + e.getDate() + ' ' + MNS[e.getMonth()] + '</small>';
  }
  return '<span>' + MN[cursor.getMonth()] + ' ' + cursor.getFullYear() + '</span>';
}

export function renderCalendar() {
  const allEvents = collectEvents();
  eventsCache = allEvents.filter(isVisible);
  byDate = groupByDate(eventsCache);

  const seg = ['month', 'week', 'agenda', 'timeline'].map((v, i) => {
    const labels = ['Месяц', 'Неделя', 'Повестка', 'Таймлайн'];
    return '<button data-view="' + v + '" class="' + (view === v ? 'on' : '') + '">' + labels[i] + '</button>';
  }).join('');

  const head = `
    <button class="detail-back" id="calBackToList">
      ${svgIcon('chevron-left', 'sm')} К проектам
    </button>
    <div class="cal-head">
      <div class="cal-title">${title()}</div>
      <div class="cal-head-actions">
        <div class="cal-search">
          ${svgIcon('search', 'sm')}
          <input class="cal-search-input" id="calSearch" placeholder="Поиск события…" value="${escapeHTML(query)}">
        </div>
        <div class="cal-seg" id="calSeg">${seg}</div>
        <div class="cal-nav">
          <button class="btn btn-sm btn-secondary" id="calPrev" title="Назад">${svgIcon('chevron-left', 'sm')}</button>
          <button class="btn btn-sm btn-secondary" id="calToday">Сегодня</button>
          <button class="btn btn-sm btn-secondary" id="calNext" title="Вперёд">${svgIcon('chevron-right', 'sm')}</button>
        </div>
      </div>
    </div>`;

  const layout = `
    <div class="cal-layout">
      <div class="cal-stage" id="calStage">${renderStage()}</div>
      <aside class="cal-side" id="calSide">
        ${renderUpcoming()}
        ${renderFilters(allEvents)}
      </aside>
    </div>`;

  setTimeout(bindCalendar, 0);
  return head + renderStats() + layout;
}

function rerender() {
  import('../app.js').then(m => m.render());
}

function addRefresh(dateKey) {
  import('../app.js').then(async m => {
    await m.loadProjects();
    const d = dateKey ? parseYmd(dateKey) : null;
    if (d) cursor = d;
    m.render();
  });
}

function openAddEvent(key) {
  const projects = (store.projects || []).filter(p => !p.deleted_at);
  if (!projects.length) {
    import('./modal.js').then(m => m.openCreateProjectModal(() => addRefresh()));
    return;
  }
  import('./modal-forms.js').then(m => m.openCalendarEventModal({ dateKey: key, onSuccess: addRefresh }));
}

function openProject(id) {
  if (!id) return;
  closeOverlays();
  store.currentProjectId = id;
  store.currentView = 'detail';
  store.currentDetailTab = 'notes';
  rerender();
}

function closeOverlays() {
  const dr = document.getElementById('calDrawer');
  const bd = document.getElementById('calBackdrop');
  const pop = document.getElementById('calPop');
  if (dr) dr.classList.remove('open');
  if (bd) bd.classList.remove('open');
  if (pop) pop.classList.remove('open');
}

function mountOverlays() {
  const old = document.getElementById('calOverlayHost');
  if (old) old.remove();
  const host = document.createElement('div');
  host.id = 'calOverlayHost';
  host.innerHTML = `
    <div class="cal-backdrop" id="calBackdrop"></div>
    <div class="cal-pop" id="calPop"></div>
    <aside class="cal-drawer" id="calDrawer">
      <div class="cal-drawer-h">
        <div>
          <div class="cal-drawer-day" id="calDrawerDay"></div>
          <div class="cal-drawer-sub" id="calDrawerSub"></div>
        </div>
        <button class="btn-icon ghost" id="calDrawerClose" title="Закрыть">${svgIcon('x')}</button>
      </div>
      <div class="cal-drawer-add-wrap">
        <button class="cal-drawer-add" id="calDrawerAdd">${svgIcon('plus', 'sm')} Добавить событие</button>
      </div>
      <div class="cal-drawer-b" id="calDrawerBody"></div>
    </aside>`;
  document.body.appendChild(host);
  host.querySelector('#calDrawerClose').addEventListener('click', closeOverlays);
  host.querySelector('#calDrawerAdd').addEventListener('click', () => { if (drawerKey) openAddEvent(drawerKey); });
  host.querySelector('#calBackdrop').addEventListener('click', closeOverlays);
}

function openDrawer(key) {
  if (!key) return;
  drawerKey = key;
  const d = parseYmd(key);
  const list = byDate[key] || [];
  const dayEl = document.getElementById('calDrawerDay');
  if (!dayEl) return;
  dayEl.textContent = d.getDate() + ' ' + MN[d.getMonth()].toLowerCase();
  document.getElementById('calDrawerSub').textContent =
    DWF[(d.getDay() + 6) % 7] + ', ' + d.getFullYear() + ' · ' + list.length + ' ' + plural(list.length, 'событие', 'события', 'событий');
  const body = document.getElementById('calDrawerBody');
  if (!list.length) {
    body.innerHTML = '<div class="cal-drawer-empty">На этот день событий нет</div>';
  } else {
    body.innerHTML = list.map(e => {
      const ovd = isOverdue(e);
      return '<button class="cal-dev" data-project="' + e.projectId + '">' +
        '<span class="cal-dev-bar" style="background:' + e.color + '"></span>' +
        '<span class="cal-dev-body"><span class="cal-dev-t">' + escapeHTML(e.title) + '</span>' +
        '<span class="cal-dev-m"><span class="cal-dev-ic">' + svgIcon(TYPES[e.type].icon, 'xs') + '</span>' +
        TYPES[e.type].label + ' · ' + escapeHTML(e.projectName) +
        (ovd ? '<span class="badge badge-danger badge-xs" style="margin-left:6px">просрочено</span>' : '') +
        '</span></span></button>';
    }).join('');
  }
  body.querySelectorAll('.cal-dev').forEach(el => {
    el.addEventListener('click', () => openProject(el.dataset.project));
  });
  document.getElementById('calDrawer').classList.add('open');
  document.getElementById('calBackdrop').classList.add('open');
}

function showPop(anchor, key) {
  const pop = document.getElementById('calPop');
  if (!pop) return;
  const list = byDate[key] || [];
  pop.innerHTML = '<div class="cal-pop-h">' + humanDate(key) + '</div>' +
    list.map(e => '<div class="cal-ev' + (TYPES[e.type].solid ? ' solid' : '') + '" style="--cal:' + e.color + '" data-project="' + e.projectId + '">' +
      svgIcon(TYPES[e.type].icon, 'xs') + '<span>' + escapeHTML(e.title) + '</span></div>').join('');
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(r.left, window.innerWidth - 260) + 'px';
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 180) + 'px';
  pop.classList.add('open');
  pop.querySelectorAll('.cal-ev').forEach(el => {
    el.addEventListener('click', () => openProject(el.dataset.project));
  });
}

async function moveEvent(ev, newDate) {
  if (!newDate || newDate === ev.date) return;
  try {
    if (ev.type === 'deadline') {
      await api.updateProject(ev.projectId, { deadline: newDate });
    } else if (ev.type === 'start') {
      await api.updateProject(ev.projectId, { startDate: newDate });
    } else if (ev.type === 'milestone') {
      await api.updateMilestone(ev.projectId, ev.milestoneId, { date: newDate });
    }
    const p = store.projects.find(x => x.id === ev.projectId);
    if (p) {
      if (ev.type === 'deadline') p.deadline = newDate;
      else if (ev.type === 'start') p.start_date = newDate;
      else if (ev.type === 'milestone') (p.milestones || []).forEach(m => { if (String(m.id) === String(ev.milestoneId)) m.date = newDate; });
    }
    showToast('Перенесено на ' + humanDate(newDate));
    rerender();
  } catch (err) {
    showToast(err && err.message ? err.message : 'Не удалось перенести событие', true);
  }
}

function bindGlobals() {
  if (globalsBound) return;
  globalsBound = true;
  document.addEventListener('click', e => {
    if (!e.target.closest('#calPop') && !e.target.closest('.cal-ev-more')) {
      const pop = document.getElementById('calPop');
      if (pop) pop.classList.remove('open');
    }
  });
}

function bindCalendar() {
  bindGlobals();
  mountOverlays();
  bindHead();
  bindSide();
  bindStage();
}

function patchResults() {
  const allEvents = collectEvents();
  eventsCache = allEvents.filter(isVisible);
  byDate = groupByDate(eventsCache);

  const layout = document.querySelector('.cal-layout');
  const stage = document.getElementById('calStage');
  if (!allEvents.length || !layout || !stage) { rerender(); return; }

  const stats = document.getElementById('calStats');
  if (stats) stats.outerHTML = renderStats();
  stage.innerHTML = renderStage();
  const side = document.getElementById('calSide');
  if (side) side.outerHTML = '<aside class="cal-side" id="calSide">' + renderUpcoming() + renderFilters(allEvents) + '</aside>';

  bindSide();
  bindStage();
}

function bindHead() {
  const back = document.getElementById('calBackToList');
  if (back) back.addEventListener('click', () => {
    store.currentView = 'list';
    store.currentProjectId = null;
    rerender();
  });

  const seg = document.getElementById('calSeg');
  if (seg) seg.addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    view = b.dataset.view;
    rerender();
  });

  const prev = document.getElementById('calPrev');
  if (prev) prev.addEventListener('click', () => {
    if (view === 'week') cursor.setDate(cursor.getDate() - 7);
    else cursor.setMonth(cursor.getMonth() - 1);
    rerender();
  });
  const next = document.getElementById('calNext');
  if (next) next.addEventListener('click', () => {
    if (view === 'week') cursor.setDate(cursor.getDate() + 7);
    else cursor.setMonth(cursor.getMonth() + 1);
    rerender();
  });
  const todayBtn = document.getElementById('calToday');
  if (todayBtn) todayBtn.addEventListener('click', () => { cursor = new Date(); rerender(); });

  const search = document.getElementById('calSearch');
  if (search) search.addEventListener('input', () => { query = search.value; patchResults(); });
}

function bindSide() {
  const reset = document.getElementById('calResetFilters');
  if (reset) reset.addEventListener('click', () => {
    hiddenProjects.clear();
    hiddenTypes.clear();
    rerender();
  });

  const side = document.querySelector('.cal-side');
  if (side) side.addEventListener('click', e => {
    const fp = e.target.closest('[data-fp]');
    const ft = e.target.closest('[data-ft]');
    if (fp) {
      const id = fp.dataset.fp;
      if (hiddenProjects.has(id)) hiddenProjects.delete(id); else hiddenProjects.add(id);
      rerender();
    } else if (ft) {
      const t = ft.dataset.ft;
      if (hiddenTypes.has(t)) hiddenTypes.delete(t); else hiddenTypes.add(t);
      rerender();
    }
  });

  document.querySelectorAll('.cal-up').forEach(el => el.addEventListener('click', () => openProject(el.dataset.project)));
}

function bindStage() {
  document.querySelectorAll('.cal-ag-item').forEach(el => el.addEventListener('click', () => openProject(el.dataset.project)));

  document.querySelectorAll('.cal-ev-more').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    showPop(el, el.dataset.more);
  }));

  document.querySelectorAll('.cal-ev[data-key]').forEach(el => {
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', el.dataset.key);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('click', e => {
      e.stopPropagation();
      openProject(el.dataset.project);
    });
  });

  document.querySelectorAll('[data-add-day]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openAddEvent(btn.dataset.addDay);
    });
  });

  document.querySelectorAll('.cal-day[data-day]').forEach(day => {
    day.addEventListener('click', e => {
      if (e.target.closest('.cal-ev') || e.target.closest('.cal-ev-more') || e.target.closest('.cal-day-add')) return;
      openDrawer(day.dataset.day);
    });
    day.addEventListener('dragover', e => { e.preventDefault(); day.classList.add('cal-drop'); });
    day.addEventListener('dragleave', () => day.classList.remove('cal-drop'));
    day.addEventListener('drop', e => {
      e.preventDefault();
      day.classList.remove('cal-drop');
      const key = e.dataTransfer.getData('text/plain');
      const ev = eventsCache.find(x => x.key === key);
      if (ev) moveEvent(ev, day.dataset.day);
    });
  });
}
