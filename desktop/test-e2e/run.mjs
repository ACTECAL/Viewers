// End-to-end checks of Spectra Desktop and of the web edition that shares its page. Needs the viewer in app/viewer
// (npm run viewer), Python 3 and zip for the test ZIP files, and Chrome for the web edition.
// Usage: npm run e2e [-- web | desktop]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTestData } from '../test/fixtures.mjs';
import { checker } from './helpers.mjs';
import desktopChecks from './desktop.mjs';
import webChecks from './web.mjs';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewerDir = path.join(desktopDir, 'app', 'viewer');
if (!fs.existsSync(path.join(viewerDir, 'index.html'))) {
  console.error('The viewer is missing from app/viewer: run npm run viewer first.');
  process.exit(2);
}
const only = process.argv[2];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-e2e-'));
const { check, results } = checker();
try {
  const data = makeTestData(root);
  if (!only || only === 'web') {
    console.log('\n# Web edition (Chrome)');
    await webChecks({ check, data, viewerDir });
  }
  if (!only || only === 'desktop') {
    console.log('\n# Spectra Desktop (Electron)');
    await desktopChecks({ check, data, desktopDir });
  }
} catch (error) {
  check('the checks ran to the end', false, String(error.stack || error).split('\n').slice(0, 4).join(' | '));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
