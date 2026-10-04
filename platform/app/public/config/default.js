/** @type {AppTypes.Config} */

window.config = {
  name: 'config/default.js',
  apiBaseUrl: `https://api-dev.actecal.com`,
  // apiBaseUrl: `http://localhost:4000`,
  tenant: 'autolight',
  iotCoreBaseUrl: `https://api-dev.actecal.com`,
  routerBasename: null,
  // Cognito login, consumed by redirectToLogin() in
  // extensions/actecal-erp/src/services/ApiService.js. Anything left empty
  // falls back to a built-in default (and redirectUri falls back to
  // `${apiBaseUrl}/erp/<tenant>/auth/cognito-callback`).
  // NOTE: redirectUri must be listed in the Cognito app client's allowed
  // callback URLs.
  auth: {
    cognitoDomain: 'https://ap-south-1rxdtudilc.auth.ap-south-1.amazoncognito.com',
    clientId: '36t5q5ljl36405lcjfhajif16d',
    redirectUri: '',
  },
  ai: {
    enabled: true,
    // Swappable AI provider + model. Change these any time without code changes.
    provider: 'gemini',
    // MedGemma (medical vision-language model) used through the Gemini API.
    // Other Gemini models / providers can be added to the list below.
    defaultModel: 'medgemma',
    models: ['medgemma', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    apiKey: 'djjfhjhfjdksjadyeuyeiruygdgsaJIAZ',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    temperature: 0.2,
    // Set false to check credits but not deduct (if backend endpoint below is not deployed).
    deductCredit: true,
  },
  // GPU AI / WebSocket transcription configuration
  gpu: {
    enabled: true,
    // Base URL for GPU HTTP endpoints (analyze-dicom, update-dicom-measurement)
    baseUrl: 'http://34.9.15.48:8000',
    // Primary WebSocket URL for real-time transcription/report updates
    wsUrl: 'ws://34.9.15.48:8000/ws/transcribe',
    // NOT SENT: the GPU box accepts tokenless WS handshakes (verified). If it
    // ever enforces JWT auth, provide the token here and re-add it to the
    // socket URL in ScribeSocketService.buildUrl().
    authToken: '',
    timeoutMs: 60000,
    modality: 'CT',
    // ── DICOM analysis (POST /analyze-dicom) ──
    // The panel has no model picker: the GPU box runs one vision model and
    // swapping it is a server-side change, not a viewer one.
    timeoutAnalysisMs: 120000,
    dicomPrompt: 'Detect acute hemorrhage, mass effect, or nodule with exact measurements',
    // Optional static bearer token. Left empty so the viewer presents its own
    // ERP/Cognito session credential (localStorage['user']) instead.
    apiToken: '',
    // Set false to check credits but not deduct on analysis.
    deductCredit: true,
  },
  // Clinical scribe (transcription/report) configuration
  scribe: {
    transcribeBaseUrl: 'https://transcribe-service-381629948277.asia-southeast1.run.app',
    pollIntervalMs: 10000,
    maxPollAttempts: 90,
    socketConnectTimeoutMs: 5000,
    // Sends {"action":"ping"} while the socket is open. Left at 0 (disabled)
    // because the GPU transcribe WebSocket only documents end_meeting going out;
    // set to e.g. 30000 once it has confirmed it tolerates/answers a ping.
    wsHeartbeatMs: 0,
    // Retry interval once the 1s..30s backoff ladder is exhausted, so a GPU box
    // that is down for the whole consultation is not dialled every 30 seconds.
    reconnectMaxIntervalMs: 120000,
    // 0 = keep retrying for the whole consultation (default). Set a positive
    // number to stop after that many attempts; REST polling runs either way.
    maxReconnectAttempts: 0,
  },
  // whiteLabeling: {},
  extensions: [],
  modes: [],
  customizationService: {},
  investigationalUseDialog: {
    option: 'never',
  },
  showStudyList: true,
  // some windows systems have issues with more than 3 web workers
  maxNumberOfWebWorkers: 3,
  // below flag is for performance reasons, but it might not work for all servers
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  experimentalStudyBrowserSort: false,
  strictZSpacingForVolumeViewport: true,
  groupEnabledModesFirst: true,
  allowMultiSelectExport: false,
  maxNumRequests: {
    interaction: 100,
    thumbnail: 75,
    // Prefetch number is dependent on the http protocol. For http 2 or
    // above, the number of requests can be go a lot higher.
    prefetch: 25,
  },
  showErrorDetails: 'always', // 'always', 'dev', 'production'
  // filterQueryParam: false,
  // Defines multi-monitor layouts
  multimonitor: [
    {
      id: 'split',
      test: ({ multimonitor }) => multimonitor === 'split',
      screens: [
        {
          id: 'ohif0',
          screen: null,
          location: {
            screen: 0,
            width: 0.5,
            height: 1,
            left: 0,
            top: 0,
          },
          options: 'location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
        {
          id: 'ohif1',
          screen: null,
          location: {
            width: 0.5,
            height: 1,
            left: 0.5,
            top: 0,
          },
          options: 'location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
      ],
    },

    {
      id: '2',
      test: ({ multimonitor }) => multimonitor === '2',
      screens: [
        {
          id: 'ohif0',
          screen: 0,
          location: {
            width: 1,
            height: 1,
            left: 0,
            top: 0,
          },
          options: 'fullscreen=yes,location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
        {
          id: 'ohif1',
          screen: 1,
          location: {
            width: 1,
            height: 1,
            left: 0,
            top: 0,
          },
          options: 'fullscreen=yes,location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
      ],
    },
  ],
  defaultDataSourceName: 'actecalApi',
  /* Dynamic config allows user to pass "configUrl" query string this allows to load config without recompiling application. The regex will ensure valid configuration source */
  // dangerouslyUseDynamicConfig: {
  //   enabled: true,
  //   // regex will ensure valid configuration source and default is /.*/ which matches any character. To use this, setup your own regex to choose a specific source of configuration only.
  //   // Example 1, to allow numbers and letters in an absolute or sub-path only.
  //   // regex: /(0-9A-Za-z.]+)(\/[0-9A-Za-z.]+)*/
  //   // Example 2, to restricts to either hosptial.com or othersite.com.
  //   // regex: /(https:\/\/hospital.com(\/[0-9A-Za-z.]+)*)|(https:\/\/othersite.com(\/[0-9A-Za-z.]+)*)/
  //   regex: /.*/,
  // },
  dataSources: [
    {
      namespace: '@ohif/extension-actecal-erp.dataSourcesModule.actecalApi',
      sourceName: 'actecalApi',
      configuration: {
        friendlyName: 'Actecal ERP Worklist API',
        name: 'actecal',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'ohif',
      configuration: {
        friendlyName: 'GCP Healthcare API',
        name: 'gcp',
        // wadoUriRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        // qidoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        // wadoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',

        wadoUriRoot:
          'https://healthcare.googleapis.com/v1/projects/hms-viewer/locations/asia-south1/datasets/hms_dataset/dicomStores/hms_dicom_store/dicomWeb',

        qidoRoot:
          'https://healthcare.googleapis.com/v1/projects/hms-viewer/locations/asia-south1/datasets/hms_dataset/dicomStores/hms_dicom_store/dicomWeb',

        wadoRoot:
          'https://healthcare.googleapis.com/v1/projects/hms-viewer/locations/asia-south1/datasets/hms_dataset/dicomStores/hms_dicom_store/dicomWeb',

        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: false,
        staticWado: false,
        singlepart: 'bulkdata,video',
        // whether the data source should use retrieveBulkData to grab metadata,
        // and in case of relative path, what would it be relative to, options
        // are in the series level or study level (some servers like series some study)
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
      },
    },

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'local5000',
      configuration: {
        friendlyName: 'Static WADO Local Data',
        name: 'DCM4CHEE',
        qidoRoot: 'http://localhost:5000/dicomweb',
        wadoRoot: 'http://localhost:5000/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: true,
        supportsStow: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc',
      configuration: {
        friendlyName: 'local Orthanc DICOMWeb Server',
        name: 'DCM4CHEE',
        wadoUriRoot: 'http://localhost/pacs/dicom-web',
        qidoRoot: 'http://localhost/pacs/dicom-web',
        wadoRoot: 'http://localhost/pacs/dicom-web',
        qidoSupportsIncludeField: true,
        supportsReject: true,
        dicomUploadEnabled: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        omitQuotationForMultipartRequest: true,
        bulkDataURI: {
          enabled: true,
          // This is an example config that can be used to fix the retrieve URL
          // where it has the wrong prefix (eg a canned prefix).  It is better to
          // just use the correct prefix out of the box, but that is sometimes hard
          // when URLs go through several systems.
          // Example URLS are:
          // "BulkDataURI" : "http://localhost/dicom-web/studies/1.2.276.0.7230010.3.1.2.2344313775.14992.1458058363.6979/series/1.2.276.0.7230010.3.1.3.1901948703.36080.1484835349.617/instances/1.2.276.0.7230010.3.1.4.1901948703.36080.1484835349.618/bulk/00420011",
          // when running on http://localhost:3003 with no server running on localhost.  This can be corrected to:
          // /orthanc/dicom-web/studies/1.2.276.0.7230010.3.1.2.2344313775.14992.1458058363.6979/series/1.2.276.0.7230010.3.1.3.1901948703.36080.1484835349.617/instances/1.2.276.0.7230010.3.1.4.1901948703.36080.1484835349.618/bulk/00420011
          // which is a valid relative URL, and will result in using the http://localhost:3003/orthanc/.... path
          // startsWith: 'http://localhost/',
          // prefixWith: '/orthanc/',
        },
      },
    },

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomwebproxy',
      sourceName: 'dicomwebproxy',
      configuration: {
        friendlyName: 'dicomweb delegating proxy',
        name: 'dicomwebproxy',
        // Security controls for runtime ?url=... datasource loading:
        // In authenticated environments, runtime ?url origins must be allowlisted:
        // dangerouslyAllowedOriginsForAuthenticatedEnvironments: [
        //   'https://config.example.com',
        //   'http://localhost:5000',
        // ],
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomjson',
      sourceName: 'dicomjson',
      configuration: {
        friendlyName: 'dicom json',
        name: 'json',
        // Security controls for runtime ?url=... datasource loading:
        // In authenticated environments, runtime ?url origins must be allowlisted:
        // dangerouslyAllowedOriginsForAuthenticatedEnvironments: [
        //   'https://config.example.com',
        //   'http://localhost:5000',
        // ],
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'dicom local',
      },
    },
  ],
  httpErrorHandler: error => {
    // This is 429 when rejected from the public idc sandbox too often.
    console.warn(error.status);

    // Could use services manager here to bring up a dialog/modal if needed.
    console.warn('test, navigate to https://ohif.org/');
  },
  // segmentation: {
  //   segmentLabel: {
  //     enabledByDefault: true,
  //     labelColor: [255, 255, 0, 1], // must be an array
  //     hoverTimeout: 1,
  //     background: 'rgba(100, 100, 100, 0.5)', // can be any valid css color
  //   },
  // },
  whiteLabeling: {
    createLogoComponentFn: function (React) {
      return React.createElement(
        'div',
        { className: 'flex items-center space-x-2 cursor-pointer' },
        [
          React.createElement(
            'svg',
            {
              xmlns: 'http://www.w3.org/2000/svg',
              viewBox: '0 0 100 100',
              className: 'w-9 h-9',
              key: 'logo-svg',
            },
            [
              React.createElement('rect', {
                x: '15',
                y: '40',
                width: '10',
                height: '20',
                rx: '5',
                fill: '#5ACCE6',
                opacity: '0.6',
                key: 'r1',
              }),
              React.createElement('rect', {
                x: '35',
                y: '25',
                width: '10',
                height: '50',
                rx: '5',
                fill: '#0D6EFD',
                opacity: '0.8',
                key: 'r2',
              }),
              React.createElement('rect', {
                x: '55',
                y: '10',
                width: '10',
                height: '80',
                rx: '5',
                fill: '#FFFFFF',
                key: 'r3',
              }),
              React.createElement('rect', {
                x: '75',
                y: '30',
                width: '10',
                height: '40',
                rx: '5',
                fill: '#5ACCE6',
                key: 'r4',
              }),
            ]
          ),
          React.createElement(
            'div',
            { className: 'flex flex-col justify-center ml-2', key: 'logo-text' },
            [
              React.createElement(
                'span',
                {
                  className: 'text-[20px] font-bold text-white leading-none tracking-widest',
                  key: 't1',
                },
                'SPECTRA'
              ),
            ]
          ),
        ]
      );
    },
  },
};
