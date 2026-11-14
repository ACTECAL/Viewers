'use strict';
// Checks on what the page sends to the main process (index.js). The page is the app's own, but every argument is
// still checked before it reaches the library or the file system. No Electron import; test/main.test.mjs.
const path = require('node:path');

const SORTS = new Set(['studyDate', 'patientName', 'patientID', 'description', 'instances', 'importedAt', 'openedAt']);
const UID = /^[\x21-\x7e]{1,128}$/;

/** Study Instance UIDs: a list of 1 to `max` printable strings, without repeats. */
function uidList(value, max = 200) {
  if (!Array.isArray(value) || !value.length || value.length > max) throw new Error('Choose one or more studies.');
  return [
    ...new Set(
      value.map((uid) => {
        if (typeof uid !== 'string' || !UID.test(uid)) throw new Error('That is not a study in the library.');
        return uid;
      })
    ),
  ];
}

const uid = (value) => uidList([value], 1)[0];

/** A study list query with every field checked; anything else gives the defaults. */
function listQuery(value) {
  const query = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const date = (field) => (typeof field === 'string' && /^\d{8}$/.test(field) ? field : '');
  return {
    text: typeof query.text === 'string' ? query.text.slice(0, 200) : '',
    modalities: Array.isArray(query.modalities) ? query.modalities.filter((code) => typeof code === 'string' && /^[A-Z0-9]{1,16}$/.test(code)).slice(0, 20) : [],
    from: date(query.from),
    to: date(query.to),
    sort: SORTS.has(query.sort) ? query.sort : 'studyDate',
    direction: query.direction === 'asc' ? 'asc' : 'desc',
    limit: Number.isInteger(query.limit) && query.limit > 0 ? Math.min(query.limit, 5000) : 1000,
  };
}

/** Paths of dropped files and folders: absolute, without NUL characters, at most `max`. */
function pathList(value, max = 1000) {
  if (!Array.isArray(value) || !value.length || value.length > max) throw new Error('Nothing to open.');
  return value.map((file) => {
    if (typeof file !== 'string' || !file || file.length > 4096 || file.includes('\0') || !path.isAbsolute(file)) throw new Error('That is not a file on this computer.');
    return path.normalize(file);
  });
}

/** One of the given names. */
function oneOf(value, names, fallback) {
  return names.includes(value) ? value : fallback;
}

module.exports = { listQuery, oneOf, pathList, uid, uidList };
