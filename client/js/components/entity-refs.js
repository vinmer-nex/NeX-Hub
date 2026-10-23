import { svgIcon, escapeHTML } from '../utils/dom.js';

function selectedSet(values) {
  return new Set((Array.isArray(values) ? values : []).map(String));
}

function buildNotesPickerHTML(prefix, label, notes, selectedIds) {
  const list = Array.isArray(notes) ? notes : [];
  if (!list.length) return '';
  const selected = selectedSet(selectedIds);

  return `
    <div class="form-group">
      <span class="form-label">${label}</span>
      <div class="note-links-picker">
        <button type="button" class="form-input picker-toggle" id="${prefix}Toggle">
          <span class="picker-summary" id="${prefix}Summary"></span>
          ${svgIcon('chevron-down', 'sm')}
        </button>
        <div class="picker-menu" id="${prefix}Menu" style="display:none">
          ${list.map(item => `
            <label class="picker-option">
              <input type="checkbox" value="${escapeHTML(String(item.id))}" ${selected.has(String(item.id)) ? 'checked' : ''}>
              <span class="picker-option-text">${escapeHTML(item.title || 'Без заголовка')}</span>
            </label>
          `).join('')}
        </div>
      </div>
    </div>`;
}

function buildTasksPickerHTML(prefix, label, checklist, categories, selectedIds) {
  const items = Array.isArray(checklist) ? checklist : [];
  if (!items.length) return '';

  const cats = Array.isArray(categories) ? categories : [];
  const catIds = new Set(cats.map(c => String(c.id)));
  const selected = selectedSet(selectedIds);

  const groups = [];
  cats.forEach(cat => {
    const groupItems = items.filter(i => String(i.category_id || '') === String(cat.id));
    if (groupItems.length) groups.push({ id: String(cat.id), name: cat.name, items: groupItems });
  });
  const uncategorized = items.filter(i => !i.category_id || !catIds.has(String(i.category_id)));
  if (uncategorized.length) groups.push({ id: '', name: 'Без категории', items: uncategorized });
  if (!groups.length) return '';

  const categoryKeyOf = (item) => (item.category_id && catIds.has(String(item.category_id))) ? String(item.category_id) : '';
  const firstSelected = items.find(item => selected.has(String(item.id)));
  const defaultCategory = firstSelected ? categoryKeyOf(firstSelected) : groups[0].id;
  const categoryOptions = groups.map(g =>
    `<option value="${escapeHTML(g.id)}" ${g.id === defaultCategory ? 'selected' : ''}>${escapeHTML(g.name)}</option>`
  ).join('');

  const taskOptions = items.map(i => {
    const catKey = categoryKeyOf(i);
    return `<label class="picker-option task-option" data-category="${escapeHTML(catKey)}" style="${catKey === defaultCategory ? '' : 'display:none'}">
      <input type="checkbox" value="${i.id}" ${selected.has(String(i.id)) ? 'checked' : ''}>
      <span class="picker-option-text">${escapeHTML(i.text)}</span>
      ${i.priority ? `<span class="priority-badge priority-${i.priority}">${i.priority.toUpperCase()}</span>` : ''}
    </label>`;
  }).join('');

  return `
    <div class="form-group">
      <span class="form-label">${label}</span>
      <div class="note-links-picker">
        <button type="button" class="form-input picker-toggle" id="${prefix}Toggle">
          <span class="picker-summary" id="${prefix}Summary"></span>
          ${svgIcon('chevron-down', 'sm')}
        </button>
        <div class="picker-menu task-picker-menu" id="${prefix}Menu" style="display:none">
          <div class="picker-category-row">
            <label class="picker-category-label" for="${prefix}Category">Категория</label>
            <select class="form-select picker-category" id="${prefix}Category" title="Выберите категорию задач">${categoryOptions}</select>
          </div>
          <div class="picker-tasks" id="${prefix}Tasks">${taskOptions}</div>
        </div>
      </div>
    </div>`;
}

function bindNotesPicker(overlay, prefix) {
  const toggle = overlay.querySelector('#' + prefix + 'Toggle');
  const menu = overlay.querySelector('#' + prefix + 'Menu');
  const summary = overlay.querySelector('#' + prefix + 'Summary');
  if (!toggle || !menu || !summary) return;

  const updateSummary = () => {
    const checked = Array.from(menu.querySelectorAll('input[type="checkbox"]:checked'));
    if (!checked.length) summary.textContent = 'Не выбрано';
    else if (checked.length === 1) {
      const option = checked[0].closest('.picker-option');
      const text = option ? option.querySelector('.picker-option-text') : null;
      summary.textContent = text ? text.textContent : 'Выбрано: 1';
    } else summary.textContent = 'Выбрано заметок: ' + checked.length;
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.style.display !== 'none';
    if (open) {
      menu.style.display = 'none';
      toggle.classList.remove('open');
    } else {
      closeOtherPickers(overlay, menu);
      menu.style.display = '';
      toggle.classList.add('open');
    }
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
  menu.addEventListener('change', updateSummary);
  updateSummary();
}

function bindTasksPicker(overlay, prefix) {
  const toggle = overlay.querySelector('#' + prefix + 'Toggle');
  const menu = overlay.querySelector('#' + prefix + 'Menu');
  const summary = overlay.querySelector('#' + prefix + 'Summary');
  const categorySelect = overlay.querySelector('#' + prefix + 'Category');
  const tasks = overlay.querySelector('#' + prefix + 'Tasks');
  if (!toggle || !menu || !summary) return;

  const taskOptions = tasks ? Array.from(tasks.querySelectorAll('.task-option')) : [];

  const updateSummary = () => {
    const checked = Array.from(menu.querySelectorAll('input[type="checkbox"]:checked'));
    if (!checked.length) summary.textContent = 'Не выбрано';
    else if (checked.length === 1) {
      const option = checked[0].closest('.picker-option');
      const text = option ? option.querySelector('.picker-option-text') : null;
      summary.textContent = text ? text.textContent : 'Выбрано: 1';
    } else summary.textContent = 'Выбрано задач: ' + checked.length;
  };

  const applyCategoryFilter = () => {
    const category = categorySelect ? categorySelect.value : null;
    taskOptions.forEach(option => {
      option.style.display = category === null || option.dataset.category === category ? '' : 'none';
    });
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.style.display !== 'none';
    if (open) {
      menu.style.display = 'none';
      toggle.classList.remove('open');
    } else {
      closeOtherPickers(overlay, menu);
      menu.style.display = '';
      toggle.classList.add('open');
      applyCategoryFilter();
    }
  });
  if (categorySelect) {
    categorySelect.addEventListener('change', (e) => {
      e.stopPropagation();
      applyCategoryFilter();
    });
  }
  menu.addEventListener('click', (e) => e.stopPropagation());
  menu.addEventListener('change', updateSummary);
  updateSummary();
  applyCategoryFilter();
}

function closeOtherPickers(overlay, currentMenu) {
  overlay.querySelectorAll('.picker-menu').forEach(other => {
    if (other === currentMenu) return;
    other.style.display = 'none';
    const otherToggle = other.previousElementSibling;
    if (otherToggle) otherToggle.classList.remove('open');
  });
}

// Поля выбора заметок и задач для модалок
export function refsFieldHTML(prefix, project, selected, options) {
  const p = project || {};
  const opts = options || {};
  const refs = selected || {};
  const excludeNoteId = opts.excludeNoteId != null ? String(opts.excludeNoteId) : null;
  const excludeChecklistId = opts.excludeChecklistId != null ? String(opts.excludeChecklistId) : null;

  const notes = (p.notes || []).filter(n => excludeNoteId === null || String(n.id) !== excludeNoteId);
  const checklist = (p.checklist || []).filter(i => excludeChecklistId === null || String(i.id) !== excludeChecklistId);
  const selectedNoteIds = (refs.note_ids || []).filter(id => excludeNoteId === null || String(id) !== excludeNoteId);
  const selectedChecklistIds = (refs.checklist_ids || refs.links || [])
    .filter(id => excludeChecklistId === null || String(id) !== excludeChecklistId);

  const notesPicker = opts.showNotes === false ? '' : buildNotesPickerHTML(
    prefix + 'Note',
    opts.noteLabel || 'Заметки',
    notes,
    selectedNoteIds
  );

  const tasksPicker = opts.showTasks === false ? '' : buildTasksPickerHTML(
    prefix + 'Task',
    opts.taskLabel || 'Задачи',
    checklist,
    p.checklistCategories || [],
    selectedChecklistIds
  );

  return notesPicker + tasksPicker;
}

export function bindRefsPicker(overlay, prefix) {
  bindNotesPicker(overlay, prefix + 'Note');
  bindTasksPicker(overlay, prefix + 'Task');
}

export function readRefs(overlay, prefix) {
  const notesMenu = overlay.querySelector('#' + prefix + 'NoteMenu');
  const tasksMenu = overlay.querySelector('#' + prefix + 'TaskMenu');
  return {
    note_ids: notesMenu
      ? Array.from(notesMenu.querySelectorAll('input[type="checkbox"]:checked')).map(c => String(c.value))
      : [],
    checklist_ids: tasksMenu
      ? Array.from(tasksMenu.querySelectorAll('input[type="checkbox"]:checked'))
        .map(c => parseInt(c.value, 10))
        .filter(Number.isFinite)
      : []
  };
}

function collectRows(selected, project) {
  const p = project || {};
  const refs = selected || {};
  const noteIds = Array.isArray(refs.note_ids) ? refs.note_ids : [];
  const checklistIds = Array.isArray(refs.checklist_ids)
    ? refs.checklist_ids
    : (Array.isArray(refs.links) ? refs.links : []);

  const notes = p.notes || [];
  const checklist = p.checklist || {};

  const noteRows = noteIds.map(id => {
    const note = notes.find(n => String(n.id) === String(id));
    return {
      id: String(id),
      label: note ? (note.title || 'Без заголовка') : ('Заметка #' + id),
      missing: !note
    };
  });

  const taskRows = checklistIds.map(id => {
    const item = Array.isArray(checklist)
      ? checklist.find(i => String(i.id) === String(id))
      : null;
    return {
      id: String(id),
      label: item ? item.text : ('Задача #' + id),
      priority: item ? item.priority : '',
      missing: !item
    };
  });

  return { noteRows, taskRows };
}

// Чипы связей для карточек заметок, версий и задач
export function refsChipsHTML(selected, project, options) {
  const opts = options || {};
  const { noteRows, taskRows } = collectRows(selected, project);
  const groups = [];

  if (noteRows.length && opts.showNotes !== false) {
    groups.push(`
      <div class="ref-group">
        <span class="note-links-label">${svgIcon('note', 'sm')} ${opts.noteLabel || 'Заметки'}:</span>
        ${noteRows.map(row => `
          <button type="button" class="note-link-chip ref-chip${row.missing ? ' missing' : ''}"
            data-ref-type="note" data-ref-id="${escapeHTML(row.id)}" title="Открыть заметку">
            ${escapeHTML(row.label)}
          </button>`).join('')}
      </div>`);
  }

  if (taskRows.length && opts.showTasks !== false) {
    groups.push(`
      <div class="ref-group">
        <span class="note-links-label">${svgIcon('check', 'sm')} ${opts.taskLabel || 'Задачи'}:</span>
        ${taskRows.map(row => `
          <button type="button" class="note-link-chip ref-chip${row.missing ? ' missing' : ''}"
            data-ref-type="checklist" data-ref-id="${escapeHTML(row.id)}" title="Открыть задачу в чеклисте">
            ${escapeHTML(row.label)}${row.priority ? ` <span class="priority-badge priority-${row.priority}">${row.priority.toUpperCase()}</span>` : ''}
          </button>`).join('')}
      </div>`);
  }

  if (!groups.length) return '';
  return `<div class="ref-groups">${groups.join('')}</div>`;
}

// Компактное превью связей для Mind Map
export function refsPreviewHTML(selected, project, options) {
  const opts = options || {};
  const { noteRows, taskRows } = collectRows(selected, project);
  const groups = [];

  if (noteRows.length && opts.showNotes !== false) {
    groups.push(`
      <div class="mm-preview-files">
        <div class="mm-preview-files-label">${svgIcon('note', 'sm')} ${opts.noteLabel || 'Заметки'}</div>
        ${noteRows.map(row => `
          <div class="mm-preview-file${row.missing ? ' missing' : ''}">
            ${svgIcon('note', 'sm')} <span>${escapeHTML(row.label)}</span>
          </div>`).join('')}
      </div>`);
  }

  if (taskRows.length && opts.showTasks !== false) {
    groups.push(`
      <div class="mm-preview-files">
        <div class="mm-preview-files-label">${svgIcon('check', 'sm')} ${opts.taskLabel || 'Задачи'}</div>
        ${taskRows.map(row => `
          <div class="mm-preview-file${row.missing ? ' missing' : ''}">
            ${svgIcon('check', 'sm')} <span>${escapeHTML(row.label)}</span>
            ${row.priority ? ` <span class="priority-badge priority-${row.priority}">${row.priority.toUpperCase()}</span>` : ''}
          </div>`).join('')}
      </div>`);
  }

  return groups.join('');
}

// Делегированный клик по чипам: type = note | checklist
export function bindRefsNavigation(root, onNavigate) {
  if (!root || typeof onNavigate !== 'function' || root.dataset.refsNavBound === '1') return;
  root.dataset.refsNavBound = '1';
  root.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-ref-type][data-ref-id]');
    if (!chip || !root.contains(chip)) return;
    e.preventDefault();
    e.stopPropagation();
    onNavigate(chip.dataset.refType, chip.dataset.refId);
  });
}
