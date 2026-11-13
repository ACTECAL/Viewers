'use strict';
// The only bridge between the viewer page and Spectra Desktop: window.spectraDesktop (used by
// extensions/actecal-offline/src/desktop.js). The page can ask for a file or folder dialog, the list of drives,
// one of those drives, or what the operating system asked the app to open. The main process decides what is
// read, and gives the page the addresses of those files only (main/protocol.js). Sandboxed: no Node.js here.
const { contextBridge, ipcRenderer } = require('electron');

const versionArgument = process.argv.find((arg) => arg.startsWith('--spectra-version='));

function onScanProgress(callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, progress) => callback(progress);
  ipcRenderer.on('spectra:scan-progress', listener);
  return () => ipcRenderer.removeListener('spectra:scan-progress', listener);
}

contextBridge.exposeInMainWorld('spectraDesktop', {
  edition: 'desktop',
  version: versionArgument ? versionArgument.slice('--spectra-version='.length) : '',
  platform: process.platform,
  pickFiles: () => ipcRenderer.invoke('spectra:pick-files'),
  pickFolder: () => ipcRenderer.invoke('spectra:pick-folder'),
  listDrives: () => ipcRenderer.invoke('spectra:list-drives'),
  openDrive: (id) => ipcRenderer.invoke('spectra:open-drive', String(id)),
  takePending: () => ipcRenderer.invoke('spectra:take-pending'),
  cancelScan: () => ipcRenderer.invoke('spectra:cancel-scan'),
  onScanProgress,
});
