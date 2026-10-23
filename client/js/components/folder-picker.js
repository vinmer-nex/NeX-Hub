import api from '../api.js';
import { openModal } from './modal.js';
import { svgIcon, escapeHTML, showToast } from '../utils/dom.js';

function placeIcon(name) {
  const n = (name || '').toLowerCase();
  if (n.indexOf('домаш') !== -1) return svgIcon('home', 'sm');
  if (n.indexOf('стол') !== -1) return svgIcon('monitor', 'sm');
  if (n.indexOf('загруз') !== -1) return svgIcon('download', 'sm');
  if (n.indexOf('изображ') !== -1 || n.indexOf('картин') !== -1) return svgIcon('image', 'sm');
  return svgIcon('folder', 'sm');
}

export function openFolderPicker(projectId, currentPath, onSelect) {
  const state = { path: currentPath || '', parent: null, dirs: [], places: [], drives: [] };

  const body = `
    <div class="folder-picker">
      <div class="fp-layout">
        <aside class="fp-side" id="fpSide"></aside>
        <div class="fp-main">
          <div class="fp-toolbar">
            <button type="button" class="btn btn-sm btn-secondary" id="fpUp" title="Вверх">${svgIcon('arrow-up', 'sm')}</button>
            <input class="form-input fp-path" id="fpPath" type="text" placeholder="Введите путь, например C:\\Projects" value="${escapeHTML(currentPath || '')}">
            <button type="button" class="btn btn-sm btn-secondary" id="fpGo">Перейти</button>
          </div>
          <div class="fp-list" id="fpList"></div>
        </div>
      </div>
    </div>
  `;

  const footer = `
    <button class="btn btn-secondary modal-close-x" type="button">Отмена</button>
    <button class="btn btn-primary" id="modalSaveBtn" type="button">Выбрать эту папку</button>
  `;

  const overlay = openModal('Выбор папки проекта', body, async () => {
    if (!state.path) {
      showToast('Выберите папку', true);
      return false;
    }
    try {
      await api.setFolder(projectId, state.path);
      showToast('Папка выбрана');
      if (onSelect) await onSelect(state.path);
      return true;
    } catch (err) {
      showToast(err.message || 'Ошибка', true);
      return false;
    }
  }, { footer });

  const sideEl = overlay.querySelector('#fpSide');
  const listEl = overlay.querySelector('#fpList');
  const pathInput = overlay.querySelector('#fpPath');
  const upBtn = overlay.querySelector('#fpUp');
  const goBtn = overlay.querySelector('#fpGo');

  function navItem(name, p, iconHtml) {
    const active = state.path && p.toLowerCase() === state.path.toLowerCase() ? ' active' : '';
    return '<button type="button" class="fp-nav-item' + active + '" data-path="' + escapeHTML(p) + '">' +
      iconHtml + '<span class="fp-nav-name">' + escapeHTML(name) + '</span>' +
    '</button>';
  }

  function renderSide() {
    let html = '';
    if (state.places && state.places.length) {
      html += '<div class="fp-nav-title">Быстрый доступ</div>';
      html += state.places.map(function(p) { return navItem(p.name, p.path, placeIcon(p.name)); }).join('');
    }
    if (state.drives && state.drives.length) {
      html += '<div class="fp-nav-title">Компьютер</div>';
      html += state.drives.map(function(d) { return navItem(d.name, d.path, svgIcon('drive', 'sm')); }).join('');
    }
    sideEl.innerHTML = html;
    sideEl.querySelectorAll('.fp-nav-item').forEach(function(el) {
      el.addEventListener('click', function() { navigate(el.dataset.path); });
    });
  }

  function renderList() {
    if (!state.dirs.length) {
      listEl.innerHTML = '<p class="fp-empty">Нет подпапок</p>';
      return;
    }
    listEl.innerHTML = state.dirs.map(function(d) {
      return '<div class="fp-item" data-path="' + escapeHTML(d.path) + '">' +
        svgIcon('folder', 'sm') + ' <span>' + escapeHTML(d.name) + '</span>' +
      '</div>';
    }).join('');
    listEl.querySelectorAll('.fp-item').forEach(function(el) {
      el.addEventListener('click', function() { navigate(el.dataset.path); });
    });
  }

  async function navigate(fsPath) {
    listEl.innerHTML = '<p class="fp-empty">Загрузка…</p>';
    try {
      const data = await api.browseFs(fsPath);
      state.path = data.path;
      state.parent = data.parent;
      state.dirs = data.dirs || [];
      state.places = data.places || state.places;
      state.drives = data.drives || state.drives;
      pathInput.value = data.path || '';
      upBtn.disabled = !data.parent;
      renderSide();
      renderList();
    } catch (err) {
      listEl.innerHTML = '<p class="fp-empty">Не удалось открыть папку</p>';
    }
  }

  upBtn.addEventListener('click', function() {
    if (state.parent) navigate(state.parent);
  });

  goBtn.addEventListener('click', function() {
    navigate(pathInput.value.trim());
  });

  pathInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigate(pathInput.value.trim());
    }
  });

  navigate(currentPath || '');
}
