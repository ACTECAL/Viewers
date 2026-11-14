// How the library page writes names, dates, sizes and counts, and its date filters.
import { utils } from '@ohif/core';

export const count = (n, one, many) => `${Number(n || 0).toLocaleString()} ${n === 1 ? one : many}`;

/** A DICOM person name as the viewer shows it: "Family, Given Middle". */
export const formatName = value => utils.formatPN(String(value || '')) || '';

const DAY = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "5 Jan 2026" (in the user's language) from a DICOM date (YYYYMMDD), or ''. */
export function formatDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? '' : DAY.format(date);
}

/** "14:05" from a DICOM time (HHMMSS.FFFFFF), or ''. */
export function formatTime(value) {
  const match = /^(\d{2})(\d{2})/.exec(String(value || ''));
  return match ? `${match[1]}:${match[2]}` : '';
}

/** The day an ISO timestamp falls on, in the user's language and time zone. */
export function formatDay(iso) {
  const date = new Date(iso || '');
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "1.4 GB" */
export function formatBytes(bytes) {
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

const SEX = { M: 'Male', F: 'Female', O: 'Other' };
export const formatSex = value => SEX[String(value || '').toUpperCase()] || '';

/** "45 years" from a DICOM age string (045Y, 006M, 010W, 003D). */
export function formatAge(value) {
  const match = /^(\d{3})([DWMY])$/.exec(String(value || '').trim());
  if (!match) return '';
  const n = Number(match[1]);
  const unit = {
    D: ['day', 'days'],
    W: ['week', 'weeks'],
    M: ['month', 'months'],
    Y: ['year', 'years'],
  }[match[2]];
  return `${n} ${n === 1 ? unit[0] : unit[1]}`;
}

/** What the file manager is called on this system, for "Show in …" buttons. */
export function fileManager(platform) {
  if (platform === 'darwin') return 'Finder';
  if (platform === 'win32') return 'File Explorer';
  return 'Files';
}

// The study date filter: the label, and the first day it includes (days back from today, 0 = today).
export const DATE_RANGES = [
  { id: 'any', label: 'Any date' },
  { id: 'today', label: 'Today', days: 0 },
  { id: 'week', label: 'Last 7 days', days: 6 },
  { id: 'month', label: 'Last 30 days', days: 29 },
  { id: 'year', label: 'Last 12 months', days: 364 },
];

const dicomDate = date =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

/** { from, to } (YYYYMMDD, or '') for a date filter, counted from `today`. */
export function rangeDates(id, today = new Date()) {
  const range = DATE_RANGES.find(entry => entry.id === id);
  if (!range || range.days === undefined) return { from: '', to: '' };
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - range.days);
  return { from: dicomDate(start), to: dicomDate(today) };
}

/** How a study is named in labels and messages: "Sharma, Asha · CT Chest · 5 Jan 2026". */
export function studyTitle(study) {
  return [
    formatName(study.patientName) || 'Unnamed patient',
    study.studyDescription,
    formatDate(study.studyDate),
  ]
    .filter(Boolean)
    .join(' · ');
}
