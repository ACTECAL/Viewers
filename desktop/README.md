# Spectra Desktop

A free DICOM viewer for Windows, macOS and Linux, by Actecal: the standalone Spectra viewer (`../extensions/actecal-offline`) in an Electron window, with the app's own ways to open studies. For viewing and education only; not for diagnostic use. Plan and decisions: `erp-architecture/TASK_PLAN.md`, TASK_PLAN 13.

## What it does (phase 1)

- **Opens** DICOM files, folders, ZIP files, a DICOMDIR, and CDs, DVDs and USB drives. It also opens what the operating system gives it: "Open With" in Finder and Explorer, files and folders dropped on the Dock icon, and the files of a second launch, which go to the window that is already open.
- **Discs:** a DICOMDIR at the top of a folder or drive, or one level down, is followed, so only the images it lists are read. Names match in any case and with ISO 9660 `;1` versions. Without a DICOMDIR, every file is checked for the DICOM `DICM` marker.
- **In memory**, as in the web edition: closing the study or the window forgets it. The local library comes in phase 2.
- **Offline:** no account, no telemetry and no network request. The main process refuses every http and ws request.

## How it fits together

| Part | Where |
|---|---|
| Main process: the window, the File menu, dialogs, "Open With", second launches | `src/main/index.js`, `menu.js`, `argv.js` |
| `app://spectra/`: the viewer, and the files found in what the user opened (byte ranges for ZIP files) | `src/main/protocol.js` |
| Finding DICOM files; DICOMDIR; CDs, DVDs and USB drives | `src/main/scan.js`, `dicomdir.js`, `drives.js` |
| The page's bridge, `window.spectraDesktop` | `src/preload/index.js` |
| The page side: the app's buttons, the drive list, files by address | `../extensions/actecal-offline/src/desktop.js`, `components/OfflineHome.tsx` |
| The viewer build, copied into `app/viewer` | `scripts/build-viewer.mjs` (runs `../build-offline.sh /`) |
| Installers | `electron-builder.config.cjs`, `build/`, `../.github/workflows/spectra-desktop.yml` |

The web edition and the app share the same page; its desktop parts switch on only when `window.spectraDesktop` exists.

This folder has its own npm lockfile. It is neither a yarn workspace nor a lerna package, so the web viewer's install and build (Jenkins) never see it. Keep it that way, and do not build on `../platform/electron`, an earlier prototype.

## Security

- **Window:** `contextIsolation`, `sandbox`, no Node.js integration, `webSecurity`, no `<webview>`, and no DevTools in the packaged app.
- **Navigation:** pages stay on `app://spectra/`. https links open in the system browser, and nothing opens a second window.
- **Network:** the page's Content-Security-Policy (`protocol.js`) lets it load and send nothing outside the app, and the main process refuses every http and ws request as well.
- **Files:** the page cannot name a file to read. The main process reads only what the user picked in a dialog, opened from the operating system, or chose from the drive list. Each file it finds gets a random address, valid until the next opening.
- **IPC:** six calls and one progress message. Each call is accepted only from the app's own page, and a drive must come from the last list shown.
- **Permissions:** full screen and writing to the clipboard; everything else is refused.
- **Electron fuses** (packaged app): no `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` or inspector, ASAR integrity on, the app loads only from `app.asar`, and `file://` gets no extra privileges.
- **Logs:** nothing about the files is logged.

## Commands

Node.js 22 for this folder. The viewer build needs `yarn install` at the repository root.

```bash
npm install
npm run viewer        # build ../build-offline.sh / and copy it into app/viewer
npm start             # run from source
npm test              # unit tests (node --test)
npm run e2e           # end to end: the web edition in Chrome, then the app (its windows appear on screen)
npm run pack          # the app for this computer, in release/ (unsigned; ad-hoc signed on macOS)
npm run e2e:packaged  # macOS: fuses, signature, contents, and a study opened by the packaged app
npm run dist          # installers for this platform (see Releases)
npm run icon          # build/icon.png from build/icon.svg
```

The end-to-end checks need Python 3 and `zip` for their test ZIP files, and Chrome for the web edition (or `CHROME_PATH`). On macOS they also mount a disc image to test the drive list.

## Releases

`../.github/workflows/spectra-desktop.yml` builds unsigned installers for macOS (dmg, zip), Windows (NSIS) and Linux (AppImage, deb) when a `spectra-desktop-v*` tag is pushed, and keeps them as workflow artifacts. Signing, notarization, the Microsoft Store package, automatic updates from `downloads.actecal.com` and the download page come in phase 5 (TASK_PLAN 13), once the Apple Developer and Microsoft Store accounts exist.

## Known limits

- DICOM PDFs do not show: the page's policy blocks embedded documents (`object-src 'none'`), as in the web edition.
- Studies are held in memory, so very large studies need enough RAM. ZIP files are read in parts, but each image is held in memory once read.
- On Windows the drive list shows CD and DVD drives and USB flash drives. USB hard disks report themselves as fixed disks; open them with "Open a folder".
- Dropping a DICOMDIR file alone on the window does not follow it, because the page gets the file without its folder. Open it with "Open files", or drop the folder.
- Electron is pinned at 44.9.3, the version cached on the development machine; update it before the first release.
