import store from '../store.js';
import api from '../api.js';
import CONFIG from '../config.js';
import { svgIcon, escapeHTML, formatDate, formatFileSize, showToast } from '../utils/dom.js';
import { renderMarkdown } from '../utils/format.js';
import { parseMindmapFiles } from '../utils/mindmap-files.js';
import { fileIconName } from './attachments.js';
import { refsPreviewHTML } from './entity-refs.js';

var currentCleanup = null;
var mindmapInitToken = 0;
var mindMapMenuEl = null;
var previewEl = null;
var previewTimer = null;
var showRootLinks = localStorage.getItem('mm_root_links') !== '0';

function destroyMindMap() {
  if (currentCleanup) {
    try { currentCleanup(); } catch (e) {}
    currentCleanup = null;
  }
  hideMindMapMenu();
  hideNodePreview();
}

function hideNodePreview() {
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
  if (previewEl) { previewEl.remove(); previewEl = null; }
}

function previewCard(icon, title, meta, bodyHTML, filesHTML) {
  var h = '<div class="mm-preview-head">' + svgIcon(icon, 'sm') + '<span>' + escapeHTML(title) + '</span></div>';
  if (meta) h += '<div class="mm-preview-meta">' + meta + '</div>';
  if (bodyHTML) h += '<div class="mm-preview-body">' + bodyHTML + '</div>';
  if (filesHTML) h += filesHTML;
  return h;
}

// Вложения сущности в превью узла
function previewAttachments(attachments, proj) {
  var list = Array.isArray(attachments) ? attachments : [];
  if (!list.length) return '';
  var files = proj.files || [];
  var rows = list.map(function(a) {
    var name, missing;
    if (a.kind === 'upload') {
      var f = files.filter(function(x) { return x.id === a.id; })[0];
      name = f ? f.original_name : (a.name || ('Файл #' + a.id));
      missing = !f || a.missing;
    } else {
      name = a.name || a.path;
      missing = a.missing;
    }
    return '<div class="mm-preview-file' + (missing ? ' missing' : '') + '">' +
      svgIcon(fileIconName(name), 'sm') + ' <span>' + escapeHTML(name) + '</span></div>';
  }).join('');
  return '<div class="mm-preview-files"><div class="mm-preview-files-label">' + svgIcon('file', 'sm') + ' Вложения</div>' + rows + '</div>';
}

function nodeIconName(n) {
  if (n.isRoot) return 'mindmap';
  if (n.type === 'heading') return 'layers';
  if (n.type === 'note') return 'note';
  if (n.type === 'checklist') return 'check';
  if (n.type === 'milestone') return 'flag';
  if (n.type === 'version') return 'git-branch';
  return 'file';
}

function buildNodeHTML(n) {
  var iconName = nodeIconName(n);
  var borderStyle = n.isRoot ? '' : 'border-color:' + n.color + ';border-width:2px';
  var iconColor = n.isRoot ? '#fff' : n.color;
  var cls = 'mindmap-node' + (n.isRoot ? ' root' : '') + (n.type === 'heading' ? ' heading' : '');
  var disp = n.hidden ? 'display:none;' : '';

  var h = '<div class="' + cls + '" id="mm_' + n.id + '" style="left:' + n.x + 'px;top:' + n.y + 'px;' + borderStyle + disp + '" data-node-id="' + n.id + '">';
  h += '<span class="mm-node-icon" style="color:' + iconColor + '">' + svgIcon(iconName, 'sm') + '</span>';
  h += '<span class="mm-node-label">' + escapeHTML(n.label) + '</span>';
  if (n.type === 'heading') {
    var count = n.childrenCount || 0;
    h += '<span class="mm-node-badge"' + (count ? '' : ' style="display:none"') + '>' + count + '</span>';
    h += '<span class="mm-node-chevron">' + svgIcon(n.collapsed ? 'chevron-right' : 'chevron-down', 'sm') + '</span>';
  }
  h += '</div>';
  return h;
}

function isHeading(n) { return n && n.type === 'heading'; }

// Пересчитывает видимость детей свёрнутых групп
function applyHiddenStates(data) {
  if (!data || !data.headings) return;
  var hidden = {};
  for (var i = 0; i < data.headings.length; i++) {
    var h = data.headings[i];
    if (!h.collapsed) continue;
    var kids = h.children || [];
    for (var j = 0; j < kids.length; j++) hidden[kids[j]] = true;
  }
  for (var k = 0; k < data.nodes.length; k++) {
    var n = data.nodes[k];
    if (isHeading(n) || n.isRoot) continue;
    n.hidden = !!hidden[n.id];
    var el = document.getElementById('mm_' + n.id);
    if (el) el.style.display = n.hidden ? 'none' : '';
  }
}

// Рамки групп: огибают заголовок и видимых детей
function updateGroupFrames(data) {
  if (!data || !data.headings) return;
  var layer = document.getElementById('mindmapNodesLayer');
  if (!layer) return;

  var frames = {};
  var existing = layer.querySelectorAll('.mm-group-frame');
  for (var e = 0; e < existing.length; e++) frames[existing[e].dataset.headingId] = existing[e];

  for (var i = 0; i < data.headings.length; i++) {
    var h = data.headings[i];
    var hnode = findNode(data.nodes, h.id);
    if (!hnode) continue;

    var childNodes = (h.children || []).map(function(id) { return findNode(data.nodes, id); })
      .filter(function(n) { return n && !n.hidden; });

    if (h.collapsed || !childNodes.length) {
      if (frames[h.id]) frames[h.id].style.display = 'none';
      continue;
    }

    var boxes = [hnode].concat(childNodes).map(function(n) {
      var el = document.getElementById('mm_' + n.id);
      if (!el) return null;
      var w = el.offsetWidth || 120;
      var hh = el.offsetHeight || 34;
      return { l: n.x - w / 2, t: n.y - hh / 2, r: n.x + w / 2, b: n.y + hh / 2 };
    }).filter(Boolean);
    if (!boxes.length) continue;

    var minL = Math.min.apply(null, boxes.map(function(b) { return b.l; }));
    var minT = Math.min.apply(null, boxes.map(function(b) { return b.t; }));
    var maxR = Math.max.apply(null, boxes.map(function(b) { return b.r; }));
    var maxB = Math.max.apply(null, boxes.map(function(b) { return b.b; }));
    var padX = 22, padTop = 14, padBottom = 18;

    var f = frames[h.id];
    if (!f) {
      f = document.createElement('div');
      f.className = 'mm-group-frame';
      f.dataset.headingId = h.id;
      layer.insertBefore(f, layer.firstChild);
      frames[h.id] = f;
    }
    f.style.display = '';
    f.style.left = (minL - padX) + 'px';
    f.style.top = (minT - padTop) + 'px';
    f.style.width = (maxR - minL + padX * 2) + 'px';
    f.style.height = (maxB - minT + padTop + padBottom) + 'px';
  }
}

// Определяет, в какую группу попал узел (по центру)
function findGroupAt(data, x, y) {
  if (!data.headings) return null;
  var best = null;
  for (var i = 0; i < data.headings.length; i++) {
    var h = data.headings[i];
    var hnode = findNode(data.nodes, h.id);
    if (!hnode) continue;
    var childNodes = (h.children || []).map(function(id) { return findNode(data.nodes, id); })
      .filter(function(n) { return n && !n.hidden; });
    var boxes = [hnode].concat(childNodes).map(function(n) {
      var el = document.getElementById('mm_' + n.id);
      var w = (el && el.offsetWidth) || 120;
      var hh = (el && el.offsetHeight) || 34;
      return { l: n.x - w / 2, t: n.y - hh / 2, r: n.x + w / 2, b: n.y + hh / 2 };
    });
    var pad = childNodes.length ? 22 : 46;
    for (var b = 0; b < boxes.length; b++) {
      if (x >= boxes[b].l - pad && x <= boxes[b].r + pad && y >= boxes[b].t - pad && y <= boxes[b].b + pad) {
        best = h;
        break;
      }
    }
    if (best) break;
  }
  return best;
}

function setNodeParent(data, nodeId, headingId) {
  var node = findNode(data.nodes, nodeId);
  if (!node || isHeading(node)) return;
  // Убираем из прежней группы
  for (var i = 0; i < data.headings.length; i++) {
    var kids = data.headings[i].children || [];
    var idx = kids.indexOf(nodeId);
    if (idx >= 0) kids.splice(idx, 1);
  }
  node.parent = null;
  if (headingId) {
    var h = data.headings.filter(function(x) { return x.id === headingId; })[0];
    if (h) {
      h.children = h.children || [];
      if (h.children.indexOf(nodeId) < 0) h.children.push(nodeId);
      node.parent = headingId;
    }
  }
  refreshHeadingBadges(data);
  saveMindMapHeadings();
}

// Распускает все блоки из группы (заголовок остаётся, блоки освобождаются)
function ungroupHeading(headingId) {
  var data = window._mindmapData;
  if (!data) return;
  var h = (data.headings || []).filter(function(x) { return x.id === headingId; })[0];
  if (!h) return;
  (h.children || []).forEach(function(cid) {
    var n = findNode(data.nodes, cid);
    if (n) n.parent = null;
  });
  h.children = [];
  h.collapsed = false;
  refreshHeadingBadges(data);
  applyHiddenStates(data);
  updateGroupFrames(data);
  updateSvgLines(data);
  saveMindMapHeadings();
}

// ===================== Режим выделения блоков =====================

function selectedIds(data) {
  var out = [];
  if (!data || !data.selected) return out;
  for (var k in data.selected) {
    if (data.selected[k]) out.push(k);
  }
  return out;
}

function enterSelectMode(nodeId) {
  var data = window._mindmapData;
  if (!data) return;
  hideMindMapMenu();
  data.selectMode = true;
  data.selected = {};
  if (nodeId) {
    var n = findNode(data.nodes, nodeId);
    if (n && !n.isRoot && !isHeading(n)) data.selected[nodeId] = true;
  }
  applySelectionUI(data);
}

function exitSelectMode() {
  var data = window._mindmapData;
  if (!data) return;
  data.selectMode = false;
  data.selected = {};
  hideMindMapMenu();
  applySelectionUI(data);
}

function toggleNodeSelected(nodeId) {
  var data = window._mindmapData;
  if (!data || !data.selectMode) return;
  if (data.selected[nodeId]) delete data.selected[nodeId];
  else data.selected[nodeId] = true;
  if (!selectedIds(data).length) { exitSelectMode(); return; }
  applySelectionUI(data);
}

// Отрисовка чекбоксов и панели действий
function applySelectionUI(data) {
  var container = document.getElementById(data.containerId);
  if (!container) return;
  container.classList.toggle('mm-selecting', !!data.selectMode);

  var nodeEls = container.querySelectorAll('.mindmap-node');
  for (var i = 0; i < nodeEls.length; i++) {
    var el = nodeEls[i];
    var nid = el.dataset.nodeId;
    var node = findNode(data.nodes, nid);
    var selectable = data.selectMode && node && !node.isRoot && !isHeading(node);
    var check = el.querySelector('.mm-node-check');
    if (selectable) {
      if (!check) {
        check = document.createElement('span');
        check.className = 'mm-node-check';
        el.insertBefore(check, el.firstChild);
      }
      check.innerHTML = data.selected[nid] ? svgIcon('check', 'sm') : '';
      el.classList.toggle('mm-selected', !!data.selected[nid]);
    } else {
      if (check) check.remove();
      el.classList.remove('mm-selected');
    }
  }
  renderMmSelectionBar(data);
}

function renderMmSelectionBar(data) {
  var container = document.getElementById(data.containerId);
  if (!container) return;
  var bar = container.querySelector('.mm-selection-bar');
  if (!data.selectMode) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'mm-selection-bar';
    container.appendChild(bar);
  }

  var ids = selectedIds(data);
  var count = ids.length;
  var hasGroups = (data.headings || []).length > 0;
  var canUngroup = ids.some(function(id) { var n = findNode(data.nodes, id); return n && n.parent; });

  var html = '';
  html += '<div class="selection-info"><span class="selection-badge">' + count + '</span> <span>выбрано</span></div>';
  html += '<div class="selection-actions">';
  html += '<button class="btn btn-sm btn-secondary" id="mmSelGroup"' + (hasGroups ? '' : ' disabled') + '>' + svgIcon('layers', 'sm') + ' Добавить в группу</button>';
  if (canUngroup) {
    html += '<button class="btn btn-sm btn-secondary" id="mmSelUngroup">' + svgIcon('x', 'sm') + ' Убрать из группы</button>';
  }
  if (count === 1) {
    html += '<button class="btn btn-sm btn-secondary" id="mmSelLink">' + svgIcon('git-branch', 'sm') + ' Связать с…</button>';
  }
  html += '<button class="btn btn-sm btn-danger" id="mmSelDelete">' + svgIcon('trash', 'sm') + ' Удалить</button>';
  html += '<button class="btn btn-sm btn-tertiary" id="mmSelCancel">Отмена</button>';
  html += '</div>';
  bar.innerHTML = html;

  var groupBtn = bar.querySelector('#mmSelGroup');
  if (groupBtn && hasGroups) groupBtn.addEventListener('click', function(e) { e.stopPropagation(); openMmGroupMenu(groupBtn, data); });
  var unBtn = bar.querySelector('#mmSelUngroup');
  if (unBtn) unBtn.addEventListener('click', function() { ungroupSelected(data); });
  var linkBtn = bar.querySelector('#mmSelLink');
  if (linkBtn) linkBtn.addEventListener('click', function() { var id = selectedIds(data)[0]; exitSelectMode(); enterLinkMode(id); });
  var delBtn = bar.querySelector('#mmSelDelete');
  if (delBtn) delBtn.addEventListener('click', function() { deleteSelectedNodes(); });
  var cancelBtn = bar.querySelector('#mmSelCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', function() { exitSelectMode(); });
}

function openMmGroupMenu(anchor, data) {
  hideMindMapMenu();
  var menu = document.createElement('div');
  menu.className = 'context-menu';
  var groups = data.headings || [];
  groups.forEach(function(h) {
    addMenuItem(menu, h.label, 'layers', function() { assignSelectedToGroup(data, h.id); });
  });
  if (groups.length) {
    var sep = document.createElement('div');
    sep.className = 'context-menu-separator';
    menu.appendChild(sep);
  }
  addMenuItem(menu, 'Создать группу', 'layers', function() { createGroupForSelected(data); });

  var r = anchor.getBoundingClientRect();
  mountMenu({ clientX: r.left, clientY: r.top }, menu, 220);
  var mr = menu.getBoundingClientRect();
  menu.style.top = Math.max(8, r.top - mr.height - 8) + 'px';
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mr.width - 10)) + 'px';
}

function assignSelectedToGroup(data, headingId) {
  var ids = selectedIds(data);
  ids.forEach(function(id) { setNodeParent(data, id, headingId); });
  applyHiddenStates(data);
  updateGroupFrames(data);
  updateSvgLines(data);
  showToast('В группе: ' + ids.length);
  applySelectionUI(data);
}

function createGroupForSelected(data) {
  var ids = selectedIds(data);
  if (!ids.length) return;
  var pts = ids.map(function(id) { return findNode(data.nodes, id); }).filter(Boolean);
  var cx = data.centerX, topY = data.centerY;
  if (pts.length) {
    var sumX = 0, minY = Infinity;
    pts.forEach(function(n) { sumX += n.x; if (n.y < minY) minY = n.y; });
    cx = sumX / pts.length;
    topY = minY;
  }
  import('./modal.js').then(function(modal) {
    var body = '<div class="form-group"><span class="form-label">Название группы</span>' +
      '<input class="form-input" id="headingName" maxlength="60" placeholder="Например, Чеклисты"></div>' +
      '<div class="form-row"><button class="btn btn-secondary modal-close-x">Отмена</button>' +
      '<button class="btn btn-primary" id="modalSaveBtn">Создать</button></div>';
    modal.openModal('Новая группа', body, function(ov) {
      var label = ov.querySelector('#headingName').value.trim();
      if (!label) { showToast('Введите название', true); return false; }
      var hid = addHeadingNode(data, label, cx, topY - 90);
      ids.forEach(function(id) { setNodeParent(data, id, hid); });
      applyHiddenStates(data);
      updateGroupFrames(data);
      applySelectionUI(data);
      return true;
    });
  });
}

function ungroupSelected(data) {
  var ids = selectedIds(data);
  ids.forEach(function(id) { setNodeParent(data, id, null); });
  applyHiddenStates(data);
  updateGroupFrames(data);
  updateSvgLines(data);
  applySelectionUI(data);
}

async function deleteSelectedNodes() {
  var data = window._mindmapData;
  if (!data) return;
  var ids = selectedIds(data);
  var deletable = ids.filter(function(id) {
    var n = findNode(data.nodes, id);
    return n && ENTITY_DELETE[n.type];
  });
  if (!deletable.length) { showToast('Нечего удалять', true); return; }

  var modal = await import('./modal.js');
  var body = '<p>Удалить <strong>' + deletable.length + '</strong> элемент(ов)?</p>' +
    '<div class="form-row">' +
      '<button class="btn btn-secondary modal-close-x">Отмена</button>' +
      '<button class="btn btn-danger" id="modalSaveBtn">Удалить</button>' +
    '</div>';
  modal.openModal('Удаление', body, async function() {
    try {
      for (var i = 0; i < deletable.length; i++) {
        var n = findNode(data.nodes, deletable[i]);
        if (!n) continue;
        await ENTITY_DELETE[n.type](data.proj.id, n.entityId);
      }
      exitSelectMode();
      if (window._refreshDetail) await window._refreshDetail();
    } catch (err) {
      showToast('Ошибка удаления', true);
    }
    return true;
  });
}

function refreshHeadingBadges(data) {
  for (var i = 0; i < data.headings.length; i++) {
    var h = data.headings[i];
    var hnode = findNode(data.nodes, h.id);
    if (!hnode) continue;
    hnode.childrenCount = (h.children || []).length;
    hnode.collapsed = !!h.collapsed;
    var el = document.getElementById('mm_' + h.id);
    if (!el) continue;
    var badge = el.querySelector('.mm-node-badge');
    if (badge) {
      badge.textContent = hnode.childrenCount;
      badge.style.display = hnode.childrenCount ? '' : 'none';
    }
    var chev = el.querySelector('.mm-node-chevron');
    if (chev) chev.innerHTML = svgIcon(h.collapsed ? 'chevron-right' : 'chevron-down', 'sm');
  }
}

export function toggleRootLinks() {
  showRootLinks = !showRootLinks;
  localStorage.setItem('mm_root_links', showRootLinks ? '1' : '0');
  var data = window._mindmapData;
  if (data) updateSvgLines(data);
  return showRootLinks;
}

export function isRootLinksVisible() {
  return showRootLinks;
}

function scheduleNodePreview(nodeEl, data) {
  hideNodePreview();
  previewTimer = setTimeout(function() {
    previewTimer = null;
    showNodePreview(nodeEl, data);
  }, 300);
}

function showNodePreview(nodeEl, data) {
  if (!data || data.dragging || data.dragNode || data.linkMode) return;
  var nodeId = nodeEl.dataset.nodeId;
  var node = findNode(data.nodes, nodeId);
  if (!node) return;
  var previewHTML = (node.heading && node.meta) ? headingPreview(data, node.meta) : node.preview;
  if (!previewHTML) return;
  hideNodePreview();

  var el = document.createElement('div');
  el.className = 'mm-preview';
  el.innerHTML = previewHTML;
  el.style.visibility = 'hidden';
  document.body.appendChild(el);

  var r = nodeEl.getBoundingClientRect();
  var pr = el.getBoundingClientRect();
  var left = r.right + 12;
  var top = r.top;
  if (left + pr.width > window.innerWidth - 10) left = r.left - pr.width - 12;
  if (left < 10) left = 10;
  if (top + pr.height > window.innerHeight - 10) top = window.innerHeight - pr.height - 10;
  if (top < 10) top = 10;
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  el.style.visibility = 'visible';
  previewEl = el;
}

function hideMindMapMenu() {
  if (mindMapMenuEl) {
    mindMapMenuEl.remove();
    mindMapMenuEl = null;
  }
}

function addMenuItem(menu, label, icon, action, danger) {
  var el = document.createElement('div');
  el.className = 'context-menu-item' + (danger ? ' danger' : '');
  el.innerHTML = (icon ? svgIcon(icon, 'sm') : '') + ' ' + escapeHTML(label);
  el.addEventListener('click', function(ev) {
    ev.stopPropagation();
    hideMindMapMenu();
    action();
  });
  menu.appendChild(el);
}

function addSubmenu(menu, label, icon, children) {
  var parent = document.createElement('div');
  parent.className = 'context-menu-item';
  parent.innerHTML = (icon ? svgIcon(icon, 'sm') : '') + ' ' + escapeHTML(label) + ' ▸';
  parent.style.position = 'relative';

  var submenu = document.createElement('div');
  submenu.className = 'context-menu';
  submenu.style.position = 'absolute';
  submenu.style.left = '100%';
  submenu.style.top = '0';
  submenu.style.display = 'none';

  children.forEach(function(c) {
    var el = document.createElement('div');
    el.className = 'context-menu-item' + (c.danger ? ' danger' : '');
    el.innerHTML = (c.icon ? svgIcon(c.icon, 'sm') : '') + ' ' + escapeHTML(c.label);
    el.addEventListener('click', function(ev) {
      ev.stopPropagation();
      hideMindMapMenu();
      c.action();
    });
    submenu.appendChild(el);
  });

  parent.addEventListener('mouseenter', function() {
    hideAllSubmenus(menu);
    submenu.style.display = 'block';
    var pad = 8;
    // Ориентируемся на позицию родительского пункта, а не на текущее
    // положение подменю — иначе при повторном наведении сторона
    // переключается каждый раз и меню уходит за экран.
    var parentRect = parent.getBoundingClientRect();
    var subWidth = submenu.offsetWidth;
    if (parentRect.right + subWidth > window.innerWidth - pad) {
      submenu.style.left = 'auto';
      submenu.style.right = '100%';
    } else {
      submenu.style.left = '100%';
      submenu.style.right = 'auto';
    }
    var subHeight = submenu.offsetHeight;
    if (parentRect.top + subHeight > window.innerHeight - pad) {
      submenu.style.top = 'auto';
      submenu.style.bottom = '0';
    } else {
      submenu.style.top = '0';
      submenu.style.bottom = 'auto';
    }
  });
  parent.addEventListener('mouseleave', function() { submenu.style.display = 'none'; });

  parent.appendChild(submenu);
  menu.appendChild(parent);
}

function hideAllSubmenus(menu) {
  menu.querySelectorAll('.context-menu').forEach(function(sm) { sm.style.display = 'none'; });
}

function mountMenu(e, menu, maxHeight) {
  var x = Math.min(e.clientX, window.innerWidth - 230);
  var y = Math.min(e.clientY, window.innerHeight - (maxHeight || 220));
  menu.style.top = y + 'px';
  menu.style.left = x + 'px';
  document.body.appendChild(menu);
  mindMapMenuEl = menu;
  setTimeout(function() {
    document.addEventListener('click', hideMindMapMenu, { once: true });
    document.addEventListener('keydown', function(ev) {
      if (ev.key === 'Escape') hideMindMapMenu();
    }, { once: true });
  }, 0);
}

function showMindMapMenu(e, proj) {
  hideMindMapMenu();
  hideNodePreview();
  var menu = document.createElement('div');
  menu.className = 'context-menu';
  addMenuItem(menu, 'Новая заметка', 'note', function() { openCreateEntity('note', proj); });
  addMenuItem(menu, 'Новая задача', 'check', function() { openCreateEntity('checklist', proj); });
  addMenuItem(menu, 'Новая веха', 'flag', function() { openCreateEntity('milestone', proj); });
  addMenuItem(menu, 'Новая версия', 'git-branch', function() { openCreateEntity('version', proj); });
  var sep = document.createElement('div');
  sep.className = 'context-menu-separator';
  menu.appendChild(sep);
  addMenuItem(menu, 'Добавить заголовок', 'layers', function() { openAddHeading(e); });
  mountMenu(e, menu, 240);
}

function showEdgeMenu(e, idx) {
  hideMindMapMenu();
  hideNodePreview();
  var data = window._mindmapData;
  if (!data) return;
  var ed = data.edges[idx];
  if (!ed) return;

  var menu = document.createElement('div');
  menu.className = 'context-menu';

  if (typeof ed.mx === 'number' || typeof ed.my === 'number') {
    addMenuItem(menu, 'Выпрямить связь', 'x', function() {
      delete ed.mx;
      delete ed.my;
      updateSvgLines(data);
      saveMindMapGraph();
    });
  }
  addMenuItem(menu, 'Удалить связь', 'trash', function() { removeEdge(ed); }, true);

  mountMenu(e, menu, 120);
}

function showNodeMenu(e, nodeId) {
  hideMindMapMenu();
  hideNodePreview();
  var data = window._mindmapData;
  if (!data) return;
  var node = findNode(data.nodes, nodeId);
  if (!node) return;

  var menu = document.createElement('div');
  menu.className = 'context-menu';

  if (isHeading(node)) {
    addMenuItem(menu, 'Переименовать', 'edit', function() { renameHeading(node.id); });
    var kids = (node.childrenCount || 0) > 0;
    if (kids) {
      addMenuItem(menu, node.collapsed ? 'Развернуть' : 'Свернуть', 'chevron-down', function() { toggleHeadingCollapse(node.id); });
      addMenuItem(menu, 'Распустить все блоки', 'x', function() { ungroupHeading(node.id); });
    }
    var sepH = document.createElement('div');
    sepH.className = 'context-menu-separator';
    menu.appendChild(sepH);
    addMenuItem(menu, 'Удалить заголовок', 'trash', function() { deleteHeading(node.id); }, true);
    mountMenu(e, menu, 260);
    return;
  }

  addMenuItem(menu, 'Связать с…', 'git-branch', function() {
    enterLinkMode(nodeId);
  });

  if (!node.isRoot) {
    addMenuItem(menu, 'Выделить', 'check', function() { enterSelectMode(nodeId); });
  }

  if (node.parent) {
    addMenuItem(menu, 'Убрать из группы', 'x', function() { setNodeParent(data, nodeId, null); updateGroupFrames(data); });
  }

  // Добавление в существующую группу / создание новой
  var otherGroups = (data.headings || []).filter(function(h) { return h.id !== node.parent; });
  if (otherGroups.length) {
    var sepG = document.createElement('div');
    sepG.className = 'context-menu-separator';
    menu.appendChild(sepG);
    addSubmenu(menu, 'Добавить в группу', 'layers', otherGroups.map(function(h) {
      return {
        label: h.label, icon: 'layers',
        action: function() { setNodeParent(data, nodeId, h.id); updateGroupFrames(data); }
      };
    }));
  } else if (!node.parent) {
    addMenuItem(menu, 'Создать группу', 'layers', function() { openAddHeadingForNode(node); });
  }

  var conns = [];
  for (var i = 0; i < data.edges.length; i++) {
    var ed = data.edges[i];
    if (ed.from === nodeId) conns.push({ edge: ed, other: ed.to });
    else if (ed.to === nodeId) conns.push({ edge: ed, other: ed.from });
  }

  if (conns.length) {
    var sep = document.createElement('div');
    sep.className = 'context-menu-separator';
    menu.appendChild(sep);
    if (conns.length === 1) {
      var c0 = conns[0];
      var other0 = findNode(data.nodes, c0.other);
      addMenuItem(menu, 'Открепить: ' + (other0 ? other0.label : c0.other), 'x', function() {
        removeEdge(c0.edge);
      }, true);
    } else {
      addSubmenu(menu, 'Открепить связь', 'x', conns.map(function(c) {
        var other = findNode(data.nodes, c.other);
        return {
          label: (other ? other.label : c.other), icon: 'x', danger: true,
          action: function() { removeEdge(c.edge); }
        };
      }));
    }
  }

  if (!node.isRoot && ENTITY_DELETE[node.type]) {
    var sep2 = document.createElement('div');
    sep2.className = 'context-menu-separator';
    menu.appendChild(sep2);
    addMenuItem(menu, 'Удалить', 'trash', function() { deleteNode(node); }, true);
  }

  mountMenu(e, menu, 320);
}

var ENTITY_DELETE = {
  note: function(pid, id) { return api.deleteNote(pid, id); },
  checklist: function(pid, id) { return api.deleteChecklistItem(pid, parseInt(id)); },
  milestone: function(pid, id) { return api.deleteMilestone(pid, parseInt(id)); },
  version: function(pid, id) { return api.deleteVersion(pid, id); },
  file: function(pid, id) { return api.deleteFile(pid, parseInt(id)); }
};

var ENTITY_LABELS = { note: 'заметку', checklist: 'задачу', milestone: 'веху', version: 'версию', file: 'файл' };

async function deleteNode(node) {
  var data = window._mindmapData;
  if (!data || !data.proj || node.isRoot) return;
  var fn = ENTITY_DELETE[node.type];
  if (!fn) return;
  var modal = await import('./modal.js');
  var body = '<p>Удалить ' + (ENTITY_LABELS[node.type] || 'элемент') + ' <strong>' + escapeHTML(node.label) + '</strong>?</p>' +
    '<div class="form-row">' +
      '<button class="btn btn-secondary modal-close-x">Отмена</button>' +
      '<button class="btn btn-danger" id="modalSaveBtn">Удалить</button>' +
    '</div>';
  modal.openModal('Удаление', body, async function() {
    try {
      await fn(data.proj.id, node.entityId);
      data.edges = (data.edges || []).filter(function(ed) {
        return ed.from !== node.id && ed.to !== node.id;
      });
      // Убираем из групп
      if (data.headings) {
        data.headings.forEach(function(h) {
          if (h.children) h.children = h.children.filter(function(cid) { return cid !== node.id; });
        });
        saveMindMapHeadings();
      }
      saveMindMapGraph();
      if (window._refreshDetail) await window._refreshDetail();
    } catch (err) {
      showToast('Ошибка удаления', true);
    }
    return true;
  });
}

function findNode(nodes, id) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return nodes[i];
  }
  return null;
}

function saveMindMapHeadings() {
  var data = window._mindmapData;
  if (!data || !data.proj) return;
  try {
    api.updateProject(data.proj.id, {
      mindmap_headings: JSON.stringify(data.headings || [])
    }).catch(function() {});
  } catch (e) {}
}

function headingPreview(data, meta) {
  var kids = (meta.children || []).map(function(id) { return findNode(data.nodes, id); }).filter(Boolean);
  var body = kids.length
    ? kids.map(function(n) { return '<div class="mm-preview-sub">• ' + escapeHTML(n.label) + '</div>'; }).join('')
    : 'Пустая группа — перетащите блоки внутрь';
  return previewCard('layers', meta.label, kids.length ? ('Блоков: ' + kids.length) : '', body);
}

function openAddHeading(e) {
  var data = window._mindmapData;
  if (!data || !data.proj) return;
  var pt = data.screenToCanvas ? data.screenToCanvas(e.clientX, e.clientY) : { x: data.centerX, y: data.centerY };
  import('./modal.js').then(function(modal) {
    var body = '<div class="form-group"><span class="form-label">Название заголовка</span>' +
      '<input class="form-input" id="headingName" maxlength="60" placeholder="Например, Чеклисты"></div>' +
      '<div class="form-row"><button class="btn btn-secondary modal-close-x">Отмена</button>' +
      '<button class="btn btn-primary" id="modalSaveBtn">Добавить</button></div>';
    modal.openModal('Новый заголовок', body, function(ov) {
      var label = ov.querySelector('#headingName').value.trim();
      if (!label) { showToast('Введите название', true); return false; }
      addHeadingNode(data, label, pt.x, pt.y);
      return true;
    });
  });
}

function addHeadingNode(data, label, x, y) {
  var id = 'head_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  var meta = { id: id, label: label, collapsed: false, children: [] };
  data.headings.push(meta);
  var node = {
    id: id, label: label, x: x, y: y, color: '#8e8e93',
    type: 'heading', heading: true, childrenCount: 0, collapsed: false, meta: meta
  };
  data.nodes.push(node);
  if (!data.savedPositions) data.savedPositions = {};
  data.savedPositions[id] = { x: x, y: y };

  var layer = document.getElementById('mindmapNodesLayer');
  if (layer) {
    layer.insertAdjacentHTML('beforeend', buildNodeHTML(node));
    var el = document.getElementById('mm_' + id);
    if (el && data.bindNode) data.bindNode(el);
  }
  saveMindMapHeadings();
  saveMindMapPositions();
  updateSvgLines(data);
  return id;
}

// Создать группу рядом с блоком и сразу добавить в неё этот блок
function openAddHeadingForNode(node) {
  var data = window._mindmapData;
  if (!data || !data.proj || !node) return;
  var x = node.x;
  var y = node.y - 90;
  import('./modal.js').then(function(modal) {
    var body = '<div class="form-group"><span class="form-label">Название группы</span>' +
      '<input class="form-input" id="headingName" maxlength="60" placeholder="Например, Чеклисты"></div>' +
      '<div class="form-row"><button class="btn btn-secondary modal-close-x">Отмена</button>' +
      '<button class="btn btn-primary" id="modalSaveBtn">Создать</button></div>';
    modal.openModal('Новая группа', body, function(ov) {
      var label = ov.querySelector('#headingName').value.trim();
      if (!label) { showToast('Введите название', true); return false; }
      var id = addHeadingNode(data, label, x, y);
      setNodeParent(data, node.id, id);
      updateGroupFrames(data);
      return true;
    });
  });
}

function renameHeading(headingId) {
  var data = window._mindmapData;
  if (!data) return;
  var h = data.headings.filter(function(x) { return x.id === headingId; })[0];
  if (!h) return;
  import('./modal.js').then(function(modal) {
    var body = '<div class="form-group"><span class="form-label">Название заголовка</span>' +
      '<input class="form-input" id="headingName" maxlength="60"></div>' +
      '<div class="form-row"><button class="btn btn-secondary modal-close-x">Отмена</button>' +
      '<button class="btn btn-primary" id="modalSaveBtn">Сохранить</button></div>';
    var overlay = modal.openModal('Переименовать заголовок', body, function(ov) {
      var label = ov.querySelector('#headingName').value.trim();
      if (!label) { showToast('Введите название', true); return false; }
      h.label = label;
      var el = document.getElementById('mm_' + headingId);
      if (el) { var lab = el.querySelector('.mm-node-label'); if (lab) lab.textContent = label; }
      saveMindMapHeadings();
      return true;
    });
    overlay.querySelector('#headingName').value = h.label;
  });
}

function toggleHeadingCollapse(headingId) {
  var data = window._mindmapData;
  if (!data) return;
  var h = data.headings.filter(function(x) { return x.id === headingId; })[0];
  if (!h) return;
  h.collapsed = !h.collapsed;
  applyHiddenStates(data);
  refreshHeadingBadges(data);
  updateSvgLines(data);
  updateGroupFrames(data);
  saveMindMapHeadings();
}

function deleteHeading(headingId) {
  var data = window._mindmapData;
  if (!data) return;
  var h = data.headings.filter(function(x) { return x.id === headingId; })[0];
  if (!h) return;
  var count = (h.children || []).length;
  import('./modal.js').then(function(modal) {
    var body = '<p>Удалить заголовок <strong>' + escapeHTML(h.label) + '</strong>?</p>' +
      (count ? '<p style="color:var(--text-secondary);font-size:13px">Блоки (' + count + ') останутся на карте.</p>' : '') +
      '<div class="form-row"><button class="btn btn-secondary modal-close-x">Отмена</button>' +
      '<button class="btn btn-danger" id="modalSaveBtn">Удалить</button></div>';
    modal.openModal('Удаление заголовка', body, function() {
      (h.children || []).forEach(function(cid) { var n = findNode(data.nodes, cid); if (n) n.parent = null; });
      data.headings = data.headings.filter(function(x) { return x.id !== headingId; });
      data.nodes = data.nodes.filter(function(x) { return x.id !== headingId; });
      if (data.savedPositions) delete data.savedPositions[headingId];
      var el = document.getElementById('mm_' + headingId);
      if (el) el.remove();
      var frame = document.querySelector('.mm-group-frame[data-heading-id="' + headingId + '"]');
      if (frame) frame.remove();
      saveMindMapHeadings();
      saveMindMapPositions();
      updateSvgLines(data);
      return true;
    });
  });
}


function enterLinkMode(fromId) {
  var data = window._mindmapData;
  if (!data) return;
  hideNodePreview();
  cancelLinkMode();
  data.linkMode = fromId;
  var el = document.getElementById('mm_' + fromId);
  if (el) el.classList.add('linking');
  var c = document.getElementById(data.containerId);
  if (c) c.style.cursor = 'crosshair';
}

function cancelLinkMode() {
  var data = window._mindmapData;
  if (!data || !data.linkMode) return;
  var el = document.getElementById('mm_' + data.linkMode);
  if (el) el.classList.remove('linking');
  data.linkMode = null;
  var c = document.getElementById(data.containerId);
  if (c) c.style.cursor = 'grab';
}

function handleLinkClick(nodeId) {
  var data = window._mindmapData;
  if (!data || !data.linkMode) return false;
  var from = data.linkMode;
  if (nodeId === from) { cancelLinkMode(); return true; }
  addEdge(from, nodeId);
  cancelLinkMode();
  return true;
}

function addEdge(from, to) {
  var data = window._mindmapData;
  if (!data) return;
  for (var i = 0; i < data.edges.length; i++) {
    if ((data.edges[i].from === from && data.edges[i].to === to) ||
        (data.edges[i].from === to && data.edges[i].to === from)) return;
  }
  data.edges.push({ from: from, to: to });
  updateSvgLines(data);
  saveMindMapGraph();
}

function removeEdge(edge) {
  var data = window._mindmapData;
  if (!data) return;
  for (var i = 0; i < data.edges.length; i++) {
    if (data.edges[i] === edge) { data.edges.splice(i, 1); break; }
  }
  updateSvgLines(data);
  saveMindMapGraph();
}

function openCreateEntity(type, proj) {
  if (!proj) return;
  import('./modal-forms.js').then(function(forms) {
    var onSuccess = function() {
      if (typeof window._refreshDetail === 'function') {
        return window._refreshDetail();
      }
    };
    if (type === 'note') forms.openAddNoteModal(proj.id, onSuccess);
    else if (type === 'checklist') forms.openAddChecklistModal(proj.id, onSuccess);
    else if (type === 'milestone') forms.openAddMilestoneModal(proj.id, onSuccess);
    else if (type === 'version') forms.openAddVersionModal(proj.id, onSuccess);
  });
}

export function renderMindMap(containerId, proj) {
  destroyMindMap();
  var myToken = ++mindmapInitToken;
  var container = document.getElementById(containerId);
  var containerWidth = container ? container.clientWidth : 800;
  var containerHeight = container ? container.clientHeight : 500;
  
  var centerX = containerWidth / 2;
  var centerY = containerHeight / 2;

  // Загружаем сохранённые позиции узлов
  var savedPositions = {};
  try {
    if (proj.mindmap_positions) {
      savedPositions = JSON.parse(proj.mindmap_positions);
    }
  } catch (e) {
    savedPositions = {};
  }

  // Загружаем сохранённые связи между блоками
  var edges = [];
  try {
    if (proj.mindmap_graph) {
      var parsedGraph = JSON.parse(proj.mindmap_graph);
      if (Array.isArray(parsedGraph)) edges = parsedGraph;
    }
  } catch (e) {
    edges = [];
  }

  // Загружаем заголовки/группы
  var headings = [];
  try {
    if (proj.mindmap_headings) {
      var parsedHeadings = JSON.parse(proj.mindmap_headings);
      if (Array.isArray(parsedHeadings)) {
        headings = parsedHeadings.filter(function(h) { return h && h.id && h.label; });
      }
    }
  } catch (e) {
    headings = [];
  }

  var nodes = [];

  // Корневой узел всегда по центру
  var rootPos = savedPositions['root'] || { x: centerX, y: centerY };
  nodes.push({
    id: 'root',
    label: proj.name || 'Проект',
    x: rootPos.x,
    y: rootPos.y,
    color: proj.color || '#0071e3',
    isRoot: true,
    type: 'root',
    preview: previewCard('layers', proj.name || 'Проект',
      (CONFIG.STATUS_LABELS[proj.status] || proj.status || '') + (proj.deadline ? ' • ' + formatDate(proj.deadline) : ''),
      renderMarkdown(proj.description || 'Нет описания')),
    action: null
  });

  // Собираем все дочерние узлы
  var childNodes = [];

  // Заметки
  var notes = proj.notes || [];
  for (var i = 0; i < notes.length; i++) {
    (function(note) {
      childNodes.push({
        id: 'note_' + note.id,
        entityId: note.id,
        label: (note.title || 'Заметка').slice(0, 30),
        type: 'note',
        color: '#34c759',
        preview: previewCard('note', note.title || 'Без заголовка',
          formatDate(note.created_at),
          renderMarkdown((note.text || '—').slice(0, 800)),
          previewAttachments(note.attachments, proj) + refsPreviewHTML(note, proj, { showNotes: false })),
        action: function() { store.currentDetailTab = 'notes'; import('../app.js').then(function(m) { m.render(); }); }
      });
    })(notes[i]);
  }

  // Чеклист
  var checklist = proj.checklist || [];
  for (var j = 0; j < checklist.length; j++) {
    (function(item) {
      var subs = item.subtasks || [];
      var body = subs.length
        ? subs.map(function(s) { return '<div class="mm-preview-sub">' + (s.done ? '✓' : '○') + ' ' + escapeHTML(s.text) + '</div>'; }).join('')
        : (item.done ? 'Выполнено' : 'Не выполнено');
      var meta = (CONFIG.PRIORITY_LABELS[item.priority] || item.priority || '') +
        (item.done ? ' • выполнено' : '');
      childNodes.push({
        id: 'chk_' + item.id,
        entityId: item.id,
        label: item.text.slice(0, 30),
        type: 'checklist',
        color: item.done ? '#aeaeb2' : '#ff9500',
        preview: previewCard('check', item.text, meta, body, previewAttachments(item.attachments, proj)),
        action: function() {
          import('./project-detail.js').then(function(m) { m.navigateToRef('checklist', item.id); });
        }
      });
    })(checklist[j]);
  }

  // Вехи
  var milestones = proj.milestones || [];
  for (var k = 0; k < milestones.length; k++) {
    (function(ms) {
      childNodes.push({
        id: 'ms_' + ms.id,
        entityId: ms.id,
        label: ms.title.slice(0, 30),
        type: 'milestone',
        color: '#af52de',
        preview: previewCard('flag', ms.title, formatDate(ms.date), renderMarkdown(ms.description || '')),
        action: function() { store.currentDetailTab = 'milestones'; import('../app.js').then(function(m) { m.render(); }); }
      });
    })(milestones[k]);
  }

  // Версии
  var versions = proj.versions || [];
  var vNodes = versions;
  for (var v = 0; v < vNodes.length; v++) {
    (function(ver) {
      childNodes.push({
        id: 'ver_' + ver.id,
        entityId: ver.id,
        label: 'v' + ver.number,
        type: 'version',
        color: '#0071e3',
        preview: previewCard('git-branch', 'Версия ' + ver.number, formatDate(ver.date), renderMarkdown(ver.description || ''),
          previewAttachments(ver.attachments, proj) + refsPreviewHTML(ver, proj)),
        action: function() { store.currentDetailTab = 'versions'; import('../app.js').then(function(m) { m.render(); }); }
      });
    })(vNodes[v]);
  }

  // Файлы, которые пользователь сам закрепил на карте
  var files = proj.files || [];
  var pinnedFiles = parseMindmapFiles(proj.mindmap_files);
  var fileById = {};
  for (var ff = 0; ff < files.length; ff++) fileById[files[ff].id] = files[ff];

  for (var f = 0; f < pinnedFiles.length; f++) {
    (function(entry) {
      if (entry.kind === 'upload') {
        var file = fileById[entry.id];
        if (!file) return;
        childNodes.push({
          id: 'file_' + file.id,
          entityId: file.id,
          label: file.original_name.slice(0, 25),
          type: 'file',
          color: '#ff9500',
          preview: previewCard('file', file.original_name,
            (file.type ? file.type + ' • ' : '') + formatFileSize(file.size), ''),
          action: function() { store.currentDetailTab = 'files'; import('../app.js').then(function(m) { m.render(); }); }
        });
      } else if (entry.kind === 'path') {
        var p = entry.path;
        var base = p.split('/').pop() || p;
        childNodes.push({
          id: 'fs_' + encodeURIComponent(p),
          fsPath: p,
          label: base.slice(0, 25),
          type: 'fsfile',
          color: '#ff9f0a',
          preview: previewCard('file', base, escapeHTML(p), ''),
          action: function() {
            store.pendingFilePreview = p;
            store.currentDetailTab = 'files';
            import('../app.js').then(function(m) { m.render(); });
          }
        });
      }
    })(pinnedFiles[f]);
  }

  // Распределяем узлы по кругу с разными радиусами по типам
  var typeRadius = {
    'note': 160,
    'version': 200,
    'checklist': 240,
    'file': 280,
    'fsfile': 280,
    'milestone': 320
  };

  var typeOrder = { 'note': 0, 'version': 1, 'checklist': 2, 'file': 3, 'fsfile': 3, 'milestone': 4 };
  childNodes.sort(function(a, b) {
    return (typeOrder[a.type] || 0) - (typeOrder[b.type] || 0);
  });

  var totalChildren = childNodes.length;
  for (var i = 0; i < totalChildren; i++) {
    var child = childNodes[i];
    var savedPos = savedPositions[child.id];
    
    if (savedPos) {
      child.x = savedPos.x;
      child.y = savedPos.y;
    } else {
      var angle = (i / Math.max(1, totalChildren)) * Math.PI * 2 - Math.PI / 2;
      var radius = typeRadius[child.type] || 200;
      var randomOffset = (Math.random() - 0.5) * 30;
      
      child.x = centerX + Math.cos(angle) * (radius + randomOffset);
      child.y = centerY + Math.sin(angle) * (radius + randomOffset);
    }
    
    child.isRoot = false;
    nodes.push(child);
  }

  // Заголовки/группы как узлы
  var nodeIdSet = {};
  for (var ni0 = 0; ni0 < nodes.length; ni0++) nodeIdSet[nodes[ni0].id] = true;

  for (var hi = 0; hi < headings.length; hi++) {
    (function(h, hIndex) {
      h.children = (h.children || []).filter(function(cid) { return nodeIdSet[cid]; });
      var hp = savedPositions[h.id];
      var hx = hp ? hp.x : (centerX + (hIndex - (headings.length - 1) / 2) * 240);
      var hy = hp ? hp.y : (centerY - 300);
      nodes.push({
        id: h.id,
        label: h.label,
        x: hx,
        y: hy,
        color: '#8e8e93',
        type: 'heading',
        heading: true,
        meta: h,
        collapsed: !!h.collapsed,
        childrenCount: h.children.length,
        isRoot: false
      });
      h.children.forEach(function(cid) {
        var cn = findNode(nodes, cid);
        if (cn) cn.parent = h.id;
      });
    })(headings[hi], hi);
  }

  // Прячем детей свёрнутых групп
  var collapsedKids = {};
  for (var ch = 0; ch < headings.length; ch++) {
    if (headings[ch].collapsed) {
      (headings[ch].children || []).forEach(function(cid) { collapsedKids[cid] = true; });
    }
  }
  for (var hn = 0; hn < nodes.length; hn++) {
    if (!nodes[hn].isRoot && !nodes[hn].heading) {
      nodes[hn].hidden = !!collapsedKids[nodes[hn].id];
    }
  }

  // Оставляем связи только между существующими узлами
  var nodeById = {};
  for (var i = 0; i < nodes.length; i++) {
    nodeById[nodes[i].id] = nodes[i];
  }
  edges = edges.filter(function(e) {
    return e && nodeById[e.from] && nodeById[e.to] && e.from !== e.to;
  });

  var svgLines = renderEdges(nodes, edges);

  // Рассчитываем начальный трансформ (центрирование) сразу, без задержки
  var sumX = 0, sumY = 0;
  for (var i = 0; i < nodes.length; i++) {
    sumX += nodes[i].x;
    sumY += nodes[i].y;
  }
  var avgX = sumX / Math.max(1, nodes.length);
  var avgY = sumY / Math.max(1, nodes.length);
  var initOffsetX = containerWidth / 2 - avgX;
  var initOffsetY = containerHeight / 2 - avgY;
  var initTransform = 'translate(' + initOffsetX + 'px, ' + initOffsetY + 'px) scale(1)';

  // Единый размер полотна: 2000px достаточно для любого сценария
  var largeSize = 2000;
  var svgWidth = largeSize;
  var svgHeight = largeSize;

  var html = '';
  html += '<div class="mindmap-container" id="' + containerId + '" style="width:100%;height:500px;position:relative;cursor:grab;background:var(--mindmap-bg);border-radius:var(--radius);border:1px solid var(--border);overflow:hidden">';
  html += '<svg id="mindmapSvg" style="position:absolute;top:0;left:0;width:' + svgWidth + 'px;height:' + svgHeight + 'px;pointer-events:none;transform-origin:0 0;overflow:visible;transform:' + initTransform + '">' + svgLines + '</svg>';
  html += '<div id="mindmapNodesLayer" style="position:absolute;top:0;left:0;width:' + svgWidth + 'px;height:' + svgHeight + 'px;pointer-events:none;transform-origin:0 0;transform:' + initTransform + '">';

  for (var i = 0; i < nodes.length; i++) {
    html += buildNodeHTML(nodes[i]);
  }

  html += '</div></div></div>';

  // Данные для взаимодействия
  window._mindmapData = {
    nodes: nodes,
    proj: proj,
    edges: edges,
    headings: headings,
    linkMode: null,
    scale: 1,
    offsetX: initOffsetX,
    offsetY: initOffsetY,
    dragging: false,
    dragNode: null,
    startX: 0,
    startY: 0,
    nodeStartX: 0,
    nodeStartY: 0,
    nodeOrigLeft: 0,
    nodeOrigTop: 0,
    containerId: containerId,
    centerX: centerX,
    centerY: centerY,
    savedPositions: savedPositions,
    wasDragged: false,  // Флаг: был ли drag на этом узле
    dirty: false,       // Флаг: были ли реальные изменения позиций
    edgeDrag: null,     // Индекс перетаскиваемой связи
    selectMode: false,  // Режим массового выделения блоков
    selected: {}        // Карта выделенных узлов: id -> true
  };

  // Инициализация взаимодействия
  setTimeout(function() {
    // Пропускаем, если за это время был отрисован более новый mindmap
    if (myToken !== mindmapInitToken) return;

    var containerEl = document.getElementById(containerId);
    var svgEl = document.getElementById('mindmapSvg');
    var nodesLayer = document.getElementById('mindmapNodesLayer');
    var data = window._mindmapData;
    if (!containerEl || !svgEl || !nodesLayer || !data) return;

    // Применяем начальный transform (центрирование)
    updateTransform(svgEl, nodesLayer, data);

    // Зум колёсиком
    function onWheel(e) {
      e.preventDefault();
      hideNodePreview();

      var rect = containerEl.getBoundingClientRect();
      var mouseX = e.clientX - rect.left;
      var mouseY = e.clientY - rect.top;

      var delta = e.deltaY > 0 ? -0.1 : 0.1;
      var newScale = Math.max(0.3, Math.min(2, data.scale + delta));

      var scaleChange = newScale / data.scale;
      data.offsetX = mouseX - (mouseX - data.offsetX) * scaleChange;
      data.offsetY = mouseY - (mouseY - data.offsetY) * scaleChange;
      data.scale = newScale;

      updateTransform(svgEl, nodesLayer, data);
    }

    // Перевод координат экрана в координаты полотна
    function screenToCanvas(clientX, clientY) {
      var rect = containerEl.getBoundingClientRect();
      return {
        x: (clientX - rect.left - data.offsetX) / data.scale,
        y: (clientY - rect.top - data.offsetY) / data.scale
      };
    }

    function startEdgeDrag(target) {
      var idx = parseInt(target.getAttribute('data-edge-hit'));
      var ed = data.edges[idx];
      if (!ed) return;
      hideNodePreview();
      data.edgeDrag = idx;
      containerEl.style.cursor = 'grabbing';
    }

    // Панорамирование фона
    function onContainerMouseDown(e) {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('.mm-selection-bar')) return;

      // Перетаскивание связи (сгибание стрелки)
      var edgeHit = e.target.closest && e.target.closest('[data-edge-hit]');
      if (edgeHit) {
        e.preventDefault();
        e.stopPropagation();
        startEdgeDrag(edgeHit);
        return;
      }

      if (data.dragNode) return;
      if (e.target.closest && e.target.closest('.mindmap-node')) return;

      hideNodePreview();
      if (data.linkMode) { cancelLinkMode(); return; }

      data.dragging = true;
      data.startX = e.clientX - data.offsetX;
      data.startY = e.clientY - data.offsetY;
      containerEl.style.cursor = 'grabbing';
      e.preventDefault();
    }

    // Движение/отпускание изгиба связи
    function onDocMouseMoveEdge(e) {
      if (data.edgeDrag == null) return;
      var ed = data.edges[data.edgeDrag];
      if (!ed) return;
      var p = screenToCanvas(e.clientX, e.clientY);
      ed.mx = p.x;
      ed.my = p.y;
      updateSvgLines(data);
    }

    function onDocMouseUpEdge() {
      if (data.edgeDrag == null) return;
      data.edgeDrag = null;
      if (containerEl) containerEl.style.cursor = 'grab';
      saveMindMapGraph();
    }

    function onDocMouseMovePan(e) {
      if (!data.dragging || data.dragNode) return;
      data.offsetX = e.clientX - data.startX;
      data.offsetY = e.clientY - data.startY;
      updateTransform(svgEl, nodesLayer, data);
    }

    function onDocMouseUpPan() {
      data.dragging = false;
      if (containerEl) containerEl.style.cursor = 'grab';
    }

    // Двойной клик — выпрямление связи или центрирование
    function onDblClick(e) {
      var edgeHit = e.target.closest && e.target.closest('[data-edge-hit]');
      if (edgeHit) {
        e.preventDefault();
        var idx = parseInt(edgeHit.getAttribute('data-edge-hit'));
        var ed = data.edges[idx];
        if (ed) {
          delete ed.mx;
          delete ed.my;
          updateSvgLines(data);
          saveMindMapGraph();
        }
        return;
      }
      if (e.target.closest && e.target.closest('.mindmap-node')) return;
      centerMindMap();
    }

    // ПКМ по фону — меню создания; ПКМ по связи — меню связи
    function onContextMenu(e) {
      var edgeHit = e.target.closest && e.target.closest('[data-edge-hit]');
      if (edgeHit) {
        if (data.selectMode) { e.preventDefault(); return; }
        e.preventDefault();
        showEdgeMenu(e, parseInt(edgeHit.getAttribute('data-edge-hit')));
        return;
      }
      if (e.target.closest('.mindmap-node')) return;
      e.preventDefault();
      if (data.selectMode) return;
      showMindMapMenu(e, data.proj);
    }

    // Esc — отмена режима связывания / выделения
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (data.selectMode) { exitSelectMode(); return; }
      if (data.linkMode) cancelLinkMode();
    }

    // Привязка обработчиков к узлу (используется и для новых узлов)
    function bindNode(nodeEl) {
      if (!nodeEl || nodeEl.dataset.bound) return;
      nodeEl.dataset.bound = '1';
      var nodeId = nodeEl.dataset.nodeId;

      nodeEl.addEventListener('click', function(e) {
        if (data.wasDragged) { data.wasDragged = false; e.stopPropagation(); return; }
        e.stopPropagation();
        if (data.selectMode) {
          var sn = findNode(data.nodes, nodeId);
          if (sn && !sn.isRoot && !isHeading(sn)) toggleNodeSelected(nodeId);
          return;
        }
        if (data.linkMode) { handleLinkClick(nodeId); return; }
        var node = findNode(data.nodes, nodeId);
        if (node && node.action) { node.action(); return; }
        if (node && isHeading(node) && (node.childrenCount || 0) > 0) {
          toggleHeadingCollapse(nodeId);
        }
      });

      nodeEl.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (data.selectMode) return;
        showNodeMenu(e, nodeId);
      });

      nodeEl.addEventListener('mouseenter', function() {
        if (data.selectMode) return;
        scheduleNodePreview(nodeEl, data);
      });
      nodeEl.addEventListener('mouseleave', function() {
        hideNodePreview();
      });

      nodeEl.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        window._mindmapNodeDragStart(e, nodeId);
      });
    }

    data.bindNode = bindNode;
    data.screenToCanvas = screenToCanvas;
    var nodeElements = document.querySelectorAll('.mindmap-node');
    for (var i = 0; i < nodeElements.length; i++) {
      bindNode(nodeElements[i]);
    }
    updateGroupFrames(data);

    // Перетаскивание узлов
    window._mindmapNodeDragStart = function(e, nodeId) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      hideNodePreview();

      data.dragNode = nodeId;
      data.wasDragged = false;  // Сбрасываем флаг
      data.nodeStartX = e.clientX;
      data.nodeStartY = e.clientY;

      var node = null;
      for (var i = 0; i < data.nodes.length; i++) {
        if (data.nodes[i].id === nodeId) { node = data.nodes[i]; break; }
      }
      if (!node) return;

      data.nodeOrigLeft = node.x;
      data.nodeOrigTop = node.y;

      // Тянем заголовок — двигаем группу целиком
      data.groupOrig = null;
      if (isHeading(node) && node.meta) {
        data.groupOrig = (node.meta.children || []).map(function(cid) {
          var cn = findNode(data.nodes, cid);
          return cn ? { id: cid, x: cn.x, y: cn.y } : null;
        }).filter(Boolean);
      } else if (data.selectMode && data.selected[nodeId]) {
        // В режиме выделения двигаем все выбранные блоки
        data.groupOrig = selectedIds(data).filter(function(id) { return id !== nodeId; }).map(function(id) {
          var cn = findNode(data.nodes, id);
          return cn ? { id: id, x: cn.x, y: cn.y } : null;
        }).filter(Boolean);
      }

      var nodeEl = document.getElementById('mm_' + nodeId);
      if (nodeEl) {
        nodeEl.style.zIndex = '10';
        nodeEl.style.boxShadow = '0 8px 25px rgba(0,0,0,0.3)';
        nodeEl.style.cursor = 'grabbing';
      }
    };

    // Перетаскивание узла
    function onDocMouseMoveNode(e) {
      if (!data.dragNode) return;

      var dx = (e.clientX - data.nodeStartX) / data.scale;
      var dy = (e.clientY - data.nodeStartY) / data.scale;

      // Если узел сдвинулся хотя бы на 3px — считаем что был drag
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        data.wasDragged = true;
        data.dirty = true;
      }

      var node = null;
      for (var j = 0; j < data.nodes.length; j++) {
        if (data.nodes[j].id === data.dragNode) { node = data.nodes[j]; break; }
      }
      if (!node) return;

      node.x = data.nodeOrigLeft + dx;
      node.y = data.nodeOrigTop + dy;

      var nodeEl = document.getElementById('mm_' + data.dragNode);
      if (nodeEl) {
        nodeEl.style.left = node.x + 'px';
        nodeEl.style.top = node.y + 'px';
      }

      // Перемещаем группу целиком
      if (data.groupOrig) {
        for (var gi = 0; gi < data.groupOrig.length; gi++) {
          var go = data.groupOrig[gi];
          var gc = findNode(data.nodes, go.id);
          if (!gc) continue;
          gc.x = go.x + dx;
          gc.y = go.y + dy;
          var gel = document.getElementById('mm_' + go.id);
          if (gel) { gel.style.left = gc.x + 'px'; gel.style.top = gc.y + 'px'; }
        }
      }

      updateSvgLines(data);
      updateGroupFrames(data);
    }

    // Отпускание узла
    function onDocMouseUpNode() {
      if (!data.dragNode) return;
      var draggedId = data.dragNode;

      var nodeEl = document.getElementById('mm_' + draggedId);
      if (nodeEl) {
        nodeEl.style.zIndex = '2';
        nodeEl.style.boxShadow = '';
        nodeEl.style.cursor = 'grab';
      }

      var node = findNode(data.nodes, draggedId);
      if (node) {
        data.savedPositions[node.id] = { x: node.x, y: node.y };

        // Обновляем членство при перемещении обычного блока
        if (data.dirty && !isHeading(node) && !data.selectMode) {
          var grp = findGroupAt(data, node.x, node.y);
          var target = grp ? grp.id : null;
          if (node.parent !== target) setNodeParent(data, node.id, target);
        }

        if (data.groupOrig) {
          data.groupOrig.forEach(function(go) {
            var gc = findNode(data.nodes, go.id);
            if (gc) data.savedPositions[gc.id] = { x: gc.x, y: gc.y };
          });
        }
      }

      var wasDirty = data.dirty;
      data.dragNode = null;
      data.groupOrig = null;

      if (wasDirty) {
        data.dirty = false;
        saveMindMapPositions();
        updateGroupFrames(data);
      }
    }

    containerEl.addEventListener('wheel', onWheel, { passive: false });
    containerEl.addEventListener('mousedown', onContainerMouseDown);
    containerEl.addEventListener('dblclick', onDblClick);
    containerEl.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('mousemove', onDocMouseMovePan);
    document.addEventListener('mouseup', onDocMouseUpPan);
    document.addEventListener('mousemove', onDocMouseMoveNode);
    document.addEventListener('mouseup', onDocMouseUpNode);
    document.addEventListener('mousemove', onDocMouseMoveEdge);
    document.addEventListener('mouseup', onDocMouseUpEdge);
    document.addEventListener('keydown', onKeyDown);

    // Снимаем все слушатели при повторном рендере
    currentCleanup = function() {
      containerEl.removeEventListener('wheel', onWheel);
      containerEl.removeEventListener('mousedown', onContainerMouseDown);
      containerEl.removeEventListener('dblclick', onDblClick);
      containerEl.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('mousemove', onDocMouseMovePan);
      document.removeEventListener('mouseup', onDocMouseUpPan);
      document.removeEventListener('mousemove', onDocMouseMoveNode);
      document.removeEventListener('mouseup', onDocMouseUpNode);
      document.removeEventListener('mousemove', onDocMouseMoveEdge);
      document.removeEventListener('mouseup', onDocMouseUpEdge);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, 300);

  return html;
}

function centerMindMap() {
  var data = window._mindmapData;
  if (!data) return;
  
  var containerEl = document.getElementById(data.containerId);
  var svgEl = document.getElementById('mindmapSvg');
  var nodesLayer = document.getElementById('mindmapNodesLayer');
  if (!containerEl || !svgEl || !nodesLayer) return;
  
  var cw = containerEl.clientWidth;
  var ch = containerEl.clientHeight;
  
  // Считаем центр масс всех узлов
  var sumX = 0, sumY = 0;
  for (var i = 0; i < data.nodes.length; i++) {
    sumX += data.nodes[i].x;
    sumY += data.nodes[i].y;
  }
  var avgX = sumX / Math.max(1, data.nodes.length);
  var avgY = sumY / Math.max(1, data.nodes.length);
  
  data.offsetX = cw / 2 - avgX;
  data.offsetY = ch / 2 - avgY;
  data.scale = 1;
  
  updateTransform(svgEl, nodesLayer, data);
}

function updateTransform(svgEl, nodesLayer, data) {
  if (!svgEl || !nodesLayer || !data) return;
  var t = 'translate(' + data.offsetX + 'px, ' + data.offsetY + 'px) scale(' + data.scale + ')';
  svgEl.style.transform = t;
  nodesLayer.style.transform = t;
}

function updateSvgLines(data) {
  var svg = document.getElementById('mindmapSvg');
  var nodesLayer = document.getElementById('mindmapNodesLayer');
  if (!svg || !data || !nodesLayer) return;
  
  // Пересчитываем границы всех узлов и расширяем SVG при необходимости
  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (var i = 0; i < data.nodes.length; i++) {
    var nx = data.nodes[i].x;
    var ny = data.nodes[i].y;
    if (nx < minX) minX = nx;
    if (nx > maxX) maxX = nx;
    if (ny < minY) minY = ny;
    if (ny > maxY) maxY = ny;
  }
  
  // Добавляем отступ 150px вокруг для линий
  var padding = 150;
  var neededWidth = (maxX - minX) + padding * 2;
  var neededHeight = (maxY - minY) + padding * 2;
  
  var currentWidth = parseInt(svg.style.width);
  var currentHeight = parseInt(svg.style.height);
  
  if (neededWidth > currentWidth || neededHeight > currentHeight) {
    svg.style.width = Math.max(currentWidth, neededWidth) + 'px';
    svg.style.height = Math.max(currentHeight, neededHeight) + 'px';
    if (nodesLayer) {
      nodesLayer.style.width = Math.max(currentWidth, neededWidth) + 'px';
      nodesLayer.style.height = Math.max(currentHeight, neededHeight) + 'px';
    }
  }
  
  svg.innerHTML = renderEdges(data.nodes, data.edges);
}

// Рисует рёбра «корень → узел» и произвольные связи между блоками
function renderEdges(nodeList, edgeList) {
  var byId = {};
  var rootNode = null;
  for (var i = 0; i < nodeList.length; i++) {
    byId[nodeList[i].id] = nodeList[i];
    if (nodeList[i].isRoot) rootNode = nodeList[i];
  }

  var lines = '<defs><marker id="mmArrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" style="fill:var(--accent)"/></marker></defs>';

  if (rootNode && showRootLinks) {
    for (var j = 0; j < nodeList.length; j++) {
      var n = nodeList[j];
      if (n.isRoot || n.heading || n.hidden) continue;
      var dash = n.color === '#aeaeb2' ? ' stroke-dasharray="6,3"' : '';
      var opacity = n.type === 'file' ? '0.4' : '0.6';
      lines += '<path d="M' + rootNode.x + ' ' + rootNode.y + ' L' + n.x + ' ' + n.y + '" stroke="' + n.color + '" stroke-width="2"' + dash + ' opacity="' + opacity + '" fill="none"/>';
    }
  }

  if (edgeList) {
    for (var k = 0; k < edgeList.length; k++) {
      var ed = edgeList[k];
      var a = byId[ed.from];
      var b = byId[ed.to];
      if (!a || !b || a.hidden || b.hidden) continue;
      var d = edgePathD(a, b, ed);
      var bent = typeof ed.mx === 'number' || typeof ed.my === 'number';
      lines += '<g class="mm-edge" data-edge-i="' + k + '">';
      lines += '<path d="' + d + '" stroke="var(--accent)" stroke-width="2" fill="none" marker-end="url(#mmArrowHead)" opacity="0.9"/>';
      lines += '<path class="mm-edge-hit" d="' + d + '" data-edge-hit="' + k + '" stroke="transparent" stroke-width="16" fill="none" style="stroke:transparent;pointer-events:stroke;cursor:grab"/>';
      if (bent) {
        var m = edgeMidpoint(a, b, ed);
        lines += '<circle data-edge-hit="' + k + '" cx="' + m.x + '" cy="' + m.y + '" r="6" style="fill:var(--accent);pointer-events:all;cursor:grab"/>';
      }
      lines += '</g>';
    }
  }

  return lines;
}

// Концы ребра с отступом под наконечник
function edgeEnds(a, b) {
  var dx = b.x - a.x;
  var dy = b.y - a.y;
  var len = Math.sqrt(dx * dx + dy * dy) || 1;
  var ux = dx / len;
  var uy = dy / len;
  var pad = Math.min(46, len * 0.4);
  return {
    sx: a.x, sy: a.y,
    ex: b.x - ux * pad, ey: b.y - uy * pad
  };
}

// Точка-ручка изогнутого ребра (через неё проходит кривая)
function edgeHandle(a, b, ed) {
  var e = edgeEnds(a, b);
  var mx = typeof ed.mx === 'number' ? ed.mx : (e.sx + e.ex) / 2;
  var my = typeof ed.my === 'number' ? ed.my : (e.sy + e.ey) / 2;
  return { x: mx, y: my };
}

function edgeMidpoint(a, b, ed) {
  return edgeHandle(a, b, ed);
}

// Прямая по умолчанию, кубическая кривая — если у ребра задан изгиб.
// Кривая проходит через ручку, а её конец направлен строго в целевой блок,
// чтобы наконечник всегда указывал на блок, а не в произвольную сторону.
function edgePathD(a, b, ed) {
  var e = edgeEnds(a, b);
  if (typeof ed.mx === 'number' || typeof ed.my === 'number') {
    var h = edgeHandle(a, b, ed);
    var dx = e.ex - e.sx, dy = e.ey - e.sy;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len;
    var k = len / 3;
    var c2x = e.ex - ux * k, c2y = e.ey - uy * k;
    var c1x = (8 * h.x - e.sx - e.ex) / 3 - c2x;
    var c1y = (8 * h.y - e.sy - e.ey) / 3 - c2y;
    return 'M' + e.sx + ' ' + e.sy + ' C' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + e.ex + ' ' + e.ey;
  }
  return 'M' + e.sx + ' ' + e.sy + ' L' + e.ex + ' ' + e.ey;
}

function saveMindMapPositions() {
  var data = window._mindmapData;
  if (!data || !data.proj) return;
  
  var positions = {};
  for (var i = 0; i < data.nodes.length; i++) {
    positions[data.nodes[i].id] = { x: data.nodes[i].x, y: data.nodes[i].y };
  }
  
  try {
    api.updateProject(data.proj.id, {
      mindmap_positions: JSON.stringify(positions)
    }).catch(function() {});
  } catch (e) {}
}

function saveMindMapGraph() {
  var data = window._mindmapData;
  if (!data || !data.proj) return;
  try {
    api.updateProject(data.proj.id, {
      mindmap_graph: JSON.stringify(data.edges || [])
    }).catch(function() {});
  } catch (e) {}
}