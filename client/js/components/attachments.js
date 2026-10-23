import api from '../api.js';
import { svgIcon, escapeHTML, formatFileSize, showToast } from '../utils/dom.js';

// Реестр вложений: { kind:'upload', id, name } | { kind:'path', path, name }
// Опционально: missing (файл удалён/перемещён), size (для upload).
// Совместим с форматом mindmap_files (числа = id загруженного файла).

var IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tiff', 'svg'];
var CODE_EXTS = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'json', 'xml', 'yml', 'yaml', 'sql', 'sh', 'bash', 'bat', 'ps1', 'vue', 'svelte'];
var DOC_EXTS = ['md', 'markdown', 'txt', 'log', 'csv', 'tsv', 'pdf', 'doc', 'docx', 'rtf'];

function extOf(name) {
  var s = String(name || '');
  var i = s.lastIndexOf('.');
  return i >= 0 ? s.slice(i + 1).toLowerCase() : '';
}

export function fileIconName(name) {
  var e = extOf(name);
  if (IMAGE_EXTS.indexOf(e) >= 0) return 'image';
  if (CODE_EXTS.indexOf(e) >= 0) return 'code';
  if (DOC_EXTS.indexOf(e) >= 0) return 'document';
  return 'file';
}

function fileTypeLabel(name) {
  var e = extOf(name);
  return e ? e.toUpperCase() : 'ФАЙЛ';
}

function normalize(arr) {
  var out = [];
  if (!Array.isArray(arr)) return out;
  for (var i = 0; i < arr.length; i++) {
    var e = arr[i];
    if (!e) continue;
    if (typeof e === 'number') out.push({ kind: 'upload', id: e, name: '' });
    else if (typeof e === 'string') out.push({ kind: 'upload', id: parseInt(e), name: '' });
    else if (e.kind === 'upload') out.push({ kind: 'upload', id: parseInt(e.id), name: e.name || '', missing: !!e.missing, size: e.size });
    else if (e.kind === 'path') out.push({ kind: 'path', path: String(e.path), name: e.name || String(e.path).split('/').pop(), missing: !!e.missing });
  }
  return out;
}

export function parseAttachments(raw) {
  var arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw || '[]'); } catch (e) { arr = []; }
  }
  return normalize(arr);
}

export function attachmentsFieldHTML(prefix, label) {
  return `
    <div class="form-group">
      <span class="form-label">${label || 'Вложения (файлы проекта)'}</span>
      <div class="attach-drop" id="${prefix}Drop">
        <div class="attach-list" id="${prefix}List"></div>
        <div class="attach-drop-hint">${svgIcon('upload', 'sm')} Перетащите файлы сюда или нажмите «Загрузить»</div>
      </div>
      <div class="attach-controls">
        <select class="form-select" id="${prefix}Upload">
          <option value="">+ Загруженный файл…</option>
        </select>
        <button type="button" class="btn btn-sm btn-secondary" id="${prefix}PickPath">${svgIcon('folder', 'sm')} Из папки</button>
        <button type="button" class="btn btn-sm btn-secondary" id="${prefix}UploadBtn">${svgIcon('upload', 'sm')} Загрузить</button>
      </div>
      <input type="file" id="${prefix}File" multiple hidden>
      <div class="attach-tree" id="${prefix}Tree" style="display:none"></div>
    </div>
  `;
}

export function bindAttachments(overlay, project, initial, prefix) {
  overlay._attachList = normalize(initial);
  overlay._attachProject = project || {};

  var sel = overlay.querySelector('#' + prefix + 'Upload');
  var pickBtn = overlay.querySelector('#' + prefix + 'PickPath');
  var upBtn = overlay.querySelector('#' + prefix + 'UploadBtn');
  var fileInput = overlay.querySelector('#' + prefix + 'File');
  var dropZone = overlay.querySelector('#' + prefix + 'Drop');
  var treeEl = overlay.querySelector('#' + prefix + 'Tree');

  fillUploadSelect(overlay, prefix);

  sel.addEventListener('change', function() {
    if (!sel.value) return;
    var f = (overlay._attachProject.files || []).filter(function(x) { return String(x.id) === sel.value; })[0];
    addAtt(overlay, prefix, { kind: 'upload', id: parseInt(sel.value), name: f ? f.original_name : '' });
    sel.value = '';
  });

  upBtn.addEventListener('click', function() { fileInput.click(); });
  fileInput.addEventListener('change', function() {
    handleFiles(overlay, prefix, fileInput.files);
    fileInput.value = '';
  });

  var stop = function(e) { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach(function(ev) {
    dropZone.addEventListener(ev, function(e) { stop(e); dropZone.classList.add('dragging'); });
  });
  ['dragleave', 'dragend'].forEach(function(ev) {
    dropZone.addEventListener(ev, function(e) { stop(e); dropZone.classList.remove('dragging'); });
  });
  dropZone.addEventListener('drop', function(e) {
    stop(e);
    dropZone.classList.remove('dragging');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleFiles(overlay, prefix, e.dataTransfer.files);
    }
  });

  pickBtn.addEventListener('click', function() {
    if (treeEl.style.display === 'none') {
      treeEl.style.display = '';
      if (!treeEl.dataset.loaded) loadAttTree(overlay, overlay._attachProject, prefix, treeEl);
    } else {
      treeEl.style.display = 'none';
    }
  });

  renderAttList(overlay, prefix);
}

export function getAttachments(overlay) {
  return (overlay._attachList || []).map(function(a) {
    return { kind: a.kind, id: a.id, path: a.path, name: a.name };
  });
}

function fillUploadSelect(overlay, prefix) {
  var sel = overlay.querySelector('#' + prefix + 'Upload');
  if (!sel) return;
  var current = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  var files = (overlay._attachProject.files || []).slice().sort(function(a, b) {
    return String(a.original_name).localeCompare(String(b.original_name), 'ru');
  });
  if (!files.length) {
    var empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Нет загруженных файлов';
    empty.disabled = true;
    sel.appendChild(empty);
  } else {
    files.forEach(function(f) {
      var o = document.createElement('option');
      o.value = String(f.id);
      o.textContent = f.original_name;
      sel.appendChild(o);
    });
  }
  sel.value = current || '';
}

async function handleFiles(overlay, prefix, fileList) {
  var files = Array.prototype.slice.call(fileList || []);
  if (!files.length) return;
  var project = overlay._attachProject || {};
  if (!project.id) { showToast('Проект не определён', true); return; }
  var dropZone = overlay.querySelector('#' + prefix + 'Drop');
  if (dropZone) dropZone.classList.add('uploading');
  try {
    const res = await api.uploadFiles(project.id, files);
    const added = res.files || [];
    project.files = project.files || [];
    added.forEach(function(f) {
      project.files.push(f);
      addAtt(overlay, prefix, { kind: 'upload', id: f.id, name: f.original_name, size: f.size });
    });
    fillUploadSelect(overlay, prefix);
    showToast(added.length === 1 ? 'Файл загружен' : 'Файлы загружены');
  } catch (err) {
    showToast(err.message || 'Ошибка загрузки', true);
  } finally {
    if (dropZone) dropZone.classList.remove('uploading');
  }
}

function addAtt(overlay, prefix, att) {
  var list = overlay._attachList || (overlay._attachList = []);
  for (var i = 0; i < list.length; i++) {
    if (list[i].kind === att.kind && (att.kind === 'upload' ? list[i].id === att.id : list[i].path === att.path)) return;
  }
  list.push(att);
  renderAttList(overlay, prefix);
}

function attTooltip(a, project) {
  var parts = [a.kind === 'upload' ? (a.name || ('Файл #' + a.id)) : a.path];
  if (a.kind === 'upload') {
    var f = (project && project.files || []).filter(function(x) { return x.id === a.id; })[0];
    parts.push(fileTypeLabel(f ? f.original_name : a.name));
    if (f && f.size) parts.push(formatFileSize(f.size));
  } else {
    parts.push('папка проекта');
  }
  return parts.join(' · ');
}

function renderAttList(overlay, prefix) {
  var listEl = overlay.querySelector('#' + prefix + 'List');
  if (!listEl) return;
  var project = overlay._attachProject || {};
  var list = overlay._attachList || [];
  if (!list.length) {
    listEl.innerHTML = '<p class="attach-empty">Файлы не прикреплены</p>';
    return;
  }
  listEl.innerHTML = list.map(function(a, i) {
    var name = a.kind === 'upload' ? (a.name || ('Файл #' + a.id)) : (a.name || a.path);
    var icon = fileIconName(name);
    return '<div class="attach-item">' +
      '<span class="attach-item-icon attach-icon-' + icon + '">' + svgIcon(icon, 'sm') + '</span>' +
      '<span class="attach-item-name" title="' + escapeHTML(attTooltip(a, project)) + '">' + escapeHTML(name) + '</span>' +
      '<span class="attach-item-kind">' + (a.kind === 'upload' ? 'загружен' : 'папка') + '</span>' +
      '<button type="button" class="attach-item-remove" data-i="' + i + '" title="Убрать">' + svgIcon('x', 'sm') + '</button>' +
    '</div>';
  }).join('');

  listEl.querySelectorAll('.attach-item-remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      overlay._attachList.splice(parseInt(btn.dataset.i), 1);
      renderAttList(overlay, prefix);
    });
  });
}

function attTreeHTML(entries) {
  if (!entries || !entries.length) return '<p class="fp-empty" style="padding:4px 6px">Пусто</p>';
  return entries.map(function(e) {
    if (e.type === 'dir') {
      return '<div class="att-tree-node">' +
        '<div class="att-tree-row" data-type="dir" data-path="' + escapeHTML(e.path) + '">' +
          '<span class="att-tree-arrow">' + (e.hasChildren ? svgIcon('chevron-right', 'sm') : '') + '</span>' +
          svgIcon('folder', 'sm') + ' <span>' + escapeHTML(e.name) + '</span>' +
        '</div>' +
        '<div class="att-tree-children" style="display:none"></div>' +
      '</div>';
    }
    return '<div class="att-tree-row" data-type="file" data-path="' + escapeHTML(e.path) + '">' + svgIcon(fileIconName(e.name), 'sm') + ' <span>' + escapeHTML(e.name) + '</span></div>';
  }).join('');
}

async function loadAttTree(overlay, project, prefix, container) {
  if (!project || !project.folder_path) {
    container.innerHTML = '<p class="fp-empty" style="padding:4px 6px">Папка проекта не выбрана</p>';
    container.dataset.loaded = '1';
    return;
  }
  container.innerHTML = '<p class="fp-empty" style="padding:4px 6px">Загрузка…</p>';
  try {
    const data = await api.getFileTree(project.id, '');
    container.innerHTML = attTreeHTML(data.entries);
    container.dataset.loaded = '1';
    bindAttTree(overlay, project, prefix, container);
  } catch (e) {
    container.innerHTML = '<p class="fp-empty" style="padding:4px 6px">Ошибка</p>';
  }
}

function bindAttTree(overlay, project, prefix, root) {
  root.querySelectorAll('.att-tree-row').forEach(function(row) {
    if (row.dataset.bound) return;
    row.dataset.bound = '1';
    row.addEventListener('click', async function(e) {
      e.stopPropagation();
      if (row.dataset.type === 'file') {
        var nameEl = row.querySelector('span');
        addAtt(overlay, prefix, { kind: 'path', path: row.dataset.path, name: nameEl ? nameEl.textContent : row.dataset.path });
        return;
      }
      var children = row.parentElement ? row.parentElement.querySelector('.att-tree-children') : null;
      if (!children) return;
      var arrow = row.querySelector('.att-tree-arrow');
      if (children.style.display !== 'none') {
        children.style.display = 'none';
        if (arrow) arrow.innerHTML = svgIcon('chevron-right', 'sm');
        return;
      }
      children.style.display = '';
      if (arrow) arrow.innerHTML = svgIcon('chevron-down', 'sm');
      if (children.dataset.loaded !== '1') {
        children.innerHTML = '<p class="fp-empty" style="padding:4px 6px">Загрузка…</p>';
        try {
          const data = await api.getFileTree(project.id, row.dataset.path);
          children.innerHTML = attTreeHTML(data.entries);
          children.dataset.loaded = '1';
          bindAttTree(overlay, project, prefix, children);
        } catch (err) {
          children.innerHTML = '<p class="fp-empty" style="padding:4px 6px">Ошибка</p>';
        }
      }
    });
  });
}

// Чипы вложений для карточек заметок/чеклиста
export function renderAttachmentChips(attachments, project) {
  var list = normalize(attachments);
  if (!list.length) return '';
  var files = (project && project.files) || [];
  return '<div class="attach-chips">' + list.map(function(a) {
    if (a.kind === 'upload') {
      var f = files.filter(function(x) { return x.id === a.id; })[0];
      var uname = f ? f.original_name : (a.name || ('Файл #' + a.id));
      if (!f || a.missing) {
        return '<span class="attach-chip missing" title="Файл не найден">' + svgIcon(fileIconName(uname), 'sm') + ' ' + escapeHTML(uname) + '</span>';
      }
      return '<button type="button" class="attach-chip" data-kind="upload" data-url="/uploads/files/' + escapeHTML(f.filename) + '" title="' + escapeHTML(fileTypeLabel(uname) + (f.size ? ' · ' + formatFileSize(f.size) : '')) + '">' + svgIcon(fileIconName(uname), 'sm') + ' ' + escapeHTML(uname) + '</button>';
    }
    var pname = a.name || a.path;
    if (a.missing) {
      return '<span class="attach-chip missing" title="Файл не найден в папке проекта">' + svgIcon(fileIconName(pname), 'sm') + ' ' + escapeHTML(pname) + '</span>';
    }
    return '<button type="button" class="attach-chip" data-kind="path" data-path="' + escapeHTML(a.path) + '" title="' + escapeHTML(a.path) + '">' + svgIcon(fileIconName(pname), 'sm') + ' ' + escapeHTML(pname) + '</button>';
  }).join('') + '</div>';
}
