const { ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const session = require('./session');
const { dispatch } = require('./router');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');

const mounts = [
  { prefix: '/auth', router: authRoutes },
  { prefix: '/projects', router: projectRoutes }
];

async function saveIncomingFiles(upload, paths) {
  if (!upload || !upload.field || !Array.isArray(upload.files)) return [];

  const field = upload.field;
  const saved = [];

  for (const f of upload.files) {
    const originalName = String(f && f.name ? f.name : 'file');
    const ext = path.extname(originalName);
    const filename = `${uuidv4()}${ext}`;
    const dest = path.join(paths.uploadsDir, field, filename);

    await fs.promises.mkdir(path.dirname(dest), { recursive: true });

    let buffer;
    if (f && f.data != null) {
      buffer = Buffer.from(f.data);
    } else {
      buffer = Buffer.alloc(0);
    }

    await fs.promises.writeFile(dest, buffer);

    saved.push({
      fieldname: field,
      filename,
      originalname: originalName,
      mimetype: (f && f.type) || 'application/octet-stream',
      size: (f && f.size != null) ? f.size : buffer.length,
      path: dest
    });
  }

  return saved;
}

function registerIpc(paths) {
  ipcMain.handle('nexhub:request', async (e, payload) => {
    const { method, path: url, body, upload } = payload || {};
    let files = [];
    try {
      files = upload ? await saveIncomingFiles(upload, paths) : [];
    } catch (err) {
      console.error('saveIncomingFiles error:', err);
    }
    const user = session.getCurrentUser();
    return dispatch(mounts, (method || 'GET').toUpperCase(), url || '/', {
      body,
      user,
      files
    });
  });

  ipcMain.handle('nexhub:openUpload', async (e, rel) => {
    const marker = '/uploads/';
    const str = String(rel || '');
    const idx = str.indexOf(marker);
    const relPart = idx === -1 ? str : str.slice(idx + marker.length);
    const safeRel = relPart.replace(/^[\\/]+/, '');
    if (!safeRel || safeRel.includes('..')) return 'Недопустимый путь';
    const dest = path.join(paths.uploadsDir, safeRel);
    try {
      return await shell.openPath(dest);
    } catch (err) {
      return String(err && err.message ? err.message : err);
    }
  });

  ipcMain.handle('nexhub:getDataDir', () => paths.dataDir);

  ipcMain.handle('nexhub:openDataDir', () => shell.openPath(paths.dataDir));

  ipcMain.handle('nexhub:getVersion', () => require('electron').app.getVersion());
}

module.exports = { registerIpc };
