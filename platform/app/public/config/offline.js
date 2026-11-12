// onnxruntime-web (bundled through @cornerstonejs/ai) falls back to Node's __filename when
// document.currentScript is empty, which throws in the browser and stops the app from starting on a
// reload. This file loads before the bundles, so define it here. It only matters to ONNX tools,
// which this edition does not use.
if (!('__filename' in window)) window.__filename = undefined;

/** @type {AppTypes.Config} */
// Standalone (offline) edition of Actecal Spectra: a DICOM viewer with no ERP, sign-in, server or analytics.
// Files open from the visitor's device into the in-memory dicomlocal data source; nothing is uploaded.
// Built by build-offline.sh; served at https://spectra.actecal.com/offline/ (deploy-offline.sh).
// Keep this file free of ERP settings: no apiBaseUrl, tenant, auth, AI, GPU or scribe keys, and no analytics.
(function () {
  // Where the build is served from: its PUBLIC_URL, which index.html sets before this file loads. That is
  // /offline/ on spectra.actecal.com, and / at the root of a domain or in a desktop app, so this one file
  // serves every place without a change.
  var base = (window.PUBLIC_URL || '/').replace(/\/+$/, '') || '/';
  var prefix = base === '/' ? '' : base;

  // Files live only in the memory of the tab that opened them, so a page load straight onto a viewer URL (a
  // reload or a shared link) can never have the study. Show the home page's "study cleared" notice instead
  // of an empty viewer; this runs before the app reads the URL.
  var viewerPath = prefix + '/viewer';
  var path = window.location.pathname;
  if (path === viewerPath || path.indexOf(viewerPath + '/') === 0) {
    window.history.replaceState(null, '', prefix + '/notfoundstudy');
  }

  window.config = {
    name: 'config/offline.js',
    routerBasename: base,
    extensions: [],
    modes: [],
    // Branded home page, ZIP and folder loading, and the premium dialogs (extensions/actecal-offline).
    customizationService: ['@ohif/extension-actecal-offline.customizationModule.offlineViewer'],
    investigationalUseDialog: {
      option: 'never',
    },
    showStudyList: false,
    maxNumberOfWebWorkers: 3,
    showWarningMessageForCrossOrigin: true,
    showCPUFallbackMessage: true,
    showLoadingIndicator: true,
    experimentalStudyBrowserSort: false,
    strictZSpacingForVolumeViewport: true,
    allowMultiSelectExport: false,
    showErrorDetails: 'dev',
    defaultDataSourceName: 'dicomlocal',
    dataSources: [
      {
        namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
        sourceName: 'dicomlocal',
        configuration: {
          friendlyName: 'Files on this device',
        },
      },
    ],
    // Premium Spectra features are shown locked; these links open in a new tab so the study stays open.
    actecal: {
      edition: 'offline',
      // Like ONBOARDING_LIVE in actecal-website/src/config.js: false until self-service onboarding opens to the
      // public. Until then the buttons say "Book a demo" and open contactUrl; signUpUrl is not linked anywhere.
      onboardingLive: false,
      signUpUrl:
        'https://erp.actecal.com/get-started?product=HMS&utm_source=spectra-offline&utm_medium=viewer&utm_campaign=unlock',
      contactUrl:
        'https://actecal.com/contact?interest=spectra&utm_source=spectra-offline&utm_medium=viewer&utm_campaign=unlock',
      learnMoreUrl: 'https://actecal.com/products/spectra-pacs',
      privacyUrl: 'https://actecal.com/privacy-policy',
    },
    whiteLabeling: {
      createLogoComponentFn: function (React) {
        var bar = function (x, y, height, fill, opacity, key) {
          return React.createElement('rect', { x: x, y: y, width: '10', height: height, rx: '5', fill: fill, opacity: opacity, key: key });
        };
        return React.createElement('div', { className: 'flex items-center space-x-2' }, [
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 100 100', className: 'w-9 h-9', key: 'logo-svg', 'aria-hidden': 'true' },
            [
              bar('15', '40', '20', '#5ACCE6', '0.6', 'r1'),
              bar('35', '25', '50', '#0D6EFD', '0.8', 'r2'),
              bar('55', '10', '80', '#FFFFFF', '1', 'r3'),
              bar('75', '30', '40', '#5ACCE6', '1', 'r4'),
            ]
          ),
          React.createElement('div', { className: 'flex flex-col justify-center ml-2', key: 'logo-text' }, [
            React.createElement(
              'span',
              { className: 'text-[20px] font-bold text-white leading-none tracking-widest', key: 't1' },
              'SPECTRA'
            ),
            React.createElement(
              'span',
              { className: 'mt-1 text-[10px] font-medium leading-none tracking-widest text-[#5ACCE6]', key: 't2' },
              'FREE VIEWER'
            ),
          ]),
        ]);
      },
    },
  };
})();
