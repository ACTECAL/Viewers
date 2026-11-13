'use strict';
// Finds the DICOM files in what the user chose to open: files, folders, ZIP files, a DICOMDIR, or a whole CD, DVD
// or USB drive. A DICOMDIR at the top of a folder, or in the folders directly inside it, is followed, as viewers
// do with DICOM discs: it lists the images, so the rest of the disc (often a viewer program) is not read.
// Otherwise every file is checked for the "DICM" marker that DICOM PS3.10 files carry after a 128-byte preamble.
// ZIP files are passed on whole; the page reads them (unzip.js). No Electron import; test/scan.test.mjs.
const fs = require('node:fs');
const path = require('node:path');
const { isDicomdirName, readDicomdir, resolveReferencedFile } = require('./dicomdir');

const LIMITS = Object.freeze({ files: 100000, depth: 12, concurrency: 8, subfolders: 500 });
// Folders and files that never hold studies: macOS and Windows bookkeeping.
const SKIP = new Set(['__macosx', 'system volume information', '$recycle.bin', 'thumbs.db', 'desktop.ini']);
const skipName = (name) => name.startsWith('.') || SKIP.has(name.toLowerCase());
const isZipName = (name) => /\.zip$/i.test(name);
const readEntries = (dir) => fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);

/** true for a DICOM PS3.10 file, false for any other file, null when it cannot be read. */
async function isDicomFile(file) {
  let handle;
  try {
    handle = await fs.promises.open(file, 'r');
    const marker = Buffer.alloc(4);
    const { bytesRead } = await handle.read(marker, 0, 4, 128);
    return bytesRead === 4 && marker.toString('latin1') === 'DICM';
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/**
 * Looks through `inputs` (paths) and returns { files, zips, skipped, unreadable, truncated, dicomdir, cancelled,
 * limit }: the DICOM files and ZIP files found, how many files were not DICOM or could not be read, whether the
 * search stopped at `limits.files`, and { listed, missing } when a DICOMDIR was followed. `signal` (an
 * AbortSignal) stops it; onProgress({ checked, found }) is called at most four times a second.
 */
async function scan(inputs, { signal, onProgress, limits = LIMITS } = {}) {
  const state = { files: new Set(), zips: new Set(), skipped: 0, unreadable: 0, checked: 0, listed: 0, truncated: false, dicomdir: null };
  let reported = 0;
  const context = {
    limits,
    aborted: () => Boolean(signal && signal.aborted),
    progress(force = false) {
      if (!onProgress) return;
      const now = Date.now();
      if (!force && now - reported < 250) return;
      reported = now;
      onProgress({ checked: state.checked, found: state.files.size + state.zips.size });
    },
    state,
  };
  for (const input of Array.isArray(inputs) ? inputs : []) {
    if (context.aborted() || state.truncated) break;
    let stat;
    try {
      stat = await fs.promises.stat(input);
    } catch {
      state.unreadable += 1;
      continue;
    }
    if (stat.isDirectory()) await scanFolder(input, context);
    else if (stat.isFile()) await scanFile(input, context);
  }
  context.progress(true);
  return {
    files: [...state.files],
    zips: [...state.zips],
    skipped: state.skipped,
    unreadable: state.unreadable,
    truncated: state.truncated,
    dicomdir: state.dicomdir,
    cancelled: context.aborted(),
    limit: limits.files,
  };
}

// Counts one more file towards limits.files; false (and truncated) when the limit is reached.
function take(context) {
  const { state, limits } = context;
  if (state.listed >= limits.files) {
    state.truncated = true;
    return false;
  }
  state.listed += 1;
  return true;
}

async function scanFile(file, context) {
  const name = path.basename(file);
  if (isDicomdirName(name)) {
    if (!(await followDicomdir(file, context))) await scanFolder(path.dirname(file), context, { ignoreDicomdir: true });
    return;
  }
  if (!take(context)) return;
  if (isZipName(name)) context.state.zips.add(file);
  else await checkFiles([file], context);
}

async function scanFolder(root, context, { ignoreDicomdir = false } = {}) {
  if (!ignoreDicomdir) {
    let followed = false;
    for (const file of await findDicomdirs(root, context)) {
      if (context.aborted()) return;
      if (await followDicomdir(file, context)) followed = true;
    }
    if (followed) return;
  }
  const files = [];
  await walk(root, 0, files, context);
  await checkFiles(files, context);
}

// A DICOMDIR at the top of the folder, or else in the folders directly inside it (several discs copied side by side).
async function findDicomdirs(root, context) {
  const top = await readEntries(root);
  const here = top.filter((entry) => isDicomdirName(entry.name) && !entry.isDirectory());
  if (here.length) return here.map((entry) => path.join(root, entry.name));
  const found = [];
  const folders = top
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !skipName(entry.name))
    .slice(0, context.limits.subfolders);
  for (const folder of folders) {
    if (context.aborted()) break;
    const inside = await readEntries(path.join(root, folder.name));
    const dicomdir = inside.find((entry) => isDicomdirName(entry.name) && !entry.isDirectory());
    if (dicomdir) found.push(path.join(root, folder.name, dicomdir.name));
  }
  return found;
}

async function followDicomdir(file, context) {
  let records;
  try {
    records = await readDicomdir(file);
  } catch {
    return false;
  }
  const base = path.dirname(file);
  const cache = new Map();
  const found = [];
  let missing = 0;
  for (const parts of records) {
    if (context.aborted()) return false;
    const resolved = await resolveReferencedFile(base, parts, cache);
    if (resolved) found.push(resolved);
    else missing += 1;
  }
  if (!found.length) return false;
  const { state } = context;
  for (const resolved of found) {
    if (state.files.has(resolved)) continue;
    if (!take(context)) break;
    state.files.add(resolved);
  }
  state.dicomdir = {
    listed: (state.dicomdir ? state.dicomdir.listed : 0) + records.length,
    missing: (state.dicomdir ? state.dicomdir.missing : 0) + missing,
  };
  context.progress();
  return true;
}

// Collects the files under dir (without following symbolic links): ZIP files straight into the result, the rest
// into `files` for checkFiles().
async function walk(dir, depth, files, context) {
  const { state, limits } = context;
  if (context.aborted() || state.truncated || depth > limits.depth) return;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    state.unreadable += 1;
    return;
  }
  for (const entry of entries) {
    if (context.aborted() || state.truncated) return;
    if (skipName(entry.name) || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (!isDirectory && !isFile) {
      // Some file systems (some network and disc mounts) do not give the type in the listing.
      const stat = await fs.promises.lstat(full).catch(() => null);
      if (!stat || stat.isSymbolicLink()) continue;
      isDirectory = stat.isDirectory();
      isFile = stat.isFile();
    }
    if (isDirectory) await walk(full, depth + 1, files, context);
    else if (isFile && !isDicomdirName(entry.name)) {
      if (!take(context)) return;
      if (isZipName(entry.name)) state.zips.add(full);
      else files.push(full);
    }
  }
}

async function checkFiles(files, context) {
  const { state } = context;
  let next = 0;
  async function worker() {
    while (next < files.length && !context.aborted()) {
      const file = files[next];
      next += 1;
      const result = await isDicomFile(file);
      state.checked += 1;
      if (result === true) state.files.add(file);
      else if (result === false) state.skipped += 1;
      else state.unreadable += 1;
      context.progress();
    }
  }
  await Promise.all(Array.from({ length: Math.min(context.limits.concurrency, files.length) }, worker));
}

module.exports = { LIMITS, isDicomFile, scan };
