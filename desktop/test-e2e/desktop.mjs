// Spectra Desktop driven through Playwright's Electron support, as it runs from this folder (not packaged; see
// packaged.mjs for that): opening from the command line, the app's pickers (with the dialog answered in the main
// process), DICOMDIR discs, ZIP files read in parts, a mounted disc image as a drive (macOS), a second launch, Close
// Study, the reload notice, and the security settings. The windows appear on screen while it runs.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';
import { sameSet, studiesInUrl, waitForImage, watch } from './helpers.mjs';

const require = createRequire(import.meta.url);
const ELECTRON = require('electron');
const BRIDGE = ['cancelScan', 'edition', 'listDrives', 'onScanProgress', 'openDrive', 'pickFiles', 'pickFolder', 'platform', 'takePending', 'version'];
const isOwn = (url) => url.startsWith('app://spectra/');

export default async function desktopChecks({ check, data, desktopDir }) {
  const { version } = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-profile-'));
  const env = { ...process.env, SPECTRA_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = (paths = []) => electron.launch({ executablePath: ELECTRON, args: [desktopDir, ...paths], env, timeout: 60000 });
  try {
    // ---------- Opened from the command line (Explorer's "Open with", a second copy, a shortcut) ----------
    for (const [label, input, expected] of [
      ['a folder', data.ct.dir, [data.ct.studyUID]],
      ['a disc folder (only the studies its DICOMDIR lists)', data.disc.dir, [data.disc.studyUID]],
    ]) {
      const app = await launch([input]);
      try {
        const page = await app.firstWindow();
        const stats = await waitForImage(page);
        check(`Command line: ${label} opens straight in the viewer`, stats.grey >= 0.1 && sameSet(studiesInUrl(page), expected), `grey ${stats.grey}, ${studiesInUrl(page).length} studies`);
      } finally {
        await app.close();
      }
    }

    // ---------- One session: home page, security, pickers, ZIP files, drives, second launch ----------
    const app = await launch();
    try {
      const page = await app.firstWindow();
      const session = watch(page, isOwn);
      const openFolder = page.getByRole('button', { name: 'Open a folder' });
      await openFolder.waitFor({ timeout: 30000 });
      const home = {
        title: await page.title(),
        drives: await page.getByRole('button', { name: 'Open a CD, DVD or USB drive' }).count(),
        webInputs: await page.locator('#offline-open-files, #offline-open-folder').count(),
        footer: await page.locator('footer').innerText(),
        lead: await page.locator('main p').first().innerText(),
      };
      check(
        'Home: "Spectra Desktop", the app\'s own buttons instead of the browser\'s file inputs, and the version in the footer',
        home.title === 'Spectra Desktop' && home.drives === 1 && home.webInputs === 0 && home.footer.includes(`Spectra Desktop ${version}`) && home.lead.includes('on this computer'),
        JSON.stringify({ ...home, footer: undefined })
      );
      const bridge = await page.evaluate(() => ({ keys: Object.keys(window.spectraDesktop).sort(), require: typeof window.require, process: typeof window.process, module: typeof window.module }));
      check('Bridge: only the app\'s functions reach the page, and Node.js does not', JSON.stringify(bridge.keys) === JSON.stringify(BRIDGE) && bridge.require === 'undefined' && bridge.process === 'undefined' && bridge.module === 'undefined', JSON.stringify(bridge));

      // Links: https in the system browser (recorded instead of opened), never a second window.
      await app.evaluate(({ shell }) => {
        globalThis.openedExternally = [];
        shell.openExternal = async (url) => {
          globalThis.openedExternally.push(url);
        };
      });
      const popup = await page.evaluate(() => window.open('https://actecal.com/contact?interest=spectra'));
      await page.waitForTimeout(500);
      const external = await app.evaluate(() => globalThis.openedExternally.slice());
      check(
        'Links: a new window for an https link opens the system browser instead',
        popup === null && app.windows().length === 1 && JSON.stringify(external) === JSON.stringify(['https://actecal.com/contact?interest=spectra']),
        JSON.stringify(external)
      );
      const reached = await app.evaluate(async ({ net }) => net.fetch('https://example.com/blocked-check').then(() => 'reached', () => 'blocked'));
      check('Network: a request to another site is refused', reached === 'blocked');

      // The pickers, with the dialog answered in the main process.
      const answerDialog = (paths) =>
        app.evaluate(({ dialog }, chosen) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: chosen });
        }, paths);
      const closeStudy = async () => {
        await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('close-study').click());
        await openFolder.waitFor({ timeout: 30000 });
      };

      await answerDialog([data.ct.dir]);
      await openFolder.click();
      let stats = await waitForImage(page);
      check('Open a folder: the study opens and renders', stats.grey >= 0.1 && sameSet(studiesInUrl(page), [data.ct.studyUID]), `grey ${stats.grey}`);
      await page.reload();
      const notice = await page.getByText('The study was closed. Open it again from your files, a folder or a drive.').waitFor({ timeout: 20000 }).then(() => true, () => false);
      check('Reload: the study is closed, with the desktop wording', notice && new URL(page.url()).pathname === '/notfoundstudy', page.url());

      await closeStudy();
      check('Close Study (File menu): back to the home page', new URL(page.url()).pathname === '/' && !(await page.getByRole('status').filter({ hasText: 'The study was closed' }).count()));

      await answerDialog([path.join(data.disc.dir, 'DICOMDIR')]);
      await page.getByRole('button', { name: 'Open files or a ZIP' }).click();
      stats = await waitForImage(page);
      check('Open files: a DICOMDIR opens the series it lists, and not the one it does not', stats.grey >= 0.1 && sameSet(studiesInUrl(page), [data.disc.studyUID]), `${studiesInUrl(page).length} studies`);

      for (const kind of ['stored', 'deflate', 'zip64']) {
        await closeStudy();
        await answerDialog([data.zips[kind]]);
        await page.getByRole('button', { name: 'Open files or a ZIP' }).click();
        stats = await waitForImage(page).catch(() => ({ grey: 0 }));
        check(`ZIP (${kind}): read in parts, opens and renders`, stats.grey >= 0.1 && sameSet(studiesInUrl(page), [data.ct.studyUID]), `grey ${stats.grey}`);
      }

      await closeStudy();
      await answerDialog([data.zips.encrypted, data.notes]);
      await page.getByRole('button', { name: 'Open files or a ZIP' }).click();
      const refused = await page.getByRole('alert').filter({ hasText: 'Password-protected ZIP entries were skipped' }).waitFor({ timeout: 20000 }).then(() => true, () => false);
      check('A password-protected ZIP and a text file: refused, with the reason', refused);
      await answerDialog([data.noDicom]);
      await openFolder.click();
      const nothing = await page.getByRole('alert').filter({ hasText: `No DICOM files were found in ${path.basename(data.noDicom)}.` }).waitFor({ timeout: 20000 }).then(() => true, () => false);
      check('A folder with no DICOM files: says so, with the folder\'s name', nothing);

      // A disc image mounted as a drive (macOS): listed, marked as a DICOM disc, and opened.
      if (process.platform === 'darwin') {
        const iso = path.join(data.root, 'disc.iso');
        execFileSync('hdiutil', ['makehybrid', '-iso', '-joliet', '-default-volume-name', 'SPECTRATEST', '-o', iso, data.disc.dir], { stdio: 'ignore' });
        const attached = execFileSync('hdiutil', ['attach', '-readonly', '-nobrowse', iso]).toString();
        const mount = attached.split('\n').map((line) => (line.match(/(\/Volumes\/.+)$/) || [])[1]).find(Boolean)?.trim();
        try {
          const name = path.basename(mount);
          await page.getByRole('button', { name: 'Open a CD, DVD or USB drive' }).click();
          const open = page.getByRole('button', { name: `Open ${name}` });
          const listed = await open.waitFor({ timeout: 20000 }).then(() => true, () => false);
          const marked = listed && (await page.locator('#desktop-drives li', { hasText: name }).innerText()).includes('DICOM disc');
          if (listed) await open.click();
          stats = listed ? await waitForImage(page) : { grey: 0 };
          check('Drives: a mounted disc image is listed as a DICOM disc, and opens its study', listed && marked && stats.grey >= 0.1 && sameSet(studiesInUrl(page), [data.disc.studyUID]), `${name}, grey ${stats.grey}`);
        } finally {
          execFileSync('hdiutil', ['detach', mount, '-force'], { stdio: 'ignore' });
        }
      }

      // A second launch with other files: this window opens them, and the second copy quits.
      const second = spawn(ELECTRON, [desktopDir, data.second.dir], { env, stdio: 'ignore' });
      const exited = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 20000);
        second.on('exit', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      await page.waitForURL(new RegExp(`StudyInstanceUIDs=${data.second.studyUID.replace(/\./g, '\\.')}`), { timeout: 30000 }).catch(() => {});
      stats = await waitForImage(page).catch(() => ({ grey: 0 }));
      check('Second launch: the open window shows its files, and the second copy quits', exited && stats.grey >= 0.1 && sameSet(studiesInUrl(page), [data.second.studyUID]) && app.windows().length === 1, `exited ${exited}`);

      // Last, because Playwright keeps waiting for a navigation that the app cancels.
      await page.evaluate(() => {
        window.location.href = 'https://example.com/navigated';
      });
      await page.waitForTimeout(1000);
      const navigated = await app.evaluate(() => globalThis.openedExternally.slice());
      check('Links: following an https link opens the system browser, and the window stays on the app', isOwn(page.url()) && navigated.includes('https://example.com/navigated'), page.url());

      const blocked = await app.evaluate(() => globalThis.spectraBlockedRequests.slice());
      check('Network: the viewer itself tried to reach no other site', blocked.length === 1 && blocked[0] === 'https://example.com/blocked-check', JSON.stringify(blocked));
      check('No page errors, and no request outside the app', session.clean(), session.problems());
    } finally {
      await app.close();
    }
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
