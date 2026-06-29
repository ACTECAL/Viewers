const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getOrthancPort: () => ipcRenderer.invoke('get-orthanc-port'),
  getStorageDir: () => ipcRenderer.invoke('get-storage-dir'),
  setStorageDir: (dir) => ipcRenderer.invoke('set-storage-dir', dir),
  selectDirectory: () => ipcRenderer.invoke('select-directory')
});
