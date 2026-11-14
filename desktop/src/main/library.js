'use strict';
// The local study library (TASK_PLAN 13, phase 2): DICOM files copied into a folder, and an SQLite index of their
// patients, studies, series and instances. It uses Node's built-in node:sqlite, so there is no native module to
// build for each platform. The folder holds everything, library.db and studies/<study>/<series>/<instance>.dcm
// (names are hashes of the UIDs), so moving or copying the folder moves the library.
// No Electron import; test/library.test.mjs runs it in Node.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { key, readHeader } = require('./dicomfile');

const SCHEMA_VERSION = 1;
const DATABASE = 'library.db';
const STUDIES = 'studies';
// The start of a file read to find its header; larger files are then copied by the operating system. A file whose
// UIDs come later (large private data first) is read whole if it is no larger than WHOLE_BYTES.
const HEADER_BYTES = 4 * 1024 * 1024;
const WHOLE_BYTES = 256 * 1024 * 1024;
// Modalities of objects that are not images; they are not offered as filters.
const NOT_IMAGES = new Set(['SR', 'PR', 'KO', 'SEG', 'REG', 'RTSTRUCT', 'RTPLAN', 'RTRECORD', 'DOC', 'FID', 'PLAN']);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS studies (
  study_uid TEXT PRIMARY KEY,
  patient_name TEXT NOT NULL DEFAULT '',
  patient_id TEXT NOT NULL DEFAULT '',
  patient_birth_date TEXT NOT NULL DEFAULT '',
  patient_sex TEXT NOT NULL DEFAULT '',
  patient_age TEXT NOT NULL DEFAULT '',
  study_date TEXT NOT NULL DEFAULT '',
  study_time TEXT NOT NULL DEFAULT '',
  study_description TEXT NOT NULL DEFAULT '',
  accession_number TEXT NOT NULL DEFAULT '',
  referring_physician TEXT NOT NULL DEFAULT '',
  institution TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL,
  opened_at TEXT
);
CREATE TABLE IF NOT EXISTS series (
  series_uid TEXT PRIMARY KEY,
  study_uid TEXT NOT NULL,
  modality TEXT NOT NULL DEFAULT '',
  series_number INTEGER,
  series_description TEXT NOT NULL DEFAULT '',
  body_part TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS instances (
  sop_uid TEXT PRIMARY KEY,
  series_uid TEXT NOT NULL,
  study_uid TEXT NOT NULL,
  sop_class_uid TEXT NOT NULL DEFAULT '',
  transfer_syntax_uid TEXT NOT NULL DEFAULT '',
  instance_number INTEGER,
  frames INTEGER NOT NULL DEFAULT 1,
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS series_by_study ON series (study_uid);
-- With size_bytes, the study list counts and adds up each study's files from the index alone.
CREATE INDEX IF NOT EXISTS instances_by_study ON instances (study_uid, size_bytes);
CREATE INDEX IF NOT EXISTS instances_by_series ON instances (series_uid);
CREATE INDEX IF NOT EXISTS studies_by_date ON studies (study_date);
`;

// Study fields: column, record field. The first value seen is kept; later files only fill empty fields.
const STUDY_FIELDS = [
  ['patient_name', 'patientName'],
  ['patient_id', 'patientID'],
  ['patient_birth_date', 'patientBirthDate'],
  ['patient_sex', 'patientSex'],
  ['patient_age', 'patientAge'],
  ['study_date', 'studyDate'],
  ['study_time', 'studyTime'],
  ['study_description', 'studyDescription'],
  ['accession_number', 'accessionNumber'],
  ['referring_physician', 'referringPhysician'],
  ['institution', 'institution'],
];
const fill = (table, columns) => columns.map((column) => `${column} = CASE WHEN ${table}.${column} = '' THEN excluded.${column} ELSE ${table}.${column} END`).join(', ');

const STUDY_COLUMNS = `
  s.study_uid AS studyUID, s.patient_name AS patientName, s.patient_id AS patientID,
  s.patient_birth_date AS patientBirthDate, s.patient_sex AS patientSex, s.patient_age AS patientAge,
  s.study_date AS studyDate, s.study_time AS studyTime, s.study_description AS studyDescription,
  s.accession_number AS accessionNumber, s.referring_physician AS referringPhysician, s.institution AS institution,
  s.imported_at AS importedAt, s.opened_at AS openedAt,
  (SELECT GROUP_CONCAT(modality, ',') FROM (SELECT DISTINCT modality FROM series WHERE study_uid = s.study_uid AND modality <> '' ORDER BY modality)) AS modalities,
  (SELECT COUNT(*) FROM series WHERE study_uid = s.study_uid) AS seriesCount,
  (SELECT COUNT(*) FROM instances WHERE study_uid = s.study_uid) AS instanceCount,
  (SELECT COALESCE(SUM(size_bytes), 0) FROM instances WHERE study_uid = s.study_uid) AS bytes`;

const SORTS = {
  studyDate: (direction) => `s.study_date ${direction}, s.study_time ${direction}`,
  patientName: (direction) => `s.patient_name COLLATE NOCASE ${direction}`,
  patientID: (direction) => `s.patient_id COLLATE NOCASE ${direction}`,
  description: (direction) => `s.study_description COLLATE NOCASE ${direction}`,
  instances: (direction) => `instanceCount ${direction}`,
  importedAt: (direction) => `s.imported_at ${direction}`,
  openedAt: (direction) => `s.opened_at ${direction}`,
};

const plain = (row) => (row ? { ...row } : null);
const escapeLike = (value) => value.replace(/[\\%_]/g, (character) => `\\${character}`);
const isInside = (child, parent) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

// Folder and file names for exports: readable, and valid on Windows, macOS and Linux.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
function safeName(value, fallback) {
  const name = String(value || '')
    .replace(/[\\/:*?"<>|\x00-\x1f^]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  if (!name) return fallback;
  return RESERVED.test(name) ? `_${name}` : name;
}
const formatDate = (value) => (/^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : '');

async function readStart(file, limit = HEADER_BYTES) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, limit);
    const buffer = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const { bytesRead } = await handle.read(buffer, done, length - done, done);
      if (!bytesRead) break;
      done += bytesRead;
    }
    return { size, start: buffer.subarray(0, done) };
  } finally {
    await handle.close();
  }
}

function listFiles(folder) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  if (fs.existsSync(folder)) walk(folder);
  return out;
}

class Library {
  /** Whether a folder holds a library. */
  static isLibrary(folder) {
    return fs.existsSync(path.join(folder, DATABASE));
  }

  constructor(root) {
    this.root = path.resolve(root);
    fs.mkdirSync(path.join(this.root, STUDIES), { recursive: true });
    this.db = new DatabaseSync(path.join(this.root, DATABASE));
    try {
      this.db.exec('PRAGMA journal_mode = WAL');
    } catch {
      // Some network folders cannot use WAL; the default journal works there.
    }
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec(SCHEMA);
    const version = this.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get();
    if (!version) this.db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?)").run(String(SCHEMA_VERSION));
    else if (Number(version.value) > SCHEMA_VERSION) {
      this.db.close();
      throw new Error('This library was made by a newer version of Spectra Desktop.');
    }
    const studyColumns = STUDY_FIELDS.map(([column]) => column);
    this.sql = {
      hasStudy: this.db.prepare('SELECT 1 AS found FROM studies WHERE study_uid = ?'),
      hasInstance: this.db.prepare('SELECT 1 AS found FROM instances WHERE sop_uid = ?'),
      upsertStudy: this.db.prepare(
        `INSERT INTO studies (study_uid, ${studyColumns.join(', ')}, imported_at) VALUES (?, ${studyColumns.map(() => '?').join(', ')}, ?)
         ON CONFLICT (study_uid) DO UPDATE SET ${fill('studies', studyColumns)}`
      ),
      upsertSeries: this.db.prepare(
        `INSERT INTO series (series_uid, study_uid, modality, series_number, series_description, body_part) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (series_uid) DO UPDATE SET ${fill('series', ['modality', 'series_description', 'body_part'])},
           series_number = COALESCE(series.series_number, excluded.series_number)`
      ),
      insertInstance: this.db.prepare(
        `INSERT OR IGNORE INTO instances (sop_uid, series_uid, study_uid, sop_class_uid, transfer_syntax_uid, instance_number, frames, path, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      study: this.db.prepare(`SELECT ${STUDY_COLUMNS} FROM studies s WHERE s.study_uid = ?`),
      series: this.db.prepare(
        `SELECT se.series_uid AS seriesUID, se.modality AS modality, se.series_number AS seriesNumber,
           se.series_description AS seriesDescription, se.body_part AS bodyPart,
           (SELECT COUNT(*) FROM instances i WHERE i.series_uid = se.series_uid) AS instanceCount
         FROM series se WHERE se.study_uid = ? ORDER BY se.series_number IS NULL, se.series_number, se.series_uid`
      ),
      files: this.db.prepare(
        `SELECT i.path AS path, i.series_uid AS seriesUID, i.instance_number AS instanceNumber, se.series_number AS seriesNumber,
           se.modality AS modality, se.series_description AS seriesDescription
         FROM instances i LEFT JOIN series se ON se.series_uid = i.series_uid
         WHERE i.study_uid = ?
         ORDER BY se.series_number IS NULL, se.series_number, i.series_uid, i.instance_number IS NULL, i.instance_number, i.sop_uid`
      ),
      deleteInstances: this.db.prepare('DELETE FROM instances WHERE study_uid = ?'),
      deleteSeries: this.db.prepare('DELETE FROM series WHERE study_uid = ?'),
      deleteStudy: this.db.prepare('DELETE FROM studies WHERE study_uid = ?'),
      opened: this.db.prepare('UPDATE studies SET opened_at = ? WHERE study_uid = ?'),
      totals: this.db.prepare(
        'SELECT (SELECT COUNT(*) FROM studies) AS studies, (SELECT COUNT(*) FROM instances) AS instances, (SELECT COALESCE(SUM(size_bytes), 0) FROM instances) AS bytes'
      ),
      modalities: this.db.prepare("SELECT DISTINCT modality FROM series WHERE modality <> '' ORDER BY modality"),
    };
  }

  close() {
    if (this.db.isOpen) this.db.close();
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Already rolled back.
      }
      throw error;
    }
  }

  hasStudy(studyUID) {
    return Boolean(this.sql.hasStudy.get(String(studyUID)));
  }

  /** Adds a file from disk; large files are copied without reading them whole. { status: 'added' | 'duplicate' | 'not-dicom', record }. */
  async addFile(file) {
    let { size, start } = await readStart(file);
    let record = readHeader(start);
    if (!record && size > start.length && size <= WHOLE_BYTES && start.length >= 132 && start.toString('latin1', 128, 132) === 'DICM') {
      ({ size, start } = await readStart(file, WHOLE_BYTES));
      record = readHeader(start);
    }
    if (!record) return { status: 'not-dicom' };
    return this.store(record, size, (destination) => (size <= start.length ? fs.promises.writeFile(destination, start) : fs.promises.copyFile(file, destination)));
  }

  /** Adds a file given as bytes (from a ZIP file). */
  async addBuffer(buffer) {
    let record = readHeader(buffer.length > HEADER_BYTES ? buffer.subarray(0, HEADER_BYTES) : buffer);
    if (!record && buffer.length > HEADER_BYTES) record = readHeader(buffer);
    if (!record) return { status: 'not-dicom' };
    return this.store(record, buffer.length, (destination) => fs.promises.writeFile(destination, buffer));
  }

  async store(record, size, write) {
    if (this.sql.hasInstance.get(record.sopUID)) return { status: 'duplicate', record };
    const relative = [STUDIES, key(record.studyUID), key(record.seriesUID), `${key(record.sopUID)}.dcm`].join('/');
    const file = path.join(this.root, ...relative.split('/'));
    // A file left by an import that stopped before indexing it is replaced.
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.part`;
    try {
      await write(temporary);
      await fs.promises.rename(temporary, file);
    } catch (error) {
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    try {
      this.transaction(() => {
        this.sql.upsertStudy.run(record.studyUID, ...STUDY_FIELDS.map(([, field]) => record[field] || ''), new Date().toISOString());
        this.sql.upsertSeries.run(record.seriesUID, record.studyUID, record.modality, record.seriesNumber, record.seriesDescription, record.bodyPart);
        this.sql.insertInstance.run(
          record.sopUID,
          record.seriesUID,
          record.studyUID,
          record.sopClassUID,
          record.transferSyntaxUID,
          record.instanceNumber,
          record.frames,
          relative,
          size
        );
      });
    } catch (error) {
      await fs.promises.rm(file, { force: true }).catch(() => {});
      throw error;
    }
    return { status: 'added', record };
  }

  /**
   * Studies matching a search: { total, studies }. text matches patient name and ID, accession number, study and
   * series descriptions and modalities, word by word; from and to are YYYYMMDD; modalities is a list of codes.
   */
  list({ text = '', modalities = [], from = '', to = '', sort = 'studyDate', direction = 'desc', limit = 1000 } = {}) {
    const where = [];
    const params = [];
    for (const word of String(text).trim().split(/\s+/).filter(Boolean).slice(0, 8)) {
      const pattern = `%${escapeLike(word)}%`;
      where.push(`(s.patient_name LIKE ? ESCAPE '\\' OR s.patient_id LIKE ? ESCAPE '\\' OR s.accession_number LIKE ? ESCAPE '\\'
        OR s.study_description LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM series x WHERE x.study_uid = s.study_uid AND (x.series_description LIKE ? ESCAPE '\\' OR x.modality LIKE ? ESCAPE '\\')))`);
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }
    if (/^\d{8}$/.test(from)) {
      where.push('s.study_date >= ?');
      params.push(from);
    }
    if (/^\d{8}$/.test(to)) {
      where.push("s.study_date <= ? AND s.study_date <> ''");
      params.push(to);
    }
    const wanted = (Array.isArray(modalities) ? modalities : []).filter((code) => typeof code === 'string' && /^[A-Z0-9]{1,16}$/.test(code)).slice(0, 20);
    if (wanted.length) {
      where.push(`EXISTS (SELECT 1 FROM series m WHERE m.study_uid = s.study_uid AND m.modality IN (${wanted.map(() => '?').join(', ')}))`);
      params.push(...wanted);
    }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order = (SORTS[sort] || SORTS.studyDate)(direction === 'asc' ? 'ASC' : 'DESC');
    const count = Math.min(Math.max(1, Number.parseInt(limit, 10) || 1000), 5000);
    const total = this.db.prepare(`SELECT COUNT(*) AS total FROM studies s ${filter}`).get(...params).total;
    const rows = this.db.prepare(`SELECT ${STUDY_COLUMNS} FROM studies s ${filter} ORDER BY ${order}, s.study_uid LIMIT ?`).all(...params, count);
    return { total, studies: rows.map((row) => ({ ...row, modalities: row.modalities ? row.modalities.split(',') : [] })) };
  }

  /** One study with its series, or null. */
  study(studyUID) {
    const row = plain(this.sql.study.get(String(studyUID)));
    if (!row) return null;
    return { ...row, modalities: row.modalities ? row.modalities.split(',') : [], series: this.sql.series.all(row.studyUID).map(plain) };
  }

  /** The files of these studies in viewing order: { paths, missing }. */
  files(studyUIDs) {
    const paths = [];
    let missing = 0;
    for (const studyUID of studyUIDs) {
      for (const row of this.sql.files.all(String(studyUID))) {
        const file = path.join(this.root, ...row.path.split('/'));
        if (fs.existsSync(file)) paths.push(file);
        else missing += 1;
      }
    }
    return { paths, missing };
  }

  studyFolder(studyUID) {
    return path.join(this.root, STUDIES, key(studyUID));
  }

  markOpened(studyUIDs, when = new Date().toISOString()) {
    for (const studyUID of studyUIDs) this.sql.opened.run(when, String(studyUID));
  }

  /** Deletes the studies and their files; resolves to how many were deleted. */
  async remove(studyUIDs) {
    let removed = 0;
    for (const studyUID of [...new Set(studyUIDs.map(String))]) {
      if (!this.hasStudy(studyUID)) continue;
      this.transaction(() => {
        this.sql.deleteInstances.run(studyUID);
        this.sql.deleteSeries.run(studyUID);
        this.sql.deleteStudy.run(studyUID);
      });
      const folder = this.studyFolder(studyUID);
      if (isInside(folder, path.join(this.root, STUDIES))) await fs.promises.rm(folder, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  /** { root, studies, instances, bytes, modalities } for the settings and the filters. */
  info() {
    const totals = plain(this.sql.totals.get());
    const modalities = this.sql.modalities.all().map((row) => row.modality).filter((code) => !NOT_IMAGES.has(code));
    return { root: this.root, ...totals, modalities };
  }

  /**
   * Copies the studies into `destination`, one readable folder per study ("Patient name 2026-11-13 Description")
   * and per series ("3 CT Axial"), files IM00001.dcm… in viewing order. Returns { folders, files, missing, cancelled }.
   */
  async export(studyUIDs, destination, { signal, onProgress } = {}) {
    const taken = new Set();
    const unique = (parent, name) => {
      let candidate = name;
      for (let n = 2; taken.has(path.join(parent, candidate).toLowerCase()) || fs.existsSync(path.join(parent, candidate)); n += 1) candidate = `${name} (${n})`;
      taken.add(path.join(parent, candidate).toLowerCase());
      return path.join(parent, candidate);
    };
    const plan = [];
    const folders = [];
    let missing = 0;
    for (const studyUID of studyUIDs.map(String)) {
      const study = this.sql.study.get(studyUID);
      if (!study) continue;
      const studyFolder = unique(
        destination,
        safeName([String(study.patientName || '').replace(/\^+/g, ' '), formatDate(study.studyDate), study.studyDescription].filter(Boolean).join(' '), 'Study')
      );
      folders.push(studyFolder);
      const seriesFolders = new Map();
      const counters = new Map();
      for (const row of this.sql.files.all(studyUID)) {
        const from = path.join(this.root, ...row.path.split('/'));
        if (!fs.existsSync(from)) {
          missing += 1;
          continue;
        }
        if (!seriesFolders.has(row.seriesUID)) {
          const label = [row.seriesNumber === null || row.seriesNumber === undefined ? '' : row.seriesNumber, row.modality, row.seriesDescription].join(' ');
          seriesFolders.set(row.seriesUID, unique(studyFolder, safeName(label, 'Series')));
        }
        const index = (counters.get(row.seriesUID) || 0) + 1;
        counters.set(row.seriesUID, index);
        plan.push({ from, to: path.join(seriesFolders.get(row.seriesUID), `IM${String(index).padStart(5, '0')}.dcm`) });
      }
    }
    let done = 0;
    for (const { from, to } of plan) {
      if (signal && signal.aborted) return { folders, files: done, missing, cancelled: true };
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
      done += 1;
      if (onProgress) onProgress({ done, total: plan.length });
    }
    return { folders, files: done, missing, cancelled: false };
  }

  /**
   * Moves the library into an empty folder and returns the Library there. This library is closed first; on
   * failure the copy is removed, and the caller opens this library again.
   */
  async moveTo(target, { onProgress } = {}) {
    const destination = path.resolve(target);
    if (isInside(destination, this.root) || isInside(this.root, destination)) throw new Error('The new folder cannot be inside the library, or the library inside it.');
    const existed = fs.existsSync(destination);
    if (existed && fs.readdirSync(destination).some((name) => !name.startsWith('.'))) throw new Error('Choose an empty folder for the library.');
    const source = path.join(this.root, STUDIES);
    const files = listFiles(source);
    // Everything into library.db itself, so copying that one file copies the index.
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.close();
    try {
      fs.mkdirSync(path.join(destination, STUDIES), { recursive: true });
      fs.copyFileSync(path.join(this.root, DATABASE), path.join(destination, DATABASE));
      let done = 0;
      for (const file of files) {
        const to = path.join(destination, STUDIES, path.relative(source, file));
        await fs.promises.mkdir(path.dirname(to), { recursive: true });
        await fs.promises.copyFile(file, to);
        done += 1;
        if (onProgress) onProgress({ done, total: files.length });
      }
      const moved = new Library(destination);
      const copied = moved.info().instances;
      const expected = listFiles(path.join(destination, STUDIES)).length;
      if (copied > expected) {
        moved.close();
        throw new Error('Some files were not copied.');
      }
      fs.rmSync(source, { recursive: true, force: true });
      for (const name of [DATABASE, `${DATABASE}-wal`, `${DATABASE}-shm`]) fs.rmSync(path.join(this.root, name), { force: true });
      if (fs.existsSync(this.root) && !fs.readdirSync(this.root).length) fs.rmdirSync(this.root);
      return moved;
    } catch (error) {
      if (existed) {
        fs.rmSync(path.join(destination, STUDIES), { recursive: true, force: true });
        fs.rmSync(path.join(destination, DATABASE), { force: true });
      } else {
        fs.rmSync(destination, { recursive: true, force: true });
      }
      throw error;
    }
  }
}

module.exports = { DATABASE, Library, safeName };
