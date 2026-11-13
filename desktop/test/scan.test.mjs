import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import scanModule from '../src/main/scan.js';
import { writeDicomdir, writeSeries } from './fixtures.mjs';

const { LIMITS, isDicomFile, scan } = scanModule;

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-scan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const sorted = (list) => [...list].sort();
// A file with the DICM marker, enough for the check (not a readable image).
const fakeDicom = (file) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), Buffer.alloc(16)]));
};

test('only files with the DICM marker count as DICOM', async (t) => {
  const dir = temp(t);
  fakeDicom(path.join(dir, 'a'));
  fs.writeFileSync(path.join(dir, 'short'), 'DICM');
  fs.writeFileSync(path.join(dir, 'text'), 'x'.repeat(200));
  assert.equal(await isDicomFile(path.join(dir, 'a')), true);
  assert.equal(await isDicomFile(path.join(dir, 'short')), false);
  assert.equal(await isDicomFile(path.join(dir, 'text')), false);
  assert.equal(await isDicomFile(path.join(dir, 'missing')), null);
});

test('a folder: DICOM files at any depth and ZIP files; hidden files, macOS leftovers and other files are not', async (t) => {
  const dir = temp(t);
  fakeDicom(path.join(dir, 'IM1'));
  fakeDicom(path.join(dir, 'series', 'IM2.dcm'));
  fakeDicom(path.join(dir, 'series', 'deeper', 'IM3'));
  fakeDicom(path.join(dir, '.hidden'));
  fakeDicom(path.join(dir, '__MACOSX', '._IM1'));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x'.repeat(200));
  fs.writeFileSync(path.join(dir, 'study.ZIP'), 'zip');
  const progress = [];
  const result = await scan([dir], { onProgress: (p) => progress.push(p) });
  assert.deepEqual(sorted(result.files), sorted([path.join(dir, 'IM1'), path.join(dir, 'series', 'IM2.dcm'), path.join(dir, 'series', 'deeper', 'IM3')]));
  assert.deepEqual(result.zips, [path.join(dir, 'study.ZIP')]);
  assert.equal(result.skipped, 1);
  assert.equal(result.unreadable, 0);
  assert.equal(result.dicomdir, null);
  assert.equal(result.truncated, false);
  assert.deepEqual(progress.at(-1), { checked: 4, found: 4 });
});

test('a disc: its DICOMDIR is followed, so files it does not list are not opened', async (t) => {
  const disc = temp(t);
  const listed = writeSeries(path.join(disc, 'DICOM', 'S0000001'), { slices: 3, name: (i) => `I000000${i + 1}` });
  fakeDicom(path.join(disc, 'DICOM', 'EXTRA', 'I0000099'));
  fs.writeFileSync(path.join(disc, 'AUTORUN.INF'), '[autorun]');
  writeDicomdir(disc, [listed], { extra: [['DICOM', 'S0000001', 'I0000009']] });
  const result = await scan([disc]);
  assert.deepEqual(sorted(result.files), sorted(listed.files.map((entry) => entry.file)));
  assert.deepEqual(result.dicomdir, { listed: 4, missing: 1 });
  assert.equal(result.skipped, 0);
});

test('the DICOMDIR file itself, or a folder holding discs, opens the same files', async (t) => {
  const root = temp(t);
  const disc = path.join(root, 'DISC1');
  const listed = writeSeries(path.join(disc, 'DICOM'), { slices: 2, name: (i) => `I${i + 1}` });
  const file = writeDicomdir(disc, [listed]);
  const expected = sorted(listed.files.map((entry) => entry.file));
  assert.deepEqual(sorted((await scan([file])).files), expected);
  assert.deepEqual(sorted((await scan([root])).files), expected);
});

test('a DICOMDIR whose files are all missing gives way to checking every file', async (t) => {
  const disc = temp(t);
  writeDicomdir(disc, [], { extra: [['DICOM', 'GONE']] });
  fakeDicom(path.join(disc, 'images', 'IM1'));
  const result = await scan([path.join(disc, 'DICOMDIR')]);
  assert.deepEqual(result.files, [path.join(disc, 'images', 'IM1')]);
  assert.equal(result.dicomdir, null);
});

test('the search stops at the file limit, and can be cancelled', async (t) => {
  const dir = temp(t);
  for (let i = 0; i < 5; i += 1) fakeDicom(path.join(dir, `IM${i}`));
  const limited = await scan([dir], { limits: { ...LIMITS, files: 2 } });
  assert.equal(limited.truncated, true);
  assert.equal(limited.files.length, 2);
  assert.equal(limited.limit, 2);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await scan([dir], { signal: controller.signal });
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(cancelled.files, []);
});

test('paths that do not exist are counted as unreadable', async (t) => {
  const dir = temp(t);
  const result = await scan([path.join(dir, 'nothing-here')]);
  assert.equal(result.unreadable, 1);
  assert.deepEqual(result.files, []);
});

test('symbolic links are not followed', { skip: process.platform === 'win32' }, async (t) => {
  const dir = temp(t);
  fakeDicom(path.join(dir, 'real', 'IM1'));
  fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
  const result = await scan([dir]);
  assert.deepEqual(result.files, [path.join(dir, 'real', 'IM1')]);
});
