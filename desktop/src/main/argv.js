'use strict';
// The paths the operating system passes on the command line: "Open with" in Explorer and Linux file managers, a
// file dropped on the app's icon on Windows, and the files of a second launch (index.js, second-instance).
// No Electron import; test/main.test.mjs runs it in Node.
const fs = require('node:fs');
const path = require('node:path');

/**
 * Existing paths in argv, resolved against cwd. argv[0] is the program; switches ("-…", which Electron and Chromium
 * add) and URLs are left out, and so is the app's own folder when run from source (`electron .`).
 */
function pathsFromArgv(argv, { cwd = process.cwd(), appPath = null, defaultApp = false } = {}) {
  const out = [];
  for (const arg of Array.isArray(argv) ? argv.slice(1) : []) {
    if (typeof arg !== 'string' || !arg || arg.startsWith('-')) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) continue;
    const full = path.resolve(cwd, arg);
    if (defaultApp && appPath && path.resolve(appPath) === full) continue;
    if (!fs.existsSync(full) || out.includes(full)) continue;
    out.push(full);
  }
  return out;
}

module.exports = { pathsFromArgv };
