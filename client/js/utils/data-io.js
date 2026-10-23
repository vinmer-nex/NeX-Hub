import api from '../api.js';
import { showToast } from './dom.js';

export async function saveProjectsToFile() {
  try {
    const { requirePassword } = await import('../security.js');
    if (!(await requirePassword('Подтвердите экспорт данных аккаунта в файл.'))) return;

    console.log('📤 Сохранение начато...');

    const data = await api.exportProjects();

    console.log('📊 Получено проектов:', data.projects?.length || 0);

    const exportData = {
      projects: data.projects || [],
      trash: data.trash || [],
      exportedAt: data.exportedAt || new Date().toISOString(),
      version: data.version || '3.0'
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const filename = 'projecthub-' + new Date().toISOString().slice(0, 10) + '.json';

    // ===== showSaveFilePicker для открытия проводника =====
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'JSON файл',
            accept: { 'application/json': ['.json'] }
          }]
        });

        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();

        showToast('✅ Сохранено ' + (data.projects?.length || 0) + ' проектов');
        console.log('✅ Сохранение завершено');
        return;
      } catch (err) {
        if (err.name === 'AbortError' || err.message?.includes('abort')) {
          console.log('Сохранение отменено пользователем');
          return;
        }
        console.warn('showSaveFilePicker недоступен, используем фолбэк', err);
      }
    }

    // ===== ФОЛБЭК =====
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast('✅ Сохранено ' + (data.projects?.length || 0) + ' проектов');
  } catch (err) {
    console.error('❌ Ошибка сохранения:', err);
    showToast('❌ Ошибка: ' + err.message, true);
  }
}

export function importProjectsFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = function() {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(ev) {
      try {
        const data = JSON.parse(ev.target.result);

        if (data.projects && Array.isArray(data.projects)) {
          const importList = data.projects.concat(Array.isArray(data.trash) ? data.trash : []);
          const result = await api.importProjects(importList);

          const app = await import('../app.js');
          await app.loadProjects();
          app.render();

          if (result.failed) {
            console.error('Ошибки импорта:', result.errors);
            showToast('Загружено: ' + result.imported + ', ошибок: ' + result.failed, true);
          } else {
            showToast('Загружено: ' + result.imported + ' проектов');
          }
        } else {
          showToast('Неверный формат файла', true);
        }
      } catch (err) {
        showToast('Ошибка загрузки: ' + err.message, true);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

export default { saveProjectsToFile, importProjectsFromFile };
