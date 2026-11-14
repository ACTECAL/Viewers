// The packaged app (npm run pack; macOS for now): its fuses, its signature, what app.asar holds, what Finder may open
// with it, and that it starts, opens a folder from the command line, renders the study and opens its library (SQLite
// in the packaged app). Playwright cannot attach
// to a packaged app, because a fuse turns off its Node.js inspector, so the page is reached through Chromium's
// remote debugging port. The app runs with its real profile, which is removed afterwards if the test created it.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { writeSeries } from '../test/fixtures.mjs';
import { checker, sameSet, studiesInUrl, waitForImage } from './helpers.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9339;

if (process.platform !== 'darwin') {
  console.log('SKIP: the packaged-app check runs on macOS only for now.');
  process.exit(0);
}
const appPath = path.join(desktopDir, 'release', `mac-${process.arch}`, 'Spectra Desktop.app');
if (!fs.existsSync(appPath)) {
  console.error(`${path.relative(desktopDir, appPath)} is missing: run npm run pack first.`);
  process.exit(2);
}

const { check, results } = checker();
const fuses = execFileSync(path.join(desktopDir, 'node_modules', '.bin', 'electron-fuses'), ['read', '--app', appPath]).toString().replace(/\x1b\[[0-9;]*m/g, '');
const fuse = (name, state) => new RegExp(`${name} is ${state}`).test(fuses);
check(
  'Fuses: no Node.js runtime, NODE_OPTIONS, inspector or file:// privileges; ASAR integrity and ASAR-only loading',
  fuse('RunAsNode', 'Disabled') && fuse('EnableNodeOptionsEnvironmentVariable', 'Disabled') && fuse('EnableNodeCliInspectArguments', 'Disabled') &&
    fuse('GrantFileProtocolExtraPrivileges', 'Disabled') && fuse('EnableEmbeddedAsarIntegrityValidation', 'Enabled') && fuse('OnlyLoadAppFromAsar', 'Enabled')
);
let signed = true;
try {
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'ignore' });
} catch {
  signed = false;
}
check('Signature: valid (ad-hoc until the Developer ID certificate exists)', signed);

const list = asar.listPackage(path.join(appPath, 'Contents', 'Resources', 'app.asar'));
check(
  'app.asar: the viewer, the main process and the preload script; no source maps, ONNX runtime, tests or scripts',
  ['/app/viewer/index.html', '/src/main/index.js', '/src/preload/index.js', '/node_modules/dcmjs/build/dcmjs.js'].every((entry) => list.includes(entry)) &&
    !list.some((entry) => entry.endsWith('.map') || entry.includes('/viewer/ort/') || /^\/(test|test-e2e|scripts|build|release)\//.test(entry)),
  `${list.length} entries`
);
const documentTypes = JSON.parse(execFileSync('plutil', ['-extract', 'CFBundleDocumentTypes', 'json', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')]).toString());
const opens = (test) => documentTypes.some(test);
check(
  'Finder: DICOM files, folders and ZIP files can be opened with the app',
  opens((type) => (type.CFBundleTypeExtensions || []).includes('dcm')) && opens((type) => (type.LSItemContentTypes || []).includes('public.folder')) && opens((type) => (type.LSItemContentTypes || []).includes('public.zip-archive'))
);

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-packaged-'));
const profile = path.join(os.homedir(), 'Library', 'Application Support', 'Spectra Desktop');
const hadProfile = fs.existsSync(profile);
const hadLibrary = fs.existsSync(path.join(profile, 'Library', 'library.db'));
const series = writeSeries(path.join(data, 'ct'), { slices: 12 });
const child = spawn(path.join(appPath, 'Contents', 'MacOS', 'Spectra Desktop'), [`--remote-debugging-port=${PORT}`, series.dir], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 60 && !browser; i += 1) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => null);
    if (!browser) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const context = browser && browser.contexts()[0];
  let page = context && context.pages().find((candidate) => candidate.url().startsWith('app://spectra/'));
  if (context && !page) page = await context.waitForEvent('page', { timeout: 30000 }).catch(() => null);
  const stats = page ? await waitForImage(page).catch(() => ({ grey: 0 })) : { grey: 0 };
  check('Packaged app: opens a folder from the command line and renders it', stats.grey >= 0.1 && sameSet(studiesInUrl(page), [series.studyUID]), `grey ${stats.grey}`);
  const bridge = page ? await page.evaluate(() => ({ edition: window.spectraDesktop && window.spectraDesktop.edition, require: typeof window.require })) : {};
  check('Packaged app: the bridge is there, and Node.js is not', bridge.edition === 'desktop' && bridge.require === 'undefined', JSON.stringify(bridge));
  // The library: SQLite (node:sqlite) runs in the packaged app, in the usual place, and opening from the command
  // line imported nothing.
  const library = page ? await page.evaluate(() => window.spectraDesktop.libraryInfo()).catch((error) => ({ error: String(error) })) : {};
  const expectedRoot = path.join(profile, 'Library');
  check(
    'Packaged app: the library opens in ~/Library/Application Support/Spectra Desktop/Library, and the command line imported nothing',
    library.available === true && library.root === expectedRoot && library.studies === (hadLibrary ? library.studies : 0) && fs.existsSync(path.join(expectedRoot, 'library.db')),
    JSON.stringify({ available: library.available, root: library.root === expectedRoot ? 'expected' : library.root, studies: library.studies, error: library.error })
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  fs.rmSync(data, { recursive: true, force: true });
  if (!hadProfile) fs.rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
