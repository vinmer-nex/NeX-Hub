const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('nexhub', {
  isElectron: true,
  request: (method, path, body, upload) => ipcRenderer.invoke('nexhub:request', { method, path, body, upload }),
  openUpload: (rel) => ipcRenderer.invoke('nexhub:openUpload', rel),
  getDataDir: () => ipcRenderer.invoke('nexhub:getDataDir'),
  openDataDir: () => ipcRenderer.invoke('nexhub:openDataDir'),
  getVersion: () => ipcRenderer.invoke('nexhub:getVersion'),
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  onScriptEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('nexhub:script:event', listener);
    return () => ipcRenderer.removeListener('nexhub:script:event', listener);
  }
});
