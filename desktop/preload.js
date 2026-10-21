const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getCachedData: () => ipcRenderer.invoke('data:cached'),
  refreshData: () => ipcRenderer.invoke('data:refresh'),
  onProgress: (fn) => ipcRenderer.on('data:progress', (_e, msg) => fn(msg)),
  onClickThrough: (fn) => ipcRenderer.on('click-through', (_e, on) => fn(on)),
  hide: () => ipcRenderer.send('win:hide'),
  minimize: () => ipcRenderer.send('win:minimize'),
  quit: () => ipcRenderer.send('win:quit'),
});
