// Home page of the offline edition (the '/' custom route): open DICOM files, a folder or a ZIP, then go
// to the viewer. Everything stays in this browser tab; nothing is uploaded.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Dropzone from 'react-dropzone';
import { MODULE_TYPES } from '@ohif/core';
import { collectFiles, loadItems } from '../loadDicomFiles';
import { PREMIUM_FEATURES, premiumLinks } from '../premium';
import { PremiumActions } from './PremiumContent';
import { ExternalLink, LockIcon, SpectraMark } from './ui';

const NOTICES = {
  reloaded: 'The study was cleared when the page reloaded. Files stay only in this tab and are never stored, so open them again to continue.',
  notfound: 'That page does not exist. Open your DICOM files to start.',
};

const PICKER =
  'relative inline-flex cursor-pointer items-center justify-center rounded-md px-4 py-2 text-sm font-semibold focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary';

function describeProblems(problems, skipped) {
  const notes = [];
  if (problems.noZipSupport) notes.push('This browser cannot open ZIP files; unzip it and open the folder instead.');
  if (problems.badZip) notes.push('A ZIP file could not be read; it may be damaged.');
  if (problems.encrypted) notes.push('Password-protected ZIP entries were skipped; unzip them with the password first.');
  if (problems.method) notes.push('Some ZIP entries use a compression method this viewer cannot read.');
  if (skipped) notes.push(`${skipped} file${skipped === 1 ? ' was' : 's were'} not DICOM images and ${skipped === 1 ? 'was' : 'were'} skipped.`);
  return notes.join(' ');
}

export default function OfflineHome({ extensionManager, notice }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'idle', done: 0, total: 0, message: '' });
  const links = premiumLinks();
  const busy = state.status === 'reading';

  useEffect(() => {
    document.title = 'Free DICOM viewer · Actecal Spectra';
    document.body.classList.add('bg-background');
    return () => document.body.classList.remove('bg-background');
  }, []);

  // As in the upstream Local route: the local data source must exist before files are loaded.
  useEffect(() => {
    const modules = extensionManager?.modules?.[MODULE_TYPES.DATA_SOURCE] || [];
    const local = modules.flatMap(entry => entry.module).find(module => module.type === 'localApi');
    local?.createDataSource({});
  }, [extensionManager]);

  async function open(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || busy) return;
    setState({ status: 'reading', done: 0, total: 0, message: '' });
    try {
      const { items, problems } = await collectFiles(files);
      if (!items.length) {
        setState({ status: 'error', done: 0, total: 0, message: describeProblems(problems, 0) || 'No files to open.' });
        return;
      }
      setState(current => ({ ...current, total: items.length }));
      const result = await loadItems(items, (done, total) => setState(current => ({ ...current, done, total })));
      if (!result.studies.length) {
        setState({
          status: 'error',
          done: 0,
          total: 0,
          message: `No DICOM images were found. ${describeProblems(problems, result.skipped)}`.trim(),
        });
        return;
      }
      const query = new URLSearchParams();
      result.studies.forEach(uid => query.append('StudyInstanceUIDs', uid));
      query.append('datasources', 'dicomlocal');
      navigate(`/viewer/dicomlocal?${query.toString()}`);
    } catch {
      setState({ status: 'error', done: 0, total: 0, message: 'These files could not be opened. Try a folder of .dcm files or another ZIP.' });
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
              Open CT, MRI, X-ray and ultrasound studies from your files, a folder or a ZIP. They open in this browser tab and are never uploaded.
            </p>

            {notice && NOTICES[notice] && (
              <p role="status" className="mt-6 rounded-lg border border-input bg-muted px-4 py-3 text-sm">
                {NOTICES[notice]}
              </p>
            )}

            <section
              aria-label="Open DICOM files"
              className={`mt-8 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${isDragActive ? 'border-primary bg-primary/10' : 'border-input bg-muted/40'}`}
            >
              {busy ? (
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
                  </div>
                </>
              )}
              {state.status === 'error' && (
                <p role="alert" className="mx-auto mt-6 max-w-xl text-sm text-destructive">
                  {state.message}
                </p>
              )}
            </section>

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
              <p>© Actecal Private Limited</p>
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
