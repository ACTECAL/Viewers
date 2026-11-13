import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import protocol from '../src/main/protocol.js';

const { CSP, OpenedFiles, contentType, createHandler, parseRange, resolveViewerPath } = protocol;

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-protocol-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// What the handler reads from a request: its address, method and headers.
const request = (url, { method = 'GET', headers = {} } = {}) => ({ url, method, headers: new Headers(headers) });

test('viewer routes get index.html, files their own path, and nothing outside the viewer folder', () => {
  const root = path.resolve('/srv/viewer');
  assert.equal(resolveViewerPath(root, '/'), path.join(root, 'index.html'));
  assert.equal(resolveViewerPath(root, '/viewer/dicomlocal'), path.join(root, 'index.html'));
  assert.equal(resolveViewerPath(root, '/notfoundstudy'), path.join(root, 'index.html'));
  assert.equal(resolveViewerPath(root, '/app.bundle.123.js'), path.join(root, 'app.bundle.123.js'));
  assert.equal(resolveViewerPath(root, '/assets/fonts/x%20y.woff2'), path.join(root, 'assets', 'fonts', 'x y.woff2'));
  assert.equal(resolveViewerPath(root, '/../secret.js'), null);
  assert.equal(resolveViewerPath(root, '/%2e%2e/%2e%2e/etc/hosts.txt'), null);
  assert.equal(resolveViewerPath(root, '/a%00.js'), null);
  assert.equal(resolveViewerPath(root, '/%E0%A4%A.js'), null);
});

test('content types', () => {
  assert.equal(contentType('a/app.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentType('a/codec.WASM'), 'application/wasm');
  assert.equal(contentType('index.html'), 'text/html; charset=utf-8');
  assert.equal(contentType('data.bin'), 'application/octet-stream');
});

test('byte ranges', () => {
  assert.equal(parseRange(null, 100), null);
  assert.equal(parseRange('', 100), null);
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=95-200', 100), { start: 95, end: 99 });
  for (const header of ['bytes=100-', 'bytes=5-1', 'items=0-1', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'bytes=x-1']) {
    assert.equal(parseRange(header, 100), 'invalid', header);
  }
  assert.equal(parseRange('bytes=0-0', 0), 'invalid');
});

test('opened files: one batch at a time, each under its own random token', () => {
  const opened = new OpenedFiles();
  const [first] = opened.replace(['/data/ct/IM1']);
  assert.match(first.url, /^app:\/\/spectra\/__open\/[0-9a-f]{32}$/);
  assert.equal(first.name, 'IM1');
  const token = first.url.split('/').pop();
  assert.equal(opened.get(token), '/data/ct/IM1');
  const [second] = opened.replace(['/data/ct/IM2']);
  assert.notEqual(second.url, first.url);
  assert.equal(opened.get(token), undefined);
  assert.equal(opened.get('../../etc/passwd'), undefined);
});

test('the handler serves the viewer with its policy, and opened files in full or by range', async (t) => {
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>x</title>');
  fs.writeFileSync(path.join(root, 'app.js'), 'console.log(1)');
  const data = path.join(temp(t), 'IM1');
  fs.writeFileSync(data, Buffer.from('0123456789'));
  const opened = new OpenedFiles();
  const [entry] = opened.replace([data]);
  const handle = createHandler({ root, opened });

  const home = await handle(request('app://spectra/'));
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(home.headers.get('content-security-policy'), CSP);
  assert.match(await home.text(), /<title>x<\/title>/);
  assert.equal((await handle(request('app://spectra/viewer/dicomlocal?StudyInstanceUIDs=1'))).status, 200);
  const script = await handle(request('app://spectra/app.js'));
  assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await handle(request('app://spectra/missing.js'))).status, 404);
  assert.equal((await handle(request('app://elsewhere/'))).status, 404);
  assert.equal((await handle(request('app://spectra/', { method: 'POST' }))).status, 405);

  const whole = await handle(request(entry.url));
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-length'), '10');
  assert.equal(await whole.text(), '0123456789');
  const part = await handle(request(entry.url, { headers: { range: 'bytes=2-5' } }));
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await part.text(), '2345');
  const tail = await handle(request(entry.url, { headers: { range: 'bytes=-3' } }));
  assert.equal(await tail.text(), '789');
  const beyond = await handle(request(entry.url, { headers: { range: 'bytes=20-' } }));
  assert.equal(beyond.status, 416);
  assert.equal(beyond.headers.get('content-range'), 'bytes */10');
  assert.equal((await handle(request('app://spectra/__open/0123456789abcdef0123456789abcdef'))).status, 404);
  fs.rmSync(data);
  assert.equal((await handle(request(entry.url))).status, 404);
});
