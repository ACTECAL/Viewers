// ZIP archives read in the browser, without uploading them. Stored entries are sliced straight from the
// File; deflated entries are inflated with the built-in DecompressionStream, so there is no extra
// dependency. Supports ZIP64. Password-protected and other compression methods are reported, not read.

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX32 = 0xffffffff;

export class ZipError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason; // 'not-zip' | 'damaged' | 'method' | 'unsupported-browser'
  }
}

export function isZip(file) {
  return /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

let deflateRawSupport = null;
export function zipSupported() {
  if (deflateRawSupport === null) {
    try {
      // Throws for formats the browser does not know.
      new DecompressionStream('deflate-raw');
      deflateRawSupport = true;
    } catch {
      deflateRawSupport = false;
    }
  }
  return deflateRawSupport;
}

async function view(blob, start, end) {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

const u64 = (data, offset) => data.getUint32(offset, true) + data.getUint32(offset + 4, true) * 2 ** 32;

/** Lists the entries of a ZIP file from its central directory. */
export async function readZipEntries(file) {
  // The end-of-central-directory record is in the last 22 bytes, plus up to 64 KB of comment.
  const tailStart = Math.max(0, file.size - 22 - 0xffff);
  const tail = await view(file, tailStart, file.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i -= 1) {
    if (tail.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('not-zip');

  let count = tail.getUint16(eocd + 10, true);
  let directorySize = tail.getUint32(eocd + 12, true);
  let directoryOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || directorySize === MAX32 || directoryOffset === MAX32) {
    const locator = eocd - 20;
    if (locator < 0 || tail.getUint32(locator, true) !== ZIP64_LOCATOR) throw new ZipError('damaged');
    const zip64Offset = u64(tail, locator + 8);
    const zip64 = await view(file, zip64Offset, zip64Offset + 56);
    if (zip64.getUint32(0, true) !== ZIP64_EOCD) throw new ZipError('damaged');
    count = u64(zip64, 32);
    directorySize = u64(zip64, 40);
    directoryOffset = u64(zip64, 48);
  }

  const directory = await view(file, directoryOffset, directoryOffset + directorySize);
  const decoder = new TextDecoder();
  const entries = [];
  let p = 0;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > directory.byteLength || directory.getUint32(p, true) !== CENTRAL) throw new ZipError('damaged');
    const flags = directory.getUint16(p + 8, true);
    const method = directory.getUint16(p + 10, true);
    let compressedSize = directory.getUint32(p + 20, true);
    let size = directory.getUint32(p + 24, true);
    const nameLength = directory.getUint16(p + 28, true);
    const extraLength = directory.getUint16(p + 30, true);
    const commentLength = directory.getUint16(p + 32, true);
    let localOffset = directory.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(directory.buffer, directory.byteOffset + p + 46, nameLength));

    // ZIP64 extra field (0x0001): the real sizes and offset, in this order, for fields set to 0xFFFFFFFF.
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const tag = directory.getUint16(e, true);
      const length = directory.getUint16(e + 2, true);
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

    entries.push({
      name,
      method,
      encrypted: Boolean(flags & 1),
      compressedSize,
      size,
      localOffset,
      directory: name.endsWith('/'),
    });
    p = extraEnd + commentLength;
  }
  return entries;
}

/** Turns one entry into a File (named after the entry, without its folders). */
export async function entryToFile(zipFile, entry) {
  // The data starts after the local header, whose name and extra fields can differ from the central ones.
  const header = await view(zipFile, entry.localOffset, entry.localOffset + 30);
  if (header.getUint32(0, true) !== LOCAL) throw new ZipError('damaged');
  const start = entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const data = zipFile.slice(start, start + entry.compressedSize);
  const name = entry.name.split('/').pop() || 'file';
  // A Blob in a browser; in Spectra Desktop a byte-range slice (desktop.js), fetched first.
  if (entry.method === 0) return new File([data instanceof Blob ? data : await data.blob()], name);
  if (entry.method === 8) {
    if (!zipSupported()) throw new ZipError('unsupported-browser');
    const inflated = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new File([await new Response(inflated).blob()], name);
  }
  throw new ZipError('method');
}
