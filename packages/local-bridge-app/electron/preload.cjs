const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bridgeApp', {
  getState: () => ipcRenderer.invoke('bridge:get-state'),
  pair: code => ipcRenderer.invoke('bridge:pair', code),
  chooseRoot: () => ipcRenderer.invoke('bridge:choose-root'),
  openPortal: () => ipcRenderer.invoke('bridge:portal'),
  pause: () => ipcRenderer.invoke('bridge:pause'),
  disconnect: () => ipcRenderer.invoke('bridge:disconnect'),
  openRoot: id => ipcRenderer.invoke('bridge:open-root', id),
  removeRoot: id => ipcRenderer.invoke('bridge:remove-root', id),
  stopCommands: () => ipcRenderer.invoke('bridge:stop-commands'),
  setAutoStart: enabled => ipcRenderer.invoke('bridge:set-auto-start', enabled),
  checkUpdate: () => ipcRenderer.invoke('bridge:check-update'),
  installUpdate: () => ipcRenderer.invoke('bridge:install-update'),
  downloadUpdate: () => ipcRenderer.invoke('bridge:download-update'),
  onState: callback => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('bridge:state', listener); return () => ipcRenderer.removeListener('bridge:state', listener); }
});
