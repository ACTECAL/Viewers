// Buttons, menus, dialogs and icons of the library page, in the viewer's theme colours.
import React, { useEffect, useRef, useState } from 'react';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const BASE = `inline-flex items-center justify-center gap-2 rounded-md text-sm font-semibold ${FOCUS} disabled:cursor-not-allowed disabled:opacity-50`;
const SIZES = { normal: 'px-4 py-2', small: 'px-3 py-1.5' };
export const VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border border-input text-foreground hover:bg-muted',
  ghost: 'text-foreground hover:bg-muted',
  // The theme's destructive colour is too dark to read on the dark background.
  danger: 'border border-red-500/40 text-red-400 hover:bg-red-500/10',
};

export function Button({ variant = 'secondary', size = 'normal', className = '', ...props }) {
  return (
    <button
      type="button"
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Icon({ name, className = 'h-4 w-4' }) {
  const paths = {
    chevron: <path d="m6 9 6 6 6-6" />,
    search: (
      <>
        <circle
          cx="11"
          cy="11"
          r="7"
        />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    settings: (
      <>
        <circle
          cx="12"
          cy="12"
          r="3"
        />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </>
    ),
    disc: (
      <>
        <circle
          cx="12"
          cy="12"
          r="9"
        />
        <circle
          cx="12"
          cy="12"
          r="2.5"
        />
      </>
    ),
    import: (
      <>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    close: <path d="M18 6 6 18M6 6l12 12" />,
    up: <path d="m18 15-6-6-6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/**
 * A button that opens a list of actions: items [{ label, hint, onSelect }]. Arrow keys move between them and
 * Escape closes the list.
 */
export function MenuButton({
  label,
  items,
  variant = 'secondary',
  disabled = false,
  align = 'left',
}) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const list = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    list.current?.querySelector('[role="menuitem"]')?.focus();
    const outside = event => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  function onKeyDown(event) {
    const entries = Array.from(list.current?.querySelectorAll('[role="menuitem"]') || []);
    const index = entries.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      root.current?.querySelector('button')?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
      entries[next]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={open ? onKeyDown : undefined}
    >
      <Button
        variant={variant}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {label}
        <Icon
          name="chevron"
          className="h-4 w-4 opacity-80"
        />
      </Button>
      {open && (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          className={`border-input bg-popover text-popover-foreground absolute z-40 mt-1 w-72 rounded-md border py-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="hover:bg-muted focus:bg-muted block w-full px-4 py-2 text-left text-sm focus:outline-none"
            >
              <span className="block font-medium">{item.label}</span>
              {item.hint && (
                <span className="text-muted-foreground block text-xs">{item.hint}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A dialog over the page. Escape and the close button call onClose; the first button gets the focus. */
export function Modal({ title, onClose, children, width = 'max-w-lg', dismissible = true }) {
  const box = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const target =
      box.current?.querySelector('[data-autofocus]') || box.current?.querySelector('button');
    target?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onKeyDown={event => {
        if (event.key === 'Escape' && dismissible) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-dialog-title"
        className={`w-full ${width} border-input bg-popover text-popover-foreground rounded-xl border p-6 shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="library-dialog-title"
            className="text-lg font-semibold"
          >
            {title}
          </h2>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={`text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1 ${FOCUS}`}
            >
              <Icon
                name="close"
                className="h-5 w-5"
              />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** A progress bar; without a total it shows that work goes on. */
export function Progress({ done = 0, total = 0, label }) {
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div
      className="bg-muted h-2 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent === null ? undefined : percent}
    >
      <div
        className={`bg-primary h-full transition-all ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
