'use strict';
// ZIP files read from disk in parts, for importing them into the library. The same rules as the page's reader
// (extensions/actecal-offline/src/unzip.js): stored and deflated entries, ZIP64, and password-protected entries
// reported rather than read. No Electron import; test/zip.test.mjs.
const fs = require('node:fs');
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const inflateRaw = promisify(zlib.inflateRaw);
const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX32 = 0xffffffff;
// Larger entries cannot be held in one buffer; they are reported as unreadable.
const MAX_ENTRY = 1024 * 1024 * 1024;
const MAX_DIRECTORY = 256 * 1024 * 1024;

const u64 = (buffer, offset) => buffer.readUInt32LE(offset) + buffer.readUInt32LE(offset + 4) * 2 ** 32;

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(buffer, done, length - done, position + done);
    if (!bytesRead) break;
    done += bytesRead;
  }
  return buffer.subarray(0, done);
}

function parseDirectory(directory, count) {
  const entries = [];
  let p = 0;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > directory.length || directory.readUInt32LE(p) !== CENTRAL) throw new Error('damaged');
    const flags = directory.readUInt16LE(p + 8);
    const method = directory.readUInt16LE(p + 10);
    let compressedSize = directory.readUInt32LE(p + 20);
    let size = directory.readUInt32LE(p + 24);
    const nameLength = directory.readUInt16LE(p + 28);
    const extraLength = directory.readUInt16LE(p + 30);
    const commentLength = directory.readUInt16LE(p + 32);
    let localOffset = directory.readUInt32LE(p + 42);
    const name = directory.toString('utf8', p + 46, p + 46 + nameLength);
    // ZIP64 extra field (0x0001): the real sizes and offset, in this order, for fields set to 0xFFFFFFFF.
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const tag = directory.readUInt16LE(e);
      const length = directory.readUInt16LE(e + 2);
      if (tag === 0x0001) {
        let q = e + 4;
        if (size === MAX32) {
          size = u64(directory, q);
          q += 8;
        }
        if (compressedSize === MAX32) {
          compressedSize = u64(directory, q);
          q += 8;
        }
        if (localOffset === MAX32) localOffset = u64(directory, q);
      }
      e += 4 + length;
    }
    entries.push({ name, method, encrypted: Boolean(flags & 1), compressedSize, size, localOffset, directory: name.endsWith('/') });
    p = extraEnd + commentLength;
  }
  return entries;
}

/**
 * Opens a ZIP file: { entries, read(entry), close() }. read() gives an entry's bytes. Throws Error('not-zip') or
 * Error('damaged') for files it cannot read.
 */
async function openZip(file) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const tailStart = Math.max(0, size - 22 - 0xffff);
    const tail = await readAt(handle, tailStart, size - tailStart);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('not-zip');
    let count = tail.readUInt16LE(eocd + 10);
    let directorySize = tail.readUInt32LE(eocd + 12);
    let directoryOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || directorySize === MAX32 || directoryOffset === MAX32) {
      const locator = eocd - 20;
      if (locator < 0 || tail.readUInt32LE(locator) !== ZIP64_LOCATOR) throw new Error('damaged');
      const zip64 = await readAt(handle, u64(tail, locator + 8), 56);
      if (zip64.length < 56 || zip64.readUInt32LE(0) !== ZIP64_EOCD) throw new Error('damaged');
      count = u64(zip64, 32);
      directorySize = u64(zip64, 40);
      directoryOffset = u64(zip64, 48);
    }
    if (directorySize > MAX_DIRECTORY || directoryOffset + directorySize > size) throw new Error('damaged');
    const entries = parseDirectory(await readAt(handle, directoryOffset, directorySize), count);
    return {
      entries,
      async read(entry) {
        if (entry.encrypted) throw new Error('encrypted');
        if (entry.method !== 0 && entry.method !== 8) throw new Error('method');
        if (entry.compressedSize > MAX_ENTRY || entry.size > MAX_ENTRY) throw new Error('too-large');
        const header = await readAt(handle, entry.localOffset, 30);
        if (header.length < 30 || header.readUInt32LE(0) !== LOCAL) throw new Error('damaged');
        const start = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
        const data = await readAt(handle, start, entry.compressedSize);
        if (data.length < entry.compressedSize) throw new Error('damaged');
        if (entry.method === 0) return data;
        // No more than the size the directory gives, so a ZIP bomb cannot fill the memory.
        return inflateRaw(data, { maxOutputLength: Math.max(1, entry.size) }).catch((error) => {
          throw new Error(error && error.code === 'ERR_BUFFER_TOO_LARGE' ? 'too-large' : 'damaged');
        });
      },
      close: () => handle.close(),
    };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

module.exports = { openZip };
