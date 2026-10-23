import api from '../api.js';
import CONFIG from '../config.js';
import { svgIcon, showToast } from '../utils/dom.js';

export function openModal(title, bodyHTML, onSave, opts) {
  opts = opts || {};
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal${opts.size === 'lg' ? ' modal-lg' : ''}">
      <div class="modal-header">
        <div class="modal-header-text">
          <h2>${title}</h2>
          ${opts.subtitle ? `<p class="modal-sub">${opts.subtitle}</p>` : ''}
        </div>
        <button class="btn btn-icon modal-close-x" type="button">${svgIcon('x')}</button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
      ${opts.footer ? `<div class="modal-footer">${opts.footer}</div>` : ''}
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();

  // Все кнопки с классом modal-close-x
  overlay.querySelectorAll('.modal-close-x').forEach(btn => {
    btn.addEventListener('click', close);
  });

  // Закрытие по клику на фон — только если нажатие началось на самом фоне
  // (чтобы выделение текста с выходом за пределы модалки не закрывало её)
  let downOnOverlay = false;
  overlay.addEventListener('mousedown', e => { downOnOverlay = (e.target === overlay); });
  overlay.addEventListener('click', e => {
    if (e.target === overlay && downOnOverlay) close();
  });

  // Escape
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  const saveBtn = overlay.querySelector('#modalSaveBtn');
  if (saveBtn && onSave) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      const origText = saveBtn.textContent;
      saveBtn.textContent = 'Сохранение...';
      try {
        const result = await onSave(overlay);
        if (result !== false) close();
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Ошибка', true);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = origText;
      }
    });
  }

  return overlay;
}

// Загрузка логотипа внутри модалки проекта (dropzone #logoPreview + #logoInput)
export function wireLogoUpload(overlay, opts) {
  opts = opts || {};
  const preview = overlay.querySelector('#logoPreview');
  const input = overlay.querySelector('#logoInput');
  if (!preview || !input) return;

  const emptyHTML = `${svgIcon('image', 'lg')}<span>Логотип</span><span class="clear-badge" style="display:none">×</span>`;

  const setEmpty = () => {
    preview.innerHTML = emptyHTML;
    preview.classList.remove('has-image');
    input.value = '';
    if (opts.onClear) opts.onClear();
  };

  const setImage = (data) => {
    preview.innerHTML = `<img src="${data}" alt=""><span class="clear-badge" style="display:flex">×</span>`;
    preview.classList.add('has-image');
    preview.querySelector('.clear-badge').addEventListener('click', (e) => {
      e.stopPropagation();
      setEmpty();
    });
  };

  if (opts.initial) setImage(opts.initial);

  preview.addEventListener('click', () => input.click());

  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImage(ev.target.result);
      if (opts.onChange) opts.onChange(ev.target.result);
    };
    reader.readAsDataURL(file);
  });
}

// Общая логика формы проекта: сегменты статуса, пилюли приоритета, цвет, теги
export function wireProjectForm(overlay, ids) {
  // Статус
  const seg = overlay.querySelector('.segmented');
  const statusHidden = overlay.querySelector('#' + ids.status);
  if (seg && statusHidden) {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg');
      if (!btn) return;
      seg.querySelectorAll('.seg').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      statusHidden.value = btn.dataset.value;
    });
  }

  // Приоритет
  const pills = overlay.querySelector('.priority-pills');
  const priHidden = overlay.querySelector('#' + ids.priority);
  if (pills && priHidden) {
    pills.addEventListener('click', (e) => {
      const btn = e.target.closest('.priority-pill');
      if (!btn) return;
      pills.querySelectorAll('.priority-pill').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      priHidden.value = btn.dataset.value;
    });
  }

  // Цвет
  const colors = overlay.querySelector('.color-options');
  const colorHidden = overlay.querySelector('#' + ids.color);
  if (colors && colorHidden) {
    colors.addEventListener('click', (e) => {
      const opt = e.target.closest('.color-option');
      if (!opt) return;
      colors.querySelectorAll('.color-option').forEach(x => x.classList.remove('selected'));
      opt.classList.add('selected');
      colorHidden.value = opt.dataset.color;
    });
  }

  // Теги
  const tagsField = overlay.querySelector('.tags-field');
  const tagsInput = overlay.querySelector('#' + ids.tagsInput);
  const tagsHidden = overlay.querySelector('#' + ids.tags);
  if (tagsField && tagsInput && tagsHidden) {
    const sync = () => {
      const tags = Array.from(tagsField.querySelectorAll('.tag-pill')).map(p => p.dataset.tag);
      tagsHidden.value = tags.join(',');
    };

    const addTag = (raw) => {
      const val = (raw || '').trim();
      if (!val) return;
      const dup = Array.from(tagsField.querySelectorAll('.tag-pill'))
        .some(p => p.dataset.tag.toLowerCase() === val.toLowerCase());
      if (dup) return;
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.dataset.tag = val;
      pill.innerHTML = '<span></span><button type="button" aria-label="Удалить">×</button>';
      pill.querySelector('span').textContent = val;
      pill.querySelector('button').addEventListener('click', () => { pill.remove(); sync(); });
      tagsField.insertBefore(pill, tagsInput);
      sync();
    };

    (ids.initialTags || []).forEach(addTag);

    tagsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag(tagsInput.value);
        tagsInput.value = '';
      } else if (e.key === 'Backspace' && !tagsInput.value) {
        const last = tagsInput.previousElementSibling;
        if (last && last.classList.contains('tag-pill')) { last.remove(); sync(); }
      }
    });

    tagsField.addEventListener('click', (e) => {
      if (e.target === tagsField) tagsInput.focus();
    });
  }
}

// Создание проекта
export function openCreateProjectModal(onSuccess) {
  let tempLogo = null;

  const prioritiesHTML = CONFIG.PRIORITIES.map(p =>
    `<button type="button" class="priority-pill${p === 'p3' ? ' active' : ''}" data-p="${p}" data-value="${p}">${CONFIG.PRIORITY_LABELS[p]}</button>`
  ).join('');

  const statusesHTML = CONFIG.STATUSES.map(s =>
    `<button type="button" class="seg${s === 'active' ? ' active' : ''}" data-status="${s}" data-value="${s}"><span class="dot"></span><span class="txt">${CONFIG.STATUS_LABELS[s]}</span></button>`
  ).join('');

  const colorsHTML = CONFIG.COLORS.map((c, i) =>
    `<span class="color-option${i === 0 ? ' selected' : ''}" style="background:${c}" data-color="${c}"></span>`
  ).join('');

  const today = new Date().toISOString().slice(0, 10);

  const body = `
    <div class="modal-hero">
      <div class="modal-logo" id="logoPreview">
        ${svgIcon('image', 'lg')}
        <span>Логотип</span>
        <span class="clear-badge" style="display:none">×</span>
      </div>
      <input type="file" id="logoInput" accept="image/*" style="display:none">
      <div class="modal-hero-fields">
        <div class="form-group">
          <label class="form-label">Название <span class="req">*</span></label>
          <input class="form-input" id="prName" maxlength="100" placeholder="Название проекта" autofocus>
        </div>
        <div class="form-group">
          <label class="form-label">Описание</label>
          <textarea class="form-textarea" id="prDesc" maxlength="500" placeholder="О чём проект?"></textarea>
        </div>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-label">Организация</div>
      <div class="form-group">
        <span class="form-label">Статус</span>
        <div class="segmented">${statusesHTML}</div>
        <input type="hidden" id="prStatus" value="active">
      </div>
      <div class="form-group">
        <span class="form-label">Приоритет</span>
        <div class="priority-pills">${prioritiesHTML}</div>
        <input type="hidden" id="prPriority" value="p3">
      </div>
      <div class="form-group">
        <span class="form-label">Теги</span>
        <div class="tags-field">
          <input class="tags-input" id="prTagsInput" placeholder="Добавить тег и Enter">
        </div>
        <input type="hidden" id="prTags" value="">
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-label">Сроки и оценка</div>
      <div class="m-grid-4">
        <div class="form-group"><label class="form-label">Старт</label><input class="form-input" type="date" id="prStartDate" value="${today}"></div>
        <div class="form-group"><label class="form-label">Дедлайн</label><input class="form-input" type="date" id="prDeadline"></div>
        <div class="form-group"><label class="form-label">Оценка, ч</label><input class="form-input" type="number" id="prEstimate" min="0" step="0.5" placeholder="40"></div>
        <div class="form-group"><label class="form-label">Начальная версия</label><input class="form-input" id="prVersion" value="1.0.0" placeholder="1.0.0"></div>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-label">Оформление</div>
      <div class="inline-field">
        <label class="form-label">Цвет</label>
        <div class="color-options">${colorsHTML}</div>
        <input type="hidden" id="prColor" value="${CONFIG.COLORS[0]}">
      </div>
    </div>
  `;

  const footer = `
    <button class="btn btn-secondary modal-close-x" type="button">Отмена</button>
    <button class="btn btn-primary" id="modalSaveBtn" type="button">Создать</button>
  `;

  const overlay = openModal('Новый проект', body, async (el) => {
    const name = el.querySelector('#prName').value.trim();
    if (!name) { showToast('Введите название', true); return false; }

    const version = el.querySelector('#prVersion').value.trim() || '1.0.0';
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      showToast('Формат версии: 1.2.3', true);
      return false;
    }

    try {
      await api.createProject({
        name,
        description: el.querySelector('#prDesc').value.trim(),
        priority: el.querySelector('#prPriority').value,
        status: el.querySelector('#prStatus').value,
        tags: el.querySelector('#prTags').value.split(',').map(t => t.trim()).filter(Boolean),
        startDate: el.querySelector('#prStartDate').value || null,
        deadline: el.querySelector('#prDeadline').value || null,
        estimatedHours: parseFloat(el.querySelector('#prEstimate').value) || null,
        color: el.querySelector('#prColor').value,
        logo: tempLogo,
        version
      });

      showToast('Проект создан');
      if (onSuccess) await onSuccess();
      return true;
    } catch (err) {
      showToast(err.message, true);
      return false;
    }
  }, {
    size: 'lg',
    subtitle: 'Заполни основное — остальное добавишь позже',
    footer
  });

  wireProjectForm(overlay, { status: 'prStatus', priority: 'prPriority', color: 'prColor', tags: 'prTags', tagsInput: 'prTagsInput' });
  wireLogoUpload(overlay, {
    onChange: (data) => { tempLogo = data; },
    onClear: () => { tempLogo = null; }
  });
}
