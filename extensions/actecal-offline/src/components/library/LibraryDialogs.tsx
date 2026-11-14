// The library page's dialogs: what to do with dropped files, the CD, DVD and USB drives, and the library settings.
import React from 'react';
import { premiumLinks } from '../../premium';
import { ExternalLink } from '../ui';
import { Button, Icon, Modal } from './controls';
import { count, fileManager, formatBytes } from './format';

const DRIVE_KINDS = { disc: 'CD or DVD', usb: 'USB drive', drive: 'Drive' };

export function DropDialog({ files, onImport, onOpen, onClose }) {
  const name = files.length === 1 ? files[0].name : count(files.length, 'item', 'items');
  return (
    <Modal
      title="Import or open?"
      onClose={onClose}
    >
      <p className="text-muted-foreground mt-3 text-sm">
        <span className="text-foreground font-medium">{name}</span>: import the studies to keep them
        in the library, or open them now without keeping a copy.
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button onClick={onOpen}>Open without importing</Button>
        <Button
          variant="primary"
          onClick={onImport}
          data-autofocus
        >
          Import into the library
        </Button>
      </div>
    </Modal>
  );
}

/** The drives: purpose 'import' or 'open' decides the button. */
export function DrivesDialog({ purpose, drives, onChoose, onRefresh, onClose }) {
  const importing = purpose === 'import';
  return (
    <Modal
      title={importing ? 'Import from a CD, DVD or USB drive' : 'Open a CD, DVD or USB drive'}
      onClose={onClose}
    >
      <div
        id="desktop-drives"
        className="mt-4"
      >
        {drives.loading ? (
          <p
            role="status"
            className="text-muted-foreground text-sm"
          >
            Looking for drives…
          </p>
        ) : drives.list.length ? (
          <ul className="space-y-2">
            {drives.list.map(drive => (
              <li
                key={drive.id}
                className="border-input flex items-center justify-between gap-4 rounded-lg border p-3"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icon
                    name="disc"
                    className="text-primary h-5 w-5 flex-none"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{drive.name}</span>
                    <span className="text-muted-foreground block text-sm">
                      {DRIVE_KINDS[drive.kind] || DRIVE_KINDS.drive}
                      {drive.dicomdir ? ' · DICOM disc' : ''}
                    </span>
                  </span>
                </span>
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => onChoose(drive)}
                  aria-label={`${importing ? 'Import' : 'Open'} ${drive.name}`}
                >
                  {importing ? 'Import' : 'Open'}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            {drives.failed
              ? 'The drives could not be listed.'
              : 'No CD, DVD or USB drive was found.'}{' '}
            Insert one; it appears here within a few seconds.
          </p>
        )}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={onRefresh}
        >
          Refresh
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

export function SettingsDialog({ info, desktop, onChange, onReveal, onClose }) {
  const links = premiumLinks();
  return (
    <Modal
      title="Settings"
      onClose={onClose}
      width="max-w-xl"
    >
      <section
        aria-labelledby="settings-library"
        className="mt-4"
      >
        <h3
          id="settings-library"
          className="text-sm font-semibold"
        >
          Library folder
        </h3>
        <p
          className="border-input bg-muted/40 mt-1 break-all rounded-md border px-3 py-2 font-mono text-xs"
          data-testid="library-root"
        >
          {info.root}
        </p>
        <p className="text-muted-foreground mt-2 text-sm">
          {info.available
            ? `${count(info.studies, 'study', 'studies')}, ${count(info.instances, 'image', 'images')}, ${formatBytes(info.bytes)}.`
            : info.problem}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {info.available && (
            <Button onClick={onReveal}>Show in {fileManager(desktop.platform)}</Button>
          )}
          <Button onClick={() => onChange('choose')}>Change…</Button>
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          Choose an empty folder to move the library and its studies there, or the folder of another
          Spectra library to use that one.
        </p>
      </section>
      <section
        aria-labelledby="settings-privacy"
        className="mt-6"
      >
        <h3
          id="settings-privacy"
          className="text-sm font-semibold"
        >
          Privacy
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Studies hold personal health information. They stay on this computer, and Spectra Desktop
          sends nothing over the internet. Anyone who can sign in to this computer account can open
          the library, so delete the studies you no longer need.
        </p>
      </section>
      <div className="border-input text-muted-foreground mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs">
        <p>
          Spectra Desktop {desktop.version} · For viewing and education only; not for diagnostic
          use.{' '}
          <ExternalLink
            href={links.privacyUrl}
            className="hover:text-foreground underline"
          >
            Privacy policy
          </ExternalLink>
        </p>
        <Button
          variant="primary"
          onClick={onClose}
          data-autofocus
        >
          Done
        </Button>
      </div>
    </Modal>
  );
}
