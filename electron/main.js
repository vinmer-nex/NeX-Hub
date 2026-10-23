const { app, BrowserWindow, protocol, shell } = require('electron');
const path = require('path');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

const { initPaths } = require('./paths');

let paths = null;
let mainWindow = null;

function openExternal(url) {
  if (!url || typeof url !== 'string') return false;

  const marker = '/uploads/';
  if (url.includes(marker) && paths) {
    const idx = url.indexOf(marker);
    const rel = url.slice(idx + marker.length).replace(/^[\\/]+/, '');
    if (!rel || rel.includes('..')) return false;
    shell.openPath(path.join(paths.uploadsDir, rel));
    return true;
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    shell.openExternal(url);
    return true;
  }

  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0b0b0f',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadURL('app://nexhub/index.html');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('app://nexhub/index.html') || url.startsWith('app://nexhub/#')) return;
    if (openExternal(url)) e.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    paths = initPaths(app);
    require('./session').restoreSession();
    require('./registerProtocol').register(paths, __dirname);
    require('./ipc').registerIpc(paths);
    createWindow();
    setTimeout(() => {
      try {
        require('./controllers/projectController').warmEditorsCache();
      } catch (e) {}
    }, 1500);
  });
}

app.on('before-quit', () => {
  try {
    require('./scripts/runner').stopAllSync();
  } catch (e) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
