'use strict';
// The only bridge between the viewer page and Spectra Desktop: window.spectraDesktop (used by
// extensions/actecal-offline/src/desktop.js and its library page). The page can list, open, import, export and
// delete library studies, open files without importing them, and ask for the drives. The main process shows
// every file dialog and confirmation itself, decides what is read, and gives the page the addresses of those
// files only (main/protocol.js). Sandboxed: no Node.js here, and no file paths reach the page.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const versionArgument = process.argv.find((arg) => arg.startsWith('--spectra-version='));
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const strings = (list) => Array.from(list || [], String);

/** onProgress(callback): { task: 'scan' | 'import' | 'export' | 'move', label, …progress, finished?, result? }. */
function onProgress(callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, progress) => callback(progress);
  ipcRenderer.on('spectra:progress', listener);
  return () => ipcRenderer.removeListener('spectra:progress', listener);
}

// The paths of files and folders dropped on the page. Only File objects from a real drop or file input have one.
function droppedPaths(files) {
  const paths = [];
  for (const file of Array.from(files || [])) {
    let filePath = '';
    try {
      filePath = webUtils.getPathForFile(file);
    } catch {
      // Not a File.
    }
    if (filePath) paths.push(filePath);
  }
  return paths;
}

contextBridge.exposeInMainWorld('spectraDesktop', {
  edition: 'desktop',
  version: versionArgument ? versionArgument.slice('--spectra-version='.length) : '',
  platform: process.platform,
  // What the menu or the operating system asked for, when the home page loads.
  takePending: () => invoke('spectra:take-pending'),
  onProgress,
  cancel: (task) => invoke('spectra:cancel', String(task)),
  closeStudy: () => invoke('spectra:close-study'),
  // Opening without importing.
  pickFiles: () => invoke('spectra:open', 'files'),
  pickFolder: () => invoke('spectra:open', 'folder'),
  openDrive: (id) => invoke('spectra:open-drive', String(id)),
  openDropped: (files) => invoke('spectra:open-paths', droppedPaths(files)),
  listDrives: () => invoke('spectra:list-drives'),
  // The library.
  libraryInfo: () => invoke('spectra:library-info'),
  listStudies: (query) => invoke('spectra:list-studies', query && typeof query === 'object' ? { ...query } : {}),
  getStudy: (studyUID) => invoke('spectra:get-study', String(studyUID)),
  openStudies: (studyUIDs) => invoke('spectra:open-studies', strings(studyUIDs)),
  importFiles: () => invoke('spectra:import', 'files'),
  importFolder: () => invoke('spectra:import', 'folder'),
  importDrive: (id) => invoke('spectra:import-drive', String(id)),
  importDropped: (files) => invoke('spectra:import-paths', droppedPaths(files)),
  exportStudies: (studyUIDs) => invoke('spectra:export-studies', strings(studyUIDs)),
  revealExport: () => invoke('spectra:reveal-export'),
  deleteStudies: (studyUIDs) => invoke('spectra:delete-studies', strings(studyUIDs)),
  // The right-click menu for `count` studies: 'open', 'export', 'delete' or null.
  showStudyMenu: (count) => invoke('spectra:study-menu', { count: Number(count) || 1 }),
  changeLibrary: (option) => invoke('spectra:change-library', String(option || 'choose')),
  revealLibrary: () => invoke('spectra:reveal-library'),
});
