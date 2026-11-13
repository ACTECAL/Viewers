// The small main-process modules: addresses, the command line, drives and the menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import urls from '../src/main/urls.js';
import argv from '../src/main/argv.js';
import drives from '../src/main/drives.js';
import menu from '../src/main/menu.js';

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-main-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('app addresses and links for the system browser', () => {
  for (const url of ['app://spectra/', 'app://spectra/viewer/dicomlocal?StudyInstanceUIDs=1']) assert.equal(urls.isAppUrl(url), true, url);
  for (const url of ['app://other/', 'https://spectra/', 'file:///etc/passwd', 'javascript:alert(1)', 'blob:app://spectra/1', 'not a url', '']) {
    assert.equal(urls.isAppUrl(url), false, url);
  }
  assert.equal(urls.isExternalLink('https://actecal.com/contact'), true);
  for (const url of ['http://actecal.com/', 'javascript:alert(1)', 'file:///etc', 'mailto:sales@actecal.com', 'app://spectra/']) {
    assert.equal(urls.isExternalLink(url), false, url);
  }
});

test('paths from the command line', (t) => {
  const dir = temp(t);
  const file = path.join(dir, 'IM1.dcm');
  fs.writeFileSync(file, 'x');
  fs.mkdirSync(path.join(dir, 'series'));
  const packaged = argv.pathsFromArgv(['Spectra Desktop.exe', file, '--allow-file-access-from-files', 'series', 'missing', file, 'actecal-spectra://open', 42], { cwd: dir });
  assert.deepEqual(packaged, [file, path.join(dir, 'series')]);
  // Run from source (electron .), the app's own folder is the first argument and is not a file to open.
  const fromSource = argv.pathsFromArgv(['electron', dir, file], { cwd: '/', appPath: dir, defaultApp: true });
  assert.deepEqual(fromSource, [file]);
  assert.deepEqual(argv.pathsFromArgv(undefined), []);
});

test('Windows drives from PowerShell: removable drives and discs', () => {
  const list = drives.parseWindowsDrives(
    JSON.stringify([
      { DeviceID: 'E:', DriveType: 5, VolumeName: 'CT_STUDY' },
      { DeviceID: 'f:', DriveType: 2, VolumeName: '' },
      { DeviceID: 'not a drive', DriveType: 2 },
    ])
  );
  assert.deepEqual(list, [
    { name: 'CT_STUDY (E:)', path: 'E:\\', kind: 'disc' },
    { name: 'F:', path: 'F:\\', kind: 'usb' },
  ]);
  assert.deepEqual(drives.parseWindowsDrives('{"DeviceID":"G:","DriveType":2,"VolumeName":null}'), [{ name: 'G:', path: 'G:\\', kind: 'usb' }]);
  assert.deepEqual(drives.parseWindowsDrives(''), []);
  assert.deepEqual(drives.parseWindowsDrives('not json'), []);
});

test('Windows drives: a failed query lists nothing', async () => {
  assert.deepEqual(await drives.windowsDrives(async () => { throw new Error('no PowerShell'); }), []);
  assert.deepEqual(await drives.windowsDrives(async () => '{"DeviceID":"E:","DriveType":5,"VolumeName":"DISC"}'), [{ name: 'DISC (E:)', path: 'E:\\', kind: 'disc' }]);
});

test('macOS drives leave out the startup disk and hidden volumes', { skip: process.platform === 'win32' }, async (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'USB STICK'));
  fs.mkdirSync(path.join(root, '.timemachine'));
  fs.symlinkSync('/', path.join(root, 'Macintosh HD'));
  assert.deepEqual(await drives.macDrives(root), [{ name: 'USB STICK', path: path.join(root, 'USB STICK'), kind: 'drive' }]);
});

test('Linux drives from the usual mount folders', async (t) => {
  const root = temp(t);
  const user = path.join(root, 'media', 'asha');
  fs.mkdirSync(path.join(user, 'CT_DISC'), { recursive: true });
  fs.mkdirSync(path.join(root, 'mnt', 'usb'), { recursive: true });
  const list = await drives.linuxDrives({ user: 'asha', roots: [user, path.join(root, 'mnt')] });
  assert.deepEqual(list.map((drive) => drive.name), ['CT_DISC', 'usb']);
});

test('a drive with a DICOMDIR at the top is a DICOM disc', async (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'DICOMDIR'), 'x');
  assert.equal((await drives.withDicomdirFlag({ name: 'disc', path: root, kind: 'disc' })).dicomdir, true);
  assert.equal((await drives.withDicomdirFlag({ name: 'gone', path: path.join(root, 'gone'), kind: 'usb' })).dicomdir, false);
});

test('the menu: File actions everywhere, the Edit menu on macOS only, developer items only from source', () => {
  const calls = [];
  const actions = new Proxy({}, { get: (_target, name) => () => calls.push(name) });
  const ids = (template) => template.flatMap((item) => item.submenu || []).map((item) => item.id).filter(Boolean);
  const roles = (template) => template.flatMap((item) => [item.role, ...(item.submenu || []).map((entry) => entry.role)]).filter(Boolean);
  const mac = menu.menuTemplate({ appName: 'Spectra Desktop', isMac: true, isPackaged: true, actions });
  const windows = menu.menuTemplate({ appName: 'Spectra Desktop', isMac: false, isPackaged: true, actions });
  const source = menu.menuTemplate({ appName: 'Spectra Desktop', isMac: false, isPackaged: false, actions });
  for (const template of [mac, windows]) assert.deepEqual(ids(template), ['open-files', 'open-folder', 'open-drive', 'close-study']);
  assert.ok(roles(mac).includes('paste'));
  assert.ok(!roles(windows).includes('paste'));
  assert.ok(!roles(windows).includes('toggleDevTools'));
  assert.ok(roles(source).includes('toggleDevTools'));
  windows[0].submenu.find((item) => item.id === 'close-study').click();
  assert.deepEqual(calls, ['closeStudy']);
});
