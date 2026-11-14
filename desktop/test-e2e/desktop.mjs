// Spectra Desktop driven through Playwright's Electron support, as it runs from this folder (not packaged; see
// packaged.mjs for that). The library: the empty state, importing files, ZIP files, folders, dropped files and a
// disc (macOS), the import notice, search, sorting, details, opening one or two studies, Back to Library, export,
// delete, moving the library, and what a restart keeps. Opening without importing: the command line, the Open
// menu, refusals and a second launch. And the security settings. File dialogs and message boxes are answered in
// the main process. The windows appear on screen while it runs.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';
import { sameSet, studiesInUrl, waitForImage, watch } from './helpers.mjs';

const require = createRequire(import.meta.url);
const ELECTRON = require('electron');
const BRIDGE = [
  'cancel',
  'changeLibrary',
  'closeStudy',
  'deleteStudies',
  'edition',
  'exportStudies',
  'getStudy',
  'importDrive',
  'importDropped',
  'importFiles',
  'importFolder',
  'libraryInfo',
  'listDrives',
  'listStudies',
  'onProgress',
  'openDrive',
  'openDropped',
  'openStudies',
  'pickFiles',
  'pickFolder',
  'platform',
  'revealExport',
  'revealLibrary',
  'showStudyMenu',
  'takePending',
  'version',
];
const isOwn = (url) => url.startsWith('app://spectra/');
const listFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((name) => fs.statSync(path.join(dir, name)).isFile()) : []);

export default async function desktopChecks({ check, data, desktopDir }) {
  const { version } = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-profile-'));
  const libraryRoot = path.join(profile, 'Library');
  const env = { ...process.env, SPECTRA_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = (paths = []) => electron.launch({ executablePath: ELECTRON, args: [desktopDir, ...paths], env, timeout: 60000 });
  // The window's place, set in the first session and expected after the restart.
  let wanted = null;
  try {
    // ---------- Opened from the command line (Explorer's "Open with", a shortcut): viewed, not imported ----------
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
    check('Command line: opening does not import', listFiles(path.join(libraryRoot, 'studies')).length === 0);

    // ---------- One session: the library ----------
    let app = await launch();
    let page = await app.firstWindow();
    let session = watch(page, isOwn);
    try {
      const answerOpen = (paths) =>
        app.evaluate(({ dialog }, chosen) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: chosen });
        }, paths);
      // Message boxes: each answer in turn (default: the first button), and what was asked.
      const answerMessages = (answers = []) =>
        app.evaluate(({ dialog }, list) => {
          globalThis.messageAnswers = list.slice();
          globalThis.messageBoxes = [];
          dialog.showMessageBox = async (...args) => {
            const options = args.length > 1 ? args[1] : args[0];
            globalThis.messageBoxes.push({ title: options.title, message: options.message, detail: options.detail, buttons: options.buttons });
            return globalThis.messageAnswers.shift() || { response: 0, checkboxChecked: false };
          };
        }, answers);
      const asked = () => app.evaluate(() => globalThis.messageBoxes.slice());
      const summary = (text) => page.getByRole('status').filter({ hasText: text }).or(page.getByRole('alert').filter({ hasText: text }));
      const waitFor = (locator, timeout = 30000) => locator.first().waitFor({ timeout }).then(() => true, () => false);
      const header = page.locator('header');
      const menu = async (button, item) => {
        await header.getByRole('button', { name: button, exact: true }).click();
        await page.getByRole('menuitem', { name: item }).click();
      };
      const rows = () => page.locator('tbody tr');
      const backToLibrary = async () => {
        await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('close-study').click());
        await page.getByRole('heading', { name: 'Library', exact: true }).waitFor({ timeout: 30000 });
      };
      await app.evaluate(({ shell }) => {
        globalThis.openedExternally = [];
        globalThis.openedPaths = [];
        shell.openExternal = async (url) => {
          globalThis.openedExternally.push(url);
        };
        shell.openPath = async (target) => {
          globalThis.openedPaths.push(target);
          return '';
        };
      });

      // The empty library.
      const emptyHeading = await waitFor(page.getByRole('heading', { name: 'Your library is empty' }));
      const home = {
        title: await page.title(),
        buttons: await page.getByRole('button', { name: /^Import (files or a ZIP|a folder|from a CD, DVD or USB drive)$/ }).count(),
        webInputs: await page.locator('#offline-open-files, #offline-open-folder').count(),
        footer: await page.locator('footer').innerText(),
      };
      check(
        'Library: an empty library says so and offers the three ways to import, with the version in the footer',
        emptyHeading && home.title === 'Spectra Desktop' && home.buttons === 3 && home.webInputs === 0 && home.footer.includes(`Spectra Desktop ${version}`),
        JSON.stringify({ ...home, footer: undefined })
      );
      const bridge = await page.evaluate(() => ({ keys: Object.keys(window.spectraDesktop).sort(), require: typeof window.require, process: typeof window.process, module: typeof window.module }));
      check("Bridge: only the app's functions reach the page, and Node.js does not", JSON.stringify(bridge.keys) === JSON.stringify(BRIDGE) && bridge.require === 'undefined' && bridge.process === 'undefined' && bridge.module === 'undefined', JSON.stringify(bridge));

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

      // Import: ZIP files (one password-protected) and a text file, with the first-import notice.
      await answerOpen([data.zips.stored, data.zips.deflate, data.zips.zip64, data.zips.encrypted, data.notes]);
      await answerMessages([{ response: 0, checkboxChecked: true }]);
      await page.getByRole('button', { name: 'Import files or a ZIP' }).click();
      const imported = await waitFor(summary('Imported 24 images in 1 study from 5 items.'));
      const importText = imported ? await summary('Imported').first().innerText() : '';
      let notices = await asked();
      check(
        'Import: the first import shows the notice with the library folder and personal health information',
        notices.length === 1 && notices[0].detail.includes(libraryRoot) && /personal health information/.test(notices[0].detail) && notices[0].buttons[0] === 'Import',
        JSON.stringify(notices.map((entry) => entry.message))
      );
      check(
        'Import: ZIP files are copied in once each, and the summary names what was skipped',
        imported && /48 images were already in the library/.test(importText) && /1 file was not DICOM/.test(importText) && /Password-protected ZIP entries were skipped/.test(importText),
        importText
      );
      await waitFor(rows());
      const copied = listFiles(path.join(libraryRoot, 'studies'));
      check('Import: the study is listed and its 24 files are in the library folder', (await rows().count()) === 1 && copied.length === 24 && copied.every((name) => name.endsWith('.dcm')), `${copied.length} files`);

      // The same study again, from its folder (Import menu): no notice this time.
      await answerOpen([data.ct.dir]);
      await answerMessages();
      await menu('Import', 'Folder…');
      const again = await waitFor(summary(`The studies in ${path.basename(data.ct.dir)} are already in the library.`));
      notices = await asked();
      check('Import: a study already in the library is not copied again, and the notice is not shown again', again && notices.length === 0 && listFiles(path.join(libraryRoot, 'studies')).length === 24);

      // Files dropped on the window: the app asks whether to import or open them.
      const drop = (files) =>
        page.evaluate(async (count) => {
          const input = document.getElementById('e2e-drop');
          const transfer = new DataTransfer();
          for (const file of Array.from(input.files).slice(0, count)) transfer.items.add(file);
          const root = document.querySelector('header').parentElement;
          for (const type of ['dragenter', 'dragover', 'drop']) root.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
        }, files.length);
      await page.evaluate(() => {
        const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, id: 'e2e-drop' });
        input.style.display = 'none';
        document.body.append(input);
      });
      await page.setInputFiles('#e2e-drop', data.second.files.map((entry) => entry.file));
      await drop(data.second.files);
      const dialogShown = await waitFor(page.getByRole('dialog', { name: 'Import or open?' }));
      await page.getByRole('button', { name: 'Import into the library' }).click();
      const droppedIn = await waitFor(summary('Imported 8 images in 1 study from 8 items.'));
      check('Drop: dropped files ask "Import or open?", and import adds the study', dialogShown && droppedIn && (await rows().count()) === 2);

      // Search, sorting and the details of a study.
      const search = page.getByRole('searchbox', { name: 'Search the library' });
      await search.fill('second');
      await page.waitForTimeout(600);
      const found = await rows().allInnerTexts();
      await search.fill('nothing like this');
      await page.waitForTimeout(600);
      const none = await waitFor(page.getByText('No studies match.'), 5000);
      await page.getByRole('button', { name: 'Clear the search and filters' }).click();
      await page.waitForTimeout(600);
      await page.getByRole('button', { name: 'Description' }).click();
      await page.waitForTimeout(600);
      const sorted = (await rows().allInnerTexts()).map((text) => (text.includes('Second phantom') ? 'second' : 'ct'));
      check('Search and sort: words find the study, no match says so, and Description sorts A to Z', found.length === 1 && found[0].includes('Second phantom') && none && sorted.join() === 'second,ct', `${found.length} found; ${sorted}`);

      await rows().filter({ hasText: 'Synthetic CT phantom' }).click();
      const details = page.getByRole('complementary', { name: 'Study details' });
      await waitFor(details.getByText('Axial 5 mm'));
      const detailText = await details.innerText();
      check('Details: the selected study shows its patient, ID and series', /Phantom, Test/.test(detailText) && /PHANTOM-001/.test(detailText) && /Axial 5 mm/.test(detailText) && /1 series, 24 images/i.test(detailText), detailText.split('\n').slice(0, 6).join(' | '));

      // Open by double-click; the back arrow returns to the library as it was.
      await rows().filter({ hasText: 'Synthetic CT phantom' }).dblclick();
      let stats = await waitForImage(page);
      check('Open: a double-click opens the study from the library and renders it', stats.grey >= 0.1 && sameSet(studiesInUrl(page), [data.ct.studyUID]), `grey ${stats.grey}`);
      const backTitle = await page.locator('[data-cy="return-to-work-list"]').getAttribute('title');
      await page.locator('[data-cy="return-to-work-list"]').click();
      await page.getByRole('heading', { name: 'Library', exact: true }).waitFor({ timeout: 30000 });
      await page.waitForTimeout(800);
      const kept = await page.locator('tbody tr[aria-selected="true"]').allInnerTexts();
      check('Back to the library: the back arrow returns to the library, with the same study selected', backTitle === 'Back to the library' && kept.length === 1 && kept[0].includes('Synthetic CT phantom'), `${backTitle}; ${kept.length} selected`);

      // Two studies together, from the right-click menu (the native menu is answered in the main process).
      await page.getByRole('checkbox', { name: 'Select all studies' }).check();
      await app.evaluate(({ Menu }) => {
        globalThis.popupMenus = [];
        Menu.prototype.popup = function popup() {
          globalThis.popupMenus.push(this.items.filter((item) => item.type !== 'separator').map((item) => `${item.label}${item.enabled ? '' : ' (off)'}`));
          const item = this.getMenuItemById('study-open');
          if (item) setTimeout(() => item.click(), 50);
        };
      });
      await rows().filter({ hasText: 'Second phantom' }).click({ button: 'right' });
      stats = await waitForImage(page);
      const popups = await app.evaluate(() => globalThis.popupMenus.slice());
      check(
        'Right-click: the menu acts on the selection ("Open Together", Export and Delete for 2 studies), and opens both',
        stats.grey >= 0.1 && sameSet(studiesInUrl(page), [data.ct.studyUID, data.second.studyUID]) && JSON.stringify(popups) === JSON.stringify([['Open Together', 'Export 2 Studies…', 'Delete 2 Studies…']]),
        `${studiesInUrl(page).length} studies, ${JSON.stringify(popups)}`
      );
      await backToLibrary();

      // Export one study to a folder, with readable names.
      const exportDir = path.join(data.root, 'export');
      fs.mkdirSync(exportDir);
      await page.waitForTimeout(500);
      await rows().filter({ hasText: 'Synthetic CT phantom' }).click();
      await answerOpen([exportDir]);
      await details.getByRole('button', { name: 'Export…' }).click();
      const exported = await waitFor(summary('Exported 1 study (24 images)'));
      const exportFiles = listFiles(exportDir).sort();
      await page.getByRole('button', { name: /^Show in / }).click();
      await page.waitForTimeout(300);
      const shownPaths = await app.evaluate(() => globalThis.openedPaths.slice());
      const seriesFolder = path.join('Phantom Test 2026-11-13 Synthetic CT phantom', '1 CT Axial 5 mm');
      check(
        'Export: a study folder and a series folder with readable names, files in order, and Show opens the folder',
        exported && exportFiles.length === 24 && exportFiles[0] === path.join(seriesFolder, 'IM00001.dcm') && exportFiles[23] === path.join(seriesFolder, 'IM00024.dcm') && shownPaths.at(-1) === path.join(exportDir, 'Phantom Test 2026-11-13 Synthetic CT phantom'),
        `${exportFiles.length} files, first ${exportFiles[0]}`
      );

      // Delete: Cancel keeps the study, Delete removes it and its files.
      await rows().filter({ hasText: 'Second phantom' }).click();
      await answerMessages([{ response: 1 }]);
      await details.getByRole('button', { name: 'Delete…' }).click();
      await page.waitForTimeout(800);
      const stillThere = await rows().count();
      await answerMessages([{ response: 0 }]);
      await details.getByRole('button', { name: 'Delete…' }).click();
      const deleted = await waitFor(summary('Deleted 1 study from the library.'));
      notices = await asked();
      check(
        'Delete: confirmed in a dialog; Cancel keeps the study and Delete removes it with its files',
        stillThere === 2 && deleted && (await rows().count()) === 1 && notices[0].message === 'Delete this study from the library?' && listFiles(path.join(libraryRoot, 'studies')).length === 24,
        `${stillThere} then ${await rows().count()}`
      );

      // Open without importing: the Open menu, then a drop with "Open without importing".
      await answerOpen([data.second.dir]);
      await menu('Open', 'Folder…');
      stats = await waitForImage(page);
      check('Open without importing: the Open menu shows a folder in the viewer', stats.grey >= 0.1 && sameSet(studiesInUrl(page), [data.second.studyUID]), `grey ${stats.grey}`);
      await backToLibrary();
      await page.evaluate(() => {
        const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, id: 'e2e-drop' });
        input.style.display = 'none';
        document.body.append(input);
      });
      await page.setInputFiles('#e2e-drop', data.second.files.map((entry) => entry.file));
      await drop(data.second.files);
      await page.getByRole('button', { name: 'Open without importing' }).click();
      stats = await waitForImage(page);
      await backToLibrary();
      check('Open without importing: a drop can open instead of import, and the library is unchanged', stats.grey >= 0.1 && (await rows().count()) === 1, `grey ${stats.grey}`);

      // What cannot be opened says why.
      await answerOpen([data.zips.encrypted, data.notes]);
      await menu('Open', 'Files or a ZIP…');
      const refused = await waitFor(page.getByRole('alert').filter({ hasText: 'Password-protected ZIP entries were skipped' }), 20000);
      await answerOpen([data.noDicom]);
      await menu('Open', 'Folder…');
      const nothing = await waitFor(page.getByRole('alert').filter({ hasText: `No DICOM files were found in ${path.basename(data.noDicom)}.` }), 20000);
      check('Open without importing: a password-protected ZIP and a folder with no DICOM files are refused, with the reason', refused && nothing);

      // A DICOM disc (a mounted disc image, macOS): the banner offers to import it, and the drive list marks it.
      if (process.platform === 'darwin') {
        const iso = path.join(data.root, 'disc.iso');
        execFileSync('hdiutil', ['makehybrid', '-iso', '-joliet', '-default-volume-name', 'SPECTRATEST', '-o', iso, data.disc.dir], { stdio: 'ignore' });
        const attached = execFileSync('hdiutil', ['attach', '-readonly', '-nobrowse', iso]).toString();
        const mount = attached.split('\n').map((line) => (line.match(/(\/Volumes\/.+)$/) || [])[1]).find(Boolean)?.trim();
        try {
          const name = path.basename(mount);
          const banner = page.getByRole('status', { name: 'DICOM disc' }).filter({ hasText: name });
          const offered = await waitFor(banner, 20000);
          await menu('Import', 'CD, DVD or USB drive…');
          const listed = await waitFor(page.locator('#desktop-drives li', { hasText: name }), 20000);
          const marked = listed && (await page.locator('#desktop-drives li', { hasText: name }).innerText()).includes('DICOM disc');
          await page.getByRole('button', { name: 'Close', exact: true }).last().click();
          if (offered) await banner.getByRole('button', { name: 'Import into the library' }).click();
          const fromDisc = offered && (await waitFor(summary(`Imported 12 images in 1 study from ${name}.`)));
          const discInLibrary = await page.evaluate(async (uids) => {
            const studies = (await window.spectraDesktop.listStudies({})).studies.map((study) => study.studyUID);
            return { disc: studies.includes(uids[0]), unlisted: studies.includes(uids[1]) };
          }, [data.disc.studyUID, data.disc.unlistedStudyUID]);
          check(
            'Disc: a DICOM disc gets a banner and is marked in the drive list; importing it copies only what its DICOMDIR lists',
            offered && marked && fromDisc && discInLibrary.disc && !discInLibrary.unlisted,
            `${name}: banner ${offered}, marked ${marked}, ${JSON.stringify(discInLibrary)}`
          );
        } finally {
          execFileSync('hdiutil', ['detach', mount, '-force'], { stdio: 'ignore' });
        }
      }

      // Import from the File menu while a study is open: back to the library, which shows the import.
      await rows().first().dblclick();
      await waitForImage(page);
      await answerOpen([data.second.dir]);
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('import-folder').click());
      const fromMenu = await waitFor(summary(`Imported 8 images in 1 study from ${path.basename(data.second.dir)}.`), 40000);
      check('File menu: Import a Folder while viewing goes back to the library and imports', fromMenu && new URL(page.url()).pathname === '/');

      // Settings: the library folder, and moving it.
      const studiesBefore = await rows().count();
      await page.getByRole('button', { name: 'Settings' }).click();
      const shownRoot = await page.getByTestId('library-root').innerText();
      const moveTo = path.join(data.root, 'moved', 'Spectra Library');
      fs.mkdirSync(moveTo, { recursive: true });
      await answerOpen([moveTo]);
      await answerMessages([{ response: 0 }]);
      await page.getByRole('button', { name: 'Change…' }).click();
      const moved = await waitFor(summary(`The library is now in ${moveTo}.`), 60000);
      notices = await asked();
      await page.getByRole('button', { name: 'Done' }).click().catch(() => {});
      check(
        'Settings: the library folder is shown, and Change moves the library and its studies to an empty folder',
        shownRoot === libraryRoot && moved && notices[0]?.message === `Move the library to ${moveTo}?` && !fs.existsSync(path.join(libraryRoot, 'library.db')) && listFiles(path.join(moveTo, 'studies')).length === 24 + 8 + 12 * (process.platform === 'darwin' ? 1 : 0) && (await rows().count()) === studiesBefore,
        `${shownRoot}; ${listFiles(path.join(moveTo, 'studies')).length} files`
      );

      // The window's place for the restart below, inside the screen (macOS moves windows that do not fit).
      const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
      wanted = { x: area.x + 60, y: area.y + 40, width: Math.max(900, Math.min(1100, area.width - 120)), height: Math.max(600, Math.min(700, area.height - 80)) };
      await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), wanted);
      await page.waitForTimeout(900);
      check('No page errors, and no request outside the app (library session)', session.clean(), session.problems());
    } finally {
      await app.close();
    }

    // ---------- A restart keeps the library, its new folder and the window's place ----------
    app = await launch();
    page = await app.firstWindow();
    session = watch(page, isOwn);
    try {
      await page.getByRole('heading', { name: 'Library', exact: true }).waitFor({ timeout: 30000 });
      await page.locator('tbody tr').first().waitFor({ timeout: 20000 }).catch(() => {});
      const count = await page.locator('tbody tr').count();
      const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
      const settings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
      const close = (a, b) => Math.abs(a - b) <= 2;
      check(
        'Restart: the studies are still there, from the moved folder, and the window opens where it was',
        count === (process.platform === 'darwin' ? 3 : 2) &&
          settings.libraryRoot === path.join(data.root, 'moved', 'Spectra Library') &&
          settings.importNotice === false &&
          ['x', 'y', 'width', 'height'].every((name) => close(bounds[name], wanted[name])),
        `${count} studies, ${JSON.stringify(bounds)} for ${JSON.stringify(wanted)}`
      );
      await page.locator(`tbody tr[data-study="${data.ct.studyUID}"]`).dblclick();
      const stats = await waitForImage(page);
      check('Restart: a study opens from the moved library', stats.grey >= 0.1 && sameSet(studiesInUrl(page), [data.ct.studyUID]), `grey ${stats.grey}`);

      // A second launch with files: this window opens them, the second copy quits, nothing is imported.
      const second = spawn(ELECTRON, [desktopDir, data.second.dir], { env, stdio: 'ignore' });
      const exited = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 20000);
        second.on('exit', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      await page.waitForURL(new RegExp(`StudyInstanceUIDs=${data.second.studyUID.replace(/\./g, '\\.')}`), { timeout: 30000 }).catch(() => {});
      const secondStats = await waitForImage(page).catch(() => ({ grey: 0 }));
      const total = await page.evaluate(async () => (await window.spectraDesktop.libraryInfo()).studies);
      check('Second launch: the open window shows its files, the second copy quits, and nothing is imported', exited && secondStats.grey >= 0.1 && sameSet(studiesInUrl(page), [data.second.studyUID]) && app.windows().length === 1 && total === count, `exited ${exited}`);

      // Last, because Playwright keeps waiting for a navigation that the app cancels.
      await app.evaluate(({ shell }) => {
        globalThis.openedExternally = [];
        shell.openExternal = async (url) => {
          globalThis.openedExternally.push(url);
        };
      });
      await page.evaluate(() => {
        window.location.href = 'https://example.com/navigated';
      });
      await page.waitForTimeout(1000);
      const navigated = await app.evaluate(() => globalThis.openedExternally.slice());
      check('Links: following an https link opens the system browser, and the window stays on the app', isOwn(page.url()) && navigated.includes('https://example.com/navigated'), page.url());
      const blocked = await app.evaluate(() => globalThis.spectraBlockedRequests.slice());
      check('Network: the app itself tried to reach no other site', blocked.length === 0, JSON.stringify(blocked));
      check('No page errors, and no request outside the app (after the restart)', session.clean(), session.problems());
    } finally {
      await app.close();
    }
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
