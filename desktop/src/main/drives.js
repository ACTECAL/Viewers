'use strict';
// The CDs, DVDs and USB drives listed under "Open a CD, DVD or USB drive". No Electron import;
// test/main.test.mjs runs it in Node.
// - macOS: the volumes in /Volumes (the startup disk is a symbolic link there, and is left out).
// - Windows: removable drives and CD/DVD drives with a disc in them (Win32_LogicalDisk DriveType 2 and 5). USB hard
//   disks report DriveType 3, like internal disks, and are opened with "Open a folder".
// - Linux: the folders where desktops mount removable media (/media/<user>, /run/media/<user>, /media, /mnt).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { isDicomdirName } = require('./dicomdir');

const readEntries = (dir) => fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);

async function macDrives(root = '/Volumes') {
  const entries = await readEntries(root);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, path: path.join(root, entry.name), kind: 'drive' }));
}

async function linuxDrives({ user = os.userInfo().username, roots } = {}) {
  const candidates = roots || [`/media/${user}`, `/run/media/${user}`, '/media', '/mnt'];
  const seen = new Set();
  const out = [];
  for (const root of candidates) {
    for (const entry of await readEntries(root)) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      // /media/<user> is a folder of mounts, listed through the first root.
      if (root === '/media' && entry.name === user) continue;
      const full = path.join(root, entry.name);
      if (seen.has(full)) continue;
      seen.add(full);
      out.push({ name: entry.name, path: full, kind: 'drive' });
    }
  }
  return out;
}

const WINDOWS_QUERY =
  'Get-CimInstance -ClassName Win32_LogicalDisk | Where-Object { ($_.DriveType -eq 2 -or $_.DriveType -eq 5) -and $_.Size } | Select-Object DeviceID,DriveType,VolumeName | ConvertTo-Json -Compress';

/** Drives from the JSON that WINDOWS_QUERY prints: one object, a list, or nothing. */
function parseWindowsDrives(json) {
  let data;
  try {
    data = JSON.parse(String(json || '').trim() || 'null');
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list
    .filter((disk) => disk && typeof disk.DeviceID === 'string' && /^[A-Za-z]:$/.test(disk.DeviceID))
    .map((disk) => {
      const letter = disk.DeviceID.toUpperCase();
      const label = typeof disk.VolumeName === 'string' && disk.VolumeName.trim() ? `${disk.VolumeName.trim()} (${letter})` : letter;
      return { name: label, path: `${letter}\\`, kind: Number(disk.DriveType) === 5 ? 'disc' : 'usb' };
    });
}

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeout: 10000, windowsHide: true }, (error, stdout) =>
      error ? reject(error) : resolve(stdout)
    );
  });
}

async function windowsDrives(run = runPowerShell) {
  try {
    return parseWindowsDrives(await run(WINDOWS_QUERY));
  } catch {
    return [];
  }
}

/** Adds dicomdir: true when a DICOMDIR is at the top of the drive (a DICOM disc). */
async function withDicomdirFlag(drive) {
  const names = await fs.promises.readdir(drive.path).catch(() => []);
  return { ...drive, dicomdir: names.some(isDicomdirName) };
}

/** [{ name, path, kind: 'disc' | 'usb' | 'drive', dicomdir }] for this computer. */
async function listDrives({ platform = process.platform, run } = {}) {
  const found = platform === 'darwin' ? await macDrives() : platform === 'win32' ? await windowsDrives(run) : await linuxDrives();
  return Promise.all(found.map(withDicomdirFlag));
}

module.exports = { WINDOWS_QUERY, linuxDrives, listDrives, macDrives, parseWindowsDrives, windowsDrives, withDicomdirFlag };
