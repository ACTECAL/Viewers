'use strict';
// The application menu, as a template for Menu.buildFromTemplate(). Its actions are in index.js. No Electron
// import; test/main.test.mjs checks the template.

function menuTemplate({ appName, isMac, isPackaged, actions }) {
  const file = {
    label: 'File',
    submenu: [
      { id: 'open-files', label: 'Open Files or a ZIP…', accelerator: 'CmdOrCtrl+O', click: () => actions.openFiles() },
      { id: 'open-folder', label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: () => actions.openFolder() },
      { id: 'open-drive', label: 'Open a CD, DVD or USB Drive…', click: () => actions.openDrives() },
      { type: 'separator' },
      { id: 'close-study', label: 'Close Study', click: () => actions.closeStudy() },
      ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Exit' }]),
    ],
  };
  // Text fields on macOS need the Edit menu for copy and paste. Elsewhere its shortcuts (Ctrl+Z, Ctrl+C…) would
  // take keys from the viewer, so it is left out.
  const edit = {
    label: 'Edit',
    submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
  };
  const view = {
    label: 'View',
    submenu: [
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      ...(isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
    ],
  };
  const help = {
    role: 'help',
    submenu: [
      { label: `${appName} on actecal.com`, click: () => actions.openLink('home') },
      { label: 'Privacy Policy', click: () => actions.openLink('privacy') },
      { label: 'Contact Actecal', click: () => actions.openLink('contact') },
      ...(isMac ? [] : [{ type: 'separator' }, { label: `About ${appName}`, click: () => actions.about() }]),
    ],
  };
  if (!isMac) return [file, view, { role: 'windowMenu' }, help];
  const appMenu = {
    label: appName,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };
  return [appMenu, file, edit, view, { role: 'windowMenu' }, help];
}

module.exports = { menuTemplate };
