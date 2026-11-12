// Spectra features shown locked in the offline edition. Each exists in the full Spectra viewer
// (extensions/actecal-erp); keep the wording in step with https://actecal.com/products/spectra-pacs.
export const PREMIUM_FEATURES = [
  { id: 'ai', title: 'AI analysis', text: 'AI-assisted findings on the open image, for the radiologist to review.' },
  { id: 'report', title: 'Reports with dictation', text: 'Radiology report templates, with dictation, next to the images.' },
  { id: 'share', title: 'Secure sharing', text: 'Share a study by link with a referring doctor or a second reader.' },
  { id: 'worklist', title: 'Cloud worklist', text: 'Studies uploaded in Actecal HMS, in a worklist for each radiologist.' },
  { id: 'measurements', title: 'Saved measurements', text: 'Measurements saved with the study, visible to the whole team.' },
];

export function premiumFeature(id) {
  return PREMIUM_FEATURES.find(feature => feature.id === id) || null;
}

// Links come from window.config.actecal (config/offline.js), so they can change without a code change.
// signUpUrl is null until onboardingLive is true there: like ONBOARDING_LIVE on actecal.com, nothing links to
// self-service onboarding before it opens to the public, and the buttons offer a demo instead.
export function premiumLinks() {
  const config = (typeof window !== 'undefined' && window.config?.actecal) || {};
  return {
    signUpUrl: config.onboardingLive === true ? config.signUpUrl || 'https://erp.actecal.com/get-started?product=HMS' : null,
    contactUrl: config.contactUrl || 'https://actecal.com/contact?interest=spectra',
    learnMoreUrl: config.learnMoreUrl || 'https://actecal.com/products/spectra-pacs',
    privacyUrl: config.privacyUrl || 'https://actecal.com/privacy-policy',
  };
}
