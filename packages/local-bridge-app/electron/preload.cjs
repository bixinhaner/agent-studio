const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bridgeApp', {
  getState: () => ipcRenderer.invoke('bridge:get-state'),
  pair: code => ipcRenderer.invoke('bridge:pair', code),
  chooseRoot: () => ipcRenderer.invoke('bridge:choose-root'),
  openPortal: () => ipcRenderer.invoke('bridge:portal'),
  pause: () => ipcRenderer.invoke('bridge:pause'),
  disconnect: () => ipcRenderer.invoke('bridge:disconnect'),
  onState: callback => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('bridge:state', listener); return () => ipcRenderer.removeListener('bridge:state', listener); }
});
