// Home page of the offline edition (the '/' custom route): open DICOM files, a folder or a ZIP, then go
// to the viewer. Everything stays in this browser tab; nothing is uploaded. In Spectra Desktop (../desktop.js) the
// same page uses the app's file, folder and drive pickers, and opens what the operating system passes to the app.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Dropzone from 'react-dropzone';
import { MODULE_TYPES } from '@ohif/core';
import { collectFiles, loadItems } from '../loadDicomFiles';
import { getDesktop, itemsFromScan } from '../desktop';
import { PREMIUM_FEATURES, premiumLinks } from '../premium';
import { PremiumActions } from './PremiumContent';
import { ExternalLink, LockIcon, SpectraMark } from './ui';

const NOTICES = {
  reloaded: 'The study was cleared when the page reloaded. Files stay only in this tab and are never stored, so open them again to continue.',
  notfound: 'That page does not exist. Open your DICOM files to start.',
};
// In Spectra Desktop a reload or Close Study ends the study the same way, but there is no tab.
const DESKTOP_NOTICES = {
  ...NOTICES,
  reloaded: 'The study was closed. Open it again from your files, a folder or a drive.',
};
const DRIVE_KINDS = { disc: 'CD or DVD', usb: 'USB drive', drive: 'Drive' };
const IDLE = { status: 'idle', done: 0, total: 0, message: '' };
const FAILED = 'These files could not be opened. Try a folder of .dcm files or another ZIP.';

const PICKER =
  'relative inline-flex cursor-pointer items-center justify-center rounded-md px-4 py-2 text-sm font-semibold focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary';
const BUTTON =
  'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60';

function describeProblems(problems, skipped) {
  const notes = [];
  if (problems.noZipSupport) notes.push('This browser cannot open ZIP files; unzip it and open the folder instead.');
  if (problems.badZip) notes.push('A ZIP file could not be read; it may be damaged.');
  if (problems.encrypted) notes.push('Password-protected ZIP entries were skipped; unzip them with the password first.');
  if (problems.method) notes.push('Some ZIP entries use a compression method this viewer cannot read.');
  if (skipped) notes.push(`${skipped} file${skipped === 1 ? ' was' : 's were'} not DICOM images and ${skipped === 1 ? 'was' : 'were'} skipped.`);
  return notes.join(' ');
}

const count = (n, one, many) => `${Number(n).toLocaleString()} ${n === 1 ? one : many}`;

// Spectra Desktop: what the app's search adds to a message (files missing from a DICOMDIR, unreadable, too many).
function scanNotes(scan) {
  const notes = [];
  const missing = scan.dicomdir?.missing || 0;
  if (missing) notes.push(`${count(missing, 'file', 'files')} listed in the DICOMDIR ${missing === 1 ? 'was' : 'were'} not found.`);
  if (scan.unreadable) notes.push(`${count(scan.unreadable, 'file or folder', 'files or folders')} could not be read.`);
  if (scan.truncated) notes.push(`The search stopped after ${Number(scan.limit || 0).toLocaleString()} files; open the folder that holds the study.`);
  return notes.join(' ');
}

export default function OfflineHome({ extensionManager, notice }) {
  const navigate = useNavigate();
  const desktop = getDesktop();
  const [state, setState] = useState(IDLE);
  const [search, setSearch] = useState(null);
  const [drives, setDrives] = useState(null);
  // Spectra Desktop: true while this page waits for the app's answer. Progress messages count only then; one that
  // arrives after the answer must not bring the search back.
  const waiting = useRef(false);
  const links = premiumLinks();
  const busy = state.status === 'reading' || state.status === 'scanning';
  const notices = desktop ? DESKTOP_NOTICES : NOTICES;

  useEffect(() => {
    document.title = desktop ? 'Spectra Desktop' : 'Free DICOM viewer · Actecal Spectra';
    document.body.classList.add('bg-background');
    return () => document.body.classList.remove('bg-background');
  }, []);

  // As in the upstream Local route: the local data source must exist before files are loaded.
  useEffect(() => {
    const modules = extensionManager?.modules?.[MODULE_TYPES.DATA_SOURCE] || [];
    const local = modules.flatMap(entry => entry.module).find(module => module.type === 'localApi');
    local?.createDataSource({});
  }, [extensionManager]);

  // Spectra Desktop: show the app's search while it looks, and open what the operating system passed to the app
  // (files opened with it, a second launch, the File menu).
  useEffect(() => {
    if (!desktop) return undefined;
    let active = true;
    const stop = desktop.onScanProgress(progress => {
      if (!active || !waiting.current) return;
      setSearch(progress);
      setState(current => (current.status === 'reading' ? current : { ...IDLE, status: 'scanning' }));
    });
    waiting.current = true;
    desktop.takePending().then(
      result => active && finishScan(result),
      () => {
        waiting.current = false;
        if (active) setState({ ...IDLE, status: 'error', message: FAILED });
      }
    );
    return () => {
      active = false;
      stop();
    };
  }, []);

  // Loads the items and opens the viewer. `notes` (desktop) are added to the message when nothing opens, and `empty`
  // replaces it when there was nothing to read.
  async function load(items, problems, notes = '', empty = '') {
    if (!items.length) {
      setState({ ...IDLE, status: 'error', message: empty || describeProblems(problems, 0) || 'No files to open.' });
      return;
    }
    setState(current => ({ ...current, status: 'reading', total: items.length }));
    const result = await loadItems(items, (done, total) => setState(current => ({ ...current, done, total })));
    if (!result.studies.length) {
      setState({ ...IDLE, status: 'error', message: `No DICOM images were found. ${describeProblems(problems, result.skipped)} ${notes}`.trim() });
      return;
    }
    const query = new URLSearchParams();
    result.studies.forEach(uid => query.append('StudyInstanceUIDs', uid));
    query.append('datasources', 'dicomlocal');
    navigate(`/viewer/dicomlocal?${query.toString()}`);
  }

  async function open(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || busy) return;
    setState({ ...IDLE, status: 'reading' });
    try {
      const { items, problems } = await collectFiles(files);
      await load(items, problems);
    } catch {
      setState({ ...IDLE, status: 'error', message: FAILED });
    }
  }

  // Spectra Desktop: the answer to a picker, a drive or takePending(): what the app found, a request to list the
  // drives (File menu), or nothing (a cancelled dialog or search).
  async function finishScan(result) {
    waiting.current = false;
    setSearch(null);
    if (!result || result.cancelled) {
      setState(current => (current.status === 'scanning' ? IDLE : current));
      return;
    }
    if (result.show === 'drives') {
      setState(IDLE);
      showDrives();
      return;
    }
    setDrives(null);
    setState({ ...IDLE, status: 'reading' });
    try {
      const { items, problems } = await itemsFromScan(result);
      const notes = scanNotes(result);
      const nothing = !result.files?.length && !result.zips?.length;
      const empty = nothing ? `No DICOM files were found${result.label ? ` in ${result.label}` : ''}. ${notes}`.trim() : '';
      await load(items, problems, notes, empty);
    } catch {
      setState({ ...IDLE, status: 'error', message: FAILED });
    }
  }

  function ask(request) {
    if (busy) return;
    waiting.current = true;
    request().then(finishScan, () => {
      waiting.current = false;
      setState({ ...IDLE, status: 'error', message: FAILED });
    });
  }

  async function showDrives() {
    setDrives({ loading: true, list: [] });
    try {
      setDrives({ loading: false, list: await desktop.listDrives() });
    } catch {
      setDrives({ loading: false, list: [], failed: true });
    }
  }

  const percent = state.total ? Math.round((state.done / state.total) * 100) : 0;

  return (
    <Dropzone onDrop={accepted => open(accepted)} noClick noKeyboard multiple disabled={busy}>
      {({ getRootProps, isDragActive }) => (
        <div {...getRootProps()} className="min-h-screen w-full overflow-y-auto bg-background text-foreground">
          <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-6">
            <SpectraMark />
            <ExternalLink href={links.learnMoreUrl} className="text-sm font-medium text-primary hover:underline">
              About Actecal Spectra
            </ExternalLink>
          </header>

          <main className="mx-auto max-w-5xl px-6 pb-16">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Free DICOM viewer</h1>
            <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
              {desktop
                ? 'Open CT, MRI, X-ray and ultrasound studies from your files, a folder, a ZIP, or a CD, DVD or USB drive. They open on this computer and nothing is uploaded.'
                : 'Open CT, MRI, X-ray and ultrasound studies from your files, a folder or a ZIP. They open in this browser tab and are never uploaded.'}
            </p>

            {notice && notices[notice] && (
              <p role="status" className="mt-6 rounded-lg border border-input bg-muted px-4 py-3 text-sm">
                {notices[notice]}
              </p>
            )}

            <section
              aria-label="Open DICOM files"
              className={`mt-8 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${isDragActive ? 'border-primary bg-primary/10' : 'border-input bg-muted/40'}`}
            >
              {state.status === 'scanning' ? (
                <div role="status" aria-live="polite">
                  <p className="text-lg font-medium">Looking for DICOM files{search?.label ? ` in ${search.label}` : ''}…</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {search?.checked ? `${Number(search.checked).toLocaleString()} files checked, ${Number(search.found || 0).toLocaleString()} found` : '\u00a0'}
                  </p>
                  <button type="button" onClick={() => desktop?.cancelScan()} className={`${BUTTON} mt-4 border border-input hover:bg-muted`}>
                    Cancel
                  </button>
                </div>
              ) : busy ? (
                <div role="status" aria-live="polite">
                  <p className="text-lg font-medium">{state.total ? `Reading ${state.done} of ${state.total} files…` : 'Reading the files…'}</p>
                  <div className="mx-auto mt-4 h-2 max-w-sm overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-xl font-medium">Drop DICOM files, a folder or a ZIP file here</p>
                  <p className="mt-1 text-sm text-muted-foreground">or choose them</p>
                  <div className="mt-6 flex flex-wrap justify-center gap-3">
                    {desktop ? (
                      <>
                        <button type="button" onClick={() => ask(desktop.pickFiles)} className={`${BUTTON} bg-primary text-primary-foreground hover:opacity-90`}>
                          Open files or a ZIP
                        </button>
                        <button type="button" onClick={() => ask(desktop.pickFolder)} className={`${BUTTON} border border-input hover:bg-muted`}>
                          Open a folder
                        </button>
                        <button
                          type="button"
                          onClick={showDrives}
                          aria-expanded={Boolean(drives)}
                          aria-controls="desktop-drives"
                          className={`${BUTTON} border border-input hover:bg-muted`}
                        >
                          Open a CD, DVD or USB drive
                        </button>
                      </>
                    ) : (
                      <>
                        <label className={`${PICKER} bg-primary text-primary-foreground hover:opacity-90`}>
                          Open files or a ZIP
                          <input
                            id="offline-open-files"
                            type="file"
                            multiple
                            className="sr-only"
                            onChange={event => {
                              open(event.target.files);
                              event.target.value = '';
                            }}
                          />
                        </label>
                        <label className={`${PICKER} border border-input hover:bg-muted`}>
                          Open a folder
                          <input
                            id="offline-open-folder"
                            type="file"
                            multiple
                            // Folder picker in Chrome, Edge, Firefox and Safari.
                            {...{ webkitdirectory: '', directory: '' }}
                            className="sr-only"
                            onChange={event => {
                              open(event.target.files);
                              event.target.value = '';
                            }}
                          />
                        </label>
                      </>
                    )}
                  </div>
                </>
              )}
              {state.status === 'error' && (
                <p role="alert" className="mx-auto mt-6 max-w-xl text-sm text-destructive">
                  {state.message}
                </p>
              )}
            </section>

            {desktop && drives && (
              <section id="desktop-drives" aria-labelledby="desktop-drives-heading" className="mt-6 rounded-xl border border-input bg-muted/40 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="desktop-drives-heading" className="text-lg font-semibold">
                    CDs, DVDs and USB drives
                  </h2>
                  <div className="flex gap-2">
                    <button type="button" onClick={showDrives} disabled={drives.loading} className={`${BUTTON} border border-input hover:bg-muted`}>
                      Refresh
                    </button>
                    <button type="button" onClick={() => setDrives(null)} className={`${BUTTON} hover:bg-muted`}>
                      Close
                    </button>
                  </div>
                </div>
                {drives.loading ? (
                  <p role="status" className="mt-4 text-sm text-muted-foreground">
                    Looking for drives…
                  </p>
                ) : drives.list.length ? (
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                    {drives.list.map(drive => (
                      <li key={drive.id} className="flex items-center justify-between gap-4 rounded-lg border border-input bg-background p-4">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{drive.name}</span>
                          <span className="block text-sm text-muted-foreground">
                            {DRIVE_KINDS[drive.kind] || DRIVE_KINDS.drive}
                            {drive.dicomdir ? ' · DICOM disc' : ''}
                          </span>
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => ask(() => desktop.openDrive(drive.id))}
                          aria-label={`Open ${drive.name}`}
                          className={`${BUTTON} bg-primary text-primary-foreground hover:opacity-90`}
                        >
                          Open
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    {drives.failed ? 'The drives could not be listed.' : 'No CD, DVD or USB drive was found.'} Insert one and press Refresh, or use Open a
                    folder.
                  </p>
                )}
              </section>
            )}

            <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
              <li>Files stay on this device</li>
              <li>Scroll, zoom, window level and measure</li>
              <li>DICOM tag browser</li>
              <li>For viewing and education only; not for diagnostic use</li>
            </ul>

            <section aria-labelledby="premium-heading" className="mt-14">
              <h2 id="premium-heading" className="text-xl font-semibold">
                Unlock more with Actecal Spectra
              </h2>
              <p className="mt-2 max-w-2xl text-muted-foreground">
                The full Spectra is a cloud PACS for hospitals and diagnostic centres, connected to Actecal HMS.
              </p>
              <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {PREMIUM_FEATURES.map(feature => (
                  <li key={feature.id} className="rounded-lg border border-input bg-muted/40 p-4">
                    <p className="flex items-center gap-2 font-medium">
                      <LockIcon className="h-4 w-4 text-primary" />
                      {feature.title}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{feature.text}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap gap-3">
                <PremiumActions />
              </div>
            </section>
          </main>

          <footer className="border-t border-input">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-sm text-muted-foreground">
              <p>
                © Actecal Private Limited
                {desktop?.version ? ` · Spectra Desktop ${desktop.version}` : ''}
              </p>
              <p className="flex gap-4">
                <ExternalLink href="https://actecal.com/" className="hover:text-foreground">
                  actecal.com
                </ExternalLink>
                <ExternalLink href={links.privacyUrl} className="hover:text-foreground">
                  Privacy policy
                </ExternalLink>
              </p>
            </div>
          </footer>
        </div>
      )}
    </Dropzone>
  );
}
