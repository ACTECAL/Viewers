'use strict';
// The native dialogs of the library (shown by index.js with dialog.showMessageBox): the notice before the first
// import, the confirmations before deleting studies and before using or moving a library folder, and what choosing
// a new library folder does (libraryPlan). No Electron import; test/main.test.mjs checks them.
const fs = require('node:fs');
const path = require('node:path');
const { DATABASE } = require('./library');

const LIBRARY_FOLDER = 'Spectra Library';

const count = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en')} ${n === 1 ? one : many}`;

/** "1.4 GB" */
function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1000) return `${value} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1000;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit += 1;
  }
  return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

/** A DICOM person name for people: "Family, Given Middle", as the viewer shows it. */
function formatName(value) {
  const name = String(value || '').trim();
  if (!name) return '';
  return name.replace('^', ', ').replace(/\^/g, ' ').replace(/\s+/g, ' ').replace(/,\s*$/, '').trim();
}

/** "13 Nov 2026" from a DICOM date (YYYYMMDD), or ''. */
function formatDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : '';
}

const MESSAGE = { noLink: true, normalizeAccessKeys: false };

/** Before the first import: where the copies go, and that they hold personal health information. */
function importNotice(root) {
  return {
    ...MESSAGE,
    type: 'info',
    title: 'Import into the library',
    message: 'Imported studies are copied into the library on this computer.',
    detail:
      `They stay in ${root} until you delete them, so they open again without the disc or the original files.\n\n` +
      'Studies hold personal health information. Anyone who can sign in to this computer account can open them, so delete the ones you no longer need.',
    buttons: ['Import', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: "Don't show this again",
    checkboxChecked: false,
  };
}

/** Before deleting studies (records from Library.study()). */
function deleteConfirmation(studies) {
  const first = studies[0] || {};
  const what = [formatName(first.patientName), first.studyDescription, formatDate(first.studyDate)].filter(Boolean).join(', ');
  return {
    ...MESSAGE,
    type: 'warning',
    title: 'Delete from the library',
    message: studies.length === 1 ? 'Delete this study from the library?' : `Delete ${count(studies.length, 'study', 'studies')} from the library?`,
    detail:
      `${studies.length === 1 && what ? `${what}\n\n` : ''}` +
      'The copies in the library are deleted from this computer. Original files, discs and ZIP files are not changed.',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  };
}

const isEmptyFolder = (folder) => !fs.existsSync(folder) || fs.readdirSync(folder).every((name) => name.startsWith('.'));
const samePath = (a, b) => Boolean(a && b) && path.relative(path.resolve(a), path.resolve(b)) === '';

/**
 * What choosing `chosen` as the library folder does, given the current library folder and how many studies it
 * holds: { action, target }.
 * - 'same': it is the current folder.
 * - 'use': it holds a library (or its "Spectra Library" folder does), which replaces the current one.
 * - 'move': the current library's studies move there.
 * - 'new': the current library is empty (or unavailable), so an empty library starts there.
 * - 'refuse' with a reason: the folder cannot take the library.
 * target is the chosen folder when it is empty, otherwise a "Spectra Library" folder inside it.
 */
function libraryPlan({ chosen, current, studies }) {
  const folder = path.resolve(chosen);
  if (samePath(folder, current)) return { action: 'same', target: folder };
  const inside = path.join(folder, LIBRARY_FOLDER);
  for (const candidate of [folder, inside]) {
    if (fs.existsSync(path.join(candidate, DATABASE))) return samePath(candidate, current) ? { action: 'same', target: candidate } : { action: 'use', target: candidate };
  }
  let target = folder;
  if (!isEmptyFolder(folder)) {
    if (!isEmptyFolder(inside)) return { action: 'refuse', reason: `The folder ${inside} already holds other files. Choose an empty folder.` };
    target = inside;
  }
  if (current) {
    const relative = path.relative(path.resolve(current), target);
    const back = path.relative(target, path.resolve(current));
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) return { action: 'refuse', reason: 'The library cannot move into a folder inside itself.' };
    if (!back.startsWith('..') && !path.isAbsolute(back)) return { action: 'refuse', reason: 'Choose a folder outside the library.' };
  }
  return { action: studies > 0 ? 'move' : 'new', target };
}

/** Before moving the library: how much is copied, and where. */
function moveConfirmation({ target, current, studies, bytes }) {
  return {
    ...MESSAGE,
    type: 'question',
    title: 'Move the library',
    message: `Move the library to ${target}?`,
    detail: `${count(studies, 'study', 'studies')} (${formatBytes(bytes)}) are copied there, then removed from ${current}. Keep Spectra Desktop open until it finishes.`,
    buttons: ['Move', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  };
}

/** Before using a library that is already in the chosen folder. */
function useConfirmation({ target, current }) {
  return {
    ...MESSAGE,
    type: 'question',
    title: 'Use this library',
    message: `Use the library in ${target}?`,
    detail: current
      ? `The library in ${current} stays where it is. Choose its folder again to go back to it.`
      : 'Spectra Desktop will list the studies in that library.',
    buttons: ['Use This Library', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  };
}

function problemMessage(title, message) {
  return { ...MESSAGE, type: 'warning', title, message, buttons: ['OK'], defaultId: 0 };
}

module.exports = {
  LIBRARY_FOLDER,
  deleteConfirmation,
  formatBytes,
  formatDate,
  formatName,
  importNotice,
  libraryPlan,
  moveConfirmation,
  problemMessage,
  samePath,
  useConfirmation,
};
