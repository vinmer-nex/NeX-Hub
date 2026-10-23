const { createRouter } = require('../router');
const controller = require('../controllers/projectController');
const scriptController = require('../controllers/scriptController');

const router = createRouter();

function authMiddleware(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
}

// Все роуты требуют авторизацию
router.use(authMiddleware);

// ===== ФАЙЛОВАЯ СИСТЕМА (объявить ДО /:id) =====
router.get('/fs/browse', controller.browseFs);
router.get('/fs/editors', controller.getEditors);

// ===== ПРОЕКТЫ =====
router.get('/', controller.getAll);
// Литеральные GET-пути объявляем до параметрического /:id
router.get('/last-activity', controller.getLastActivity);
router.get('/activity', controller.getRecentActivity);
router.get('/export', controller.exportAll);
router.get('/board', controller.getBoard);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

// ===== ЗАМЕТКИ =====
router.post('/:id/notes', controller.addNote);
router.put('/:id/notes/:noteId', controller.updateNote);
router.delete('/:id/notes/:noteId', controller.deleteNote);

// ===== ВЕРСИИ =====
router.post('/:id/versions', controller.addVersion);
router.put('/:id/versions/:versionId', controller.updateVersion);
router.delete('/:id/versions/:versionId', controller.deleteVersion);

// ===== ЧЕКЛИСТ =====
router.post('/:id/checklist-categories', controller.addChecklistCategory);
router.put('/:id/checklist-categories/:categoryId', controller.updateChecklistCategory);
router.delete('/:id/checklist-categories/:categoryId', controller.deleteChecklistCategory);
router.post('/:id/checklist', controller.addChecklistItem);
router.put('/:id/checklist/:itemId', controller.updateChecklistItem);
router.delete('/:id/checklist/:itemId', controller.deleteChecklistItem);
router.post('/:id/checklist/:itemId/subtasks', controller.addSubtask);
router.put('/:id/checklist/:itemId/subtasks/:subId', controller.updateSubtask);
router.delete('/:id/checklist/:itemId/subtasks/:subId', controller.deleteSubtask);

// ===== ВЕХИ =====
router.post('/:id/milestones', controller.addMilestone);
router.put('/:id/milestones/:milestoneId', controller.updateMilestone);
router.delete('/:id/milestones/:milestoneId', controller.deleteMilestone);

// ===== КОММЕНТАРИИ =====
router.post('/:id/comments', controller.addComment);
router.put('/:id/comments/:commentId', controller.updateComment);
router.delete('/:id/comments/:commentId', controller.deleteComment);

// ===== ФОТО (файлы кладёт ipc.js, multer не нужен) =====
router.post('/:id/photos', controller.addPhotos);
router.delete('/:id/photos/:photoId', controller.deletePhoto);

// ===== ФАЙЛЫ =====
router.post('/:id/files', controller.addFiles);
router.delete('/:id/files/:fileId', controller.deleteFile);

// ===== СКРИПТЫ =====
router.get('/:id/scripts', scriptController.list);
router.get('/:id/scripts/status', scriptController.status);
router.post('/:id/scripts/autostart', scriptController.autostart);
router.post('/:id/scripts/stop-all', scriptController.stopAll);
router.put('/:id/scripts/reorder', scriptController.reorder);
router.post('/:id/scripts', scriptController.create);
router.put('/:id/scripts/:scriptId', scriptController.update);
router.delete('/:id/scripts/:scriptId', scriptController.remove);
router.post('/:id/scripts/:scriptId/run', scriptController.run);
router.post('/:id/scripts/:scriptId/restart', scriptController.restart);
router.post('/:id/scripts/:scriptId/stop', scriptController.stop);

// ===== ПАПКА ПРОЕКТА / ДЕРЕВО ФАЙЛОВ =====
router.put('/:id/folder', controller.setProjectFolder);
router.get('/:id/tree', controller.getProjectFileTree);
router.get('/:id/file', controller.readProjectFile);
router.post('/:id/open', controller.openProjectPath);

// ===== АКТИВНОСТЬ =====
router.get('/:id/activity', controller.getActivity);

// ===== ИМПОРТ / ЭКСПОРТ =====
router.post('/import', controller.importProjects);

module.exports = router;
