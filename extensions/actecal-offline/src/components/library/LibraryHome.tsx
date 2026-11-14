// Spectra Desktop's home page: the study library (TASK_PLAN 13, phase 2), as in other desktop DICOM viewers.
// Studies are imported (copied) from files, folders, ZIP files and CD, DVD or USB drives, listed with search,
// filters and sorting, and opened, exported or deleted. Studies can also be opened without importing them, which
// is how files opened with the app from Finder or Explorer arrive. The app does the work (desktop/src/main) and
// this page talks to it through window.spectraDesktop (../../desktop.js). Back to Library reloads this page, which
// frees the viewer's memory; the search, filters and selection are kept for the window's session.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getDesktop, itemsFromScan } from '../../desktop';
import { FAILED, IDLE, ensureLocalDataSource, scanNotes, useStudyOpener } from '../../opening';
import { premiumLinks } from '../../premium';
import { ExternalLink, SpectraMark } from '../ui';
import { Button, Icon, MenuButton, Modal, Progress } from './controls';
import { DrivesDialog, DropDialog, SettingsDialog } from './LibraryDialogs';
import StudyDetails from './StudyDetails';
import StudyTable from './StudyTable';
import { DATE_RANGES, count, fileManager, formatBytes, rangeDates } from './format';

const VIEW_KEY = 'spectra.library.view';
const DISMISSED_KEY = 'spectra.library.dismissedDrives';
const NOTICES = {
  reloaded: 'The study was closed. Open it again from the library.',
  notfound: 'That page does not exist.',
};
const BUSY = {
  import: 'An import is running. Wait for it to finish, or cancel it, and try again.',
  export: 'An export is running. Wait for it to finish, or cancel it, and try again.',
  move: 'The library is being moved. Wait for it to finish and try again.',
};
// Names sort A to Z first, dates and counts newest or largest first.
const FIRST_DIRECTION = { patientName: 'asc', patientID: 'asc', description: 'asc' };
const TONES = {
  success: 'border-primary/40 bg-primary/10',
  info: 'border-input bg-muted/60',
  error: 'border-destructive/50 bg-destructive/10',
};

function readSession(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is full or off; the view is simply not kept.
  }
}

function restoreView() {
  const saved = readSession(VIEW_KEY) || {};
  const strings = list =>
    Array.isArray(list) ? list.filter(value => typeof value === 'string') : [];
  return {
    text: typeof saved.text === 'string' ? saved.text : '',
    modalities: strings(saved.modalities),
    range: DATE_RANGES.some(range => range.id === saved.range) ? saved.range : 'any',
    sort: typeof saved.sort === 'string' ? saved.sort : 'studyDate',
    direction: saved.direction === 'asc' ? 'asc' : 'desc',
    selected: strings(saved.selected).slice(0, 200),
  };
}

const queryOf = view => ({
  text: view.text,
  modalities: view.modalities,
  ...rangeDates(view.range),
  sort: view.sort,
  direction: view.direction,
  limit: 1000,
});

const refusalSummary = outcome => ({
  tone: 'error',
  text:
    outcome.refused === 'busy'
      ? BUSY[outcome.task] || BUSY.import
      : 'The library is not available.',
});

function importSummary(result) {
  const added = result.added || 0;
  const label = result.label || 'the files';
  const notes = [];
  if (result.duplicates)
    notes.push(`${count(result.duplicates, 'image was', 'images were')} already in the library.`);
  if (result.skipped) notes.push(`${count(result.skipped, 'file was', 'files were')} not DICOM.`);
  if (result.unreadable)
    notes.push(
      `${count(result.unreadable, 'file or folder', 'files or folders')} could not be read.`
    );
  if (result.failed) notes.push(`${count(result.failed, 'file', 'files')} could not be copied.`);
  if (result.zip?.encrypted)
    notes.push('Password-protected ZIP entries were skipped; unzip them with the password first.');
  if (result.zip?.method)
    notes.push('Some ZIP entries use a compression method Spectra Desktop cannot read.');
  if (result.zip?.bad)
    notes.push(`${count(result.zip.bad, 'ZIP file', 'ZIP files')} could not be read.`);
  const missing = result.dicomdir?.missing || 0;
  if (missing)
    notes.push(
      `${count(missing, 'file', 'files')} listed in the DICOMDIR ${missing === 1 ? 'was' : 'were'} not found.`
    );
  if (result.truncated)
    notes.push(
      `The search stopped after ${Number(result.limit || 0).toLocaleString()} files; import the folder that holds the study.`
    );
  let tone = 'success';
  let text;
  if (result.failedAll) {
    tone = 'error';
    text = 'The import stopped because of an error.';
  } else if (result.diskFull) {
    tone = 'error';
    text = `The disk is full. ${count(added, 'image was', 'images were')} imported before it filled up.`;
  } else if (result.cancelled) {
    tone = 'info';
    text = `Import cancelled. ${count(added, 'image was', 'images were')} imported before it stopped.`;
  } else if (added) {
    text = `Imported ${count(added, 'image', 'images')} in ${count(result.studiesAdded?.length || 0, 'study', 'studies')} from ${label}.`;
  } else if (result.duplicates) {
    tone = 'info';
    text = `The studies in ${label} are already in the library.`;
  } else {
    tone = 'error';
    text = `No DICOM files were found in ${label}.`;
  }
  return { tone, text: [text, ...notes].join(' '), studies: (result.studies || []).slice(0, 50) };
}

function exportSummary(result) {
  if (result.error)
    return {
      tone: 'error',
      text:
        result.error === 'disk-full'
          ? 'The disk is full, so the export stopped.'
          : 'The export failed.',
    };
  const missing = result.missing
    ? ` ${count(result.missing, 'file was', 'files were')} missing from the library folder.`
    : '';
  if (result.cancelled)
    return {
      tone: 'info',
      text: `Export cancelled after ${count(result.files, 'image', 'images')}.${missing}`,
      reveal: true,
    };
  return {
    tone: 'success',
    text: `Exported ${count(result.studies, 'study', 'studies')} (${count(result.files, 'image', 'images')}) to ${result.destination}.${missing}`,
    reveal: true,
  };
}

function taskText(task) {
  if (task.task === 'export')
    return task.total
      ? `Exporting ${Number(task.done || 0).toLocaleString()} of ${count(task.total, 'image', 'images')}…`
      : 'Exporting…';
  if (task.phase === 'importing') {
    return task.total
      ? `Importing ${Number(task.done || 0).toLocaleString()} of ${count(task.total, 'file', 'files')} from ${task.label}…`
      : `Importing from ${task.label}…`;
  }
  const checked = task.checked
    ? ` ${count(task.checked, 'file', 'files')} checked, ${Number(task.found || 0).toLocaleString()} found.`
    : '';
  return `Looking for DICOM files in ${task.label}…${checked}`;
}

export default function LibraryHome({ extensionManager, notice }) {
  const desktop = getDesktop();
  const { state: opening, setState: setOpening, load } = useStudyOpener();
  const [info, setInfo] = useState(null);
  const [view, setView] = useState(restoreView);
  const [list, setList] = useState({ total: 0, studies: [], ready: false });
  const [details, setDetails] = useState(null);
  const [task, setTask] = useState(null);
  const [scanProgress, setScanProgress] = useState(null);
  const [summary, setSummary] = useState(null);
  const [drives, setDrives] = useState({ list: [], loading: true, failed: false });
  const [drivesDialog, setDrivesDialog] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    const saved = readSession(DISMISSED_KEY);
    return Array.isArray(saved) ? saved : [];
  });
  const [dropped, setDropped] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showNotice, setShowNotice] = useState(Boolean(notice && NOTICES[notice]));
  const searchBox = useRef(null);
  // The scan this page waits for (opening without importing): its progress is shown only while it is awaited.
  const waiting = useRef(null);
  const dragDepth = useRef(0);
  const anchor = useRef(null);
  const sequence = useRef(0);
  const refreshTimer = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const selected = view.selected;
  const busyOpening = opening.status === 'reading' || opening.status === 'scanning';
  const working = Boolean(task);
  const setSelected = useCallback(uids => setView(current => ({ ...current, selected: uids })), []);

  // The library's totals and the studies for the current search. Answers that arrive after a newer request are
  // dropped. Resolves to the list, or null.
  const reload = useCallback(async () => {
    const mine = ++sequence.current;
    try {
      const next = await desktop.libraryInfo();
      if (mine !== sequence.current) return null;
      setInfo(next);
      if (next.task) setTask(current => current || next.task);
      if (!next.available) {
        setList({ total: 0, studies: [], ready: true });
        return null;
      }
      const result = await desktop.listStudies(queryOf(viewRef.current));
      if (mine !== sequence.current) return null;
      setList({ ...result, ready: true });
      return result;
    } catch {
      if (mine === sequence.current) setList(current => ({ ...current, ready: true }));
      return null;
    }
  }, []);

  function refreshSoon() {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      reload();
    }, 1500);
  }

  useEffect(() => {
    document.title = 'Spectra Desktop';
    document.body.classList.add('bg-background');
    return () => {
      document.body.classList.remove('bg-background');
      clearTimeout(refreshTimer.current);
    };
  }, []);

  useEffect(() => ensureLocalDataSource(extensionManager), [extensionManager]);

  // The search, filters and selection survive Back to Library (a reload of this page).
  useEffect(() => writeSession(VIEW_KEY, view), [view]);

  const listKey = JSON.stringify([
    view.text,
    view.modalities,
    view.range,
    view.sort,
    view.direction,
  ]);
  useEffect(() => {
    const timer = setTimeout(reload, list.ready ? 150 : 0);
    return () => clearTimeout(timer);
  }, [listKey]);

  // Only studies in the list stay selected.
  useEffect(() => {
    if (!list.ready) return;
    setView(current => {
      const visible = new Set(list.studies.map(study => study.studyUID));
      const kept = current.selected.filter(uid => visible.has(uid));
      return kept.length === current.selected.length ? current : { ...current, selected: kept };
    });
  }, [list]);

  const single = selected.length === 1 ? selected[0] : null;
  useEffect(() => {
    if (!single || !info?.available) {
      setDetails(null);
      return undefined;
    }
    let active = true;
    desktop.getStudy(single).then(
      study => active && setDetails(study),
      () => active && setDetails(null)
    );
    return () => {
      active = false;
    };
  }, [single, info?.available, list]);

  // The app's progress and finished jobs, and what the menu or the operating system asked for.
  const handlers = useRef(null);
  handlers.current = { finished: onTaskFinished, pending: onPending };
  useEffect(() => {
    let active = true;
    const stop = desktop.onProgress(progress => {
      if (!active || !progress) return;
      if (progress.task === 'scan') {
        if (!waiting.current) return;
        setScanProgress(progress);
        setOpening(current =>
          current.status === 'reading' ? current : { ...IDLE, status: 'scanning' }
        );
        return;
      }
      if (progress.finished) {
        setTask(null);
        handlers.current.finished(progress.task, progress.result || {});
        return;
      }
      setTask(progress);
      if (progress.task === 'import') refreshSoon();
    });
    const token = {};
    waiting.current = token;
    desktop.takePending().then(
      request => {
        if (waiting.current === token) waiting.current = null;
        if (active) handlers.current.pending(request);
      },
      () => {
        if (waiting.current === token) waiting.current = null;
        if (active) setOpening({ ...IDLE, status: 'error', message: FAILED });
      }
    );
    return () => {
      active = false;
      stop();
    };
  }, []);

  // CD, DVD and USB drives, checked every few seconds while the window is visible, for the disc banner.
  const listDrives = useCallback(async () => {
    try {
      const found = await desktop.listDrives();
      setDrives({ list: found, loading: false, failed: false });
    } catch {
      setDrives(current => ({ ...current, loading: false, failed: true }));
    }
  }, []);
  // Windows lists drives through PowerShell, which costs more, so it is asked less often. Coming back to the window
  // (after inserting a disc) checks at once.
  useEffect(() => {
    let stopped = false;
    let timer = null;
    let last = 0;
    const poll = async () => {
      clearTimeout(timer);
      if (document.visibilityState !== 'hidden') {
        last = Date.now();
        await listDrives();
      }
      if (!stopped) timer = setTimeout(poll, desktop.platform === 'win32' ? 8000 : 4000);
    };
    const onFocus = () => {
      if (Date.now() - last > 1500) poll();
    };
    poll();
    window.addEventListener('focus', onFocus);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Ctrl+F, Cmd+F or / go to the search box.
  useEffect(() => {
    const onKeyDown = event => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName);
      if (
        (event.key === 'f' && (event.metaKey || event.ctrlKey)) ||
        (event.key === '/' && !typing)
      ) {
        event.preventDefault();
        searchBox.current?.focus();
        searchBox.current?.select();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  async function onTaskFinished(kind, result) {
    if (kind === 'import') {
      const outcome = importSummary(result);
      setSummary(outcome);
      const fresh = await reload();
      if (fresh && outcome.studies.length) {
        const visible = new Set(fresh.studies.map(study => study.studyUID));
        const shown = outcome.studies.filter(uid => visible.has(uid));
        if (shown.length) setSelected(shown);
      }
    } else if (kind === 'export') {
      setSummary(exportSummary(result));
    } else if (kind === 'move') {
      setSummary(
        result.error
          ? { tone: 'error', text: result.error }
          : { tone: 'success', text: `The library is now in ${result.root}.` }
      );
      reload();
    }
  }

  function onPending(request) {
    if (!request) return;
    if (request.action === 'open') finishScan(request);
    else if (request.action === 'import') {
      if (request.result?.refused) setSummary(refusalSummary(request.result));
    } else if (request.action === 'drives')
      openDrivesDialog(request.purpose === 'import' ? 'import' : 'open');
    else if (request.action === 'settings') setSettingsOpen(true);
  }

  // ---------- Opening without importing ----------

  // The answer to a picker, a drive, a drop or takePending(): what the app found, or nothing (cancelled).
  async function finishScan(result) {
    setScanProgress(null);
    if (!result || result.cancelled) {
      setOpening(current => (current.status === 'scanning' ? IDLE : current));
      return;
    }
    setOpening({ ...IDLE, status: 'reading' });
    try {
      const { items, problems } = await itemsFromScan(result);
      const notes = scanNotes(result);
      const nothing = !result.files?.length && !result.zips?.length;
      const empty = nothing
        ? `No DICOM files were found${result.label ? ` in ${result.label}` : ''}. ${notes}`.trim()
        : '';
      await load(items, problems, notes, empty);
    } catch {
      setOpening({ ...IDLE, status: 'error', message: FAILED });
    }
  }

  function ask(request) {
    if (busyOpening) return;
    setSummary(null);
    const token = {};
    waiting.current = token;
    request().then(
      result => {
        if (waiting.current === token) waiting.current = null;
        finishScan(result);
      },
      () => {
        if (waiting.current === token) waiting.current = null;
        setOpening({ ...IDLE, status: 'error', message: FAILED });
      }
    );
  }

  // ---------- The library ----------

  async function openStudies(uids) {
    const chosen = (uids || []).slice(0, 50);
    if (!chosen.length || busyOpening) return;
    setSummary(null);
    setOpening({ ...IDLE, status: 'reading' });
    try {
      const result = await desktop.openStudies(chosen);
      if (!result.files.length) {
        setOpening({
          ...IDLE,
          status: 'error',
          message:
            'The files of this study are missing from the library folder. Delete the study and import it again.',
        });
        return;
      }
      const { items, problems } = await itemsFromScan(result);
      const notes = result.missing
        ? `${count(result.missing, 'file is', 'files are')} missing from the library folder.`
        : '';
      await load(items, problems, notes);
    } catch {
      setOpening({ ...IDLE, status: 'error', message: 'The study could not be opened.' });
    }
  }

  async function startImport(request) {
    setSummary(null);
    try {
      const outcome = await request();
      if (outcome?.refused) setSummary(refusalSummary(outcome));
      // A finished import is reported through onProgress (onTaskFinished).
    } catch {
      setSummary({ tone: 'error', text: 'The import could not start.' });
    }
  }

  async function exportStudies(uids) {
    if (!uids.length) return;
    setSummary(null);
    try {
      const outcome = await desktop.exportStudies(uids);
      if (outcome?.refused) setSummary(refusalSummary(outcome));
    } catch {
      setSummary({ tone: 'error', text: 'The export could not start.' });
    }
  }

  async function deleteStudies(uids) {
    if (!uids.length || working) return;
    try {
      const outcome = await desktop.deleteStudies(uids);
      if (!outcome) return;
      if (outcome.refused) {
        setSummary(refusalSummary(outcome));
        return;
      }
      setSummary({
        tone: 'success',
        text: `Deleted ${count(outcome.deleted, 'study', 'studies')} from the library.`,
      });
      setSelected([]);
      reload();
    } catch {
      setSummary({ tone: 'error', text: 'The studies could not be deleted.' });
    }
  }

  async function changeLibrary(option) {
    try {
      const outcome = await desktop.changeLibrary(option);
      if (!outcome) return;
      if (outcome.refused) {
        setSummary(refusalSummary(outcome));
        return;
      }
      if (outcome.error) setSummary({ tone: 'error', text: outcome.error });
      if (outcome.info) setInfo(outcome.info);
      setSelected([]);
      reload();
    } catch {
      setSummary({ tone: 'error', text: 'The library folder could not be changed.' });
    }
  }

  // A right-click on a study: on a selected study the menu acts on the whole selection, on another study it selects
  // that study first, as file managers do.
  async function studyMenu(uid) {
    const uids = selected.includes(uid) ? selected : [uid];
    if (!selected.includes(uid)) {
      setSelected([uid]);
      anchor.current = uid;
    }
    let action = null;
    try {
      action = await desktop.showStudyMenu(uids.length);
    } catch {
      return;
    }
    if (action === 'open') openStudies(uids);
    else if (action === 'export') exportStudies(uids);
    else if (action === 'delete') deleteStudies(uids);
  }

  function openDrivesDialog(purpose) {
    setDrivesDialog(purpose);
    listDrives();
  }

  function dismissDrive(id) {
    const next = [...dismissed, id];
    setDismissed(next);
    writeSession(DISMISSED_KEY, next);
  }

  function select(uid, event = {}) {
    const order = list.studies.map(study => study.studyUID);
    if (event.toggle || event.metaKey || event.ctrlKey) {
      setSelected(
        selected.includes(uid) ? selected.filter(entry => entry !== uid) : [...selected, uid]
      );
      anchor.current = uid;
    } else if (event.shiftKey && anchor.current && order.includes(anchor.current)) {
      const from = order.indexOf(anchor.current);
      const to = order.indexOf(uid);
      setSelected(order.slice(Math.min(from, to), Math.max(from, to) + 1));
    } else {
      setSelected([uid]);
      anchor.current = uid;
    }
  }

  function sortBy(column) {
    setView(current =>
      current.sort === column
        ? { ...current, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { ...current, sort: column, direction: FIRST_DIRECTION[column] || 'desc' }
    );
  }

  const toggleModality = code =>
    setView(current => ({
      ...current,
      modalities: current.modalities.includes(code)
        ? current.modalities.filter(entry => entry !== code)
        : [...current.modalities, code],
    }));
  const filtered = Boolean(view.text.trim() || view.modalities.length || view.range !== 'any');
  const clearFilters = () =>
    setView(current => ({ ...current, text: '', modalities: [], range: 'any' }));

  // Dropped files and folders: import them or open them without importing (DropDialog).
  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  const dropHandlers = {
    onDragEnter: event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: event => {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop: event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer.files || []);
      if (files.length && !busyOpening) setDropped(files);
    },
  };

  const importItems = [
    {
      label: 'Files or a ZIP…',
      hint: 'Copy DICOM files or ZIP files into the library',
      onSelect: () => startImport(desktop.importFiles),
    },
    {
      label: 'Folder…',
      hint: 'Copy the studies in a folder',
      onSelect: () => startImport(desktop.importFolder),
    },
    {
      label: 'CD, DVD or USB drive…',
      hint: 'Copy the studies on a disc or drive',
      onSelect: () => openDrivesDialog('import'),
    },
  ];
  const openItems = [
    {
      label: 'Files or a ZIP…',
      hint: 'View now without keeping a copy',
      onSelect: () => ask(desktop.pickFiles),
    },
    {
      label: 'Folder…',
      hint: 'View now without keeping a copy',
      onSelect: () => ask(desktop.pickFolder),
    },
    {
      label: 'CD, DVD or USB drive…',
      hint: 'View now without keeping a copy',
      onSelect: () => openDrivesDialog('open'),
    },
  ];

  const links = premiumLinks();
  const available = Boolean(info?.available);
  const disc = drives.list.find(drive => drive.dicomdir && !dismissed.includes(drive.id));
  const empty = available && info.studies === 0 && !filtered;
  const shown = list.studies.length;
  const listCount =
    list.total > shown
      ? `Showing ${shown.toLocaleString()} of ${count(list.total, 'study', 'studies')}`
      : count(list.total, 'study', 'studies');
  const moving = task?.task === 'move';

  return (
    <div
      className="bg-background text-foreground relative flex h-screen w-full flex-col overflow-hidden"
      {...dropHandlers}
    >
      <header className="border-input flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <SpectraMark />
        <h1 className="ml-2 text-lg font-semibold">Library</h1>
        <div className="relative ml-auto min-w-[14rem] max-w-md flex-1">
          <Icon
            name="search"
            className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
          />
          <input
            ref={searchBox}
            type="search"
            aria-label="Search the library"
            placeholder="Search name, ID, accession, description"
            value={view.text}
            disabled={!available}
            onChange={event => setView(current => ({ ...current, text: event.target.value }))}
            className="border-input bg-background placeholder:text-muted-foreground focus:ring-primary w-full rounded-md border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 disabled:opacity-50"
          />
        </div>
        <MenuButton
          label="Import"
          variant="primary"
          disabled={!available || working}
          items={importItems}
          align="right"
        />
        <MenuButton
          label="Open"
          items={openItems}
          align="right"
          disabled={busyOpening}
        />
        <Button
          variant="ghost"
          aria-label="Settings"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
          disabled={!info}
        >
          <Icon
            name="settings"
            className="h-5 w-5"
          />
        </Button>
      </header>

      <div className="space-y-2 px-4 empty:hidden [&:not(:empty)]:pt-3">
        {showNotice && (
          <div
            role="status"
            className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm ${TONES.info}`}
          >
            <span>{NOTICES[notice]}</span>
            <Button
              variant="ghost"
              size="small"
              onClick={() => setShowNotice(false)}
            >
              Dismiss
            </Button>
          </div>
        )}
        {disc && available && !working && (
          <div
            role="status"
            aria-label="DICOM disc"
            className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm ${TONES.success}`}
          >
            <span className="flex items-center gap-2">
              <Icon
                name="disc"
                className="text-primary h-5 w-5"
              />
              <span>
                <span className="font-medium">{disc.name}</span> is a DICOM disc.
              </span>
            </span>
            <span className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="small"
                onClick={() => {
                  dismissDrive(disc.id);
                  startImport(() => desktop.importDrive(disc.id));
                }}
              >
                Import into the library
              </Button>
              <Button
                size="small"
                onClick={() => {
                  dismissDrive(disc.id);
                  ask(() => desktop.openDrive(disc.id));
                }}
              >
                Open without importing
              </Button>
              <Button
                variant="ghost"
                size="small"
                onClick={() => dismissDrive(disc.id)}
              >
                Not now
              </Button>
            </span>
          </div>
        )}
        {task && !moving && (
          <div
            role="status"
            aria-live="polite"
            aria-label={task.task === 'export' ? 'Export' : 'Import'}
            className={`rounded-lg border px-4 py-3 text-sm ${TONES.info}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span>{taskText(task)}</span>
              <Button
                variant="ghost"
                size="small"
                onClick={() => desktop.cancel(task.task)}
              >
                Cancel
              </Button>
            </div>
            <div className="mt-2">
              <Progress
                label={task.task === 'export' ? 'Export' : 'Import'}
                done={task.done}
                total={task.phase === 'importing' || task.task === 'export' ? task.total : 0}
              />
            </div>
          </div>
        )}
        {summary && (
          <div
            role={summary.tone === 'error' ? 'alert' : 'status'}
            className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm ${TONES[summary.tone]}`}
          >
            <span className="min-w-0 break-words">{summary.text}</span>
            <span className="flex flex-wrap gap-2">
              {summary.studies?.length > 0 && (
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => openStudies(summary.studies)}
                >
                  {summary.studies.length === 1 ? 'Open the study' : 'Open the studies'}
                </Button>
              )}
              {summary.reveal && (
                <Button
                  size="small"
                  onClick={() => desktop.revealExport()}
                >
                  Show in {fileManager(desktop.platform)}
                </Button>
              )}
              <Button
                variant="ghost"
                size="small"
                onClick={() => setSummary(null)}
              >
                Dismiss
              </Button>
            </span>
          </div>
        )}
        {opening.status === 'error' && (
          <div
            role="alert"
            className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm ${TONES.error}`}
          >
            <span className="min-w-0 break-words">{opening.message}</span>
            <Button
              variant="ghost"
              size="small"
              onClick={() => setOpening(IDLE)}
            >
              Dismiss
            </Button>
          </div>
        )}
      </div>

      {!info ? (
        <p
          role="status"
          className="text-muted-foreground m-6 text-sm"
        >
          Opening the library…
        </p>
      ) : !available && !moving ? (
        <section
          role="alert"
          aria-labelledby="library-unavailable"
          className="border-input bg-muted/40 m-6 max-w-2xl rounded-xl border p-6"
        >
          <h2
            id="library-unavailable"
            className="text-xl font-semibold"
          >
            The library is not available
          </h2>
          <p className="text-muted-foreground mt-2">{info.problem}</p>
          <p className="mt-3 break-all font-mono text-xs">{info.root}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => changeLibrary('retry')}
            >
              Try again
            </Button>
            <Button onClick={() => changeLibrary('choose')}>Choose another folder…</Button>
            {!info.isDefault && (
              <Button onClick={() => changeLibrary('default')}>
                Start a new library in the usual place
              </Button>
            )}
          </div>
          <p className="text-muted-foreground mt-4 text-sm">
            Studies can still be opened without importing them: use Open.
          </p>
        </section>
      ) : empty ? (
        <section
          aria-labelledby="library-empty"
          className={`m-6 flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors ${dragging ? 'border-primary bg-primary/10' : 'border-input bg-muted/30'}`}
        >
          <h2
            id="library-empty"
            className="text-2xl font-semibold"
          >
            Your library is empty
          </h2>
          <p className="text-muted-foreground mt-3 max-w-xl">
            Import CT, MRI, X-ray and ultrasound studies from files, a folder, a ZIP file, or a CD,
            DVD or USB drive. They are copied to this computer, so they open any time, even without
            the disc. Nothing is uploaded.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button
              variant="primary"
              onClick={() => startImport(desktop.importFiles)}
              disabled={working}
            >
              Import files or a ZIP
            </Button>
            <Button
              onClick={() => startImport(desktop.importFolder)}
              disabled={working}
            >
              Import a folder
            </Button>
            <Button
              onClick={() => openDrivesDialog('import')}
              disabled={working}
            >
              Import from a CD, DVD or USB drive
            </Button>
          </div>
          <p className="text-muted-foreground mt-6 text-sm">
            Or drop them here. To look at a study without keeping a copy, use Open at the top.
          </p>
        </section>
      ) : (
        <div className="flex min-h-0 flex-1">
          <section
            aria-label="Studies"
            className="flex min-w-0 flex-1 flex-col"
          >
            <div className="border-input flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm">
              {info.modalities.length > 0 && (
                <div
                  role="group"
                  aria-label="Modality"
                  className="flex flex-wrap gap-1"
                >
                  {info.modalities.map(code => {
                    const on = view.modalities.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleModality(code)}
                        className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-muted'}`}
                      >
                        {code}
                      </button>
                    );
                  })}
                </div>
              )}
              <select
                aria-label="Study date"
                value={view.range}
                onChange={event => setView(current => ({ ...current, range: event.target.value }))}
                className="border-input bg-background rounded-md border px-2 py-1 text-xs"
              >
                {DATE_RANGES.map(range => (
                  <option
                    key={range.id}
                    value={range.id}
                  >
                    {range.label}
                  </option>
                ))}
              </select>
              {filtered && (
                <Button
                  variant="ghost"
                  size="small"
                  onClick={clearFilters}
                >
                  Clear
                </Button>
              )}
              <p
                className="text-muted-foreground ml-auto text-xs"
                aria-live="polite"
              >
                {list.ready ? listCount : ''}
              </p>
            </div>
            {list.ready && !shown ? (
              <div className="text-muted-foreground m-6 text-sm">
                <p>No studies match.</p>
                {filtered && (
                  <Button
                    className="mt-3"
                    size="small"
                    onClick={clearFilters}
                  >
                    Clear the search and filters
                  </Button>
                )}
              </div>
            ) : (
              <StudyTable
                studies={list.studies}
                selected={selected}
                sort={view.sort}
                direction={view.direction}
                onSort={sortBy}
                onSelect={select}
                onOpen={openStudies}
                onDelete={() => deleteStudies(selected)}
                onContextMenu={studyMenu}
                onSelectAll={on => setSelected(on ? list.studies.map(study => study.studyUID) : [])}
              />
            )}
          </section>
          <aside
            aria-label="Study details"
            className="border-input w-72 flex-none overflow-y-auto border-l p-4 lg:w-80 xl:w-96"
          >
            <StudyDetails
              study={details}
              selected={selected}
              studies={list.studies}
              onOpen={() => openStudies(selected)}
              onExport={() => exportStudies(selected)}
              onDelete={() => deleteStudies(selected)}
              locked={working}
            />
          </aside>
        </div>
      )}

      <footer className="border-input text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2 text-xs">
        <p>
          {available
            ? `${count(info.studies, 'study', 'studies')} · ${count(info.instances, 'image', 'images')} · ${formatBytes(info.bytes)}`
            : '\u00a0'}
        </p>
        <p className="flex flex-wrap gap-x-4">
          <span>Spectra Desktop {desktop.version}</span>
          <span>For viewing and education only; not for diagnostic use</span>
          <ExternalLink
            href={links.privacyUrl}
            className="hover:text-foreground"
          >
            Privacy policy
          </ExternalLink>
        </p>
      </footer>

      {dragging && !empty && (
        <div className="bg-background/80 pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <p className="border-primary bg-primary/10 rounded-xl border-2 border-dashed px-10 py-8 text-xl font-medium">
            Drop to import or open
          </p>
        </div>
      )}

      {busyOpening && (
        <Modal
          title={opening.status === 'scanning' ? 'Looking for DICOM files' : 'Opening'}
          onClose={() => {}}
          dismissible={false}
        >
          <div
            role="status"
            aria-live="polite"
            className="mt-4 text-sm"
          >
            {opening.status === 'scanning' ? (
              <>
                <p>
                  Looking in {scanProgress?.label || 'the files'}…
                  {scanProgress?.checked
                    ? ` ${count(scanProgress.checked, 'file', 'files')} checked, ${Number(scanProgress.found || 0).toLocaleString()} found.`
                    : ''}
                </p>
                <div className="mt-3">
                  <Progress label="Searching" />
                </div>
                <div className="mt-5 flex justify-end">
                  <Button onClick={() => desktop.cancel('scan')}>Cancel</Button>
                </div>
              </>
            ) : (
              <>
                <p>
                  {opening.total
                    ? `Reading ${opening.done} of ${count(opening.total, 'file', 'files')}…`
                    : 'Reading the files…'}
                </p>
                <div className="mt-3">
                  <Progress
                    label="Reading"
                    done={opening.done}
                    total={opening.total}
                  />
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {moving && (
        <Modal
          title="Moving the library"
          onClose={() => {}}
          dismissible={false}
        >
          <div
            role="status"
            aria-live="polite"
            className="mt-4 text-sm"
          >
            <p>
              {task.total
                ? `Copying ${Number(task.done || 0).toLocaleString()} of ${count(task.total, 'file', 'files')} to ${task.label}…`
                : `Moving to ${task.label}…`}
            </p>
            <div className="mt-3">
              <Progress
                label="Moving"
                done={task.done}
                total={task.total}
              />
            </div>
            <p className="text-muted-foreground mt-3">
              Keep Spectra Desktop open until it finishes.
            </p>
          </div>
        </Modal>
      )}

      {dropped && (
        <DropDialog
          files={dropped}
          onClose={() => setDropped(null)}
          onImport={() => {
            const files = dropped;
            setDropped(null);
            startImport(() => desktop.importDropped(files));
          }}
          onOpen={() => {
            const files = dropped;
            setDropped(null);
            ask(() => desktop.openDropped(files));
          }}
        />
      )}

      {drivesDialog && (
        <DrivesDialog
          purpose={drivesDialog}
          drives={drives}
          onRefresh={listDrives}
          onClose={() => setDrivesDialog(null)}
          onChoose={drive => {
            setDrivesDialog(null);
            dismissDrive(drive.id);
            if (drivesDialog === 'import') startImport(() => desktop.importDrive(drive.id));
            else ask(() => desktop.openDrive(drive.id));
          }}
        />
      )}

      {settingsOpen && info && (
        <SettingsDialog
          info={info}
          desktop={desktop}
          onReveal={() => desktop.revealLibrary()}
          onChange={changeLibrary}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
