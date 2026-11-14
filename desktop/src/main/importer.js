'use strict';
// Imports what the user chose into the library: the DICOM files that scan.js finds (files, folders, discs with a
// DICOMDIR) and the DICOM files inside ZIP files. A file already in the library (the same SOP Instance UID) is
// left alone. No Electron import; test/importer.test.mjs runs it in Node.
const { scan } = require('./scan');
const { openZip } = require('./zip');

// ZIP entries that are never images: macOS and Windows bookkeeping, hidden files and DICOMDIR indexes.
const skipEntry = (name) => {
  const parts = String(name).split('/');
  const base = parts[parts.length - 1];
  return parts.includes('__MACOSX') || base.startsWith('.') || /^(dicomdir|thumbs\.db|desktop\.ini)$/i.test(base);
};

/**
 * Imports `paths` into `library`. Returns { studies, studiesAdded, added, duplicates, skipped, unreadable, failed,
 * zip, dicomdir, truncated, limit, cancelled, diskFull }: the studies found and those that got new images, files
 * added and already present, files that were not DICOM, could not be read or could not be added, ZIP problems
 * ({ encrypted, method, bad }), and the scan's notes. onProgress gets { phase: 'searching', checked, found } and
 * then { phase: 'importing', done, total }.
 */
async function importPaths(library, paths, { signal, onProgress } = {}) {
  const aborted = () => Boolean(signal && signal.aborted);
  const report = (progress) => onProgress && onProgress(progress);
  const found = await scan(paths, { signal, onProgress: (progress) => report({ phase: 'searching', ...progress }) });
  const result = {
    studies: [],
    added: 0,
    duplicates: 0,
    skipped: found.skipped,
    unreadable: found.unreadable,
    failed: 0,
    zip: { encrypted: 0, method: 0, bad: 0 },
    dicomdir: found.dicomdir,
    truncated: found.truncated,
    limit: found.limit,
    cancelled: found.cancelled,
    diskFull: false,
  };
  if (found.cancelled) return result;

  const zips = [];
  let total = found.files.length;
  for (const file of found.zips) {
    try {
      const zip = await openZip(file);
      const entries = zip.entries.filter((entry) => !entry.directory && !skipEntry(entry.name));
      const readable = entries.filter((entry) => {
        if (entry.encrypted) result.zip.encrypted += 1;
        else if (entry.method !== 0 && entry.method !== 8) result.zip.method += 1;
        else return true;
        return false;
      });
      zips.push({ zip, entries: readable });
      total += readable.length;
    } catch {
      result.zip.bad += 1;
    }
  }

  const studies = new Set();
  const studiesAdded = new Set();
  let done = 0;
  let reported = 0;
  const step = () => {
    done += 1;
    const now = Date.now();
    if (done === total || now - reported >= 200) {
      reported = now;
      report({ phase: 'importing', done, total });
    }
  };
  const add = async (work) => {
    let outcome;
    try {
      outcome = await work();
    } catch (error) {
      if (error && error.code === 'ENOSPC') {
        result.diskFull = true;
        throw error;
      }
      result.failed += 1;
      return;
    }
    if (outcome.status === 'added') result.added += 1;
    else if (outcome.status === 'duplicate') result.duplicates += 1;
    else result.skipped += 1;
    if (outcome.record) studies.add(outcome.record.studyUID);
    if (outcome.record && outcome.status === 'added') studiesAdded.add(outcome.record.studyUID);
  };

  report({ phase: 'importing', done: 0, total });
  try {
    for (const file of found.files) {
      if (aborted()) break;
      await add(() => library.addFile(file));
      step();
    }
    for (const { zip, entries } of zips) {
      for (const entry of entries) {
        if (aborted()) break;
        await add(async () => library.addBuffer(await zip.read(entry)));
        step();
      }
    }
  } catch (error) {
    if (!result.diskFull) throw error;
  } finally {
    for (const { zip } of zips) await zip.close().catch(() => {});
  }
  result.cancelled = aborted();
  result.studies = [...studies];
  result.studiesAdded = [...studiesAdded];
  return result;
}

module.exports = { importPaths };
