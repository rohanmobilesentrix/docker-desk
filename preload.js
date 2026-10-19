const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('docker', {
  list: () => ipcRenderer.invoke('list'),
  stats: (ids) => ipcRenderer.invoke('stats', ids),
  start: (id) => ipcRenderer.invoke('start', id),
  stop: (id) => ipcRenderer.invoke('stop', id),
  remove: (id, name) => ipcRenderer.invoke('remove', id, name),
  removeProject: (project) => ipcRenderer.invoke('remove-project', project),
  prune: () => ipcRenderer.invoke('prune'),
  onChange: (cb) => ipcRenderer.on('containers-changed', cb),
});
