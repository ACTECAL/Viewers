// Loads DICOM files (and the DICOM files inside ZIPs) from the visitor's device into the in-memory
// dicomlocal data source, the same way the upstream Local route does (platform/app/src/routes/Local),
// but with ZIP support, a magic-number check, limited concurrency, progress, and only this batch's studies.
import dcmjs from 'dcmjs';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { DicomMetadataStore } from '@ohif/core';
import { entryToFile, isZip, readZipEntries, zipSupported } from './unzip';

const CONCURRENCY = 6;

// Not images: macOS metadata, hidden files, the DICOMDIR index and Windows thumbnails.
function skipPath(path) {
  const parts = String(path || '').split('/');
  const base = parts[parts.length - 1];
  return parts.includes('__MACOSX') || base.startsWith('.') || /^dicomdir$/i.test(base) || /^thumbs\.db$/i.test(base);
}

// DICOM Part 10 files carry "DICM" after a 128-byte preamble.
async function isDicom(file) {
  if (file.size < 132) return false;
  const magic = new Uint8Array(await file.slice(128, 132).arrayBuffer());
  return magic[0] === 0x44 && magic[1] === 0x49 && magic[2] === 0x43 && magic[3] === 0x4d;
}

/**
 * Expands ZIPs into lazily extracted entries. Returns { items, problems } where problems counts
 * password-protected entries, unsupported compression, unreadable ZIPs and ZIPs this browser cannot open.
 */
export async function collectFiles(inputFiles) {
  const items = [];
  const problems = { encrypted: 0, method: 0, badZip: 0, noZipSupport: 0 };
  for (const file of inputFiles) {
    if (isZip(file)) {
      if (!zipSupported()) {
        problems.noZipSupport += 1;
        continue;
      }
      let entries;
      try {
        entries = await readZipEntries(file);
      } catch {
        problems.badZip += 1;
        continue;
      }
      for (const entry of entries) {
        if (entry.directory || skipPath(entry.name)) continue;
        if (entry.encrypted) problems.encrypted += 1;
        else if (entry.method !== 0 && entry.method !== 8) problems.method += 1;
        else items.push({ zip: file, entry });
      }
    } else if (!skipPath(file.webkitRelativePath || file.path || file.name)) {
      items.push({ file });
    }
  }
  return { items, problems };
}

async function loadOne(item) {
  const file = item.file || (await entryToFile(item.zip, item.entry));
  if (!(await isDicom(file))) return null;
  const imageId = dicomImageLoader.wadouri.fileManager.add(file);
  const buffer = await dicomImageLoader.wadouri.loadFileRequest(imageId);
  const dicomData = dcmjs.data.DicomMessage.readFile(buffer);
  const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict);
  dataset.url = imageId;
  dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(dicomData.meta);
  dataset.AvailableTransferSyntaxUID =
    dataset.AvailableTransferSyntaxUID || dataset._meta.TransferSyntaxUID?.Value?.[0];
  DicomMetadataStore.addInstance(dataset);
  return dataset.StudyInstanceUID || null;
}

/** Loads the items; onProgress(done, total). Returns { studies, loaded, skipped }. */
export async function loadItems(items, onProgress) {
  const studies = new Set();
  let next = 0;
  let done = 0;
  let loaded = 0;
  let skipped = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      try {
        const studyUid = await loadOne(item);
        if (studyUid) {
          studies.add(studyUid);
          loaded += 1;
        } else {
          skipped += 1;
        }
      } catch {
        skipped += 1;
      }
      done += 1;
      onProgress?.(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return { studies: [...studies], loaded, skipped };
}
