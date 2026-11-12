// Premium Spectra features, shown in the right-hand panel and in the dialog that the locked toolbar
// buttons open (commands module: showSpectraPremium), and the buttons that go with them.
import React from 'react';
import { PREMIUM_FEATURES, premiumLinks } from '../premium';
import { ExternalLink, LockIcon, PRIMARY_LINK, SECONDARY_LINK } from './ui';

/**
 * The sign-up and contact buttons. While self-service onboarding is closed (window.config.actecal.onboardingLive
 * is not true), there is one button, "Book a demo", to the contact form; afterwards "Get started" and "Talk to us".
 */
export function PremiumActions() {
  const links = premiumLinks();
  if (!links.signUpUrl) {
    return (
      <ExternalLink href={links.contactUrl} className={PRIMARY_LINK}>
        Book a demo
      </ExternalLink>
    );
  }
  return (
    <>
      <ExternalLink href={links.signUpUrl} className={PRIMARY_LINK}>
        Get started
      </ExternalLink>
      <ExternalLink href={links.contactUrl} className={SECONDARY_LINK}>
        Talk to us
      </ExternalLink>
    </>
  );
}

export function PremiumModal({ feature, hide }) {
  return (
    <div className="text-foreground">
      {feature && <p>{feature.text}</p>}
      <p className={`${feature ? 'mt-3' : ''} text-sm text-muted-foreground`}>
        This free viewer keeps your files on this device. Actecal Spectra, the cloud PACS for hospitals and diagnostic centres, adds:
      </p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {PREMIUM_FEATURES.map(item => (
          <li key={item.id} className="flex items-center gap-2">
            <LockIcon className="h-3.5 w-3.5 flex-none text-primary" />
            {item.title}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap gap-3">
        <PremiumActions />
        <button type="button" onClick={hide} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
          Not now
        </button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Links open in a new tab, so your study stays open here.</p>
    </div>
  );
}

export function PremiumPanel() {
  return (
    <div className="flex flex-col gap-3 p-4 text-foreground">
      <p className="text-base font-semibold">Actecal Spectra</p>
      <p className="text-sm text-muted-foreground">This free viewer runs on your device. Teams that read studies every day get more with Spectra:</p>
      <ul className="space-y-3">
        {PREMIUM_FEATURES.map(item => (
          <li key={item.id} className="rounded-md border border-input p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <LockIcon className="h-3.5 w-3.5 flex-none text-primary" />
              {item.title}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{item.text}</p>
          </li>
        ))}
      </ul>
      <PremiumActions />
    </div>
  );
}
