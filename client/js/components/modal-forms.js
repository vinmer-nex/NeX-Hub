import api from '../api.js';
import store from '../store.js';
import { openModal } from './modal.js';
import { showToast, escapeHTML, svgIcon } from '../utils/dom.js';
import { attachmentsFieldHTML, bindAttachments, getAttachments } from './attachments.js';
import { refsFieldHTML, bindRefsPicker, readRefs } from './entity-refs.js';
import CONFIG from '../config.js';

// ============= ЗАМЕТКА (создание + редактирование) =============
export async function openAddNoteModal(projectId, onSuccess, editNote = null) {
  const isEdit = !!editNote;
  const title = isEdit ? 'Редактировать заметку' : 'Новая заметка';

  let project = null;
  try { const d = await api.getProject(projectId); project = d.project; } catch (e) {}

  const body = `
    <div class="form-group">
      <span class="form-label">Заголовок</span>
      <input class="form-input" id="noteTitle" maxlength="150" 
             placeholder="О чём заметка?" value="${escapeHTML(editNote?.title || '')}">
    </div>
    <div class="form-group">
      <span class="form-label">Текст</span>
      <textarea class="form-textarea" id="noteText" maxlength="5000" 
                style="min-height:140px" placeholder="Текст заметки…">${escapeHTML(editNote?.text || '')}</textarea>
      <div class="form-hint">Выделите текст и нажмите Ctrl+K, чтобы вставить ссылку. Форматирование: ПКМ по выделению.</div>
    </div>
    <div class="form-group">
      <span class="form-label">Теги</span>
      <div class="tag-editor" id="noteTagEditor">
        <div class="tag-editor-chips" id="noteTagChips"></div>
        <input class="form-input tag-editor-input" id="noteTagInput" maxlength="32" placeholder="Введите тег и Enter">
      </div>
    </div>
    ${refsFieldHTML('noteRefs', project, {
      note_ids: (editNote && editNote.note_ids) || [],
      checklist_ids: (editNote && (editNote.checklist_ids || editNote.links)) || []
    }, { excludeNoteId: editNote && editNote.id, showNotes: false })}
    ${attachmentsFieldHTML('noteAtt')}
    <div class="form-row">
      <button class="btn btn-secondary modal-close-x">Отмена</button>
      <button class="btn btn-primary" id="modalSaveBtn">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `;

  const overlay = openModal(title, body, async (ov) => {
    const titleVal = ov.querySelector('#noteTitle').value.trim();
    const textVal = ov.querySelector('#noteText').value.trim();

    if (!titleVal && !textVal) {
      showToast('Заполните заголовок или текст', true);
      return false;
    }

    const attachments = getAttachments(ov);
    const tags = ov._noteTags || [];
    const refs = readRefs(ov, 'noteRefs');
    const payload = {
      title: titleVal,
      text: textVal,
      attachments,
      tags,
      note_ids: refs.note_ids,
      checklist_ids: refs.checklist_ids,
      links: refs.checklist_ids
    };
    try {
      if (isEdit) {
        await api.updateNote(projectId, editNote.id, payload);
        showToast('Заметка обновлена');
      } else {
        await api.addNote(projectId, payload);
        showToast('Заметка добавлена');
      }
      if (onSuccess) await onSuccess();
      return true;
    } catch (err) {
      showToast(err.message, true);
      return false;
    }
  });
  bindAttachments(overlay, project, (editNote && editNote.attachments) || [], 'noteAtt');
  bindTagEditor(overlay, (editNote && editNote.tags) || []);
  bindRefsPicker(overlay, 'noteRefs');
  bindNoteFormatMenu(overlay);
}

// ============= ПКМ-меню форматирования выделенного текста =============
const NOTE_FORMAT_ITEMS = [
  { label: 'Жирный', icon: 'bold', wrap: ['**', '**'] },
  { label: 'Курсив', icon: 'italic', wrap: ['*', '*'] },
  { label: 'Код', icon: 'code', wrap: ['`', '`'] },
  { label: 'Зачёркнутый', icon: 'strike', wrap: ['~~', '~~'] },
  { label: 'Ссылка', icon: 'link', link: true },
  { label: 'Заголовок', icon: 'heading', heading: true }
];

function bindNoteFormatMenu(overlay) {
  const ta = overlay.querySelector('#noteText');
  if (!ta) return;
  overlay._formatMenu = null;
  ta.addEventListener('contextmenu', (e) => {
    if (ta.selectionStart === ta.selectionEnd) return; // нет выделения — системное меню
    e.preventDefault();
    e.stopPropagation();
    showNoteFormatMenu(e.clientX, e.clientY, ta, overlay);
  });
  // Ctrl/Cmd+K — вставить ссылку (можно и без выделения)
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openNoteLinkPopover(ta);
    }
  });
}

function showNoteFormatMenu(x, y, ta, overlay) {
  if (overlay._formatMenu) { overlay._formatMenu.remove(); overlay._formatMenu = null; }

  const menu = document.createElement('div');
  menu.className = 'context-menu note-format-menu';

  NOTE_FORMAT_ITEMS.forEach(item => {
    const el = document.createElement('div');
    el.className = 'context-menu-item';
    el.innerHTML = `${svgIcon(item.icon, 'sm')} ${item.label}`;
    el.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu();
      applyNoteFormat(ta, item);
    });
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 8);
  const py = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = Math.max(8, px) + 'px';
  menu.style.top = Math.max(8, py) + 'px';

  overlay._formatMenu = menu;

  const closeMenu = () => { menu.remove(); overlay._formatMenu = null; document.removeEventListener('mousedown', onDoc, true); };
  const onDoc = (ev) => { if (!menu.contains(ev.target)) closeMenu(); };
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') { closeMenu(); document.removeEventListener('keydown', esc); }
    });
  }, 0);
}

function applyNoteFormat(ta, item) {
  if (item.link) {
    openNoteLinkPopover(ta);
    return;
  }

  const s = ta.selectionStart, e = ta.selectionEnd;
  const val = ta.value;

  if (item.heading) {
    const lineStart = val.lastIndexOf('\n', s - 1) + 1;
    let block = val.slice(lineStart, e);
    block = block.split('\n').map(l => /^##\s+/.test(l) ? l.replace(/^##\s+/, '') : '## ' + l).join('\n');
    ta.value = val.slice(0, lineStart) + block + val.slice(e);
    ta.focus();
    ta.setSelectionRange(lineStart, lineStart + block.length);
  } else {
    const [o, c] = item.wrap;
    const sel = val.slice(s, e);
    if (val.slice(s - o.length, s) === o && val.slice(e, e + c.length) === c) {
      ta.value = val.slice(0, s - o.length) + sel + val.slice(e + c.length);
      ta.focus();
      ta.setSelectionRange(s - o.length, s - o.length + sel.length);
    } else {
      ta.value = val.slice(0, s) + o + sel + c + val.slice(e);
      ta.focus();
      ta.setSelectionRange(s + o.length, s + o.length + sel.length);
    }
  }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// Нормализует адрес ссылки: добавляет https:// и отбрасывает небезопасные схемы
function normalizeNoteLink(raw) {
  let url = String(raw || '').trim();
  if (!url) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return '';
  } else if (url.startsWith('//')) {
    url = 'https:' + url;
  } else if (/^www\./i.test(url) || /^[^\s/]+\.[^\s]{2,}/.test(url)) {
    url = 'https://' + url;
  } else {
    return '';
  }
  return url.replace(/\s/g, '%20').replace(/\)/g, '%29').replace(/\(/g, '%28');
}

// Небольшая панель вставки ссылки (не модалка, чтобы не перекрывать форму заметки)
function openNoteLinkPopover(ta) {
  const old = document.querySelector('.note-link-popover');
  if (old) old.remove();

  const s = ta.selectionStart, e = ta.selectionEnd;
  const selected = ta.value.slice(s, e).trim();
  const selectedIsUrl = !!selected && /^(https?:\/\/|www\.)/i.test(selected);

  const pop = document.createElement('div');
  pop.className = 'note-link-popover';
  pop.innerHTML = `
    <div class="nlp-head">${svgIcon('link', 'sm')}<span>Ссылка</span><span class="nlp-hint">Ctrl+K</span></div>
    <input class="form-input nlp-url" type="text" spellcheck="false" placeholder="https://example.com">
    <input class="form-input nlp-text" type="text" maxlength="200" placeholder="Текст ссылки (необязательно)">
    <div class="nlp-actions">
      <button type="button" class="btn btn-secondary btn-xs nlp-cancel">Отмена</button>
      <button type="button" class="btn btn-primary btn-xs nlp-insert">Вставить</button>
    </div>
  `;
  document.body.appendChild(pop);

  const urlInput = pop.querySelector('.nlp-url');
  const textInput = pop.querySelector('.nlp-text');
  urlInput.value = selectedIsUrl ? selected : '';
  if (!selectedIsUrl && selected) textInput.value = selected;

  const r = ta.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  pop.style.left = Math.max(10, Math.min(r.left + 16, window.innerWidth - pr.width - 10)) + 'px';
  pop.style.top = Math.max(10, Math.min(r.top + 34, window.innerHeight - pr.height - 10)) + 'px';

  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onDoc = (ev) => { if (!pop.contains(ev.target)) close(); };
  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
  };

  const insert = () => {
    const url = normalizeNoteLink(urlInput.value);
    if (!url) {
      showToast('Введите корректную ссылку (http://, https:// или mailto:)', true);
      urlInput.focus();
      return;
    }
    const rawLabel = textInput.value.trim() || selected || url;
    const label = rawLabel
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/\]/g, '\\]');
    const md = '[' + label + '](' + url + ')';
    const val = ta.value;
    ta.value = val.slice(0, s) + md + val.slice(e);
    ta.focus();
    ta.setSelectionRange(s + 1, s + 1 + label.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  };

  [urlInput, textInput].forEach((inp) => {
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); insert(); }
    });
  });
  pop.querySelector('.nlp-insert').addEventListener('click', insert);
  pop.querySelector('.nlp-cancel').addEventListener('click', close);

  setTimeout(() => {
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    (urlInput.value ? textInput : urlInput).focus();
  }, 0);
}

// Мини-редактор тегов (чипы + ввод по Enter/запятой)
function bindTagEditor(overlay, initial) {
  const chipsEl = overlay.querySelector('#noteTagChips');
  const input = overlay.querySelector('#noteTagInput');
  const editor = overlay.querySelector('#noteTagEditor');
  if (!chipsEl || !input) return;

  const tags = (initial || []).slice(0, 20);
  overlay._noteTags = tags;

  const render = () => {
    chipsEl.innerHTML = tags.map((t, i) =>
      `<span class="tag-chip">${escapeHTML(t)}<button type="button" class="tag-chip-x" data-i="${i}" title="Убрать">${svgIcon('x', 'sm')}</button></span>`
    ).join('');
  };

  const add = () => {
    const v = input.value.trim().replace(/,+$/, '').trim();
    input.value = '';
    if (!v || tags.length >= 20) return;
    if (tags.some(t => t.toLowerCase() === v.toLowerCase())) return;
    tags.push(v.slice(0, 32));
    render();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); render(); }
  });
  input.addEventListener('blur', add);

  chipsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.tag-chip-x');
    if (b) { tags.splice(parseInt(b.dataset.i, 10), 1); render(); }
  });
  if (editor) editor.addEventListener('click', () => input.focus());

  render();
}

// ============= ЧЕКЛИСТ (создание + редактирование) =============
export async function openAddChecklistModal(projectId, onSuccess, editItem = null, presetCategoryId = null) {
  const isEdit = !!editItem;
  const title = isEdit ? 'Редактировать задачу' : 'Новая задача';

  let project = null;
  try { const d = await api.getProject(projectId); project = d.project; } catch (e) {}

  const prioritiesHTML = CONFIG.PRIORITIES.map(p =>
    `<option value="${p}" ${(editItem?.priority || 'p3') === p ? 'selected' : ''}>${CONFIG.PRIORITY_LABELS[p]}</option>`
  ).join('');

  const categories = (project && project.checklistCategories) || [];
  const currentCategoryId = editItem && editItem.category_id != null
    ? String(editItem.category_id)
    : (presetCategoryId != null ? String(presetCategoryId) : '');
  const categoriesHTML = categories.map(c =>
    `<option value="${c.id}" ${currentCategoryId === String(c.id) ? 'selected' : ''}>${escapeHTML(c.name)}</option>`
  ).join('');

  const body = `
    <div class="form-group">
      <span class="form-label">Задача</span>
      <input class="form-input" id="chkText" maxlength="200" 
             placeholder="Что нужно сделать?" value="${escapeHTML(editItem?.text || '')}">
    </div>
    <div class="form-group">
      <span class="form-label">Категория</span>
      <select class="form-select" id="chkCategory">
        <option value="">Без категории</option>
        ${categoriesHTML}
      </select>
    </div>
    <div class="form-group">
      <span class="form-label">Приоритет</span>
      <select class="form-select" id="chkPriority">${prioritiesHTML}</select>
    </div>
    ${attachmentsFieldHTML('chkAtt')}
    <div class="form-row">
      <button class="btn btn-secondary modal-close-x">Отмена</button>
      <button class="btn btn-primary" id="modalSaveBtn">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `;

  const overlay = openModal(title, body, async (ov) => {
    const textVal = ov.querySelector('#chkText').value.trim();
    if (!textVal) {
      showToast('Введите текст задачи', true);
      return false;
    }

    const attachments = getAttachments(ov);
    const categoryId = ov.querySelector('#chkCategory').value || null;
    const payload = {
      text: textVal,
      priority: ov.querySelector('#chkPriority').value,
      attachments,
      category_id: categoryId
    };
    try {
      if (isEdit) {
        await api.updateChecklistItem(projectId, editItem.id, payload);
        showToast('Задача обновлена');
      } else {
        await api.addChecklistItem(projectId, payload);
        showToast('Задача добавлена');
      }
      if (onSuccess) await onSuccess();
      return true;
    } catch (err) {
      showToast(err.message, true);
      return false;
    }
  });
  bindAttachments(overlay, project, (editItem && editItem.attachments) || [], 'chkAtt');
}

// ============= КАТЕГОРИЯ ЧЕКЛИСТА =============
const CHECKLIST_CATEGORY_COLORS = ['#2f6df6', '#7a45d6', '#1a9e57', '#c9770a', '#db3b34', '#40c8e0', '#d99a00', '#8b93a1'];

export function openChecklistCategoryModal(projectId, onSuccess, editCategory = null) {
  const isEdit = !!editCategory;
  let selectedColor = (editCategory && editCategory.color) || CHECKLIST_CATEGORY_COLORS[0];

  const body = `
    <div class="form-group">
      <span class="form-label">Название папки</span>
      <input class="form-input" id="chkCategoryName" maxlength="40"
             placeholder="Например: Разработка" value="${escapeHTML(editCategory?.name || '')}">
    </div>
    <div class="form-group">
      <span class="form-label">Цвет</span>
      <div class="checklist-color-picker" id="chkCategoryColor">
        ${CHECKLIST_CATEGORY_COLORS.map(c =>
          `<button type="button" class="checklist-color-swatch ${c === selectedColor ? 'active' : ''}" data-color="${c}" style="--swatch-color:${c}" title="${c}"></button>`
        ).join('')}
      </div>
    </div>
    <div class="form-row">
      <button class="btn btn-secondary modal-close-x">Отмена</button>
      <button class="btn btn-primary" id="modalSaveBtn">${isEdit ? 'Сохранить' : 'Создать'}</button>
    </div>
  `;

  const overlay = openModal(isEdit ? 'Редактировать папку' : 'Новая папка', body, async (ov) => {
    const name = ov.querySelector('#chkCategoryName').value.trim();
    if (!name) {
      showToast('Введите название папки', true);
      return false;
    }

    try {
      if (isEdit) {
        await api.updateChecklistCategory(projectId, editCategory.id, { name, color: selectedColor });
        showToast('Папка обновлена');
      } else {
        await api.addChecklistCategory(projectId, { name, color: selectedColor });
        showToast('Папка создана');
      }
      if (onSuccess) await onSuccess();
      return true;
    } catch (err) {
      showToast(err.message, true);
      return false;
    }
  });

  const picker = overlay.querySelector('#chkCategoryColor');
  if (picker) {
    picker.addEventListener('click', (e) => {
      const swatch = e.target.closest('.checklist-color-swatch');
      if (!swatch) return;
      selectedColor = swatch.dataset.color;
      picker.querySelectorAll('.checklist-color-swatch').forEach(el => {
        el.classList.toggle('active', el === swatch);
      });
    });
  }
}

// ============= ПОДЗАДАЧА =============
export function openAddSubtaskModal(projectId, itemId, onSuccess, editSubtask = null) {
  const isEdit = !!editSubtask;
  const val = isEdit ? escapeHTML(editSubtask.text || '') : '';

  const body = `
    <div class="form-group">
      <span class="form-label">Подзадача</span>
      <input class="form-input" id="subText" maxlength="150" placeholder="Например: подготовить макет" value="${val}">
    </div>
    <div class="form-row">
      <button class="btn btn-secondary modal-close-x">Отмена</button>
      <button class="btn btn-primary" id="modalSaveBtn">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `;

  openModal(isEdit ? 'Редактировать подзадачу' : 'Новая подзадача', body, async (overlay) => {
    const text = overlay.querySelector('#subText').value.trim();
    if (!text) {
      showToast('Введите текст', true);
      return false;
    }

    try {
      if (isEdit) {
        await api.updateSubtask(projectId, itemId, editSubtask.id, { text });
        showToast('Подзадача обновлена');
      } else {
        await api.addSubtask(projectId, itemId, { text });
        showToast('Подзадача добавлена');
      }
      if (onSuccess) await onSuccess();
      return true;
    } catch (err) {
      showToast(err.message, true);
      return false;
    }
  });
}

// ============= ВЕХА =============
export function openAddMilestoneModal(projectId, onSuccess, editMilestone = null) {
  const isEdit = !!editMilestone;
  const titleValue = isEdit ? escapeHTML(editMilestone.title || '') : '';
  const dateValue = isEdit ? (editMilestone.date || '') : '';
  const descValue = isEdit ? escapeHTML(editMilestone.description || '') : '';

  const body = `
    <div class="form-group">
      <span class="form-label">Название вехи</span>
      <input class="form-input" id="msTitle" maxlength="100" placeholder="Например: MVP, Бета, Релиз" value="${titleValue}">
    </div>
    <div class="form-group">
      <span class="form-label">Дата</span>
      <input class="form-input" type="date" id="msDate" value="${dateValue}">
    </div>
    <div class="form-group">
      <span class="form-label">Описание</span>
      <textarea class="form-textarea" id="msDesc" maxlength="200" style="min-height:60px" placeholder="Детали вехи">${descValue}</textarea>
    </div>
    <div class="form-row">
      <button class="btn btn-secondary modal-close-x">Отмена</button>
      <button class="btn btn-primary" id="modalSaveBtn">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `;

  openModal(isEdit ? 'Редактировать веху' : 'Новая веха', body, async (overlay) => {
    const titleVal = overlay.querySelector('#msTitle').value.trim();
    if (!titleVal) {
      showToast('Введите название', true);
      return false;
    }

    try {
      const payload = {
        title: titleVal,
        date: overlay.querySelector('#msDate').value || null,
        description: overlay.querySelector('#msDesc').value.trim()
      };
      if (isEdit) {
        await api.updateMilestone(projectId, editMilestone.id, payload);
        showToast('Веха обновлена');
      } else {
        await api.addMilestone(projectId, payload);
        showToast('Веха добавлена');
      }
      if (onSuccess) await onSuccess();
      return true;
    } catch (err) {
      showToast(err.message, true);
      return false;
    }
  });
}

// ============= ВЕРСИЯ =============
export async function openAddVersionModal(projectId, onSuccess, editVersion = null) {
  const isEdit = !!editVersion;
  const numVal = isEdit ? escapeHTML(editVersion.number || '') : '1.0.0';
  const descVal = isEdit ? escapeHTML(editVersion.description || '') : '';

  let project = null;
  try { const d = await api.getProject(projectId); project = d.project; } catch (e) {}

  const refsHTML = refsFieldHTML('verRefs', project, {
    note_ids: (editVersion && editVersion.note_ids) || [],
    checklist_ids: (editVersion && editVersion.checklist_ids) || []
  });

  const body = `
    <div class="form-group">
      <span class="form-label">Номер версии</span>
      <input class="form-input" id="verNumber" placeholder="1.0.0" value="${numVal}">
    </div>
    <div class="form-group">
      <span class="form-label">Тип версии</span>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-secondary" type="button" onclick="document.getElementById('verNumber').value='2.0.0'">Major</button>
        <button class="btn btn-sm btn-secondary" type="button" onclick="document.getElementById('verNumber').value='1.1.0'">Minor</button>
        <button class="btn btn-sm btn-secondary" type="button" onclick="document.getElementById('verNumber').value='1.0.1'">Patch</button>
      </div>
    </div>
    <div class="form-group">
      <span class="form-label">Описание изменений</span>
      <textarea class="form-textarea" id="verDesc" maxlength="300" style="min-height:70px" placeholder="Что изменилось?">${descVal}</textarea>
    </div>
    ${refsHTML}
    <div class="form-row">
      <button class="btn btn-secondary modal-close-x">Отмена</button>
      <button class="btn btn-primary" id="modalSaveBtn">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `;

  const overlay = openModal(isEdit ? 'Редактировать версию' : 'Новая версия', body, async (ov) => {
    const number = ov.querySelector('#verNumber').value.trim();
    if (!/^\d+\.\d+\.\d+$/.test(number)) {
      showToast('Формат: 1.2.3', true);
      return false;
    }

    const refs = readRefs(ov, 'verRefs');
    try {
      const payload = {
        number,
        description: ov.querySelector('#verDesc').value.trim(),
        note_ids: refs.note_ids,
        checklist_ids: refs.checklist_ids
      };
      if (isEdit) {
        await api.updateVersion(projectId, editVersion.id, payload);
        showToast('Версия обновлена');
      } else {
        await api.addVersion(projectId, payload);
        showToast('Версия добавлена');
      }
      if (onSuccess) await onSuccess();
      return true;
    } catch (err) {
      showToast(err.message, true);
      return false;
    }
  });

  bindRefsPicker(overlay, 'verRefs');
}

// ============= КОММЕНТАРИЙ =============
export function openAddCommentModal(projectId, onSuccess, editComment = null) {
  const isEdit = !!editComment;
  const body = `
    <div class="form-group">
      <span class="form-label">Ваше имя</span>
      <input class="form-input" id="cmAuthor" maxlength="50" placeholder="Аноним" value="${escapeHTML(editComment?.author || '')}">
    </div>
    <div class="form-group">
      <span class="form-label">Комментарий</span>
      <textarea class="form-textarea" id="cmText" maxlength="1000" style="min-height:80px" placeholder="Текст комментария...">${escapeHTML(editComment?.text || '')}</textarea>
    </div>
    <div class="form-row">
      <button class="btn btn-secondary modal-close-x">Отмена</button>
      <button class="btn btn-primary" id="modalSaveBtn">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `;

  openModal(isEdit ? 'Редактировать комментарий' : 'Новый комментарий', body, async (overlay) => {
    const text = overlay.querySelector('#cmText').value.trim();
    if (!text) {
      showToast('Введите текст', true);
      return false;
    }

    try {
      const payload = {
        author: overlay.querySelector('#cmAuthor').value.trim() || 'Аноним',
        text
      };
      if (isEdit) {
        await api.updateComment(projectId, editComment.id, payload);
        showToast('Комментарий обновлён');
      } else {
        await api.addComment(projectId, payload);
        showToast('Комментарий добавлен');
      }
      if (onSuccess) await onSuccess();
      return true;
    } catch (err) {
      showToast(err.message, true);
      return false;
    }
  });
}

// ============= СОБЫТИЕ КАЛЕНДАРЯ (веха / дедлайн / старт) =============
function fmtDay(s) {
  const d = new Date(String(s).slice(0, 10) + 'T00:00');
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}

export function openCalendarEventModal(opts) {
  opts = opts || {};
  const projects = (store.projects || []).filter(p => !p.deleted_at);
  const dateKey = opts.dateKey || new Date().toISOString().slice(0, 10);
  const types = [['milestone', 'Веха'], ['deadline', 'Дедлайн']];
  const projOptions = projects.map(p => `<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('');

  const body = `
    <div class="form-group">
      <span class="form-label">Тип события</span>
      <div class="segmented" id="ceType">
        ${types.map((t, i) => `<button type="button" class="seg${i === 0 ? ' active' : ''}" data-type="${t[0]}">${t[1]}</button>`).join('')}
      </div>
    </div>
    <div class="form-group">
      <span class="form-label">Проект</span>
      <select class="form-input" id="ceProject">${projOptions}</select>
    </div>
    <div class="form-group" id="ceTitleGroup">
      <span class="form-label">Название вехи</span>
      <input class="form-input" id="ceTitle" maxlength="100" placeholder="Например: MVP, Бета, Релиз">
    </div>
    <div class="form-group">
      <span class="form-label">Дата</span>
      <input class="form-input" type="date" id="ceDate" value="${dateKey}">
    </div>
    <div class="form-group" id="ceDescGroup">
      <span class="form-label">Описание</span>
      <textarea class="form-textarea" id="ceDesc" maxlength="200" style="min-height:60px" placeholder="Детали вехи"></textarea>
    </div>
    <div class="form-row">
      <button class="btn btn-secondary modal-close-x">Отмена</button>
      <button class="btn btn-primary" id="modalSaveBtn">Добавить</button>
    </div>
  `;

  let type = 'milestone';

  const overlay = openModal('Событие', body, async (el) => {
    const projectId = el.querySelector('#ceProject').value;
    const date = el.querySelector('#ceDate').value || null;
    if (!date) { showToast('Укажите дату', true); return false; }

    try {
      if (type === 'milestone') {
        const titleVal = el.querySelector('#ceTitle').value.trim();
        if (!titleVal) { showToast('Введите название вехи', true); return false; }
        await api.addMilestone(projectId, {
          title: titleVal, date,
          description: el.querySelector('#ceDesc').value.trim()
        });
        showToast('Веха добавлена');
      } else {
        await api.updateProject(projectId, { deadline: date });
        showToast('Дедлайн перенесён на ' + fmtDay(date));
      }
      if (opts.onSuccess) await opts.onSuccess(date);
      return true;
    } catch (err) {
      showToast(err.message, true);
      return false;
    }
  });

  const seg = overlay.querySelector('#ceType');
  const titleGroup = overlay.querySelector('#ceTitleGroup');
  const descGroup = overlay.querySelector('#ceDescGroup');
  const applyType = () => {
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.type === type));
    const isMs = type === 'milestone';
    titleGroup.style.display = isMs ? '' : 'none';
    descGroup.style.display = isMs ? '' : 'none';
  };
  seg.addEventListener('click', e => {
    const b = e.target.closest('button[data-type]');
    if (!b) return;
    type = b.dataset.type;
    applyType();
  });
  applyType();
}