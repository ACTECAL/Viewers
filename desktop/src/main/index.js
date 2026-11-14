'use strict';
// Spectra Desktop, main process (TASK_PLAN 13). One sandboxed window shows the standalone viewer (app/viewer,
// built by scripts/build-viewer.mjs) at app://spectra/ (protocol.js). Its home page is the study library
// (library.js): studies imported from files, folders, ZIP files, DICOMDIR discs and USB drives (importer.js,
// scan.js, drives.js) are copied into a folder on this computer and listed from an SQLite index. Studies can also
// be opened without importing them, which is what files opened with the app from Finder or Explorer and second
// launches do (argv.js). The page reaches all this through preload/index.js; native dialogs (dialogs.js) ask
// before the first import, before deleting studies, and before using or moving a library folder. Nothing goes
// over the network: every http and ws request is refused (setUpSession).
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, screen, session, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { HOME_URL, isAppUrl, isExternalLink } = require('./urls');
const { OpenedFiles, createHandler } = require('./protocol');
const { scan } = require('./scan');
const { listDrives } = require('./drives');
const { pathsFromArgv } = require('./argv');
const { editMenuTemplate, menuTemplate, studyMenuTemplate } = require('./menu');
const { Settings } = require('./settings');
const { Library } = require('./library');
const { importPaths } = require('./importer');
const { MIN_BOUNDS, restoreBounds } = require('./windowState');
const dialogs = require('./dialogs');
const validate = require('./validate');

const PRODUCT = 'Spectra Desktop';
const APP_ID = 'com.actecal.spectra.desktop';
const LINKS = {
  home: 'https://actecal.com/tools/dicom-viewer',
  privacy: 'https://actecal.com/privacy-policy',
  contact: 'https://actecal.com/contact?interest=spectra',
};
// The viewer may go full screen and copy to the clipboard; every other permission is refused.
const PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);
// The file dialogs, for importing into the library or for opening without importing.
const PICKERS = {
  files: { properties: ['openFile', 'multiSelections'], noun: 'DICOM files or a ZIP file' },
  folder: { properties: ['openDirectory', 'multiSelections'], noun: 'a folder of DICOM files' },
};
const BUSY = {
  import: 'An import is running. Wait for it to finish, or cancel it, and try again.',
  export: 'An export is running. Wait for it to finish, or cancel it, and try again.',
  move: 'The library is being moved. Wait for it to finish and try again.',
};

const fileSize = (file) => fs.promises.stat(file).then((stat) => stat.size, () => 0);
const labelFor = (paths) => (paths.length === 1 ? path.basename(paths[0]) || paths[0] : `${paths.length} items`);
// The page names drives by these ids, which stay the same while a drive stays connected.
const driveId = (file) => `drive-${crypto.createHash('sha256').update(file).digest('hex').slice(0, 16)}`;

// Development and tests only: a profile of their own, so that test runs never share the installed app's.
if (!app.isPackaged && process.env.SPECTRA_USER_DATA) app.setPath('userData', path.resolve(process.env.SPECTRA_USER_DATA));

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

// One copy runs at a time: a second launch hands its paths to the first and quits.
if (app.requestSingleInstanceLock()) start();
else app.quit();

/**
 * Where the library is until the user moves it: in the app's local data, never in a folder that is synced to the
 * cloud (Documents, a roaming Windows profile), because studies hold personal health information.
 */
function defaultLibraryRoot() {
  if (!app.isPackaged && process.env.SPECTRA_USER_DATA) return path.join(app.getPath('userData'), 'Library');
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA && path.isAbsolute(process.env.LOCALAPPDATA) ? process.env.LOCALAPPDATA : path.join(app.getPath('home'), 'AppData', 'Local');
    return path.join(local, PRODUCT, 'Library');
  }
  if (process.platform === 'linux') {
    const data = process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : path.join(app.getPath('home'), '.local', 'share');
    return path.join(data, PRODUCT, 'Library');
  }
  return path.join(app.getPath('userData'), 'Library');
}

function libraryError(error) {
  const code = error && error.code;
  if (code === 'ENOENT') return 'The library folder cannot be found. If it is on a drive that is not connected, connect the drive and try again.';
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'Spectra Desktop is not allowed to write to the library folder.';
  if (error && /newer version/.test(error.message)) return `${error.message} Update Spectra Desktop to open it.`;
  return 'The library could not be opened.';
}

// Free bytes on the disk that holds `folder` (or the nearest folder above it that exists), or null.
function freeSpace(folder) {
  let existing = path.resolve(folder);
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  try {
    const stats = fs.statfsSync(existing);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

function start() {
  const viewerRoot = path.join(app.getAppPath(), 'app', 'viewer');
  const opened = new OpenedFiles();
  // Requests refused by setUpSession, kept for the end-to-end tests; at most 50 addresses.
  const blocked = [];
  globalThis.spectraBlockedRequests = blocked;
  const settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));
  const defaultRoot = defaultLibraryRoot();
  let library = null;
  // { root, message } when the library could not be opened.
  let libraryProblem = null;
  let mainWindow = null;
  // What the home page does when it next loads (spectra:take-pending): { action: 'open' | 'import', paths },
  // { action: 'drives', purpose: 'open' | 'import' } or { action: 'settings' }.
  let pending = null;
  let incoming = [];
  let incomingTimer = null;
  // The drives in the list last given to the page: id → path. The page can open or import only these.
  let drives = new Map();
  // The search for files to open without importing (phase 1).
  let scanning = null;
  // The one long job at a time: { kind: 'import' | 'export' | 'move', label, controller, progress, report }.
  let task = null;
  // The folder of the last export, for its "Show" button.
  let lastExport = null;

  const argvOptions = (cwd) => ({ cwd, appPath: app.getAppPath(), defaultApp: process.defaultApp === true });
  const startPaths = pathsFromArgv(process.argv, argvOptions(process.cwd()));
  if (startPaths.length) pending = { action: 'open', paths: startPaths };

  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
  app.setAboutPanelOptions({
    applicationName: PRODUCT,
    applicationVersion: app.getVersion(),
    copyright: '© 2026 Actecal Private Limited',
    credits: 'Built on the OHIF Viewer (MIT licence). For viewing and education only; not for diagnostic use.',
    website: LINKS.home,
  });

  const goHome = (request) => {
    pending = request;
    showHome();
  };
  const actions = {
    importFiles: () => importFromMenu('files'),
    importFolder: () => importFromMenu('folder'),
    importDrives: () => goHome({ action: 'drives', purpose: 'import' }),
    openFiles: () => openFromMenu('files'),
    openFolder: () => openFromMenu('folder'),
    openDrives: () => goHome({ action: 'drives', purpose: 'open' }),
    closeStudy: () => goHome(null),
    settings: () => goHome({ action: 'settings' }),
    openLink: (name) => {
      if (LINKS[name]) shell.openExternal(LINKS[name]);
    },
    about: () =>
      messageBox({
        type: 'info',
        title: `About ${PRODUCT}`,
        message: `${PRODUCT} ${app.getVersion()}`,
        detail: '© 2026 Actecal Private Limited\nBuilt on the OHIF Viewer (MIT licence).\nFor viewing and education only; not for diagnostic use.',
      }),
  };

  // macOS: files and folders opened with the app in Finder or dropped on its Dock icon. Several arrive one by one,
  // so they are gathered for a moment and opened together. This can happen before the app is ready.
  app.on('open-file', (event, file) => {
    event.preventDefault();
    queuePaths([file]);
  });

  // Windows and Linux open files with a running app by starting it again; that copy hands its paths over.
  app.on('second-instance', (_event, argv, workingDirectory) => {
    const paths = pathsFromArgv(argv, argvOptions(workingDirectory));
    if (paths.length) queuePaths(paths);
    else focusWindow();
  });

  app.on('web-contents-created', (_event, contents) => guard(contents));
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (app.isReady() && !mainWindow) createWindow();
  });
  // Quitting during a move would leave a half-copied library; an import or export simply stops.
  app.on('before-quit', (event) => {
    if (task && task.kind === 'move') {
      event.preventDefault();
      messageBox(dialogs.problemMessage(PRODUCT, BUSY.move));
      return;
    }
    if (task) task.controller.abort();
  });
  app.on('will-quit', () => {
    if (library) library.close();
  });

  app.whenReady().then(() => {
    if (!fs.existsSync(path.join(viewerRoot, 'index.html'))) {
      dialog.showErrorBox(
        PRODUCT,
        app.isPackaged ? 'This copy of Spectra Desktop is incomplete. Please install it again.' : 'The viewer is missing from desktop/app/viewer. Run "npm run viewer" first.'
      );
      app.quit();
      return;
    }
    setUpSession();
    protocol.handle('app', createHandler({ root: viewerRoot, opened }));
    openLibrary();
    setUpIpc();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(menuTemplate({ appName: PRODUCT, isMac: process.platform === 'darwin', isPackaged: app.isPackaged, actions }))
    );
    createWindow();
  });

  function setUpSession() {
    const ses = session.defaultSession;
    // Nothing leaves the computer: the viewer is local, so every http and ws request is refused. Cloud sources
    // (TASK_PLAN 13, phase 4) will let through only the servers the user adds.
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      if (blocked.length < 50) blocked.push(details.url);
      callback({ cancel: true });
    });
    ses.setPermissionRequestHandler((contents, permission, callback) => callback(PERMISSIONS.has(permission) && isAppUrl(contents.getURL())));
    ses.setPermissionCheckHandler((_contents, permission) => PERMISSIONS.has(permission));
    ses.setSpellCheckerEnabled(false);
  }

  // Every page stays on app://spectra/: links to https sites open in the system browser, nothing opens in a new
  // window, and no <webview> can be attached.
  function guard(contents) {
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.on('will-navigate', (event, legacyUrl) => {
      const url = event.url || legacyUrl;
      if (isAppUrl(url)) return;
      event.preventDefault();
      if (isExternalLink(url)) shell.openExternal(url);
    });
    contents.on('will-redirect', (event, legacyUrl) => {
      if (!isAppUrl(event.url || legacyUrl)) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isExternalLink(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    // Right-click in a text field or on selected text: Cut, Copy, Paste and Select All, as in other apps. Elsewhere
    // the page decides; the viewer uses the right button for its tools.
    contents.on('context-menu', (_event, params) => {
      if (!params.isEditable && !(params.selectionText && params.selectionText.trim())) return;
      const window = BrowserWindow.fromWebContents(contents);
      Menu.buildFromTemplate(editMenuTemplate(params)).popup(window ? { window } : {});
    });
  }

  // ---------- The library ----------

  function libraryRoot() {
    const saved = settings.get('libraryRoot');
    return typeof saved === 'string' && path.isAbsolute(saved) ? saved : defaultRoot;
  }

  function openLibrary() {
    if (library) library.close();
    library = null;
    libraryProblem = null;
    const root = libraryRoot();
    try {
      // A library elsewhere is never made again where it was: that drive may just be unplugged.
      if (!dialogs.samePath(root, defaultRoot) && !Library.isLibrary(root)) throw Object.assign(new Error('The library folder is missing.'), { code: 'ENOENT' });
      library = new Library(root);
    } catch (error) {
      libraryProblem = { root, message: libraryError(error) };
    }
  }

  function libraryInfo() {
    const info = library ? library.info() : { root: libraryProblem ? libraryProblem.root : libraryRoot(), studies: 0, instances: 0, bytes: 0, modalities: [] };
    return {
      ...info,
      available: Boolean(library),
      problem: libraryProblem ? libraryProblem.message : null,
      isDefault: dialogs.samePath(info.root, defaultRoot),
      task: task ? { task: task.kind, label: task.label, ...task.progress } : null,
    };
  }

  function requireLibrary() {
    if (!library) throw new Error('The library is not available.');
    return library;
  }

  // Why a long job cannot start now, or null.
  function refusal() {
    if (task) return { refused: 'busy', task: task.kind };
    if (!library) return { refused: 'unavailable' };
    return null;
  }

  function refusalMessage(refused) {
    if (refused.refused === 'busy') return dialogs.problemMessage(PRODUCT, BUSY[refused.task] || BUSY.import);
    return dialogs.problemMessage(PRODUCT, 'The library is not available. Open Settings to look for it, or choose another folder.');
  }

  // Progress goes to whatever page the window shows, so that a page loaded during an import (after Back to
  // Library) shows it too. The page is told when the job finishes.
  function send(channel, payload) {
    const contents = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
    if (contents && !contents.isDestroyed()) contents.send(channel, payload);
  }

  function startTask(kind, label) {
    const job = { kind, label, controller: new AbortController(), progress: {} };
    let sent = 0;
    job.report = (update) => {
      job.progress = update;
      const now = Date.now();
      if (now - sent < 100) return;
      sent = now;
      send('spectra:progress', { task: kind, label, ...update });
    };
    task = job;
    send('spectra:progress', { task: kind, label });
    return job;
  }

  function finishTask(job, result) {
    if (task === job) task = null;
    send('spectra:progress', { task: job.kind, label: job.label, finished: true, result });
    return result;
  }

  /**
   * Imports `paths` into the library. Resolves to null when the user declined the notice, { refused } when another
   * job runs or the library is unavailable, or the importer's summary (also sent to the page as the finished task).
   */
  async function runImport(paths) {
    if (refusal()) return refusal();
    if (settings.get('importNotice', true) !== false) {
      const answer = await messageBox(dialogs.importNotice(library.root));
      if (answer.response !== 0) return null;
      if (answer.checkboxChecked) settings.set('importNotice', false);
      if (refusal()) return refusal();
    }
    const job = startTask('import', labelFor(paths));
    let result;
    try {
      result = await importPaths(library, paths, { signal: job.controller.signal, onProgress: job.report });
    } catch {
      result = { failedAll: true, studies: [], added: 0 };
    }
    return finishTask(job, { label: job.label, ...result });
  }

  async function runExport(studyUIDs) {
    if (refusal()) return refusal();
    const destination = await chooseFolder({ title: 'Export to a folder', message: 'Choose where to save copies of the studies.', buttonLabel: 'Export' });
    if (!destination) return null;
    if (refusal()) return refusal();
    const job = startTask('export', studyUIDs.length === 1 ? '1 study' : `${studyUIDs.length} studies`);
    let result;
    try {
      const done = await library.export(studyUIDs, destination, { signal: job.controller.signal, onProgress: job.report });
      lastExport = done.folders.length === 1 ? done.folders[0] : destination;
      result = { destination, studies: done.folders.length, files: done.files, missing: done.missing, cancelled: done.cancelled };
    } catch (error) {
      result = { destination, error: error && error.code === 'ENOSPC' ? 'disk-full' : 'failed' };
    }
    return finishTask(job, result);
  }

  async function deleteStudies(studyUIDs) {
    if (refusal()) return refusal();
    const studies = studyUIDs.map((studyUID) => library.study(studyUID)).filter(Boolean);
    if (!studies.length) return { deleted: 0 };
    const answer = await messageBox(dialogs.deleteConfirmation(studies));
    if (answer.response !== 0) return null;
    if (refusal()) return refusal();
    return { deleted: await library.remove(studies.map((study) => study.studyUID)) };
  }

  // Uses the library in `target` (made there when `create`), and remembers it.
  function switchTo(target, { create = false } = {}) {
    try {
      if (create) fs.mkdirSync(target, { recursive: true });
      const next = new Library(target);
      if (library) library.close();
      library = next;
      libraryProblem = null;
      settings.set('libraryRoot', dialogs.samePath(target, defaultRoot) ? null : next.root);
      return { info: libraryInfo() };
    } catch (error) {
      return { error: libraryError(error), info: libraryInfo() };
    }
  }

  /**
   * Settings: 'retry' opens the library again (its drive was connected), 'default' uses the library in the
   * default place, and 'choose' asks for a folder, then uses the library there, moves this one there, or starts a
   * new one there (dialogs.libraryPlan). Resolves to { info } (and { error } or { moved }), null or { refused }.
   */
  async function changeLibrary(option) {
    if (task) return { refused: 'busy', task: task.kind };
    if (option === 'retry') {
      openLibrary();
      return { info: libraryInfo() };
    }
    if (option === 'default') return switchTo(defaultRoot, { create: true });
    const chosen = await chooseFolder({ title: 'Choose a folder for the library', message: 'Choose an empty folder, or the folder of another Spectra library.', buttonLabel: 'Choose' });
    if (!chosen || task) return task ? { refused: 'busy', task: task.kind } : null;
    const current = library ? library.root : null;
    const totals = library ? library.info() : { studies: 0, bytes: 0 };
    const plan = dialogs.libraryPlan({ chosen, current, studies: totals.studies });
    if (plan.action === 'same') return { info: libraryInfo() };
    if (plan.action === 'refuse') {
      await messageBox(dialogs.problemMessage('Choose another folder', plan.reason));
      return null;
    }
    if (plan.action === 'use') {
      const answer = await messageBox(dialogs.useConfirmation({ target: plan.target, current }));
      return answer.response === 0 ? switchTo(plan.target) : null;
    }
    if (plan.action === 'new') return switchTo(plan.target, { create: true });
    // Move: the studies are copied, checked, and only then removed from the old folder.
    const free = freeSpace(plan.target);
    if (free !== null && free < totals.bytes * 1.05 + 50e6) {
      await messageBox(
        dialogs.problemMessage(
          'Not enough space',
          `The library needs ${dialogs.formatBytes(totals.bytes)}, and the disk of ${plan.target} has ${dialogs.formatBytes(free)} free. Choose a folder on another disk, or free some space.`
        )
      );
      return null;
    }
    const answer = await messageBox(dialogs.moveConfirmation({ target: plan.target, current, studies: totals.studies, bytes: totals.bytes }));
    if (answer.response !== 0 || task) return task ? { refused: 'busy', task: task.kind } : null;
    const job = startTask('move', plan.target);
    const old = library;
    library = null;
    let result;
    try {
      library = await old.moveTo(plan.target, { onProgress: job.report });
      settings.set('libraryRoot', dialogs.samePath(library.root, defaultRoot) ? null : library.root);
      result = { moved: true, root: library.root };
    } catch (error) {
      openLibrary();
      result = { error: error && error.code === 'ENOSPC' ? 'The disk filled up, so the library stayed where it was.' : `The library stayed where it was. ${error.message}` };
    }
    finishTask(job, result);
    return { ...result, info: libraryInfo() };
  }

  // ---------- Opening without importing (phase 1) ----------

  // Looks for DICOM files in `paths`, telling the page how far it got, and gives the page their addresses.
  async function runScan(paths) {
    if (scanning) scanning.abort();
    const controller = new AbortController();
    scanning = controller;
    const label = labelFor(paths);
    const report = (progress) => send('spectra:progress', { task: 'scan', label, ...progress });
    report({ checked: 0, found: 0 });
    let result;
    try {
      result = await scan(paths, { signal: controller.signal, onProgress: report });
    } finally {
      if (scanning === controller) scanning = null;
    }
    if (result.cancelled) return { cancelled: true };
    const entries = opened.replace([...result.files, ...result.zips]);
    const files = entries.slice(0, result.files.length);
    const zips = await Promise.all(
      entries.slice(result.files.length).map(async (entry, index) => ({ ...entry, size: await fileSize(result.zips[index]) }))
    );
    return {
      label,
      files,
      zips,
      dicomdir: result.dicomdir,
      skipped: result.skipped,
      unreadable: result.unreadable,
      truncated: result.truncated,
      limit: result.limit,
    };
  }

  // ---------- Dialogs ----------

  function messageBox(options) {
    return mainWindow && !mainWindow.isDestroyed() ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options);
  }

  async function showOpenDialog(options) {
    const result = mainWindow && !mainWindow.isDestroyed() ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths.length ? null : result.filePaths;
  }

  // The files or folders to import ('import') or open without importing ('open'), or null.
  function choose(kind, purpose) {
    const picker = PICKERS[kind] || PICKERS.files;
    const importing = purpose === 'import';
    return showOpenDialog({
      title: `${importing ? 'Import' : 'Open'} ${picker.noun}`,
      message: importing ? `Choose ${picker.noun} to copy into the library.` : `Choose ${picker.noun} to view without importing.`,
      buttonLabel: importing ? 'Import' : 'Open',
      properties: picker.properties,
    });
  }

  async function chooseFolder({ title, message, buttonLabel }) {
    const paths = await showOpenDialog({ title, message, buttonLabel, properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
    return paths ? paths[0] : null;
  }

  async function importFromMenu(kind) {
    const refused = refusal();
    if (refused) {
      await messageBox(refusalMessage(refused));
      return;
    }
    const paths = await choose(kind, 'import');
    if (paths) goHome({ action: 'import', paths });
  }

  async function openFromMenu(kind) {
    const paths = await choose(kind, 'open');
    if (paths) goHome({ action: 'open', paths });
  }

  function drivePath(id) {
    if (typeof id !== 'string' || !drives.has(id)) throw new Error('That drive is no longer connected.');
    return drives.get(id);
  }

  // ---------- The page's calls (preload/index.js) ----------

  function setUpIpc() {
    // Every call must come from the app's own page.
    const handle = (channel, listener) =>
      ipcMain.handle(channel, (event, ...args) => {
        if (!isAppUrl(event.senderFrame ? event.senderFrame.url : '')) throw new Error('Not allowed.');
        return listener(...args);
      });
    const kindOf = (kind) => validate.oneOf(kind, ['files', 'folder'], 'files');

    handle('spectra:take-pending', async () => {
      const request = pending;
      pending = null;
      if (!request) return null;
      if (request.action === 'open') return { action: 'open', ...(await runScan(request.paths)) };
      if (request.action === 'import') return { action: 'import', result: await runImport(request.paths) };
      if (request.action === 'drives') return { action: 'drives', purpose: request.purpose };
      return { action: request.action };
    });

    // Opening without importing.
    handle('spectra:open', async (kind) => {
      const paths = await choose(kindOf(kind), 'open');
      return paths ? runScan(paths) : null;
    });
    handle('spectra:open-drive', (id) => runScan([drivePath(id)]));
    handle('spectra:open-paths', (paths) => runScan(validate.pathList(paths)));
    handle('spectra:list-drives', async () => {
      const list = await listDrives();
      drives = new Map(list.map((drive) => [driveId(drive.path), drive.path]));
      return list.map((drive) => ({ id: driveId(drive.path), name: drive.name, kind: drive.kind, dicomdir: drive.dicomdir }));
    });
    handle('spectra:cancel', (kind) => {
      if (kind === 'scan') {
        if (scanning) scanning.abort();
      } else if (task && task.kind === kind && kind !== 'move') {
        task.controller.abort();
      }
      return null;
    });
    handle('spectra:close-study', () => {
      goHome(null);
      return null;
    });

    // The library.
    handle('spectra:library-info', () => libraryInfo());
    handle('spectra:list-studies', (query) => requireLibrary().list(validate.listQuery(query)));
    handle('spectra:get-study', (studyUID) => requireLibrary().study(validate.uid(studyUID)));
    handle('spectra:open-studies', (studyUIDs) => {
      const list = validate.uidList(studyUIDs, 50);
      const { paths, missing } = requireLibrary().files(list);
      library.markOpened(list);
      return { label: list.length === 1 ? 'the study' : `${list.length} studies`, files: opened.replace(paths), zips: [], missing, studies: list };
    });
    handle('spectra:import', async (kind) => {
      if (refusal()) return refusal();
      const paths = await choose(kindOf(kind), 'import');
      return paths ? runImport(paths) : null;
    });
    handle('spectra:import-drive', (id) => runImport([drivePath(id)]));
    handle('spectra:import-paths', (paths) => runImport(validate.pathList(paths)));
    handle('spectra:delete-studies', (studyUIDs) => deleteStudies(validate.uidList(studyUIDs)));
    // The menu for right-clicked studies: resolves to 'open', 'export', 'delete' or null (closed).
    handle('spectra:study-menu', (options) => {
      const count = options && Number.isInteger(options.count) && options.count > 0 ? Math.min(options.count, 5000) : 1;
      return new Promise((resolve) => {
        let answered = false;
        const choose = (action) => {
          if (answered) return;
          answered = true;
          resolve(action);
        };
        const menu = Menu.buildFromTemplate(studyMenuTemplate({ count, locked: Boolean(task), choose }));
        // On some systems the menu reports that it closed before the chosen item's click arrives.
        menu.popup({ ...(mainWindow ? { window: mainWindow } : {}), callback: () => setTimeout(() => choose(null), 100) });
      });
    });
    handle('spectra:export-studies', (studyUIDs) => runExport(validate.uidList(studyUIDs)));
    handle('spectra:reveal-export', async () => {
      if (!lastExport) return false;
      return (await shell.openPath(lastExport)) === '';
    });
    handle('spectra:change-library', (option) => changeLibrary(validate.oneOf(option, ['choose', 'retry', 'default'], 'choose')));
    handle('spectra:reveal-library', async () => {
      if (!library) return false;
      return (await shell.openPath(library.root)) === '';
    });
  }

  function queuePaths(paths) {
    for (const file of paths) if (!incoming.includes(file)) incoming.push(file);
    clearTimeout(incomingTimer);
    incomingTimer = setTimeout(() => {
      const paths = incoming;
      incoming = [];
      goHome({ action: 'open', paths });
    }, 300);
  }

  // Loads the home page, which asks for `pending`. Leaving the viewer this way also frees the study's memory.
  function showHome() {
    if (!app.isReady()) return; // the window opens when the app is ready, and asks then
    if (!mainWindow) {
      createWindow();
      return;
    }
    focusWindow();
    mainWindow.loadURL(HOME_URL).catch(() => {});
  }

  function focusWindow() {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  function createWindow() {
    const { maximized, ...bounds } = restoreBounds(settings.get('window'), screen.getAllDisplays().map((display) => display.workArea));
    const window = new BrowserWindow({
      ...bounds,
      minWidth: MIN_BOUNDS.width,
      minHeight: MIN_BOUNDS.height,
      show: false,
      backgroundColor: '#090c15',
      title: PRODUCT,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        devTools: !app.isPackaged,
        additionalArguments: [`--spectra-version=${app.getVersion()}`],
      },
    });
    mainWindow = window;
    // The window's place and size for next time (windowState.js), saved shortly after it changes and on closing.
    let saveTimer = null;
    const saveBounds = () => {
      clearTimeout(saveTimer);
      if (window.isDestroyed() || window.isFullScreen() || window.isMinimized()) return;
      const { x, y, width, height } = window.getNormalBounds();
      settings.set('window', { x, y, width, height, maximized: window.isMaximized() });
    };
    const saveSoon = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveBounds, 500);
    };
    for (const name of ['resize', 'move', 'maximize', 'unmaximize']) window.on(name, saveSoon);
    window.on('close', (event) => {
      if (task && task.kind === 'move' && process.platform !== 'darwin') {
        event.preventDefault();
        messageBox(dialogs.problemMessage(PRODUCT, BUSY.move));
        return;
      }
      saveBounds();
    });
    window.once('ready-to-show', () => {
      if (maximized) window.maximize();
      window.show();
    });
    window.on('closed', () => {
      if (mainWindow === window) mainWindow = null;
    });
    window.loadURL(HOME_URL).catch(() => {});
  }
}
