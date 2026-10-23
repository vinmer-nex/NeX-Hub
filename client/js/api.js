class API {
  async request(method, path, body = null, upload = null) {
    if (!window.nexhub || !window.nexhub.request) {
      throw new Error('Приложение запущено вне Electron');
    }
    const res = await window.nexhub.request(method, path, body, upload);
    const status = res ? res.status : 0;
    const data = res ? res.body : null;
    if (status >= 400) {
      const msg = (data && data.error) || 'Ошибка сервера';
      if (status === 401) {
        const authMod = (await import('./auth.js')).default;
        if (authMod && authMod.logoutLocal) authMod.logoutLocal();
        const { renderLoginScreen } = await import('./components/login.js');
        renderLoginScreen();
      }
      throw new Error(msg);
    }
    return data;
  }

  // Проекты
  getProjects(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.request('GET', `/projects${q ? '?' + q : ''}`);
  }

  getBoard() {
    return this.request('GET', '/projects/board');
  }

  getProject(id) {
    return this.request('GET', `/projects/${id}`);
  }

  exportProjects() {
    return this.request('GET', '/projects/export');
  }

  createProject(projectData) {
    return this.request('POST', '/projects', projectData);
  }

  updateProject(id, projectData) {
    return this.request('PUT', `/projects/${id}`, projectData);
  }

  deleteProject(id, permanent = false) {
    return this.request('DELETE', `/projects/${id}?permanent=${permanent}`);
  }

  // Заметки
  addNote(projectId, noteData) {
    return this.request('POST', `/projects/${projectId}/notes`, noteData);
  }

  updateNote(projectId, noteId, noteData) {
    return this.request('PUT', `/projects/${projectId}/notes/${noteId}`, noteData);
  }

  deleteNote(projectId, noteId) {
    return this.request('DELETE', `/projects/${projectId}/notes/${noteId}`);
  }

  // Версии
  addVersion(projectId, versionData) {
    return this.request('POST', `/projects/${projectId}/versions`, versionData);
  }

  updateVersion(projectId, versionId, versionData) {
    return this.request('PUT', `/projects/${projectId}/versions/${versionId}`, versionData);
  }

  deleteVersion(projectId, versionId) {
    return this.request('DELETE', `/projects/${projectId}/versions/${versionId}`);
  }

  // Категории чеклиста
  addChecklistCategory(projectId, categoryData) {
    return this.request('POST', `/projects/${projectId}/checklist-categories`, categoryData);
  }

  updateChecklistCategory(projectId, categoryId, categoryData) {
    return this.request('PUT', `/projects/${projectId}/checklist-categories/${categoryId}`, categoryData);
  }

  deleteChecklistCategory(projectId, categoryId) {
    return this.request('DELETE', `/projects/${projectId}/checklist-categories/${categoryId}`);
  }

  // Чеклист
  addChecklistItem(projectId, itemData) {
    return this.request('POST', `/projects/${projectId}/checklist`, itemData);
  }

  updateChecklistItem(projectId, itemId, itemData) {
    return this.request('PUT', `/projects/${projectId}/checklist/${itemId}`, itemData);
  }

  deleteChecklistItem(projectId, itemId) {
    return this.request('DELETE', `/projects/${projectId}/checklist/${itemId}`);
  }

  addSubtask(projectId, checklistItemId, subtaskData) {
    return this.request('POST', `/projects/${projectId}/checklist/${checklistItemId}/subtasks`, subtaskData);
  }

  updateSubtask(projectId, checklistItemId, subtaskId, subtaskData) {
    return this.request('PUT', `/projects/${projectId}/checklist/${checklistItemId}/subtasks/${subtaskId}`, subtaskData);
  }

  deleteSubtask(projectId, checklistItemId, subtaskId) {
    return this.request('DELETE', `/projects/${projectId}/checklist/${checklistItemId}/subtasks/${subtaskId}`);
  }

  // Вехи
  addMilestone(projectId, milestoneData) {
    return this.request('POST', `/projects/${projectId}/milestones`, milestoneData);
  }

  updateMilestone(projectId, milestoneId, milestoneData) {
    return this.request('PUT', `/projects/${projectId}/milestones/${milestoneId}`, milestoneData);
  }

  deleteMilestone(projectId, milestoneId) {
    return this.request('DELETE', `/projects/${projectId}/milestones/${milestoneId}`);
  }

  // Комментарии
  addComment(projectId, commentData) {
    return this.request('POST', `/projects/${projectId}/comments`, commentData);
  }

  updateComment(projectId, commentId, commentData) {
    return this.request('PUT', `/projects/${projectId}/comments/${commentId}`, commentData);
  }

  deleteComment(projectId, commentId) {
    return this.request('DELETE', `/projects/${projectId}/comments/${commentId}`);
  }

  // Фото
  async uploadPhotos(projectId, files) {
    const items = await Promise.all(Array.from(files).map(async f => ({
      name: f.name, type: f.type || '', size: f.size,
      data: new Uint8Array(await f.arrayBuffer())
    })));
    return this.request('POST', `/projects/${projectId}/photos`, null, { field: 'photos', files: items });
  }

  deletePhoto(projectId, photoId) {
    return this.request('DELETE', `/projects/${projectId}/photos/${photoId}`);
  }

  // Файлы
  async uploadFiles(projectId, files) {
    const items = await Promise.all(Array.from(files).map(async f => ({
      name: f.name, type: f.type || '', size: f.size,
      data: new Uint8Array(await f.arrayBuffer())
    })));
    return this.request('POST', `/projects/${projectId}/files`, null, { field: 'files', files: items });
  }

  deleteFile(projectId, fileId) {
    return this.request('DELETE', `/projects/${projectId}/files/${fileId}`);
  }

  // Папка проекта / дерево файлов
  browseFs(fsPath) {
    const q = fsPath ? '?path=' + encodeURIComponent(fsPath) : '';
    return this.request('GET', `/projects/fs/browse${q}`);
  }

  getEditors(refresh) {
    return this.request('GET', '/projects/fs/editors' + (refresh ? '?refresh=1' : ''));
  }

  setFolder(projectId, folderPath) {
    return this.request('PUT', `/projects/${projectId}/folder`, { folderPath });
  }

  getFileTree(projectId, relPath) {
    const q = relPath ? '?path=' + encodeURIComponent(relPath) : '';
    return this.request('GET', `/projects/${projectId}/tree${q}`);
  }

  readFile(projectId, relPath) {
    return this.request('GET', `/projects/${projectId}/file?path=${encodeURIComponent(relPath)}`);
  }

  async readFileRaw(projectId, relPath) {
    const res = await window.nexhub.request('GET', `/projects/${projectId}/file?raw=1&path=${encodeURIComponent(relPath)}`);
    if (!res || res.status >= 400) throw new Error((res && res.body && res.body.error) || 'Не удалось прочитать файл');
    const b = res.body;
    const bytes = b.buffer instanceof Uint8Array ? b.buffer : new Uint8Array(b.buffer);
    return new Blob([bytes], { type: b.mime || 'application/octet-stream' });
  }

  openPath(projectId, relPath, target, editor) {
    return this.request('POST', `/projects/${projectId}/open`, {
      path: relPath || '',
      target: target || 'explorer',
      editor: editor || ''
    });
  }

  // Скрипты проекта
  getScripts(projectId) {
    return this.request('GET', `/projects/${projectId}/scripts`);
  }

  createScript(projectId, script) {
    return this.request('POST', `/projects/${projectId}/scripts`, script);
  }

  updateScript(projectId, scriptId, script) {
    return this.request('PUT', `/projects/${projectId}/scripts/${scriptId}`, script);
  }

  deleteScript(projectId, scriptId) {
    return this.request('DELETE', `/projects/${projectId}/scripts/${scriptId}`);
  }

  runScript(projectId, scriptId) {
    return this.request('POST', `/projects/${projectId}/scripts/${scriptId}/run`);
  }

  restartScript(projectId, scriptId) {
    return this.request('POST', `/projects/${projectId}/scripts/${scriptId}/restart`);
  }

  stopScript(projectId, scriptId) {
    return this.request('POST', `/projects/${projectId}/scripts/${scriptId}/stop`);
  }

  reorderScripts(projectId, order) {
    return this.request('PUT', `/projects/${projectId}/scripts/reorder`, { order });
  }

  stopAllScripts(projectId) {
    return this.request('POST', `/projects/${projectId}/scripts/stop-all`);
  }

  autostartScripts(projectId) {
    return this.request('POST', `/projects/${projectId}/scripts/autostart`);
  }

  getScriptStatus(projectId) {
    return this.request('GET', `/projects/${projectId}/scripts/status`);
  }

  // Терминал
  getTerminalSettings(refresh) {
    return this.request('GET', '/auth/terminal' + (refresh ? '?refresh=1' : ''));
  }

  updateTerminalSettings(shell) {
    return this.request('PUT', '/auth/terminal', { shell });
  }

  // Активность
  getActivity(projectId) {
    return this.request('GET', `/projects/${projectId}/activity`);
  }

  // Глобальная лента активности (все проекты) — для дашборда
  getRecentActivity(limit = 20) {
    return this.request('GET', `/projects/activity?limit=${limit}`);
  }

  // Последняя активность по каждому проекту — для индикатора «застоя» на Kanban
  getLastActivity() {
    return this.request('GET', '/projects/last-activity');
  }

  // Импорт
  importProjects(projects) {
    return this.request('POST', '/projects/import', { projects });
  }

  updateProject(id, projectData) {
    return this.request('PUT', `/projects/${id}`, projectData);
  }
}

const api = new API();
export default api;