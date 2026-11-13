import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dicomdir from '../src/main/dicomdir.js';
import { writeDicomdir, writeSeries } from './fixtures.mjs';

const { fileIdParts, isDicomdirName, readDicomdir, resolveReferencedFile } = dicomdir;

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-dicomdir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a DICOMDIR lists the file of every image record, once each', async (t) => {
  const disc = temp(t);
  const series = writeSeries(path.join(disc, 'DICOM', 'S0000001'), { slices: 3, name: (i) => `I000000${i + 1}` });
  // The same file twice, as some burners write it.
  const file = writeDicomdir(disc, [series], { extra: [['DICOM', 'S0000001', 'I0000001']] });
  const records = await readDicomdir(file);
  assert.deepEqual(records, [
    ['DICOM', 'S0000001', 'I0000001'],
    ['DICOM', 'S0000001', 'I0000002'],
    ['DICOM', 'S0000001', 'I0000003'],
  ]);
});

test('file IDs resolve without regard to case or ISO 9660 version suffixes', async (t) => {
  const disc = temp(t);
  const series = writeSeries(path.join(disc, 'dicom', 's0000001'), { slices: 1, name: () => 'i0000001' });
  fs.writeFileSync(path.join(disc, 'dicom', 's0000001', 'I0000002;1'), 'x');
  const cache = new Map();
  assert.equal(await resolveReferencedFile(disc, ['DICOM', 'S0000001', 'I0000001'], cache), series.files[0].file);
  assert.equal(await resolveReferencedFile(disc, ['DICOM', 'S0000001', 'I0000002'], cache), path.join(disc, 'dicom', 's0000001', 'I0000002;1'));
  assert.equal(await resolveReferencedFile(disc, ['DICOM', 'S0000001', 'I0000003'], cache), null);
  assert.equal(await resolveReferencedFile(disc, ['NOFOLDER', 'I0000001'], cache), null);
});

test('file IDs that are empty or would leave the folder are refused', () => {
  assert.deepEqual(fileIdParts(['DICOM', 'S1 ', 'I1']), ['DICOM', 'S1', 'I1']);
  assert.deepEqual(fileIdParts('DICOM\\S1\\I1'), ['DICOM', 'S1', 'I1']);
  assert.equal(fileIdParts(undefined), null);
  assert.equal(fileIdParts(''), null);
  assert.equal(fileIdParts(['DICOM', '..', 'secret']), null);
  assert.equal(fileIdParts(['C:', 'Windows']), null);
  assert.equal(fileIdParts(['DICOM/escape']), null);
  assert.equal(fileIdParts(Array.from({ length: 17 }, () => 'A')), null);
});

test('DICOMDIR names in any case and with a version suffix', () => {
  for (const name of ['DICOMDIR', 'dicomdir', 'DicomDir', 'DICOMDIR;1', 'DICOMDIR.']) assert.equal(isDicomdirName(name), true, name);
  for (const name of ['DICOMDIR.txt', 'DICOMDIR2', 'dicom']) assert.equal(isDicomdirName(name), false, name);
});

test('a file that is not a DICOMDIR is refused', async (t) => {
  const dir = temp(t);
  const file = path.join(dir, 'DICOMDIR');
  fs.writeFileSync(file, 'not DICOM at all');
  await assert.rejects(readDicomdir(file));
});
