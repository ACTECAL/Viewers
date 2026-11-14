'use strict';
// Spectra Desktop's settings, in <userData>/settings.json: where the library is, the window's place and size, and
// whether the first-import notice was shown. Written atomically (a temporary file, then a rename); a damaged or
// missing file gives the defaults. No Electron import; test/library.test.mjs runs it in Node.
const fs = require('node:fs');
const path = require('node:path');

class Settings {
  constructor(file) {
    this.file = file;
    this.values = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.values = parsed;
    } catch {
      // Missing or damaged: the defaults apply.
    }
  }

  get(name, fallback = undefined) {
    return Object.prototype.hasOwnProperty.call(this.values, name) ? this.values[name] : fallback;
  }

  set(name, value) {
    this.values = { ...this.values, [name]: value };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.values, null, 2));
    fs.renameSync(temporary, this.file);
  }
}

module.exports = { Settings };
