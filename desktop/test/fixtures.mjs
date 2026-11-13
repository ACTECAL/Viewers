// Synthetic DICOM data for the tests, with no patient data: CT series of a water phantom with a bright sphere,
// DICOMDIR discs, and ZIP files (makeTestData needs Python 3 and zip for those).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dcmjs = require('dcmjs');
const { DicomDict, DicomMetaDictionary } = dcmjs.data;

const CT_IMAGE = '1.2.840.10008.5.1.4.1.1.2';
const EXPLICIT_LE = '1.2.840.10008.1.2.1';
export const uid = () => DicomMetaDictionary.uid();

function part10(meta, dataset) {
  const dict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dict.dict = dataset;
  return Buffer.from(dict.write());
}

/** A CT series of `slices` 64 × 64 images in dir; name(i) gives each file's path under dir. */
export function writeSeries(dir, { slices = 24, description = 'Axial 5 mm', studyDescription = 'Synthetic CT phantom', name = (i) => `CT${String(i + 1).padStart(3, '0')}` } = {}) {
  const studyUID = uid();
  const seriesUID = uid();
  const frameUID = uid();
  const files = [];
  for (let z = 0; z < slices; z += 1) {
    // Stored value = HU + 1024: air outside a body disc, water inside it, and a bright sphere in the middle.
    const pixels = new Int16Array(64 * 64);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const body = (x - 32) ** 2 + (y - 32) ** 2 < 28 ** 2;
        const sphere = (x - 32) ** 2 + (y - 32) ** 2 + ((z - slices / 2) * 2.5) ** 2 < 14 ** 2;
        pixels[y * 64 + x] = sphere ? 1424 : body ? 1024 : 0;
      }
    }
    const sopUID = uid();
    const dataset = DicomMetaDictionary.denaturalizeDataset({
      SOPClassUID: CT_IMAGE,
      SOPInstanceUID: sopUID,
      StudyInstanceUID: studyUID,
      SeriesInstanceUID: seriesUID,
      FrameOfReferenceUID: frameUID,
      PatientName: [{ Alphabetic: 'Phantom^Test' }],
      PatientID: 'PHANTOM-001',
      PatientBirthDate: '19800101',
      PatientSex: 'O',
      StudyDate: '20261113',
      StudyTime: '120000',
      StudyDescription: studyDescription,
      SeriesDescription: description,
      AccessionNumber: 'ACC001',
      StudyID: '1',
      Modality: 'CT',
      SeriesNumber: 1,
      InstanceNumber: z + 1,
      ImagePositionPatient: [-32, -32, z * 5],
      ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
      PixelSpacing: [1, 1],
      SliceThickness: 5,
      SliceLocation: z * 5,
      Rows: 64,
      Columns: 64,
      SamplesPerPixel: 1,
      PhotometricInterpretation: 'MONOCHROME2',
      BitsAllocated: 16,
      BitsStored: 16,
      HighBit: 15,
      PixelRepresentation: 1,
      RescaleIntercept: -1024,
      RescaleSlope: 1,
      WindowCenter: 40,
      WindowWidth: 400,
      PixelData: [pixels.buffer],
      _vrMap: { PixelData: 'OW' },
    });
    const meta = {
      FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
      MediaStorageSOPClassUID: CT_IMAGE,
      MediaStorageSOPInstanceUID: sopUID,
      TransferSyntaxUID: EXPLICIT_LE,
      ImplementationClassUID: '2.25.1234567890',
      ImplementationVersionName: 'ACTECAL-TEST',
    };
    const file = path.join(dir, name(z));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, part10(meta, dataset));
    files.push({ file, sopUID });
  }
  return { dir, studyUID, seriesUID, files };
}

/**
 * A DICOMDIR in root for these series, with PATIENT, STUDY, SERIES and IMAGE records as disc burners write them.
 * fileId(file) gives each image's ReferencedFileID (default: its path under root in upper case). `extra` adds
 * IMAGE records for files that do not exist. Offsets are 0; readers find the files by ReferencedFileID.
 */
export function writeDicomdir(root, seriesList, { fileId = (file) => path.relative(root, file).split(path.sep).map((part) => part.toUpperCase()), extra = [] } = {}) {
  const UL = (value) => ({ vr: 'UL', Value: [value] });
  const CS = (...values) => ({ vr: 'CS', Value: values });
  const UI = (value) => ({ vr: 'UI', Value: [value] });
  const record = (type, fields) => ({ '00041400': UL(0), '00041410': { vr: 'US', Value: [0xffff] }, '00041420': UL(0), '00041430': CS(type), ...fields });
  const image = (parts, sopUID) => record('IMAGE', { '00041500': CS(...parts), '00041510': UI(CT_IMAGE), '00041511': UI(sopUID), '00041512': UI(EXPLICIT_LE) });
  const records = [record('PATIENT', { '00100020': { vr: 'LO', Value: ['PHANTOM-001'] } })];
  for (const series of seriesList) {
    records.push(record('STUDY', { '0020000D': UI(series.studyUID), '00080020': { vr: 'DA', Value: ['20261113'] } }));
    records.push(record('SERIES', { '0020000E': UI(series.seriesUID), '00080060': CS('CT') }));
    for (const { file, sopUID } of series.files) records.push(image(fileId(file), sopUID));
  }
  for (const parts of extra) records.push(image(parts, uid()));
  const dataset = {
    '00041130': CS('SPECTRATEST'),
    '00041200': UL(0),
    '00041202': UL(0),
    '00041212': { vr: 'US', Value: [0] },
    '00041220': { vr: 'SQ', Value: records },
  };
  const meta = {
    FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
    MediaStorageSOPClassUID: '1.2.840.10008.1.3.10',
    MediaStorageSOPInstanceUID: uid(),
    TransferSyntaxUID: EXPLICIT_LE,
    ImplementationClassUID: '2.25.1234567890',
    ImplementationVersionName: 'ACTECAL-TEST',
  };
  const file = path.join(root, 'DICOMDIR');
  fs.writeFileSync(file, part10(meta, dataset));
  return file;
}

const ZIPS = `
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
names = sorted(os.listdir(src))
with zipfile.ZipFile(os.path.join(out, 'stored.zip'), 'w', zipfile.ZIP_STORED) as z:
    for n in names: z.write(os.path.join(src, n), 'Study/CT/' + n)
    z.writestr('__MACOSX/Study/CT/._CT001', b'mac resource fork')
    z.writestr('Study/DICOMDIR', b'not used')
    z.writestr('Study/.DS_Store', b'finder')
with zipfile.ZipFile(os.path.join(out, 'deflate.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for n in names: z.write(os.path.join(src, n), n)
zipfile.ZIP64_LIMIT = 0
with zipfile.ZipFile(os.path.join(out, 'zip64.zip'), 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as z:
    for n in names: z.write(os.path.join(src, n), n)
`;

/** Everything the end-to-end checks open, under root. */
export function makeTestData(root) {
  const ct = writeSeries(path.join(root, 'ct'));
  const second = writeSeries(path.join(root, 'second'), { slices: 8, description: 'Second series', studyDescription: 'Second phantom' });
  // A disc: a DICOMDIR listing one series, a series it does not list, and the files discs carry besides.
  const discDir = path.join(root, 'disc');
  const disc = writeSeries(path.join(discDir, 'DICOM', 'S0000001'), { slices: 12, description: 'Disc series', name: (i) => `I${String(i + 1).padStart(7, '0')}` });
  const unlisted = writeSeries(path.join(discDir, 'DICOM', 'EXTRA'), { slices: 1, description: 'Not in the DICOMDIR', name: () => 'I0000099' });
  writeDicomdir(discDir, [disc]);
  fs.writeFileSync(path.join(discDir, 'AUTORUN.INF'), '[autorun]\r\nopen=VIEWER\\VIEWER.EXE\r\n');
  fs.mkdirSync(path.join(discDir, 'VIEWER'));
  fs.writeFileSync(path.join(discDir, 'VIEWER', 'VIEWER.EXE'), crypto.randomBytes(4096));
  fs.writeFileSync(path.join(discDir, 'README.TXT'), 'Synthetic test disc.\r\n');
  disc.dir = discDir;
  disc.unlistedStudyUID = unlisted.studyUID;
  const notes = path.join(root, 'notes.txt');
  fs.writeFileSync(notes, 'Not a DICOM file.\n'.repeat(20));
  const noDicom = path.join(root, 'no-dicom');
  fs.mkdirSync(noDicom);
  fs.writeFileSync(path.join(noDicom, 'readme.txt'), 'Nothing to see.\n');
  const zipDir = path.join(root, 'zips');
  fs.mkdirSync(zipDir);
  execFileSync('python3', ['-c', ZIPS, ct.dir, zipDir]);
  const encrypted = path.join(zipDir, 'encrypted.zip');
  execFileSync('zip', ['-q', '-j', '-P', 'secret', encrypted, ...ct.files.map((entry) => entry.file)]);
  const zips = { stored: path.join(zipDir, 'stored.zip'), deflate: path.join(zipDir, 'deflate.zip'), zip64: path.join(zipDir, 'zip64.zip'), encrypted };
  return { root, ct, second, disc, notes, noDicom, zips };
}
