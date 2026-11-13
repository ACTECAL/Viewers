// Spectra Desktop (desktop/ in this repository, an Electron app) gives this page window.spectraDesktop through
// its preload script: the app's file, folder and drive pickers, and the files the operating system asked it to
// open. The app finds the DICOM files (desktop/src/main/scan.js) and gives this page their addresses
// (app://spectra/__open/…). In a browser the bridge is absent and the page is the web edition.
import { collectFiles } from './loadDicomFiles';

const OPEN_URL = /^app:\/\/spectra\/__open\/[0-9a-f]{32}$/;

/** The bridge in Spectra Desktop, or null in a browser. */
export function getDesktop() {
  const bridge = typeof window === 'undefined' ? null : window.spectraDesktop;
  return bridge && bridge.edition === 'desktop' ? bridge : null;
}

// Part of a RangeFile: fetched with a byte range when it is read.
class RangeSlice {
  constructor(file, start, end) {
    this.file = file;
    this.start = start;
    this.end = end;
    this.size = Math.max(0, end - start);
  }

  async response() {
    const response = await fetch(this.file.url, { headers: { Range: `bytes=${this.start}-${this.end - 1}` } });
    if (response.status !== 206) throw new Error(`Range request failed (${response.status})`);
    return response;
  }

  async arrayBuffer() {
    return this.size ? (await this.response()).arrayBuffer() : new ArrayBuffer(0);
  }

  async blob() {
    return this.size ? (await this.response()).blob() : new Blob([]);
  }

  stream() {
    if (!this.size) return new Blob([]).stream();
    const { readable, writable } = new TransformStream();
    this.response()
      .then(response => response.body.pipeTo(writable), error => writable.abort(error))
      .catch(() => {});
    return readable;
  }
}

// A ZIP file in Spectra Desktop, read in parts, so that a large archive is never held in memory whole. It has the
// parts of File that unzip.js uses: name, type, size and slice().
class RangeFile {
  constructor(url, name, size) {
    this.url = url;
    this.name = name;
    this.size = size;
    this.type = 'application/zip';
  }

  slice(start = 0, end = this.size) {
    const from = Math.min(Math.max(0, start), this.size);
    return new RangeSlice(this, from, Math.min(Math.max(from, end), this.size));
  }
}

/** Items for loadItems() from what the app found: DICOM files by address, and the entries of each ZIP file. */
export async function itemsFromScan(scan) {
  const valid = entry => entry && typeof entry.url === 'string' && OPEN_URL.test(entry.url);
  const zips = (scan.zips || [])
    .filter(valid)
    .map(entry => new RangeFile(entry.url, String(entry.name || 'archive.zip'), Number(entry.size) || 0));
  const { items, problems } = await collectFiles(zips);
  const files = (scan.files || []).filter(valid).map(entry => ({ url: entry.url, name: String(entry.name || 'file') }));
  return { items: [...files, ...items], problems };
}
