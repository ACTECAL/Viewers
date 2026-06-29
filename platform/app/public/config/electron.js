window.config = {
  routerBasename: '/',
  extensions: [],
  modes: [],
  customizationService: {
    dicomUploadComponent:
      '@ohif/extension-cornerstone.customizationModule.cornerstoneDicomUploadComponent',
  },
  showStudyList: true,
  maxNumberOfWebWorkers: 3,
  showWarningMessageForCrossOrigin: false,
  showCPUFallbackMessage: false,
  showLoadingIndicator: true,
  strictZIndex: false,
  dataSources: [
    {
      friendlyName: 'Local Orthanc',
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'local-orthanc',
      configuration: {
        name: 'local-orthanc',
        wadoUriRoot: 'http://localhost:8042/wado',
        qidoRoot: 'http://localhost:8042/dicom-web',
        wadoRoot: 'http://localhost:8042/dicom-web',
        qidoSupportsIncludeField: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        staticWado: false,
        singlepart: 'bulkdata',
        bulkDataURI: {
          enabled: true,
        },
      },
    },
    {
      friendlyName: 'Cloud Server',
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'cloud-server',
      configuration: {
        name: 'cloud-server',
        // Example configuration for GCP Healthcare API
        // This will be dynamic based on the GCP token fetching logic
        wadoUriRoot: 'https://healthcare.googleapis.com/v1/projects/...',
        qidoRoot: 'https://healthcare.googleapis.com/v1/projects/...',
        wadoRoot: 'https://healthcare.googleapis.com/v1/projects/...',
        qidoSupportsIncludeField: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        staticWado: false,
        singlepart: 'bulkdata',
        bulkDataURI: {
          enabled: true,
        },
      },
    }
  ],
  defaultDataSourceName: 'local-orthanc',
  hotkeys: [],
};
