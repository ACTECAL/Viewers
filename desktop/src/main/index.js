'use strict';
// Spectra Desktop, main process (TASK_PLAN 13). One sandboxed window shows the standalone viewer (app/viewer,
// built by scripts/build-viewer.mjs) at app://spectra/ (protocol.js). This process finds the DICOM files in what
// the user opens (scan.js): files, folders, ZIP files, a DICOMDIR, CDs, DVDs and USB drives (drives.js), files
// opened with the app from Finder or Explorer, and second launches (argv.js). The page gets them through
// preload/index.js. Nothing goes over the network: every http and ws request is refused (setUpSession).
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { HOME_URL, isAppUrl, isExternalLink } = require('./urls');
const { OpenedFiles, createHandler } = require('./protocol');
const { scan } = require('./scan');
const { listDrives } = require('./drives');
const { pathsFromArgv } = require('./argv');
const { menuTemplate } = require('./menu');

const PRODUCT = 'Spectra Desktop';
const APP_ID = 'com.actecal.spectra.desktop';
const LINKS = {
  home: 'https://actecal.com/tools/dicom-viewer',
  privacy: 'https://actecal.com/privacy-policy',
  contact: 'https://actecal.com/contact?interest=spectra',
};
// The viewer may go full screen and copy to the clipboard; every other permission is refused.
const PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

const fileSize = (file) => fs.promises.stat(file).then((stat) => stat.size, () => 0);

// Development and tests only: a profile of their own, so that test runs never share the installed app's.
if (!app.isPackaged && process.env.SPECTRA_USER_DATA) app.setPath('userData', path.resolve(process.env.SPECTRA_USER_DATA));

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

// One copy runs at a time: a second launch hands its paths to the first and quits.
if (app.requestSingleInstanceLock()) start();
else app.quit();

function start() {
  const viewerRoot = path.join(app.getAppPath(), 'app', 'viewer');
  const opened = new OpenedFiles();
  // Requests refused by setUpSession, kept for the end-to-end tests; at most 50 addresses.
  const blocked = [];
  globalThis.spectraBlockedRequests = blocked;
  let mainWindow = null;
  // What the home page opens when it next loads (spectra:take-pending): { paths } or { drives: true }.
  let pending = null;
  let incoming = [];
  let incomingTimer = null;
  // The drives in the list last shown: id → path. The page can open only these.
  let drives = new Map();
  let scanning = null;

  const argvOptions = (cwd) => ({ cwd, appPath: app.getAppPath(), defaultApp: process.defaultApp === true });
  const startPaths = pathsFromArgv(process.argv, argvOptions(process.cwd()));
  if (startPaths.length) pending = { paths: startPaths };

  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
  app.setAboutPanelOptions({
    applicationName: PRODUCT,
    applicationVersion: app.getVersion(),
    copyright: '© 2026 Actecal Private Limited',
    credits: 'Built on the OHIF Viewer (MIT licence). For viewing and education only; not for diagnostic use.',
    website: LINKS.home,
  });

  const actions = {
    openFiles: () => openFromMenu(['openFile', 'multiSelections'], 'Open DICOM files or a ZIP file'),
    openFolder: () => openFromMenu(['openDirectory', 'multiSelections'], 'Open a folder of DICOM files'),
    openDrives: () => {
      pending = { drives: true };
      showHome();
    },
    closeStudy: () => {
      pending = null;
      showHome();
    },
    openLink: (name) => {
      if (LINKS[name]) shell.openExternal(LINKS[name]);
    },
    about: () => {
      const options = {
        type: 'info',
        title: `About ${PRODUCT}`,
        message: `${PRODUCT} ${app.getVersion()}`,
        detail: '© 2026 Actecal Private Limited\nBuilt on the OHIF Viewer (MIT licence).\nFor viewing and education only; not for diagnostic use.',
      };
      return mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options);
    },
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
  }

  function setUpIpc() {
    // Every call must come from the app's own page.
    const handle = (channel, listener) =>
      ipcMain.handle(channel, (event, ...args) => {
        if (!isAppUrl(event.senderFrame ? event.senderFrame.url : '')) throw new Error('Not allowed.');
        return listener(event, ...args);
      });
    handle('spectra:take-pending', (event) => {
      const request = pending;
      pending = null;
      if (!request) return null;
      if (request.drives) return { show: 'drives' };
      return runScan(event.sender, request.paths);
    });
    handle('spectra:pick-files', async (event) => {
      const paths = await choose(['openFile', 'multiSelections'], 'Open DICOM files or a ZIP file');
      return paths ? runScan(event.sender, paths) : null;
    });
    handle('spectra:pick-folder', async (event) => {
      const paths = await choose(['openDirectory', 'multiSelections'], 'Open a folder of DICOM files');
      return paths ? runScan(event.sender, paths) : null;
    });
    handle('spectra:list-drives', async () => {
      const list = await listDrives();
      const stamp = Date.now().toString(36);
      drives = new Map();
      return list.map((drive, index) => {
        const id = `drive-${stamp}-${index}`;
        drives.set(id, drive.path);
        return { id, name: drive.name, kind: drive.kind, dicomdir: drive.dicomdir };
      });
    });
    handle('spectra:open-drive', (event, id) => {
      if (typeof id !== 'string' || !drives.has(id)) throw new Error('That drive is no longer listed.');
      return runScan(event.sender, [drives.get(id)]);
    });
    handle('spectra:cancel-scan', () => {
      if (scanning) scanning.abort();
      return null;
    });
  }

  async function choose(properties, title) {
    const options = { title, properties };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths.length ? null : result.filePaths;
  }

  async function openFromMenu(properties, title) {
    const paths = await choose(properties, title);
    if (!paths) return;
    pending = { paths };
    showHome();
  }

  // Looks for DICOM files in `paths`, telling the page how far it got, and gives the page their addresses.
  async function runScan(sender, paths) {
    if (scanning) scanning.abort();
    const controller = new AbortController();
    scanning = controller;
    const label = paths.length === 1 ? path.basename(paths[0]) || paths[0] : `${paths.length} items`;
    const report = (progress) => {
      if (!sender.isDestroyed()) sender.send('spectra:scan-progress', { label, ...progress });
    };
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

  function queuePaths(paths) {
    for (const file of paths) if (!incoming.includes(file)) incoming.push(file);
    clearTimeout(incomingTimer);
    incomingTimer = setTimeout(() => {
      pending = { paths: incoming };
      incoming = [];
      showHome();
    }, 300);
  }

  // Loads the home page, which asks for `pending`. Opening something new replaces the study on screen.
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
    const window = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 900,
      minHeight: 600,
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
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => {
      if (mainWindow === window) mainWindow = null;
    });
    window.loadURL(HOME_URL).catch(() => {});
  }
}
