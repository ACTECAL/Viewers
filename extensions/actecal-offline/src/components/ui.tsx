// Small shared pieces for the offline edition's pages, panel and dialogs (OHIF theme colours).
import React from 'react';

export const PRIMARY_LINK =
  'inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
export const SECONDARY_LINK =
  'inline-flex items-center justify-center rounded-md border border-input px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function LockIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// External links open in a new tab, so the study loaded in this tab (memory only) is not lost.
export function ExternalLink({ href, className, children }) {
  return (
    <a href={href} target="_blank" rel="noopener" className={className}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function SpectraMark() {
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 100 100" className="h-10 w-10" aria-hidden="true">
        <rect x="15" y="40" width="10" height="20" rx="5" fill="#5ACCE6" opacity="0.6" />
        <rect x="35" y="25" width="10" height="50" rx="5" fill="#0D6EFD" opacity="0.8" />
        <rect x="55" y="10" width="10" height="80" rx="5" fill="#FFFFFF" />
        <rect x="75" y="30" width="10" height="40" rx="5" fill="#5ACCE6" />
      </svg>
      <div className="leading-none">
        <span className="block text-[20px] font-bold tracking-widest text-foreground">SPECTRA</span>
        <span className="mt-1 block text-[10px] font-medium tracking-widest text-[#5ACCE6]">FREE VIEWER BY ACTECAL</span>
      </div>
    </div>
  );
}
