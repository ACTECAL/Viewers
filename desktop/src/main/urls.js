'use strict';
// Addresses in Spectra Desktop. The app is served at app://spectra/ (protocol.js); https links open in the
// system browser; nothing else is opened. No Electron import, so test/main.test.mjs runs it in Node.
const APP_HOST = 'spectra';
const HOME_URL = 'app://spectra/';
// Files found in what the user opened are served under this path (protocol.js, OpenedFiles).
const OPEN_PREFIX = '/__open/';

function parse(value) {
  try {
    return new URL(String(value));
  } catch {
    return null;
  }
}

/** Whether the address belongs to the app (app://spectra/…). */
function isAppUrl(value) {
  const url = parse(value);
  return Boolean(url) && url.protocol === 'app:' && url.host === APP_HOST;
}

/** Whether the address may open in the system browser: https only. */
function isExternalLink(value) {
  const url = parse(value);
  return Boolean(url) && url.protocol === 'https:' && Boolean(url.hostname);
}

module.exports = { APP_HOST, HOME_URL, OPEN_PREFIX, isAppUrl, isExternalLink };
