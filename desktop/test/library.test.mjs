// The library (library.js), the DICOM header reader it uses (dicomfile.js) and the settings file (settings.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import libraryModule from '../src/main/library.js';
import dicomfile from '../src/main/dicomfile.js';
import settingsModule from '../src/main/settings.js';
import { writeSeries } from './fixtures.mjs';

const { DATABASE, Library, safeName } = libraryModule;
const { isPart10, key, readHeader } = dicomfile;
const { Settings } = settingsModule;

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-library-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function open(t, root) {
  const library = new Library(root);
  t.after(() => library.close());
  return library;
}

async function addAll(library, series) {
  const statuses = [];
  for (const { file } of series.files) statuses.push((await library.addFile(file)).status);
  return statuses;
}

// Three studies of two patients, on different dates, with CT, MR and an SR.
function threeStudies(dir) {
  const ct = writeSeries(path.join(dir, 'ct'), { slices: 3, patientName: 'Sharma^Asha', patientID: 'P-100', studyDate: '20260105', studyDescription: 'CT Chest', accessionNumber: 'A1' });
  const ctSecond = writeSeries(path.join(dir, 'ct2'), { slices: 2, studyUID: ct.studyUID, patientName: 'Sharma^Asha', patientID: 'P-100', studyDate: '20260105', studyDescription: 'CT Chest', description: 'Lung 1 mm', seriesNumber: 2 });
  const mr = writeSeries(path.join(dir, 'mr'), { slices: 2, modality: 'MR', patientName: 'Verma^Ravi', patientID: 'P-200', studyDate: '20261020', studyDescription: 'MR Knee 50%_off', accessionNumber: 'A2', description: 'Sagittal PD' });
  const sr = writeSeries(path.join(dir, 'sr'), { slices: 1, modality: 'SR', studyUID: mr.studyUID, patientName: 'Verma^Ravi', patientID: 'P-200', studyDate: '20261020', description: 'Report', seriesNumber: 99 });
  const old = writeSeries(path.join(dir, 'old'), { slices: 1, patientName: 'Sharma^Asha', patientID: 'P-100', studyDate: '20190311', studyDescription: 'CT Head', accessionNumber: 'A3' });
  return { ct, ctSecond, mr, sr, old };
}

test('the header reader: DICOM files only, and the fields the library lists', (t) => {
  const dir = temp(t);
  const series = writeSeries(dir, { slices: 1, patientName: 'Sharma^Asha', studyDate: '20260105', seriesNumber: 7, modality: 'mr' });
  const bytes = fs.readFileSync(series.files[0].file);
  assert.equal(isPart10(bytes), true);
  assert.equal(isPart10(Buffer.from('DICM')), false);
  assert.equal(readHeader(Buffer.alloc(300)), null);
  const record = readHeader(bytes);
  assert.equal(record.studyUID, series.studyUID);
  assert.equal(record.seriesUID, series.seriesUID);
  assert.equal(record.sopUID, series.files[0].sopUID);
  assert.equal(record.sopClassUID, '1.2.840.10008.5.1.4.1.1.2');
  assert.equal(record.transferSyntaxUID, '1.2.840.10008.1.2.1');
  assert.equal(record.patientName, 'Sharma^Asha');
  assert.equal(record.patientID, 'PHANTOM-001');
  assert.equal(record.studyDate, '20260105');
  assert.equal(record.modality, 'MR');
  assert.equal(record.seriesNumber, 7);
  assert.equal(record.instanceNumber, 1);
  assert.equal(record.frames, 1);
  // The start of the file is enough; reading stops at the pixel data.
  assert.equal(readHeader(bytes.subarray(0, bytes.length - 4000)).sopUID, series.files[0].sopUID);
  assert.equal(key('1.2.3').length, 20);
  assert.notEqual(key('1.2.3'), key('1.2.4'));
});

test('importing: files are copied in, once each, and other files are refused', async (t) => {
  const dir = temp(t);
  const root = path.join(dir, 'Library');
  assert.equal(Library.isLibrary(root), false);
  const library = open(t, root);
  assert.equal(Library.isLibrary(root), true);
  const series = writeSeries(path.join(dir, 'in'), { slices: 3 });
  assert.deepEqual(await addAll(library, series), ['added', 'added', 'added']);
  assert.deepEqual(await addAll(library, series), ['duplicate', 'duplicate', 'duplicate']);
  const notes = path.join(dir, 'notes.txt');
  fs.writeFileSync(notes, 'x'.repeat(500));
  assert.equal((await library.addFile(notes)).status, 'not-dicom');
  assert.equal((await library.addBuffer(Buffer.from('x'.repeat(500)))).status, 'not-dicom');
  // The copies are the same bytes, under hashed names.
  const { paths, missing } = library.files([series.studyUID]);
  assert.equal(missing, 0);
  assert.deepEqual(
    paths.map((file) => path.relative(root, file).split(path.sep).slice(0, 3)),
    series.files.map(() => ['studies', key(series.studyUID), key(series.seriesUID)])
  );
  for (const [i, file] of paths.entries()) assert.deepEqual(fs.readFileSync(file), fs.readFileSync(series.files[i].file));
  // Removing the original does not change the library.
  fs.rmSync(path.join(dir, 'in'), { recursive: true });
  assert.equal(library.files([series.studyUID]).paths.length, 3);
  const info = library.info();
  assert.equal(info.root, path.resolve(root));
  assert.equal(info.studies, 1);
  assert.equal(info.instances, 3);
  assert.equal(info.bytes, paths.reduce((sum, file) => sum + fs.statSync(file).size, 0));
  assert.deepEqual(info.modalities, ['CT']);
});

test('a file given as bytes (from a ZIP file) is added the same way', async (t) => {
  const dir = temp(t);
  const library = open(t, path.join(dir, 'Library'));
  const series = writeSeries(path.join(dir, 'in'), { slices: 1 });
  const bytes = fs.readFileSync(series.files[0].file);
  const added = await library.addBuffer(bytes);
  assert.equal(added.status, 'added');
  assert.equal(added.record.studyUID, series.studyUID);
  assert.equal((await library.addFile(series.files[0].file)).status, 'duplicate');
  assert.deepEqual(fs.readFileSync(library.files([series.studyUID]).paths[0]), bytes);
});

test('a file left by an interrupted import is replaced, and nothing is half-written', async (t) => {
  const dir = temp(t);
  const root = path.join(dir, 'Library');
  const library = open(t, root);
  const series = writeSeries(path.join(dir, 'in'), { slices: 1 });
  const target = path.join(root, 'studies', key(series.studyUID), key(series.seriesUID), `${key(series.files[0].sopUID)}.dcm`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'left over');
  assert.equal((await library.addFile(series.files[0].file)).status, 'added');
  assert.deepEqual(fs.readFileSync(target), fs.readFileSync(series.files[0].file));
  assert.deepEqual(
    fs.readdirSync(path.dirname(target)).filter((name) => name.endsWith('.part')),
    []
  );
});

test('the study list: details, counts, search, filters and sorting', async (t) => {
  const dir = temp(t);
  const library = open(t, path.join(dir, 'Library'));
  const data = threeStudies(path.join(dir, 'in'));
  for (const series of Object.values(data)) await addAll(library, series);

  const all = library.list();
  assert.equal(all.total, 3);
  // Newest first by default.
  assert.deepEqual(all.studies.map((study) => study.studyDescription), ['MR Knee 50%_off', 'CT Chest', 'CT Head']);
  const chest = all.studies[1];
  assert.equal(chest.patientName, 'Sharma^Asha');
  assert.equal(chest.patientID, 'P-100');
  assert.equal(chest.accessionNumber, 'A1');
  assert.equal(chest.studyDate, '20260105');
  assert.deepEqual(chest.modalities, ['CT']);
  assert.equal(chest.seriesCount, 2);
  assert.equal(chest.instanceCount, 5);
  assert.ok(chest.bytes > 0);
  assert.match(chest.importedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(chest.openedAt, null);
  assert.deepEqual(all.studies[0].modalities, ['MR', 'SR']);

  const descriptions = (options) => library.list(options).studies.map((study) => study.studyDescription);
  assert.deepEqual(descriptions({ text: 'asha' }), ['CT Chest', 'CT Head']);
  assert.deepEqual(descriptions({ text: 'SHARMA head' }), ['CT Head']);
  assert.deepEqual(descriptions({ text: 'p-200' }), ['MR Knee 50%_off']);
  assert.deepEqual(descriptions({ text: 'A3' }), ['CT Head']);
  assert.deepEqual(descriptions({ text: 'lung' }), ['CT Chest']);
  assert.deepEqual(descriptions({ text: 'sagittal' }), ['MR Knee 50%_off']);
  assert.deepEqual(descriptions({ text: 'nobody' }), []);
  // % and _ are matched as themselves.
  assert.deepEqual(descriptions({ text: '%' }), ['MR Knee 50%_off']);
  assert.deepEqual(descriptions({ text: '0%_' }), ['MR Knee 50%_off']);
  assert.deepEqual(descriptions({ text: 'C_ Chest' }), []);

  assert.deepEqual(descriptions({ modalities: ['MR'] }), ['MR Knee 50%_off']);
  assert.deepEqual(descriptions({ modalities: ['MR', 'CT'] }), ['MR Knee 50%_off', 'CT Chest', 'CT Head']);
  assert.deepEqual(descriptions({ modalities: ["CT' OR 1=1 --"] }), ['MR Knee 50%_off', 'CT Chest', 'CT Head']);
  assert.deepEqual(descriptions({ from: '20260101' }), ['MR Knee 50%_off', 'CT Chest']);
  assert.deepEqual(descriptions({ from: '20260101', to: '20260131' }), ['CT Chest']);
  assert.deepEqual(descriptions({ to: '20201231' }), ['CT Head']);
  assert.deepEqual(descriptions({ from: 'yesterday' }), ['MR Knee 50%_off', 'CT Chest', 'CT Head']);

  assert.deepEqual(descriptions({ sort: 'studyDate', direction: 'asc' }), ['CT Head', 'CT Chest', 'MR Knee 50%_off']);
  assert.deepEqual(descriptions({ sort: 'patientName', direction: 'asc' }).slice(-1), ['MR Knee 50%_off']);
  assert.deepEqual(descriptions({ sort: 'instances', direction: 'desc' })[0], 'CT Chest');
  assert.deepEqual(descriptions({ sort: 'no such column; DROP TABLE studies' }), ['MR Knee 50%_off', 'CT Chest', 'CT Head']);

  const limited = library.list({ limit: 2 });
  assert.equal(limited.total, 3);
  assert.equal(limited.studies.length, 2);

  // The filters list image modalities only.
  assert.deepEqual(library.info().modalities, ['CT', 'MR']);
});

test('one study with its series, in series-number order', async (t) => {
  const dir = temp(t);
  const library = open(t, path.join(dir, 'Library'));
  const data = threeStudies(path.join(dir, 'in'));
  await addAll(library, data.ctSecond);
  await addAll(library, data.ct);
  const study = library.study(data.ct.studyUID);
  assert.equal(study.studyDescription, 'CT Chest');
  assert.deepEqual(
    study.series.map(({ seriesNumber, modality, seriesDescription, instanceCount }) => ({ seriesNumber, modality, seriesDescription, instanceCount })),
    [
      { seriesNumber: 1, modality: 'CT', seriesDescription: 'Axial 5 mm', instanceCount: 3 },
      { seriesNumber: 2, modality: 'CT', seriesDescription: 'Lung 1 mm', instanceCount: 2 },
    ]
  );
  assert.equal(library.study('1.2.3.4'), null);
  // Files in viewing order: series by number, images by instance number.
  const { paths } = library.files([data.ct.studyUID]);
  const order = paths.map((file) => {
    const record = readHeader(fs.readFileSync(file));
    return `${record.seriesNumber}/${record.instanceNumber}`;
  });
  assert.deepEqual(order, ['1/1', '1/2', '1/3', '2/1', '2/2']);
});

test('opened studies, missing files, and deleting studies', async (t) => {
  const dir = temp(t);
  const root = path.join(dir, 'Library');
  const library = open(t, root);
  const data = threeStudies(path.join(dir, 'in'));
  for (const series of Object.values(data)) await addAll(library, series);

  library.markOpened([data.old.studyUID], '2026-11-13T10:00:00.000Z');
  assert.equal(library.study(data.old.studyUID).openedAt, '2026-11-13T10:00:00.000Z');
  assert.equal(library.list({ sort: 'openedAt', direction: 'desc' }).studies[0].studyUID, data.old.studyUID);

  const first = library.files([data.mr.studyUID]).paths[0];
  fs.rmSync(first);
  assert.deepEqual(library.files([data.mr.studyUID]).missing, 1);

  const folder = library.studyFolder(data.ct.studyUID);
  assert.equal(fs.existsSync(folder), true);
  assert.equal(await library.remove([data.ct.studyUID, '9.9.9', data.ct.studyUID]), 1);
  assert.equal(fs.existsSync(folder), false);
  assert.equal(library.study(data.ct.studyUID), null);
  assert.equal(library.list().total, 2);
  assert.deepEqual(library.files([data.ct.studyUID]), { paths: [], missing: 0 });
  // A deleted study can be imported again.
  assert.deepEqual(await addAll(library, data.ct), ['added', 'added', 'added']);
});

test('the library is kept between sessions, and a newer library is not opened', async (t) => {
  const dir = temp(t);
  const root = path.join(dir, 'Library');
  const series = writeSeries(path.join(dir, 'in'), { slices: 2 });
  const first = new Library(root);
  await addAll(first, series);
  first.close();
  first.close();
  const again = open(t, root);
  assert.equal(again.list().total, 1);
  assert.equal(again.files([series.studyUID]).paths.length, 2);
  again.close();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(root, DATABASE));
  db.exec("UPDATE meta SET value = '99' WHERE key = 'schema'");
  db.close();
  assert.throws(() => new Library(root), /newer version/);
});

test('export: readable folders per study and series, files in viewing order', async (t) => {
  const dir = temp(t);
  const library = open(t, path.join(dir, 'Library'));
  const data = threeStudies(path.join(dir, 'in'));
  for (const series of Object.values(data)) await addAll(library, series);
  const out = path.join(dir, 'out');
  fs.mkdirSync(path.join(out, 'Sharma Asha 2026-01-05 CT Chest'), { recursive: true });
  const progress = [];
  const result = await library.export([data.ct.studyUID, data.mr.studyUID, '9.9.9'], out, { onProgress: (p) => progress.push(p) });
  assert.equal(result.cancelled, false);
  assert.equal(result.files, 8);
  assert.equal(result.missing, 0);
  assert.deepEqual(result.folders.map((folder) => path.basename(folder)), ['Sharma Asha 2026-01-05 CT Chest (2)', 'Verma Ravi 2026-10-20 MR Knee 50%_off']);
  assert.deepEqual(fs.readdirSync(result.folders[0]).sort(), ['1 CT Axial 5 mm', '2 CT Lung 1 mm']);
  assert.deepEqual(fs.readdirSync(path.join(result.folders[0], '1 CT Axial 5 mm')), ['IM00001.dcm', 'IM00002.dcm', 'IM00003.dcm']);
  assert.deepEqual(fs.readdirSync(result.folders[1]).sort(), ['1 MR Sagittal PD', '99 SR Report']);
  const exported = readHeader(fs.readFileSync(path.join(result.folders[0], '1 CT Axial 5 mm', 'IM00002.dcm')));
  assert.equal(exported.instanceNumber, 2);
  assert.deepEqual(progress.at(-1), { done: 8, total: 8 });

  const controller = new AbortController();
  controller.abort();
  const cancelled = await library.export([data.ct.studyUID], path.join(dir, 'cancelled'), { signal: controller.signal });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.files, 0);
});

test('names for exported folders are valid on every system', () => {
  assert.equal(safeName('Sharma^Asha: CT/Chest?*', 'Study'), 'Sharma Asha CT Chest');
  assert.equal(safeName('  trailing dots... ', 'Study'), 'trailing dots');
  assert.equal(safeName('CON', 'Study'), '_CON');
  assert.equal(safeName('lpt1', 'Study'), '_lpt1');
  assert.equal(safeName('', 'Series'), 'Series');
  assert.equal(safeName('\u0000\u0001', 'Series'), 'Series');
  assert.equal(safeName('x'.repeat(200), 'Study').length, 80);
});

test('moving the library to another folder', async (t) => {
  const dir = temp(t);
  const root = path.join(dir, 'Library');
  const library = new Library(root);
  const series = writeSeries(path.join(dir, 'in'), { slices: 3 });
  await addAll(library, series);

  const notEmpty = path.join(dir, 'busy');
  fs.mkdirSync(notEmpty);
  fs.writeFileSync(path.join(notEmpty, 'file.txt'), 'x');
  await assert.rejects(library.moveTo(notEmpty), /empty folder/);
  await assert.rejects(library.moveTo(path.join(root, 'inside')), /inside/);
  await assert.rejects(library.moveTo(dir), /inside/);
  // The refusals leave the library open and whole.
  assert.equal(library.list().total, 1);

  const target = path.join(dir, 'elsewhere', 'Spectra Library');
  const progress = [];
  const moved = await library.moveTo(target, { onProgress: (p) => progress.push(p) });
  t.after(() => moved.close());
  assert.equal(moved.root, path.resolve(target));
  assert.equal(fs.existsSync(root), false);
  assert.equal(moved.list().total, 1);
  const { paths, missing } = moved.files([series.studyUID]);
  assert.equal(missing, 0);
  assert.ok(paths.every((file) => file.startsWith(path.resolve(target))));
  assert.deepEqual(progress.at(-1), { done: 3, total: 3 });
  // Still a working library: new studies go to the new folder.
  const more = writeSeries(path.join(dir, 'more'), { slices: 1 });
  assert.deepEqual(await addAll(moved, more), ['added']);
  assert.ok(moved.files([more.studyUID]).paths[0].startsWith(path.resolve(target)));
});

test('settings: kept in a file, with defaults when it is missing or damaged', (t) => {
  const dir = temp(t);
  const file = path.join(dir, 'config', 'settings.json');
  const settings = new Settings(file);
  assert.equal(settings.get('libraryRoot'), undefined);
  assert.equal(settings.get('importNotice', true), true);
  settings.set('libraryRoot', '/data/library');
  settings.set('window', { x: 10, y: 20, width: 1200, height: 800 });
  const again = new Settings(file);
  assert.equal(again.get('libraryRoot'), '/data/library');
  assert.deepEqual(again.get('window'), { x: 10, y: 20, width: 1200, height: 800 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
  fs.writeFileSync(file, '{ not json');
  assert.equal(new Settings(file).get('libraryRoot', 'default'), 'default');
  fs.writeFileSync(file, '[1, 2]');
  assert.equal(new Settings(file).get('0'), undefined);
  // Names from the prototype are not settings.
  assert.equal(new Settings(file).get('toString'), undefined);
});
