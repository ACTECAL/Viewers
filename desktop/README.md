# Spectra Desktop

A free DICOM viewer for Windows, macOS and Linux, by Actecal: the standalone Spectra viewer (`../extensions/actecal-offline`) in an Electron window, with a study library and the app's own ways to open studies. For viewing and education only; not for diagnostic use. Plan and decisions: `erp-architecture/TASK_PLAN.md`, TASK_PLAN 13.

## What it does

### The library (phase 2)

- **Home screen:** the study library, as in other desktop DICOM viewers. Studies are listed with patient, patient ID, study date, description, modality and image count. You can search by name, ID, accession number or description (word by word), filter by modality and study date, and sort by any column.
- **Selecting studies:** a click, Ctrl or Cmd for more, Shift for a range, and a checkbox per row. The panel beside the list shows the patient, the study and its series.
- **Opening studies:** a double-click or Enter opens a study. Several selected studies open together (up to 50). The right-click menu offers Open, Export and Delete. The viewer's back arrow, or File > Back to Library, returns to the library with the same search and selection.
- **Import** copies studies into the library from files, folders, ZIP files, a DICOMDIR, and CDs, DVDs and USB drives, so they open later without the disc. Files dropped on the window ask whether to import them or open them without importing.
  - **The first import** shows a notice: the copies hold personal health information, and where they are kept.
  - **One import at a time**, with progress and Cancel.
  - **Duplicates:** an image already in the library (the same SOP Instance UID) is not copied again.
  - **Summary:** at the end, what was added, already there, not DICOM or unreadable, and any password-protected ZIP entries.
- **DICOM discs:** when a CD, DVD or USB drive with a DICOMDIR is connected, a banner offers to import it or open it.
- **Export** copies studies to a folder with readable names, such as `Sharma Asha 2026-11-02 CT Chest/1 CT Axial/IM00001.dcm`, in viewing order.
- **Delete** asks first. It removes the library's copies only, never the originals.
- **Settings** (the gear button, or Cmd+, / Ctrl+,) show the library folder and its size, with Show in Finder or File Explorer, and Change. Change moves the library to an empty folder, after checking free space and copying and checking every file before the old folder is removed. Choosing a folder that already holds a Spectra library switches to it instead. A library on a drive that is not connected is reported, with Try again and Choose another folder.
- **The window** opens where it was last time, unless that screen is gone.

### Opening without importing (phase 1)

- **What opens:** DICOM files, folders, ZIP files, a DICOMDIR, and CDs, DVDs and USB drives, from the Open menu or a drop. The operating system can pass studies too: "Open With" in Finder and Explorer, files and folders dropped on the Dock icon, and the files of a second launch, which go to the window that is already open. These are viewed, not imported.
- **Discs:** a DICOMDIR at the top of a folder or drive, or one level down, is followed, so only the images it lists are read. Names match in any case and with ISO 9660 `;1` versions. Without a DICOMDIR, every file is checked for the DICOM `DICM` marker.
- **Offline:** no account, no telemetry and no network request. The main process refuses every http and ws request.

## The library on disk

| Platform | Default folder |
|---|---|
| macOS | `~/Library/Application Support/Spectra Desktop/Library` |
| Windows | `%LOCALAPPDATA%\Spectra Desktop\Library` (not the roaming profile) |
| Linux | `$XDG_DATA_HOME/Spectra Desktop/Library` (default `~/.local/share/...`) |

The default folder is never in Documents or another folder that iCloud or OneDrive may sync, because studies hold personal health information. The folder holds `library.db`, an SQLite index (Node's built-in `node:sqlite`, so there is no native module to build), and `studies/<study>/<series>/<instance>.dcm`, named with hashes of the UIDs. The index stores paths relative to the folder, so a copied or moved folder still works. `settings.json` in the app's data folder keeps the library folder, the window's place and whether the first-import notice was turned off.

## How it fits together

| Part | Where |
|---|---|
| Main process: the window, the menus, dialogs, "Open With", second launches, the page's calls | `src/main/index.js`, `menu.js`, `argv.js` |
| The library: index, import, export, delete, move | `src/main/library.js`, `importer.js`, `dicomfile.js` (header reader), `zip.js` (ZIP files from disk) |
| Native dialogs (first-import notice, delete, library folder) and the checks on what the page sends | `src/main/dialogs.js`, `validate.js` |
| Settings and the window's place | `src/main/settings.js`, `windowState.js` |
| `app://spectra/`: the viewer, and the files to open (byte ranges for ZIP files) | `src/main/protocol.js` |
| Finding DICOM files; DICOMDIR; CDs, DVDs and USB drives | `src/main/scan.js`, `dicomdir.js`, `drives.js` |
| The page's bridge, `window.spectraDesktop` | `src/preload/index.js` |
| The page side: the library screen, opening studies, files by address | `../extensions/actecal-offline/src/components/library/`, `opening.js`, `desktop.js` |
| The back arrow in the viewer | `../extensions/default/src/ViewerLayout/ViewerHeader.tsx` (only when `window.spectraDesktop` exists) |
| The viewer build, copied into `app/viewer` | `scripts/build-viewer.mjs` (runs `../build-offline.sh /`) |
| Installers | `electron-builder.config.cjs`, `build/`, `../.github/workflows/spectra-desktop.yml` |

The web edition and the app share one build. `components/OfflineHome.tsx` shows the library when `window.spectraDesktop` exists and the web page (`WebHome.tsx`) otherwise.

Library studies open the same way as opened files: the main process reads their paths from the index and gives the page a random address for each file. The page then loads them into the in-memory `dicomlocal` data source. Back to Library reloads the home page, which frees the viewer's memory.

This folder has its own npm lockfile. It is neither a yarn workspace nor a lerna package, so the web viewer's install and build (Jenkins) never see it. Keep it that way, and do not build on `../platform/electron`, an earlier prototype.

## Security

- **Window:** `contextIsolation`, `sandbox`, no Node.js integration, `webSecurity`, no `<webview>`, and no DevTools in the packaged app.
- **Navigation:** pages stay on `app://spectra/`. https links open in the system browser, and nothing opens a second window.
- **Network:** the page's Content-Security-Policy (`protocol.js`) lets it load and send nothing outside the app, and the main process refuses every http and ws request as well.
- **Files:** the page cannot name a file to read. The main process reads only what the user picked in a dialog, dropped on the window, opened from the operating system or chose from the drive list, and the library's own files. Each file gets a random address, valid until the next opening. No file path reaches the page, except the library folder shown in Settings.
- **IPC:** each call is accepted only from the app's own page, and every argument is checked (`validate.js`): study UIDs, search fields, sort names, dropped paths (absolute only). A drive must come from the last list.
- **Confirmation:** deleting studies, moving or switching the library, and the first import each ask in a native dialog that the page cannot answer.
- **Permissions:** full screen and writing to the clipboard; everything else is refused.
- **Electron fuses** (packaged app): no `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` or inspector, ASAR integrity on, the app loads only from `app.asar`, and `file://` gets no extra privileges.
- **Logs:** nothing about patients or files is logged.
- **At rest:** the library is not encrypted. It relies on the computer account and disk encryption (FileVault, BitLocker), as other desktop viewers do. The first-import notice and Settings say so.

## Commands

Node.js 22.13 or later for this folder (`node:sqlite` needs no flag from 22.13). The viewer build needs `yarn install` at the repository root.

```bash
npm install
npm run viewer        # build ../build-offline.sh / and copy it into app/viewer
npm start             # run from source
npm test              # unit tests (node --test)
npm run e2e           # end to end: the web edition in Chrome, then the app (its windows appear on screen)
npm run pack          # the app for this computer, in release/ (unsigned; ad-hoc signed on macOS)
npm run e2e:packaged  # macOS: fuses, signature, contents, a study opened by the packaged app, and its library
npm run dist          # installers for this platform (see Releases)
npm run icon          # build/icon.png from build/icon.svg
```

The end-to-end checks need Python 3 and `zip` for their test ZIP files, and Chrome for the web edition (or `CHROME_PATH`). On macOS they also mount a disc image to test the drive list and the disc banner. They use a profile and library of their own (`SPECTRA_USER_DATA`, honoured only when the app is not packaged).

## Releases

`../.github/workflows/spectra-desktop.yml` builds unsigned installers for macOS (dmg, zip), Windows (NSIS) and Linux (AppImage, deb) when a `spectra-desktop-v*` tag is pushed, and keeps them as workflow artifacts. Signing, notarization, the Microsoft Store package, automatic updates from `downloads.actecal.com` and the download page come in phase 5 (TASK_PLAN 13), once the Apple Developer and Microsoft Store accounts exist.

## Known limits

- **Not yet tested on Windows or Linux:** the library, the drive banner and the dialogs have only been run on macOS. On Windows the drives are listed through PowerShell every 8 seconds while the library is on screen, and at once when the window gets focus.
- **No thumbnails** in the library yet.
- **DICOM PDFs** do not show: the page's policy blocks embedded documents (`object-src 'none'`), as in the web edition.
- **Memory:** open studies are held in memory, so very large studies need enough RAM. ZIP files are read in parts, but each image is held in memory once read. Importing does not hold studies in memory.
- **USB hard disks on Windows:** the drive list shows CD and DVD drives and USB flash drives. USB hard disks report themselves as fixed disks; import or open them as a folder.
- **Electron** is pinned at 44.9.3, the version cached on the development machine; update it before the first release.
