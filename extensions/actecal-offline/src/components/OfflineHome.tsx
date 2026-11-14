// Home page of the offline edition (the '/' custom route, and the notices for a reload and an unknown address).
// In a browser it is the web edition's page (WebHome.tsx). In Spectra Desktop (../desktop.js) it is the study
// library (library/LibraryHome.tsx).
import React from 'react';
import { getDesktop } from '../desktop';
import WebHome from './WebHome';
import LibraryHome from './library/LibraryHome';

export default function OfflineHome(props) {
  return getDesktop() ? <LibraryHome {...props} /> : <WebHome {...props} />;
}
