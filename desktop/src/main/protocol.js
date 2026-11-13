'use strict';
// The app:// protocol of Spectra Desktop (registered in index.js). It serves:
// - the viewer in app/viewer (inside app.asar when packaged) at app://spectra/, the way CloudFront serves the web
//   edition (../../infra/cloudfront-offline-rewrite.js): a path without a file extension is a viewer route and
//   gets index.html;
// - the files found in what the user opened (scan.js) at app://spectra/__open/<token>, with byte ranges, so that
//   ZIP files are read in parts. Only files given a token can be read; nothing else on the disk is reachable.
// No Electron import, so test/protocol.test.mjs runs it in Node.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { APP_HOST, OPEN_PREFIX } = require('./urls');

// The policy recommended for the web edition, plus media from blob: for DICOM video. The page can load and send
// nothing outside the app.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

const contentType = (file) => TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

/** The file under root for a request path, or null when the path would leave root. */
function resolveViewerPath(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(pathname || '/'));
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const last = decoded.split('/').pop();
  const relative = last.includes('.') ? decoded.replace(/^\/+/, '') : 'index.html';
  const base = path.resolve(root);
  const file = path.resolve(base, relative);
  return file.startsWith(base + path.sep) ? file : null;
}

/** A single "bytes=" range of a file of `size` bytes: { start, end } (inclusive), null when absent, or 'invalid'. */
function parseRange(header, size) {
  if (header === null || header === undefined || header === '') return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!suffix) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}

/** The files the page may read: one batch at a time, each under a random token. */
class OpenedFiles {
  constructor() {
    this.files = new Map();
  }

  /** Forgets the previous batch and gives each of these files an address, in order: [{ url, name }]. */
  replace(paths) {
    this.files = new Map();
    return paths.map((file) => {
      const token = crypto.randomBytes(16).toString('hex');
      this.files.set(token, file);
      return { url: `app://${APP_HOST}${OPEN_PREFIX}${token}`, name: path.basename(file) };
    });
  }

  get(token) {
    return /^[0-9a-f]{32}$/.test(String(token)) ? this.files.get(token) : undefined;
  }
}

const text = (status, message, headers = {}) =>
  new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } });

const read = (file, range) => Readable.toWeb(fs.createReadStream(file, range ? { start: range.start, end: range.end } : {}));

async function serveOpened(file, rangeHeader) {
  if (!file) return text(404, 'Not found');
  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return text(404, 'Not found');
  }
  if (!stat.isFile()) return text(404, 'Not found');
  const headers = {
    'content-type': 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  const range = parseRange(rangeHeader, stat.size);
  if (range === 'invalid') return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${stat.size}` } });
  if (range) {
    return new Response(read(file, range), {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${range.start}-${range.end}/${stat.size}`, 'content-length': String(range.end - range.start + 1) },
    });
  }
  return new Response(stat.size ? read(file) : null, { status: 200, headers: { ...headers, 'content-length': String(stat.size) } });
}

/** The handler for protocol.handle('app', …). `opened` is an OpenedFiles. */
function createHandler({ root, opened }) {
  return async function handle(request) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return text(400, 'Bad request');
    }
    if (url.host !== APP_HOST) return text(404, 'Not found');
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed');
    if (url.pathname.startsWith(OPEN_PREFIX)) {
      return serveOpened(opened.get(url.pathname.slice(OPEN_PREFIX.length)), request.headers.get('range'));
    }
    const file = resolveViewerPath(root, url.pathname);
    if (!file) return text(404, 'Not found');
    let body;
    try {
      body = await fs.promises.readFile(file);
    } catch {
      return text(404, 'Not found');
    }
    return new Response(request.method === 'HEAD' ? null : body, {
      status: 200,
      headers: {
        'content-type': contentType(file),
        'content-security-policy': CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-cache',
      },
    });
  };
}

module.exports = { CSP, OpenedFiles, contentType, createHandler, parseRange, resolveViewerPath };
