const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const orthancManager = require('./orthanc-manager');
const Store = require('electron-store');
const log = require('electron-log');

const store = new Store();
let mainWindow;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Start Orthanc before loading the app
  try {
    const orthancPort = await orthancManager.start();
    log.info(`Orthanc is running on port ${orthancPort}`);
    
    // Pass port to frontend via environment variable or IPC
    // For OHIF, we might just load a specific URL or inject it
    // Wait, OHIF config is static. We can expose an IPC method for OHIF to fetch the port.
  } catch (err) {
    log.error('Failed to start Orthanc:', err);
  }

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../app/dist/index.html')}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  orthancManager.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('get-orthanc-port', () => {
  return orthancManager.port;
});

ipcMain.handle('get-storage-dir', () => {
  return store.get('orthancStorageDir');
});

ipcMain.handle('set-storage-dir', async (event, dir) => {
  store.set('orthancStorageDir', dir);
  // Restart Orthanc to apply new dir
  orthancManager.stop();
  return await orthancManager.start();
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});
