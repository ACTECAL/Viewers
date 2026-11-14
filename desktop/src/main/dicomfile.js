'use strict';
// What the library needs from a DICOM file: the patient, study, series and instance attributes from its header
// (DICOM PS3.10), read without decoding the pixel data. No Electron import; test/library.test.mjs.
const crypto = require('node:crypto');
const dcmjs = require('dcmjs');

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;
const PIXEL_DATA = '7FE00010';
// dcmjs logs a warning with a stack trace for every header that is cut short, which the library reads on purpose
// (only the start of large files). The values read before the cut are kept.
dcmjs.log.setLevel('error');

/** Whether the bytes start like a DICOM PS3.10 file: a 128-byte preamble, then "DICM". */
const isPart10 = (buffer) => buffer.length >= 132 && buffer.toString('latin1', 128, 132) === 'DICM';

// One trimmed string: the first of several values, and the alphabetic form of a person's name.
function text(value, max = 256) {
  let first = Array.isArray(value) ? value[0] : value;
  if (first && typeof first === 'object') first = first.Alphabetic === undefined ? '' : first.Alphabetic;
  if (first === undefined || first === null) return '';
  return String(first).replace(/\0/g, '').trim().slice(0, max);
}

function integer(value) {
  const number = Number.parseInt(text(value, 32), 10);
  return Number.isFinite(number) ? number : null;
}

// UIDs are kept as given (some systems write letters), but must be printable and of a sensible length.
function uid(value) {
  const result = text(value, 128);
  return /^[\x21-\x7e]{1,128}$/.test(result) ? result : '';
}

/**
 * The library's record for a DICOM file, or null when the bytes are not a DICOM file of a study (no study, series
 * or instance UID). `bytes` may be only the start of the file: reading stops at the pixel data.
 */
function readHeader(bytes) {
  if (!isPart10(bytes)) return null;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let message;
  try {
    message = DicomMessage.readFile(buffer, { untilTag: PIXEL_DATA, includeUntilTagValue: false, ignoreErrors: true });
  } catch {
    return null;
  }
  let meta;
  let data;
  try {
    meta = DicomMetaDictionary.naturalizeDataset(message.meta || {});
    data = DicomMetaDictionary.naturalizeDataset(message.dict || {});
  } catch {
    return null;
  }
  const record = {
    studyUID: uid(data.StudyInstanceUID),
    seriesUID: uid(data.SeriesInstanceUID),
    sopUID: uid(data.SOPInstanceUID) || uid(meta.MediaStorageSOPInstanceUID),
    sopClassUID: uid(data.SOPClassUID) || uid(meta.MediaStorageSOPClassUID),
    transferSyntaxUID: uid(meta.TransferSyntaxUID),
    patientName: text(data.PatientName),
    patientID: text(data.PatientID, 64),
    patientBirthDate: text(data.PatientBirthDate, 16),
    patientSex: text(data.PatientSex, 16),
    patientAge: text(data.PatientAge, 16),
    studyDate: text(data.StudyDate, 16),
    studyTime: text(data.StudyTime, 32),
    studyDescription: text(data.StudyDescription),
    accessionNumber: text(data.AccessionNumber, 64),
    referringPhysician: text(data.ReferringPhysicianName),
    institution: text(data.InstitutionName),
    modality: text(data.Modality, 16).toUpperCase(),
    seriesNumber: integer(data.SeriesNumber),
    seriesDescription: text(data.SeriesDescription),
    bodyPart: text(data.BodyPartExamined, 64),
    instanceNumber: integer(data.InstanceNumber),
    frames: integer(data.NumberOfFrames) || 1,
  };
  return record.studyUID && record.seriesUID && record.sopUID ? record : null;
}

/** A short name for a UID, for folders and files: fixed length, so paths stay within Windows limits. */
const key = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 20);

module.exports = { isPart10, key, readHeader };
