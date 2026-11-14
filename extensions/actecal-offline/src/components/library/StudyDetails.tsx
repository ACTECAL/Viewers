// The panel beside the study list: the selected study's patient, study and series, with Open, Export and Delete;
// a summary when several studies are selected; and, with none, how the library works and what Actecal Spectra adds.
import React from 'react';
import { PREMIUM_FEATURES } from '../../premium';
import { PremiumActions } from '../PremiumContent';
import { LockIcon } from '../ui';
import { Button } from './controls';
import {
  count,
  formatAge,
  formatDate,
  formatDay,
  formatName,
  formatSex,
  formatTime,
  studyTitle,
} from './format';

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

function Actions({ count: studies, onOpen, onExport, onDelete, locked }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button
        variant="primary"
        onClick={onOpen}
      >
        {studies > 1 ? 'Open together' : 'Open'}
      </Button>
      <Button
        onClick={onExport}
        disabled={locked}
        title={locked ? 'Wait for the current task to finish.' : undefined}
      >
        Export…
      </Button>
      <Button
        variant="danger"
        onClick={onDelete}
        disabled={locked}
        title={locked ? 'Wait for the current task to finish.' : undefined}
      >
        Delete…
      </Button>
    </div>
  );
}

export default function StudyDetails({
  study,
  selected,
  studies,
  onOpen,
  onExport,
  onDelete,
  locked,
}) {
  if (selected.length > 1) {
    const listed = studies.filter(entry => selected.includes(entry.studyUID));
    return (
      <div>
        <h2 className="text-lg font-semibold">
          {count(selected.length, 'study', 'studies')} selected
        </h2>
        <ul className="mt-3 space-y-1 text-sm">
          {listed.slice(0, 8).map(entry => (
            <li
              key={entry.studyUID}
              className="truncate"
            >
              {studyTitle(entry)}
            </li>
          ))}
          {listed.length > 8 && (
            <li className="text-muted-foreground">
              and {count(listed.length - 8, 'more', 'more')}
            </li>
          )}
        </ul>
        {selected.length > 50 && (
          <p className="text-muted-foreground mt-3 text-sm">Up to 50 studies open together.</p>
        )}
        <Actions
          count={selected.length}
          onOpen={onOpen}
          onExport={onExport}
          onDelete={onDelete}
          locked={locked}
        />
      </div>
    );
  }

  if (study) {
    const born = [
      formatDate(study.patientBirthDate),
      formatSex(study.patientSex),
      formatAge(study.patientAge),
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <div>
        <p className="text-muted-foreground text-xs uppercase tracking-wide">Patient</p>
        <h2 className="mt-1 break-words text-lg font-semibold">
          {formatName(study.patientName) || 'Unnamed patient'}
        </h2>
        <dl className="mt-2 text-sm">
          <Field
            label="Patient ID"
            value={study.patientID}
          />
          <Field
            label="Born"
            value={born}
          />
        </dl>

        <p className="text-muted-foreground mt-5 text-xs uppercase tracking-wide">Study</p>
        <p className="mt-1 break-words font-medium">{study.studyDescription || 'No description'}</p>
        <dl className="mt-2 text-sm">
          <Field
            label="Date"
            value={[formatDate(study.studyDate), formatTime(study.studyTime)]
              .filter(Boolean)
              .join(', ')}
          />
          <Field
            label="Accession"
            value={study.accessionNumber}
          />
          <Field
            label="Modality"
            value={study.modalities.join(', ')}
          />
          <Field
            label="Referred by"
            value={formatName(study.referringPhysician)}
          />
          <Field
            label="Institution"
            value={study.institution}
          />
          <Field
            label="Added"
            value={formatDay(study.importedAt)}
          />
          <Field
            label="Last opened"
            value={formatDay(study.openedAt)}
          />
        </dl>

        <Actions
          count={1}
          onOpen={onOpen}
          onExport={onExport}
          onDelete={onDelete}
          locked={locked}
        />

        <p className="text-muted-foreground mt-6 text-xs uppercase tracking-wide">
          {count(study.series.length, 'series', 'series')},{' '}
          {count(study.instanceCount, 'image', 'images')}
        </p>
        <ul
          className="divide-input/60 border-input mt-2 divide-y rounded-lg border text-sm"
          aria-label="Series"
        >
          {study.series.map(series => (
            <li
              key={series.seriesUID}
              className="flex items-baseline gap-3 px-3 py-2"
            >
              <span className="text-muted-foreground w-8 flex-none text-right tabular-nums">
                {series.seriesNumber ?? ''}
              </span>
              <span className="w-10 flex-none font-medium">{series.modality}</span>
              <span
                className="min-w-0 flex-1 truncate"
                title={series.seriesDescription}
              >
                {series.seriesDescription || 'No description'}
              </span>
              <span className="text-muted-foreground flex-none tabular-nums">
                {Number(series.instanceCount).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="text-sm">
      <h2 className="text-base font-semibold">Select a study</h2>
      <p className="text-muted-foreground mt-2">
        Its patient, study and series appear here. Double-click a study to open it.
      </p>
      <p className="text-muted-foreground mt-2">
        Drop files, folders or ZIP files anywhere on this window to import them.
      </p>
      <section
        aria-labelledby="library-premium"
        className="border-input bg-muted/40 mt-8 rounded-lg border p-4"
      >
        <h2
          id="library-premium"
          className="font-semibold"
        >
          Actecal Spectra
        </h2>
        <p className="text-muted-foreground mt-1">
          The cloud PACS for hospitals and diagnostic centres adds:
        </p>
        <ul className="mt-3 space-y-1.5">
          {PREMIUM_FEATURES.map(feature => (
            <li
              key={feature.id}
              className="flex items-center gap-2"
            >
              <LockIcon className="text-primary h-3.5 w-3.5 flex-none" />
              {feature.title}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <PremiumActions />
        </div>
      </section>
    </div>
  );
}
