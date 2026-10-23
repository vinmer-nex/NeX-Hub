import api from '../api.js';
import CONFIG from '../config.js';
import { openModal, wireProjectForm, wireLogoUpload } from './modal.js';
import { svgIcon, escapeHTML, showToast } from '../utils/dom.js';

export async function openEditProjectModal(projectId, onSuccess) {
  try {
    const data = await api.getProject(projectId);
    const proj = data.project;
    let tempLogo = proj.logo || null;

    const prioritiesHTML = CONFIG.PRIORITIES.map(p =>
      `<button type="button" class="priority-pill${proj.priority === p ? ' active' : ''}" data-p="${p}" data-value="${p}">${CONFIG.PRIORITY_LABELS[p]}</button>`
    ).join('');

    const statusesHTML = CONFIG.STATUSES.map(s =>
      `<button type="button" class="seg${proj.status === s ? ' active' : ''}" data-status="${s}" data-value="${s}"><span class="dot"></span><span class="txt">${CONFIG.STATUS_LABELS[s]}</span></button>`
    ).join('');

    const colorsHTML = CONFIG.COLORS.map(c =>
      `<span class="color-option${proj.color === c ? ' selected' : ''}" style="background:${c}" data-color="${c}"></span>`
    ).join('');

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
            <input class="form-input" id="eName" value="${escapeHTML(proj.name)}" maxlength="100">
          </div>
          <div class="form-group">
            <label class="form-label">Описание</label>
            <textarea class="form-textarea" id="eDesc" maxlength="500">${escapeHTML(proj.description || '')}</textarea>
          </div>
        </div>
      </div>

      <div class="modal-section">
        <div class="modal-section-label">Организация</div>
        <div class="form-group">
          <span class="form-label">Статус</span>
          <div class="segmented">${statusesHTML}</div>
          <input type="hidden" id="eStatus" value="${proj.status}">
        </div>
        <div class="form-group">
          <span class="form-label">Приоритет</span>
          <div class="priority-pills">${prioritiesHTML}</div>
          <input type="hidden" id="ePriority" value="${proj.priority}">
        </div>
        <div class="form-group">
          <span class="form-label">Теги</span>
          <div class="tags-field">
            <input class="tags-input" id="eTagsInput" placeholder="Добавить тег и Enter">
          </div>
          <input type="hidden" id="eTags" value="">
        </div>
      </div>

      <div class="modal-section">
        <div class="modal-section-label">Сроки и оценка</div>
        <div class="m-grid-3">
          <div class="form-group"><label class="form-label">Старт</label><input class="form-input" type="date" id="eStartDate" value="${proj.start_date || ''}"></div>
          <div class="form-group"><label class="form-label">Дедлайн</label><input class="form-input" type="date" id="eDeadline" value="${proj.deadline || ''}"></div>
          <div class="form-group"><label class="form-label">Оценка, ч</label><input class="form-input" type="number" id="eEstimate" value="${proj.estimated_hours || ''}" min="0" step="0.5"></div>
        </div>
      </div>

      <div class="modal-section">
        <div class="modal-section-label">Оформление</div>
        <div class="inline-field">
          <label class="form-label">Цвет</label>
          <div class="color-options">${colorsHTML}</div>
          <input type="hidden" id="eColor" value="${proj.color || CONFIG.COLORS[0]}">
        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary modal-close-x" type="button">Отмена</button>
      <button class="btn btn-primary" id="modalSaveBtn" type="button">Сохранить</button>
    `;

    const overlay = openModal('Редактирование проекта', body, async (el) => {
      const name = el.querySelector('#eName').value.trim();
      if (!name) { showToast('Введите название', true); return false; }

      try {
        await api.updateProject(projectId, {
          name,
          description: el.querySelector('#eDesc').value.trim(),
          priority: el.querySelector('#ePriority').value,
          status: el.querySelector('#eStatus').value,
          tags: el.querySelector('#eTags').value.split(',').map(t => t.trim()).filter(Boolean),
          startDate: el.querySelector('#eStartDate').value || null,
          deadline: el.querySelector('#eDeadline').value || null,
          estimatedHours: parseFloat(el.querySelector('#eEstimate').value) || null,
          color: el.querySelector('#eColor').value,
          logo: tempLogo
        });
        showToast('Сохранено');
        if (onSuccess) await onSuccess();
        return true;
      } catch (err) {
        showToast(err.message, true);
        return false;
      }
    }, {
      size: 'lg',
      subtitle: escapeHTML(proj.name),
      footer
    });

    wireProjectForm(overlay, {
      status: 'eStatus',
      priority: 'ePriority',
      color: 'eColor',
      tags: 'eTags',
      tagsInput: 'eTagsInput',
      initialTags: proj.tags || []
    });
    wireLogoUpload(overlay, {
      initial: proj.logo || null,
      onChange: (data) => { tempLogo = data; },
      onClear: () => { tempLogo = null; }
    });
  } catch (err) {
    showToast('Ошибка загрузки проекта', true);
  }
}
