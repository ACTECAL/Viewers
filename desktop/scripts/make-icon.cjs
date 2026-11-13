// Renders build/icon.svg to build/icon.png (1024 × 1024), from which electron-builder makes the macOS, Windows and
// Linux icons. Run with Electron: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 1024;
const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8');
const out = path.join(__dirname, '..', 'build', 'icon.png');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true, sandbox: true },
  });
  const page = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  let image = await window.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  if (image.getSize().width !== SIZE) image = image.resize({ width: SIZE, height: SIZE, quality: 'best' });
  fs.writeFileSync(out, image.toPNG());
  console.log(`Wrote build/icon.png (${image.getSize().width} × ${image.getSize().height}).`);
  app.quit();
});
