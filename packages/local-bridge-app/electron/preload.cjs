const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("bridgeApp", {
  getState: () => ipcRenderer.invoke("bridge:get-state"),
  pair: (code) => ipcRenderer.invoke("bridge:pair", code),
  chooseRoot: () => ipcRenderer.invoke("bridge:choose-root"),
  disconnect: () => ipcRenderer.invoke("bridge:disconnect"),
  on: (channel, callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener); }
});
