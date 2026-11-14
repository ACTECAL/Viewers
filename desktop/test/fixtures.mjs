// Synthetic DICOM data for the tests, with no patient data: CT series of a water phantom with a bright sphere,
// DICOMDIR discs, and ZIP files (zipBytes in JavaScript for the unit tests; makeTestData uses Python 3 and zip,
// as other programs write them).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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

/**
 * A series of `slices` 64 × 64 images in dir; name(i) gives each file's path under dir. Pass studyUID to add a
 * series to a study, and the patient and study fields to tell studies apart.
 */
export function writeSeries(
  dir,
  {
    slices = 24,
    description = 'Axial 5 mm',
    studyDescription = 'Synthetic CT phantom',
    name = (i) => `CT${String(i + 1).padStart(3, '0')}`,
    studyUID = uid(),
    patientName = 'Phantom^Test',
    patientID = 'PHANTOM-001',
    studyDate = '20261113',
    accessionNumber = 'ACC001',
    modality = 'CT',
    seriesNumber = 1,
  } = {}
) {
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
      PatientName: [{ Alphabetic: patientName }],
      PatientID: patientID,
      PatientBirthDate: '19800101',
      PatientSex: 'O',
      StudyDate: studyDate,
      StudyTime: '120000',
      StudyDescription: studyDescription,
      SeriesDescription: description,
      AccessionNumber: accessionNumber,
      StudyID: '1',
      Modality: modality,
      SeriesNumber: seriesNumber,
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

const u64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};
// The ZIP64 extra field (0x0001) with these 64-bit values.
const zip64Extra = (values) => {
  const head = Buffer.alloc(4);
  head.writeUInt16LE(1, 0);
  head.writeUInt16LE(values.length * 8, 2);
  return Buffer.concat([head, ...values.map(u64)]);
};

/**
 * The bytes of a ZIP file. entries: [{ name, data, method, encrypted }]; method 8 (the default) deflates, 0 stores,
 * and any other value is written stored but marked with that method. encrypted only sets the flag. zip64 writes
 * every size and offset in ZIP64 fields, as large archives have them.
 */
export function zipBytes(entries, { zip64 = false, comment = '' } = {}) {
  const parts = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data = Buffer.alloc(0), method = 8, encrypted = false } of entries) {
    const raw = Buffer.from(data);
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(raw);
    const flags = (encrypted ? 1 : 0) | 0x0800;
    const version = zip64 ? 45 : 20;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(version, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(zip64 ? 0xffffffff : body.length, 18);
    local.writeUInt32LE(zip64 ? 0xffffffff : raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const localExtra = zip64 ? zip64Extra([raw.length, body.length]) : Buffer.alloc(0);
    local.writeUInt16LE(localExtra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(version, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(zip64 ? 0xffffffff : body.length, 20);
    central.writeUInt32LE(zip64 ? 0xffffffff : raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    const centralExtra = zip64 ? zip64Extra([raw.length, body.length, offset]) : Buffer.alloc(0);
    central.writeUInt16LE(centralExtra.length, 30);
    central.writeUInt32LE(zip64 ? 0xffffffff : offset, 42);
    centrals.push(central, nameBytes, centralExtra);
    parts.push(local, nameBytes, localExtra, body);
    offset += local.length + nameBytes.length + localExtra.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const count = entries.length;
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(directory, record, locator);
  } else {
    parts.push(directory);
  }
  const commentBytes = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : count, 8);
  end.writeUInt16LE(zip64 ? 0xffff : count, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : directory.length, 12);
  end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  return Buffer.concat([...parts, end, commentBytes]);
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
