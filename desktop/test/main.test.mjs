// The small main-process modules: addresses, the command line, drives, the menu, the window's place, the library's
// dialogs and the checks on what the page sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import urls from '../src/main/urls.js';
import argv from '../src/main/argv.js';
import drives from '../src/main/drives.js';
import menu from '../src/main/menu.js';
import windowState from '../src/main/windowState.js';
import dialogs from '../src/main/dialogs.js';
import validate from '../src/main/validate.js';

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

test('the menu: Import and Open everywhere, Settings in the app menu on macOS, developer items only from source', () => {
  const calls = [];
  const actions = new Proxy({}, { get: (_target, name) => () => calls.push(name) });
  const items = (template) => template.flatMap((item) => item.submenu || []);
  const ids = (template) => items(template).map((item) => item.id).filter(Boolean);
  const roles = (template) => template.flatMap((item) => [item.role, ...(item.submenu || []).map((entry) => entry.role)]).filter(Boolean);
  const mac = menu.menuTemplate({ appName: 'Spectra Desktop', isMac: true, isPackaged: true, actions });
  const windows = menu.menuTemplate({ appName: 'Spectra Desktop', isMac: false, isPackaged: true, actions });
  const source = menu.menuTemplate({ appName: 'Spectra Desktop', isMac: false, isPackaged: false, actions });
  const file = ['import-files', 'import-folder', 'import-drive', 'open-files', 'open-folder', 'open-drive', 'close-study'];
  assert.deepEqual(ids(mac), ['settings', ...file]);
  assert.deepEqual(ids(windows), [...file, 'settings']);
  assert.ok(roles(mac).includes('paste'));
  assert.ok(!roles(windows).includes('paste'));
  assert.ok(!roles(windows).includes('toggleDevTools'));
  assert.ok(roles(source).includes('toggleDevTools'));
  // No two items share a shortcut, and none is a key the viewer uses on its own.
  for (const template of [mac, windows, source]) {
    const keys = items(template).map((item) => item.accelerator).filter(Boolean);
    assert.equal(new Set(keys).size, keys.length, keys.join(' '));
    assert.ok(keys.every((key) => /^(CmdOrCtrl\+|F\d+$)/.test(key)), keys.join(' '));
  }
  for (const id of ['import-folder', 'open-drive', 'close-study', 'settings']) items(windows).find((item) => item.id === id).click();
  assert.deepEqual(calls, ['importFolder', 'openDrives', 'closeStudy', 'settings']);
});

test('right-click menus: studies in the library, and text fields', () => {
  const chosen = [];
  const one = menu.studyMenuTemplate({ count: 1, locked: false, choose: (action) => chosen.push(action) });
  assert.deepEqual(one.filter((item) => item.label).map((item) => item.label), ['Open', 'Export…', 'Delete…']);
  for (const item of one.filter((entry) => entry.click)) item.click();
  assert.deepEqual(chosen, ['open', 'export', 'delete']);
  const three = menu.studyMenuTemplate({ count: 3, locked: true, choose: () => {} });
  assert.deepEqual(
    three.filter((item) => item.label).map((item) => [item.label, item.enabled !== false]),
    [
      ['Open Together', true],
      ['Export 3 Studies…', false],
      ['Delete 3 Studies…', false],
    ]
  );
  const roles = (template) => template.map((item) => item.role || item.type);
  assert.deepEqual(roles(menu.editMenuTemplate({ isEditable: true, editFlags: { canPaste: true } })), ['cut', 'copy', 'paste', 'separator', 'selectAll']);
  assert.deepEqual(menu.editMenuTemplate({ isEditable: true, editFlags: { canPaste: true } }).map((item) => item.enabled), [false, false, true, undefined, false]);
  assert.deepEqual(roles(menu.editMenuTemplate({ isEditable: false, editFlags: { canCopy: true } })), ['copy']);
});

test('dialogs: the import notice, delete confirmations and names', () => {
  const notice = dialogs.importNotice('/Users/asha/Library/Application Support/Spectra Desktop/Library');
  assert.deepEqual(notice.buttons, ['Import', 'Cancel']);
  assert.equal(notice.cancelId, 1);
  assert.match(notice.detail, /Application Support\/Spectra Desktop\/Library/);
  assert.match(notice.detail, /personal health information/);
  assert.equal(notice.checkboxLabel, "Don't show this again");
  const one = dialogs.deleteConfirmation([{ patientName: 'Sharma^Asha', studyDescription: 'CT Chest', studyDate: '20260105' }]);
  assert.equal(one.message, 'Delete this study from the library?');
  assert.match(one.detail, /^Sharma, Asha, CT Chest, 5 Jan 2026\n/);
  assert.equal(one.defaultId, 1, 'Cancel is the default');
  assert.equal(dialogs.deleteConfirmation([{}, {}, {}]).message, 'Delete 3 studies from the library?');
  assert.equal(dialogs.formatName('Sharma^Asha^K'), 'Sharma, Asha K');
  assert.equal(dialogs.formatName('ANONYMOUS'), 'ANONYMOUS');
  assert.equal(dialogs.formatName('Verma^'), 'Verma');
  assert.equal(dialogs.formatDate('20261113'), '13 Nov 2026');
  assert.equal(dialogs.formatDate('2026'), '');
  assert.equal(dialogs.formatBytes(999), '999 bytes');
  assert.equal(dialogs.formatBytes(1_400_000_000), '1.4 GB');
  assert.equal(dialogs.formatBytes(250_000_000), '250 MB');
});

test('choosing a library folder: use, move, start new, or refuse', (t) => {
  const root = temp(t);
  const current = path.join(root, 'Library');
  fs.mkdirSync(path.join(current, 'studies'), { recursive: true });
  fs.writeFileSync(path.join(current, 'library.db'), '');
  const plan = (chosen, studies = 3) => dialogs.libraryPlan({ chosen, current, studies });
  assert.deepEqual(plan(current), { action: 'same', target: current });
  // An empty folder takes the library itself; a folder with other files gets a "Spectra Library" folder.
  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(empty, '.DS_Store'), '');
  assert.deepEqual(plan(empty), { action: 'move', target: empty });
  assert.deepEqual(plan(empty, 0), { action: 'new', target: empty });
  const documents = path.join(root, 'Documents');
  fs.mkdirSync(documents);
  fs.writeFileSync(path.join(documents, 'letter.txt'), 'x');
  assert.deepEqual(plan(documents), { action: 'move', target: path.join(documents, 'Spectra Library') });
  assert.deepEqual(plan(path.join(root, 'not-yet')), { action: 'move', target: path.join(root, 'not-yet') });
  // Another library, chosen directly or by the folder that holds it.
  const other = path.join(root, 'USB', 'Spectra Library');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'library.db'), '');
  assert.deepEqual(plan(other), { action: 'use', target: other });
  assert.deepEqual(plan(path.join(root, 'USB')), { action: 'use', target: other });
  // Folders that cannot take it.
  const busy = path.join(root, 'busy');
  fs.mkdirSync(path.join(busy, 'Spectra Library'), { recursive: true });
  fs.writeFileSync(path.join(busy, 'file.txt'), 'x');
  fs.writeFileSync(path.join(busy, 'Spectra Library', 'file.txt'), 'x');
  assert.equal(plan(busy).action, 'refuse');
  assert.equal(plan(path.join(current, 'studies')).action, 'refuse');
  // With no library open (its drive is gone), any empty folder starts a new one.
  assert.deepEqual(dialogs.libraryPlan({ chosen: empty, current: null, studies: 0 }), { action: 'new', target: empty });
});

test('what the page sends is checked', () => {
  assert.deepEqual(validate.uidList(['1.2.3', '1.2.3', '1.2.4']), ['1.2.3', '1.2.4']);
  for (const bad of [[], 'x', [1], ['has space'], ['a'.repeat(129)], Array(201).fill('1.2')]) assert.throws(() => validate.uidList(bad), JSON.stringify(bad).slice(0, 40));
  assert.equal(validate.uid('1.2.840'), '1.2.840');
  assert.throws(() => validate.uid(['1.2']));
  assert.deepEqual(validate.listQuery({ text: 'asha', modalities: ['CT', 'ct', "x' OR 1"], from: '20260101', to: 'today', sort: 'patientName', direction: 'asc', limit: 50 }), {
    text: 'asha',
    modalities: ['CT'],
    from: '20260101',
    to: '',
    sort: 'patientName',
    direction: 'asc',
    limit: 50,
  });
  assert.deepEqual(validate.listQuery('nonsense'), { text: '', modalities: [], from: '', to: '', sort: 'studyDate', direction: 'desc', limit: 1000 });
  assert.equal(validate.listQuery({ sort: 'study_uid; DROP TABLE studies', limit: 10 ** 9 }).sort, 'studyDate');
  assert.equal(validate.listQuery({ limit: 10 ** 9 }).limit, 5000);
  const absolute = path.resolve('/tmp/a/../b');
  assert.deepEqual(validate.pathList([absolute]), [absolute]);
  for (const bad of [[], ['relative/path'], ['/tmp/x\0y'], [42], 'not a list']) assert.throws(() => validate.pathList(bad));
  assert.equal(validate.oneOf('folder', ['files', 'folder'], 'files'), 'folder');
  assert.equal(validate.oneOf('../etc', ['files', 'folder'], 'files'), 'files');
});

test('the window comes back where it was, unless that screen is gone', () => {
  const { DEFAULT_BOUNDS, MIN_BOUNDS, restoreBounds } = windowState;
  const laptop = { x: 0, y: 0, width: 1512, height: 944 };
  const monitor = { x: 1512, y: -200, width: 2560, height: 1415 };
  assert.deepEqual(restoreBounds(undefined, [laptop]), { ...DEFAULT_BOUNDS, maximized: false });
  assert.deepEqual(restoreBounds({ x: 'a', y: 0, width: 1, height: 1 }, [laptop]), { ...DEFAULT_BOUNDS, maximized: false });
  assert.deepEqual(restoreBounds({ x: 100, y: 50, width: 1200, height: 800 }, [laptop]), { x: 100, y: 50, width: 1200, height: 800, maximized: false });
  assert.deepEqual(restoreBounds({ x: 1600, y: -100, width: 1800, height: 1000, maximized: true }, [laptop, monitor]), {
    x: 1600,
    y: -100,
    width: 1800,
    height: 1000,
    maximized: true,
  });
  // The monitor was unplugged: the size is kept and the system places the window.
  assert.deepEqual(restoreBounds({ x: 1600, y: -100, width: 1800, height: 1000 }, [laptop]), { width: 1800, height: 1000, maximized: false });
  // Never smaller than the minimum, never larger than the screen.
  assert.deepEqual(restoreBounds({ x: 10, y: 10, width: 200, height: 100 }, [laptop]), { x: 10, y: 10, ...MIN_BOUNDS, maximized: false });
  assert.deepEqual(restoreBounds({ x: 0, y: 0, width: 4000, height: 3000 }, [laptop]), { x: 0, y: 0, width: 1512, height: 944, maximized: false });
});
