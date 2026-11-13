'use strict';
// DICOMDIR: the index on DICOM CDs, DVDs and USB exports (DICOM PS3.10 section 8, PS3.3 annex F). Each directory
// record names its file by ReferencedFileID: path components relative to the DICOMDIR's folder. Disc file names
// are ISO 9660 names, which some systems show in lower case or with a ";1" version, so names are matched loosely.
// No Electron import; test/dicomdir.test.mjs runs it in Node.
const fs = require('node:fs');
const path = require('node:path');
const dcmjs = require('dcmjs');

const DIRECTORY_RECORD_SEQUENCE = '00041220';
const REFERENCED_FILE_ID = '00041500';
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_COMPONENTS = 16;

const looseName = (name) => String(name).toLowerCase().replace(/;\d+$/, '').replace(/\.$/, '');

/** Whether a file name is a DICOMDIR (any case, with or without an ISO 9660 version). */
const isDicomdirName = (name) => looseName(name) === 'dicomdir';

/** A ReferencedFileID as path components, or null when it is empty or would leave the DICOMDIR's folder. */
function fileIdParts(value) {
  if (value === undefined || value === null) return null;
  const raw = (Array.isArray(value) ? value : [value]).flatMap((part) => String(part).split('\\'));
  const parts = raw.map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > MAX_COMPONENTS) return null;
  if (parts.some((part) => part === '.' || part === '..' || /[\/\\:\0]/.test(part) || part.length > 255)) return null;
  return parts;
}

/** The files a DICOMDIR lists, as path components ([['DICOM', 'S0000001', 'I0000001'], …]), each once. */
async function readDicomdir(file) {
  const { size } = await fs.promises.stat(file);
  if (size > MAX_BYTES) throw new Error('The DICOMDIR is too large.');
  const bytes = await fs.promises.readFile(file);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { dict } = dcmjs.data.DicomMessage.readFile(buffer, { ignoreErrors: true });
  const records = dict[DIRECTORY_RECORD_SEQUENCE] && dict[DIRECTORY_RECORD_SEQUENCE].Value;
  const seen = new Set();
  const out = [];
  for (const record of Array.isArray(records) ? records : []) {
    const parts = fileIdParts(record && record[REFERENCED_FILE_ID] && record[REFERENCED_FILE_ID].Value);
    if (!parts) continue;
    const key = parts.join('/').toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parts);
  }
  return out;
}

// A folder's names, for exact and loose matching. Read once per folder (cache), as discs are slow.
async function listing(dir, cache) {
  let entry = cache.get(dir);
  if (!entry) {
    const names = await fs.promises.readdir(dir).catch(() => []);
    entry = { exact: new Set(names), loose: new Map() };
    for (const name of names) {
      const key = looseName(name);
      if (!entry.loose.has(key)) entry.loose.set(key, name);
    }
    cache.set(dir, entry);
  }
  return entry;
}

/** The path of a ReferencedFileID under base, matching names without regard to case or ";1"; or null. */
async function resolveReferencedFile(base, parts, cache = new Map()) {
  let current = base;
  for (const part of parts) {
    const entry = await listing(current, cache);
    const name = entry.exact.has(part) ? part : entry.loose.get(looseName(part));
    if (!name) return null;
    current = path.join(current, name);
  }
  return current;
}

module.exports = { fileIdParts, isDicomdirName, readDicomdir, resolveReferencedFile };
