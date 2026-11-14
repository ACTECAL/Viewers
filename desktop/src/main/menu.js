'use strict';
// The application menu, as a template for Menu.buildFromTemplate(). Its actions are in index.js. Import copies
// studies into the library; Open shows them without importing. The viewer's own shortcuts are plain keys and
// Ctrl+Z / Ctrl+Y, so the menu's Cmd/Ctrl shortcuts do not take keys from it. No Electron import;
// test/main.test.mjs checks the template.

function menuTemplate({ appName, isMac, isPackaged, actions }) {
  const settings = { id: 'settings', label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => actions.settings() };
  const file = {
    label: 'File',
    submenu: [
      { id: 'import-files', label: 'Import Files or a ZIP…', accelerator: 'CmdOrCtrl+I', click: () => actions.importFiles() },
      { id: 'import-folder', label: 'Import a Folder…', accelerator: 'CmdOrCtrl+Shift+I', click: () => actions.importFolder() },
      { id: 'import-drive', label: 'Import from a CD, DVD or USB Drive…', click: () => actions.importDrives() },
      { type: 'separator' },
      { id: 'open-files', label: 'Open Files or a ZIP Without Importing…', accelerator: 'CmdOrCtrl+O', click: () => actions.openFiles() },
      { id: 'open-folder', label: 'Open a Folder Without Importing…', accelerator: 'CmdOrCtrl+Shift+O', click: () => actions.openFolder() },
      { id: 'open-drive', label: 'Open a CD, DVD or USB Drive Without Importing…', click: () => actions.openDrives() },
      { type: 'separator' },
      { id: 'close-study', label: 'Back to Library', click: () => actions.closeStudy() },
      ...(isMac ? [] : [{ type: 'separator' }, settings, { type: 'separator' }, { role: 'quit', label: 'Exit' }]),
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
      // F12, so that Ctrl+Shift+I stays Import a Folder on Windows and Linux.
      ...(isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools', accelerator: 'F12' }]),
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
      settings,
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

/**
 * The menu for studies right-clicked in the library. choose(action) gets 'open', 'export' or 'delete'; export and
 * delete wait while another task (an import, an export or a move) runs.
 */
function studyMenuTemplate({ count, locked, choose }) {
  const several = count > 1;
  return [
    { id: 'study-open', label: several ? 'Open Together' : 'Open', click: () => choose('open') },
    { type: 'separator' },
    { id: 'study-export', label: several ? `Export ${count} Studies…` : 'Export…', enabled: !locked, click: () => choose('export') },
    { id: 'study-delete', label: several ? `Delete ${count} Studies…` : 'Delete…', enabled: !locked, click: () => choose('delete') },
  ];
}

/** Right-click in a text field (Cut, Copy, Paste, Select All) or on selected text (Copy), from Electron's context-menu params. */
function editMenuTemplate({ isEditable, editFlags = {} }) {
  if (!isEditable) return [{ role: 'copy', enabled: Boolean(editFlags.canCopy) }];
  return [
    { role: 'cut', enabled: Boolean(editFlags.canCut) },
    { role: 'copy', enabled: Boolean(editFlags.canCopy) },
    { role: 'paste', enabled: Boolean(editFlags.canPaste) },
    { type: 'separator' },
    { role: 'selectAll', enabled: Boolean(editFlags.canSelectAll) },
  ];
}

module.exports = { editMenuTemplate, menuTemplate, studyMenuTemplate };
