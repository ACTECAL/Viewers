import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zip from '../src/main/zip.js';
import { zipBytes } from './fixtures.mjs';

const { openZip } = zip;

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-zip-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function withZip(t, bytes) {
  const file = path.join(temp(t), 'test.zip');
  fs.writeFileSync(file, bytes);
  const archive = await openZip(file);
  t.after(() => archive.close().catch(() => {}));
  return archive;
}

const random = crypto.randomBytes(5000);
const text = Buffer.from('DICOM '.repeat(4000));

for (const zip64 of [false, true]) {
  test(`stored and deflated entries are read back exactly${zip64 ? ' (ZIP64)' : ''}`, async (t) => {
    const archive = await withZip(
      t,
      zipBytes(
        [
          { name: 'Study/', data: Buffer.alloc(0), method: 0 },
          { name: 'Study/CT/IM1', data: random, method: 0 },
          { name: 'Study/CT/IM2', data: text },
          { name: 'Étude/ñame.dcm', data: Buffer.from('é') },
        ],
        { zip64, comment: 'Exported by a PACS' }
      )
    );
    assert.deepEqual(
      archive.entries.map(({ name, method, directory, size }) => ({ name, method, directory, size })),
      [
        { name: 'Study/', method: 0, directory: true, size: 0 },
        { name: 'Study/CT/IM1', method: 0, directory: false, size: random.length },
        { name: 'Study/CT/IM2', method: 8, directory: false, size: text.length },
        { name: 'Étude/ñame.dcm', method: 8, directory: false, size: 2 },
      ]
    );
    assert.ok(archive.entries[2].compressedSize < text.length);
    assert.deepEqual(await archive.read(archive.entries[1]), random);
    assert.deepEqual(await archive.read(archive.entries[2]), text);
    assert.equal((await archive.read(archive.entries[3])).toString(), 'é');
  });
}

test('password-protected entries and other compression methods are reported, not read', async (t) => {
  const archive = await withZip(
    t,
    zipBytes([
      { name: 'secret', data: text, method: 0, encrypted: true },
      { name: 'bzip2', data: text, method: 12 },
    ])
  );
  assert.deepEqual(
    archive.entries.map((entry) => [entry.encrypted, entry.method]),
    [
      [true, 0],
      [false, 12],
    ]
  );
  await assert.rejects(archive.read(archive.entries[0]), /encrypted/);
  await assert.rejects(archive.read(archive.entries[1]), /method/);
});

test('an entry that inflates beyond its stated size is refused', async (t) => {
  const bytes = zipBytes([{ name: 'bomb', data: Buffer.alloc(200000) }]);
  // Make the directory claim 100 bytes; the data inflates to 200 000.
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE(100, central + 24);
  const archive = await withZip(t, bytes);
  await assert.rejects(archive.read(archive.entries[0]), /too-large/);
});

test('files that are not ZIP files, and damaged ones', async (t) => {
  const dir = temp(t);
  const notZip = path.join(dir, 'notes.zip');
  fs.writeFileSync(notZip, 'just text, no directory at the end');
  await assert.rejects(openZip(notZip), /not-zip/);
  const empty = path.join(dir, 'empty.zip');
  fs.writeFileSync(empty, '');
  await assert.rejects(openZip(empty), /not-zip/);

  const good = zipBytes([{ name: 'a', data: text }]);
  const broken = Buffer.from(good);
  broken.writeUInt32LE(0x12345678, good.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
  const damaged = path.join(dir, 'damaged.zip');
  fs.writeFileSync(damaged, broken);
  await assert.rejects(openZip(damaged), /damaged/);

  // Cut short: the directory points past the end of the file.
  const cut = path.join(dir, 'cut.zip');
  fs.writeFileSync(cut, Buffer.concat([good.subarray(0, 10), good.subarray(good.length - 22)]));
  await assert.rejects(openZip(cut), /damaged/);

  // A local header that is not where the directory says.
  const moved = Buffer.from(good);
  moved.writeUInt32LE(0, 0);
  const archive = await withZip(t, moved);
  await assert.rejects(archive.read(archive.entries[0]), /damaged/);
});
