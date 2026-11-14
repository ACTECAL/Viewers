// Opening studies in the viewer, shared by the web home page (components/WebHome.tsx) and Spectra Desktop's
// library (components/library/LibraryHome.tsx): load the files into the in-memory dicomlocal data source
// (loadDicomFiles.js), then go to the viewer with this batch's studies. Also the wording of what went wrong.
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MODULE_TYPES } from '@ohif/core';
import { loadItems } from './loadDicomFiles';

export const IDLE = { status: 'idle', done: 0, total: 0, message: '' };
export const FAILED = 'These files could not be opened. Try a folder of .dcm files or another ZIP.';

export const count = (n, one, many) => `${Number(n || 0).toLocaleString()} ${n === 1 ? one : many}`;

export function describeProblems(problems, skipped) {
  const notes = [];
  if (problems.noZipSupport)
    notes.push('This browser cannot open ZIP files; unzip it and open the folder instead.');
  if (problems.badZip) notes.push('A ZIP file could not be read; it may be damaged.');
  if (problems.encrypted)
    notes.push('Password-protected ZIP entries were skipped; unzip them with the password first.');
  if (problems.method)
    notes.push('Some ZIP entries use a compression method this viewer cannot read.');
  if (skipped)
    notes.push(
      `${skipped} file${skipped === 1 ? ' was' : 's were'} not DICOM images and ${skipped === 1 ? 'was' : 'were'} skipped.`
    );
  return notes.join(' ');
}

// Spectra Desktop: what the app's search adds to a message (files missing from a DICOMDIR, unreadable, too many).
export function scanNotes(scan) {
  const notes = [];
  const missing = scan.dicomdir?.missing || 0;
  if (missing)
    notes.push(
      `${count(missing, 'file', 'files')} listed in the DICOMDIR ${missing === 1 ? 'was' : 'were'} not found.`
    );
  if (scan.unreadable)
    notes.push(
      `${count(scan.unreadable, 'file or folder', 'files or folders')} could not be read.`
    );
  if (scan.truncated)
    notes.push(
      `The search stopped after ${Number(scan.limit || 0).toLocaleString()} files; open the folder that holds the study.`
    );
  return notes.join(' ');
}

// As in the upstream Local route: the local data source must exist before files are loaded.
export function ensureLocalDataSource(extensionManager) {
  const modules = extensionManager?.modules?.[MODULE_TYPES.DATA_SOURCE] || [];
  const local = modules.flatMap(entry => entry.module).find(module => module.type === 'localApi');
  local?.createDataSource({});
}

/**
 * { state, setState, load }. load(items, problems, notes, empty) reads the items with progress in state
 * ({ status: 'reading', done, total }), then opens the viewer, or sets state to an error: `notes` are added to the
 * message when nothing opens, and `empty` replaces it when there was nothing to read. Resolves to true when the
 * viewer opened.
 */
export function useStudyOpener() {
  const navigate = useNavigate();
  const [state, setState] = useState(IDLE);
  const load = useCallback(
    async (items, problems, notes = '', empty = '') => {
      if (!items.length) {
        setState({
          ...IDLE,
          status: 'error',
          message: empty || describeProblems(problems, 0) || 'No files to open.',
        });
        return false;
      }
      setState(current => ({ ...current, status: 'reading', total: items.length }));
      const result = await loadItems(items, (done, total) =>
        setState(current => ({ ...current, done, total }))
      );
      if (!result.studies.length) {
        setState({
          ...IDLE,
          status: 'error',
          message:
            `No DICOM images were found. ${describeProblems(problems, result.skipped)} ${notes}`.trim(),
        });
        return false;
      }
      const query = new URLSearchParams();
      result.studies.forEach(uid => query.append('StudyInstanceUIDs', uid));
      query.append('datasources', 'dicomlocal');
      navigate(`/viewer/dicomlocal?${query.toString()}`);
      return true;
    },
    [navigate]
  );
  return { state, setState, load };
}
