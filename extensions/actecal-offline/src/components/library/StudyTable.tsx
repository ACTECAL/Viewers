// The library's list of studies, as in other DICOM viewers' databases: sortable columns, a checkbox and a click
// to select (Ctrl or Cmd adds, Shift selects a range), a double-click or Enter to open, arrow keys to move,
// Delete to delete, and a right-click for the study menu (Open, Export, Delete).
import React, { useEffect, useRef } from 'react';
import { Icon } from './controls';
import { count, formatDate, formatDay, formatName, studyTitle } from './format';

// Patient and Description share the width left by the others. In a narrow window the patient ID moves under the
// name (below 1024 px) and Added is left out (below 1280 px; the details panel shows it).
const COLUMNS = [
  { sort: 'patientName', label: 'Patient', className: '' },
  { sort: 'patientID', label: 'Patient ID', className: 'hidden w-32 lg:table-cell' },
  { sort: 'studyDate', label: 'Study date', className: 'w-32' },
  { sort: 'description', label: 'Description', className: '' },
  { sort: null, label: 'Modality', className: 'w-24' },
  { sort: 'instances', label: 'Images', className: 'w-20 text-right' },
  { sort: 'importedAt', label: 'Added', className: 'hidden w-28 xl:table-cell' },
];

export default function StudyTable({
  studies,
  selected,
  sort,
  direction,
  onSort,
  onSelect,
  onOpen,
  onDelete,
  onSelectAll,
  onContextMenu,
}) {
  const body = useRef(null);
  const chosen = new Set(selected);
  const all = studies.length > 0 && studies.every(study => chosen.has(study.studyUID));

  // The selected row stays in view when the arrow keys move the selection.
  useEffect(() => {
    if (selected.length !== 1) return;
    const row = body.current?.querySelector(`[data-study="${CSS.escape(selected[0])}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  function onKeyDown(event) {
    if (!studies.length || event.target.tagName === 'INPUT') return;
    const index = studies.findIndex(study => study.studyUID === selected[selected.length - 1]);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.min(
        studies.length - 1,
        Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1))
      );
      onSelect(studies[index < 0 ? 0 : next].studyUID, { shiftKey: event.shiftKey });
    } else if (event.key === 'Enter' && selected.length) {
      event.preventDefault();
      onOpen(selected);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected.length) {
      event.preventDefault();
      onDelete();
    } else if (event.key.toLowerCase() === 'a' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSelectAll(true);
    }
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-auto"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Studies in the library"
      role="region"
    >
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">
          Studies in the library. Double-click a study, or select it and press Enter, to open it.
        </caption>
        <thead className="bg-background sticky top-0 z-10">
          <tr className="border-input text-muted-foreground border-b text-left text-xs uppercase tracking-wide">
            <th
              scope="col"
              className="w-10 px-3 py-2"
            >
              <input
                type="checkbox"
                aria-label="Select all studies"
                checked={all}
                onChange={event => onSelectAll(event.target.checked)}
                className="h-4 w-4 accent-[hsl(var(--primary))]"
              />
            </th>
            {COLUMNS.map(column => (
              <th
                key={column.label}
                scope="col"
                className={`whitespace-nowrap px-3 py-2 font-medium ${column.className}`}
                aria-sort={
                  column.sort && column.sort === sort
                    ? direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                {column.sort ? (
                  <button
                    type="button"
                    onClick={() => onSort(column.sort)}
                    className="hover:text-foreground inline-flex items-center gap-1 uppercase"
                  >
                    {column.label}
                    {column.sort === sort && (
                      <Icon
                        name={direction === 'asc' ? 'up' : 'down'}
                        className="h-3.5 w-3.5"
                      />
                    )}
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={body}>
          {studies.map(study => {
            const isSelected = chosen.has(study.studyUID);
            return (
              <tr
                key={study.studyUID}
                data-study={study.studyUID}
                aria-selected={isSelected}
                onClick={event => onSelect(study.studyUID, event)}
                onDoubleClick={() => onOpen([study.studyUID])}
                onContextMenu={event => {
                  event.preventDefault();
                  onContextMenu(study.studyUID);
                }}
                className={`border-input/60 cursor-default select-none border-b ${isSelected ? 'bg-primary/20' : 'hover:bg-muted/60'}`}
              >
                <td
                  className="px-3 py-2"
                  onClick={event => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${studyTitle(study)}`}
                    checked={isSelected}
                    onChange={() => onSelect(study.studyUID, { toggle: true })}
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                </td>
                <td
                  className="truncate px-3 py-2 font-medium"
                  title={formatName(study.patientName)}
                >
                  {formatName(study.patientName) || (
                    <span className="text-muted-foreground">Unnamed</span>
                  )}
                  {study.patientID && (
                    <span className="text-muted-foreground block truncate text-xs font-normal lg:hidden">
                      {study.patientID}
                    </span>
                  )}
                </td>
                <td
                  className="text-muted-foreground hidden truncate px-3 py-2 lg:table-cell"
                  title={study.patientID}
                >
                  {study.patientID}
                </td>
                <td className="truncate px-3 py-2">{formatDate(study.studyDate)}</td>
                <td
                  className="truncate px-3 py-2"
                  title={study.studyDescription}
                >
                  {study.studyDescription}
                </td>
                <td className="truncate px-3 py-2">{study.modalities.join(', ')}</td>
                <td
                  className="px-3 py-2 text-right tabular-nums"
                  title={count(study.seriesCount, 'series', 'series')}
                >
                  {Number(study.instanceCount).toLocaleString()}
                </td>
                <td className="text-muted-foreground hidden truncate px-3 py-2 xl:table-cell">
                  {formatDay(study.importedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
