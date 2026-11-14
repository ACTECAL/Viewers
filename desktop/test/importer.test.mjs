import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import importer from '../src/main/importer.js';
import libraryModule from '../src/main/library.js';
import { writeDicomdir, writeSeries, zipBytes } from './fixtures.mjs';

const { importPaths } = importer;
const { Library } = libraryModule;

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-import-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function open(t, root) {
  const library = new Library(root);
  t.after(() => library.close());
  return library;
}

const counts = ({ added, duplicates, skipped, unreadable, failed, zip, cancelled, diskFull }) => ({ added, duplicates, skipped, unreadable, failed, zip, cancelled, diskFull });
const NONE = { encrypted: 0, method: 0, bad: 0 };

test('a folder: its DICOM files are added, and a second import finds them all present', async (t) => {
  const dir = temp(t);
  const library = open(t, path.join(dir, 'Library'));
  const one = writeSeries(path.join(dir, 'in', 'one'), { slices: 3 });
  const two = writeSeries(path.join(dir, 'in', 'two', 'deeper'), { slices: 2 });
  fs.writeFileSync(path.join(dir, 'in', 'notes.txt'), 'x'.repeat(300));
  const progress = [];
  const result = await importPaths(library, [path.join(dir, 'in')], { onProgress: (p) => progress.push(p) });
  assert.deepEqual(counts(result), { added: 5, duplicates: 0, skipped: 1, unreadable: 0, failed: 0, zip: NONE, cancelled: false, diskFull: false });
  assert.deepEqual(result.studies.sort(), [one.studyUID, two.studyUID].sort());
  assert.deepEqual(result.studiesAdded.sort(), [one.studyUID, two.studyUID].sort());
  assert.equal(result.dicomdir, null);
  assert.equal(result.truncated, false);
  assert.ok(progress.some((p) => p.phase === 'searching'));
  assert.deepEqual(progress.at(-1), { phase: 'importing', done: 5, total: 5 });
  assert.equal(library.list().total, 2);

  const again = await importPaths(library, [path.join(dir, 'in')]);
  assert.deepEqual(counts(again), { added: 0, duplicates: 5, skipped: 1, unreadable: 0, failed: 0, zip: NONE, cancelled: false, diskFull: false });
  // Studies already in the library are still reported, so the app can show them.
  assert.equal(again.studies.length, 2);
  assert.deepEqual(again.studiesAdded, []);
});

test('ZIP files: stored, deflated and ZIP64 entries; bookkeeping files left out; problems counted', async (t) => {
  const dir = temp(t);
  const library = open(t, path.join(dir, 'Library'));
  const series = writeSeries(path.join(dir, 'src'), { slices: 4 });
  const bytes = series.files.map(({ file }) => fs.readFileSync(file));
  const zips = path.join(dir, 'zips');
  fs.mkdirSync(zips);
  fs.writeFileSync(
    path.join(zips, 'stored.zip'),
    zipBytes([
      { name: 'Study/', method: 0 },
      { name: 'Study/IM1', data: bytes[0], method: 0 },
      { name: '__MACOSX/Study/._IM1', data: Buffer.from('resource fork') },
      { name: 'Study/.DS_Store', data: Buffer.from('finder') },
      { name: 'Study/DICOMDIR', data: Buffer.from('index') },
      { name: 'Study/readme.txt', data: Buffer.from('x'.repeat(300)) },
    ])
  );
  fs.writeFileSync(path.join(zips, 'deflate.zip'), zipBytes([{ name: 'IM2', data: bytes[1] }]));
  fs.writeFileSync(path.join(zips, 'big.zip'), zipBytes([{ name: 'IM3', data: bytes[2] }], { zip64: true }));
  fs.writeFileSync(
    path.join(zips, 'odd.zip'),
    zipBytes([
      { name: 'secret', data: bytes[3], method: 0, encrypted: true },
      { name: 'bzip2', data: bytes[3], method: 12 },
    ])
  );
  fs.writeFileSync(path.join(zips, 'broken.zip'), 'not a zip file');
  const result = await importPaths(library, [zips]);
  assert.deepEqual(counts(result), { added: 3, duplicates: 0, skipped: 1, unreadable: 0, failed: 0, zip: { encrypted: 1, method: 1, bad: 1 }, cancelled: false, diskFull: false });
  assert.deepEqual(result.studies, [series.studyUID]);
  assert.equal(library.study(series.studyUID).instanceCount, 3);
});

test('a disc: the files its DICOMDIR lists', async (t) => {
  const dir = temp(t);
  const library = open(t, path.join(dir, 'Library'));
  const disc = path.join(dir, 'disc');
  const listed = writeSeries(path.join(disc, 'DICOM', 'S1'), { slices: 3, name: (i) => `I${i + 1}` });
  const unlisted = writeSeries(path.join(disc, 'DICOM', 'EXTRA'), { slices: 1, name: () => 'I99' });
  writeDicomdir(disc, [listed], { extra: [['DICOM', 'S1', 'GONE']] });
  const result = await importPaths(library, [disc]);
  assert.equal(result.added, 3);
  assert.deepEqual(result.dicomdir, { listed: 4, missing: 1 });
  assert.deepEqual(result.studies, [listed.studyUID]);
  assert.equal(library.study(unlisted.studyUID), null);
});

test('cancelling stops the import; what was added stays', async (t) => {
  const dir = temp(t);
  const library = open(t, path.join(dir, 'Library'));
  const series = writeSeries(path.join(dir, 'in'), { slices: 6 });
  const before = new AbortController();
  before.abort();
  const none = await importPaths(library, [path.join(dir, 'in')], { signal: before.signal });
  assert.equal(none.cancelled, true);
  assert.equal(none.added, 0);

  const during = new AbortController();
  const result = await importPaths(library, [path.join(dir, 'in')], {
    signal: during.signal,
    onProgress: (p) => {
      if (p.phase === 'importing' && p.done === 0) {
        // Stop after the first two files.
        const addFile = library.addFile.bind(library);
        let n = 0;
        library.addFile = async (file) => {
          n += 1;
          if (n === 2) during.abort();
          return addFile(file);
        };
      }
    },
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.added, 2);
  assert.equal(library.study(series.studyUID).instanceCount, 2);
});

test('a full disk stops the import and is reported; other failures are counted', async (t) => {
  const dir = temp(t);
  writeSeries(path.join(dir, 'in'), { slices: 3 });
  const full = {
    addFile: async () => {
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    },
  };
  const stopped = await importPaths(full, [path.join(dir, 'in')]);
  assert.equal(stopped.diskFull, true);
  assert.equal(stopped.added, 0);
  assert.equal(stopped.failed, 0);

  let n = 0;
  const flaky = {
    addFile: async () => {
      n += 1;
      if (n === 2) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return { status: 'added', record: { studyUID: '1.2.3' } };
    },
  };
  const result = await importPaths(flaky, [path.join(dir, 'in')]);
  assert.deepEqual(counts(result), { added: 2, duplicates: 0, skipped: 0, unreadable: 0, failed: 1, zip: NONE, cancelled: false, diskFull: false });
  assert.deepEqual(result.studies, ['1.2.3']);
});

test('nothing to import: paths that do not exist, and folders without DICOM files', async (t) => {
  const dir = temp(t);
  const library = open(t, path.join(dir, 'Library'));
  fs.mkdirSync(path.join(dir, 'empty'));
  fs.writeFileSync(path.join(dir, 'empty', 'a.txt'), 'x'.repeat(300));
  const result = await importPaths(library, [path.join(dir, 'gone'), path.join(dir, 'empty')]);
  assert.deepEqual(counts(result), { added: 0, duplicates: 0, skipped: 1, unreadable: 1, failed: 0, zip: NONE, cancelled: false, diskFull: false });
  assert.deepEqual(result.studies, []);
});
