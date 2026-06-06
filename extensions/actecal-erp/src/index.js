// import ApiService from './services/ApiService';
// import IoTService from './services/IoTService';
// import { MeasurementService, ExtensionManager, CommandsManager, ServicesManager, ServiceProvidersManager, HotkeysManager } from '@ohif/core';
// import { parse } from 'query-string';

// const extensionId = 'actecal-erp';

// const measurementService = new MeasurementService();

// const measurementSource = measurementService.createSource('actecal-erp', '1');
// const toMeasurementSchema = data => ({
//   ...data,
//   source: measurementSource,
// });

// const apiService = new ApiService();

// const commandsManager = new CommandsManager();
// const servicesManager = new ServicesManager(commandsManager);
// const serviceProvidersManager = new ServiceProvidersManager();
// const hotkeysManager = new HotkeysManager(commandsManager, servicesManager);

// const extensionManager = new ExtensionManager({
//   commandsManager,
//   servicesManager,
//   serviceProvidersManager,
//   hotkeysManager,
//   appConfig: {},
// });

// function preRegistration() {
//     console.log("Actecal extension loaded");

//   initializeStudy(); // call here
//   measurementService.subscribe('MEASUREMENT_ADDED', event => {
//     console.log('MEASUREMENT_ADDED event:', event);
//     if (
//       event &&
//       typeof event === 'object' &&
//       'measurement' in event &&
//       typeof event.measurement === 'object' &&
//       event.measurement !== null &&
//       'studyInstanceUid' in event.measurement
//     ) {
//       apiService.saveMeasurement(event.measurement.studyInstanceUid, event.measurement);
//     } else {
//       console.warn('MEASUREMENT_ADDED event missing measurement or studyInstanceUid property:', event);
//     }
//   });

//   measurementService.subscribe('MEASUREMENT_REMOVED', event => {
//     console.log('MEASUREMENT_REMOVED event:', event);
//     if (
//       event &&
//       typeof event === 'object' &&
//       'measurement' in event &&
//       typeof event.measurement === 'object' &&
//       event.measurement !== null &&
//       'annotationUID' in event.measurement
//     ) {
//       apiService.deleteMeasurement(event.measurement.annotationUID);
//     } else {
//       console.warn('MEASUREMENT_REMOVED event missing measurement or annotationUID property:', event);
//     }
//   });
// }

// function onModeEnter() {
//    console.log(" onModeEnter called");
//   const queryParams = parse(window.location.search);
//     console.log("Query Params:", queryParams);
//   // Support both 'StudyInstanceUIDs' (plural) and the standard 'StudyInstanceUID'
//   const studyInstanceUids = queryParams.StudyInstanceUIDs?.split(',') ||
//                            (queryParams.StudyInstanceUID ? [queryParams.StudyInstanceUID] : []);

//   if (studyInstanceUids.length === 0) {
//     console.error('No StudyInstanceUIDs found in the URL.');
//     return;
//   }

//   // 1. Fetch GCP Context and Bearer Token from ERP (using credentials: 'include')
//   Promise.all([
//     apiService.fetchStudyContext(studyInstanceUids),
//     apiService.getGCPToken(studyInstanceUids)
//   ]).then(([contexts, tokenData]) => {

//     // We use the context of the first study to define the primary DICOMweb gateway

//     const { dicomStorePath} = contexts[0];
//     const gcpUrl = `https://healthcare.googleapis.com/v1/${dicomStorePath}/dicomWeb`;

//     const { projectId, location, datasetId, dicomStoreId } = contexts[0];
//     const gcpUrl = `https://healthcare.googleapis.com/v1/projects/${projectId}/locations/${location}/datasets/${datasetId}/dicomStores/${dicomStoreId}/dicomWeb`;
//     const gcpUrl = `https://healthcare.googleapis.com/v1/${dicomStorePath}/dicomWeb`;
//     const activeDataSource = extensionManager.getActiveDataSource();

//     if (activeDataSource && activeDataSource[0]) {
//       // 2. Configure GCP Auth Headers
//       activeDataSource[0].updateDataSourceConfiguration({
//         wadoUriRoot: gcpUrl,
//         qidoRoot: gcpUrl,
//         wadoRoot: gcpUrl,
//         headers: {
//           Authorization: `Bearer ${tokenData.access_token}`,
//         },
//       });

//       // 3. Fetch and Load Measurements for all studies in parallel
//       studyInstanceUids.forEach(uid => {
//         apiService.fetchMeasurements(uid).then(measurements => {
//           measurements.forEach(measurement => {
//             // Map the stored DB record back into OHIF's MeasurementService
//             measurementService.addRawMeasurement(
//               measurementSource,
//               'customAnnotationType',
//               measurement,
//               toMeasurementSchema
//             );
//           });
//         });

//         // 4. Connect IoT Service for real-time collaboration on this specific study
//         IoTService.connect(uid);
//       });
//     } else {
//       console.error('No active data source found.');
//     }
//   }).catch(err => {
//     console.error('Failed to initialize study context or tokens:', err);
//   });
// }

// function getCommandsModule({ servicesManager }) {
//   return {
//     openShareModal: () => {
//       const { uiModalService, viewportGridService } = servicesManager.services;
//       const state = viewportGridService.getState();
//       const activeViewport = state.viewports[state.activeViewportIndex];
//       const studyInstanceUid = activeViewport?.StudyInstanceUID;

//       uiModalService.show({
//         content: ShareModal,
//         title: 'Share Study',
//         contentProps: { studyInstanceUid },
//         containerClassName: 'max-w-lg',
//       });
//     },
//   };
// }

// function getToolbarModule({ commandsManager }) {
//   return [
//     {
//       id: 'Share',
//       uiType: 'ohif.radioGroup',
//       props: {
//         icon: 'link',
//         label: 'Share',
//         commands: 'openShareModal',
//       },
//     },
//   ];
// }

// export default {
//   id: extensionId,
//   preRegistration,
//   onModeEnter,
// };

// export { getCommandsModule, getToolbarModule };



import ApiService from './services/ApiService';
import IoTService from './services/IoTService';
import {
  MeasurementService,
} from '@ohif/core';

import { parse } from 'query-string';

const extensionId = 'actecal-erp';

const measurementService =
  new MeasurementService();

const measurementSource =
  measurementService.createSource(
    'actecal-erp',
    '1'
  );

const toMeasurementSchema =
  data => ({
    ...data,
    source: measurementSource,
  });

const apiService =
  new ApiService();



/* ---------------------------
   STUDY INITIALIZATION
---------------------------- */

async function initializeStudy(extensionManager, servicesManager) {

  try {
    const { uiNotificationService } = servicesManager.services;
    console.log("initializeStudy called");

    const queryParams = parse(window.location.search);

    console.log("Query Params:", queryParams);

    const userId = queryParams.userId;
    const tenant = queryParams.tenant;

    console.log("USER ID:", userId);
    console.log("TENANT:", tenant);

    const apiService = new ApiService(userId);
    let studyInstanceUids = [];
    let contexts;
    let tokenData;

    if (queryParams.sharecode) {
      try {
        const shareData = await apiService.resolveShare(queryParams.sharecode);
        studyInstanceUids = shareData.studyInstanceUids;
        contexts = shareData.contexts;
        tokenData = shareData.tokenData;
      } catch (err) {
        uiNotificationService.show({
          title: 'Share Link Invalid',
          message: 'Failed to resolve the share link. It may be expired or invalid.',
          type: 'error',
          duration: 10000,
        });
        console.error("Share code resolution failed:", err);
        return;
      }
    } else {
      studyInstanceUids =
        queryParams.StudyInstanceUIDs?.split(',') ||
        (queryParams.StudyInstanceUID ? [queryParams.StudyInstanceUID] : []);

      if (!studyInstanceUids.length) {
        console.log("No StudyInstanceUIDs found - showing default view");
        return;
      }

      // Check for cached token from Worklist
      const cacheKey = `actecal_cache_${studyInstanceUids[0]}`;
      const cachedData = sessionStorage.getItem(cacheKey);

      if (cachedData) {
        try {
          const parsedCache = JSON.parse(cachedData);
          if (parsedCache.token && parsedCache.dicomStorePath) {
            console.log("🚀 Cache Hit! Bypassing API fetch for StudyContext & Token");
            contexts = { studies: [{ dicom_store_path: parsedCache.dicomStorePath, study_instance_uid: studyInstanceUids[0] }] };
            tokenData = { access_token: parsedCache.token };
          }
        } catch (e) {
          console.warn("Error parsing cached Worklist data", e);
        }
      }

      // Fallback to API if cache missed
      if (!contexts || !tokenData) {
        try {
          console.log("Cache Miss. Fetching Context and Token via API");
          const results = await Promise.all([
            apiService.fetchStudyContext(studyInstanceUids),
            apiService.getGCPToken(studyInstanceUids),
          ]);
          contexts = results[0];
          tokenData = results[1];
          
          if (!tokenData || !tokenData.access_token) {
            throw new Error("Invalid token received from backend");
          }
        } catch (authErr) {
          uiNotificationService.show({
            title: 'Authentication Error',
            message: 'Failed to retrieve access token or study context for the data source.',
            type: 'error',
            duration: 10000,
          });
          console.error("Token fetch failed:", authErr);
          return;
        }
      }
    }

      /* ---------------------------
   CONFIGURE DATA SOURCE
---------------------------- */


/* ---------------------------
   CONFIGURE DATA SOURCE
---------------------------- */

try {
  let dicomStorePath;
  let validUids = [...studyInstanceUids];

  if (contexts && contexts.studies && Array.isArray(contexts.studies) && contexts.studies.length > 0) {
    // Extract primary datastore from the first study
    dicomStorePath = contexts.studies[0].dicom_store_path;

    // Check if any studies belong to a different datastore
    const mismatchedStudies = contexts.studies.filter(s => s.dicom_store_path !== dicomStorePath);

    if (mismatchedStudies.length > 0) {
      const mismatchedUids = mismatchedStudies.map(s => s.study_instance_uid);
      const matchedStudies = contexts.studies.filter(s => s.dicom_store_path === dicomStorePath);
      validUids = matchedStudies.map(s => s.study_instance_uid);

      // Update the browser URL immediately so OHIF core only loads the valid UIDs
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('StudyInstanceUIDs')) {
        urlParams.set('StudyInstanceUIDs', validUids.join(','));
      }
      if (urlParams.has('StudyInstanceUID')) {
        urlParams.delete('StudyInstanceUID'); // Clean up singular param if we are using multiples
        urlParams.set('StudyInstanceUIDs', validUids.join(','));
      }
      const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
      window.history.replaceState(null, '', newUrl);

      // Generate a URL for the remaining mismatched studies
      const newTabParams = new URLSearchParams(window.location.search);
      newTabParams.delete('StudyInstanceUID');
      newTabParams.set('StudyInstanceUIDs', mismatchedUids.join(','));
      const newTabUrl = `${window.location.pathname}?${newTabParams.toString()}`;

      // Show toast notifying user
      const { uiNotificationService } = servicesManager.services;
      uiNotificationService.show({
        title: 'Additional Studies Available',
        message: `Requested study cannot be opened in same view. Please click below to open in another tab.`,
        type: 'warning',
        duration: 15000,
        action: {
          label: 'Open Remaining in New Tab',
          onClick: () => {
            window.open(newTabUrl, '_blank');
          }
        }
      });
    }
  } else {
    // Fallback to older API response format if the backend hasn't updated yet
    dicomStorePath = contexts.dicomStorePath;
  }

  console.log("dicomStorePath:", dicomStorePath);

  const gcpUrl = `https://healthcare.googleapis.com/v1/${dicomStorePath}/dicomWeb`;
  console.log("GCP URL:", gcpUrl);

  const { userAuthenticationService } = servicesManager.services;
  
  // Inject the Google Cloud token into OHIF's authentication service
  if (userAuthenticationService) {
    userAuthenticationService.setServiceImplementation({
      getAuthorizationHeader: () => ({
        Authorization: `Bearer ${tokenData.access_token}`
      })
    });
    console.log("✅ Set Authorization header in userAuthenticationService");
  } else {
    console.warn("userAuthenticationService not available");
  }

  if (extensionManager) {
    const existingSource = extensionManager.dataSourceDefs["ohif"];
    const existingConfig = existingSource ? existingSource.configuration : {};

    extensionManager.updateDataSourceConfiguration(
      "ohif",
      {
        ...existingConfig,
        wadoUriRoot: gcpUrl,
        qidoRoot: gcpUrl,
        wadoRoot: gcpUrl,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        dicomUploadEnabled: true,
        omitQuotationForMultipartRequest: true,
      }
    );

    console.log("✅ Datasource updated successfully using extensionManager");
  }

} catch (error) {
  console.error("Datasource configuration failed:", error);
}

// try {

//   const { dicomStorePath } = contexts;
//    console.log("dicomStorePath",dicomStorePath)
//   const gcpUrl =
//     `https://healthcare.googleapis.com/v1/${dicomStorePath}/dicomWeb`;

//   console.log("GCP URL:", gcpUrl);

//   const activeDataSource =
//     extensionManager?.getActiveDataSource?.();

//   console.log(
//     "Active Data Source:",
//     activeDataSource
//   );

//   if (activeDataSource?.[0]) {

//     activeDataSource[0]
//       .updateDataSourceConfiguration({
//         wadoUriRoot: gcpUrl,
//         qidoRoot: gcpUrl,
//         wadoRoot: gcpUrl,
//         headers: {
//           Authorization: `Bearer ${tokenData.access_token}`,
//         },
//       });

//     console.log(
//       "Datasource updated successfully"
//     );

//   } else {

//     console.warn(
//       "No active datasource found"
//     );

//   }

// } catch (error) {

//   console.error(
//     "Datasource configuration failed:",
//     error
//   );

// }

    console.log(
      "Study Context:",
      contexts
    );

    console.log(
      "Token Data:",
      tokenData
    );



    /* ---------------------------
       LOAD MEASUREMENTS
    ---------------------------- */

    for (
      const uid
      of studyInstanceUids
    ) {

      try {

        const measurements =
          await apiService
            .fetchMeasurements(
              uid
            );

        console.log(
          `Measurements for ${uid}:`,
          measurements
        );

        measurements
          ?.forEach(
            measurement => {

              measurementService
                .addRawMeasurement(
                  measurementSource,
                  'customAnnotationType',
                  measurement,
                  toMeasurementSchema
                );

            }
          );



        /* ---------------------------
           REALTIME SOCKET
        ---------------------------- */

        // IoTService.connect(
        //   uid
        // );

      } catch (err) {

        console.error(
          `Measurement error for ${uid}:`,
          err
        );

      }

    }

  } catch (err) {

    console.error(
      "Study initialization failed:",
      err
    );

  }

}



/* ---------------------------
   EXTENSION REGISTER
---------------------------- */

// function preRegistration(extensionManager) {
async function preRegistration({  extensionManager,
  servicesManager,
  commandsManager,}) {


  console.log(
    "Actecal extension loaded"
  );



  // Initialize viewer
  // initializeStudy(extensionManager);

  await initializeStudy(extensionManager, servicesManager);




  /* ---------------------------
     MEASUREMENT EVENTS
  ---------------------------- */

  measurementService
    .subscribe(
      measurementService.EVENTS.MEASUREMENT_ADDED,
      event => {

        console.log(
          "MEASUREMENT_ADDED:",
          event
        );

  measurementService.subscribe(measurementService.EVENTS.MEASUREMENT_UPDATED, event => {
    console.log("MEASUREMENT_UPDATED:", event);
    const measurement = event?.measurement;
    if (measurement?.studyInstanceUid) {
      apiService.saveMeasurement(measurement.studyInstanceUid, measurement);
    }
  });


        const measurement =
          event
            ?.measurement;

        if (
          measurement
            ?.studyInstanceUid
        ) {

          apiService
            .saveMeasurement(
              measurement
                .studyInstanceUid,

              measurement
            );

        }

      }
    );



  measurementService
    .subscribe(
      'MEASUREMENT_REMOVED',
      event => {

        console.log(
          "MEASUREMENT_REMOVED:",
          event
        );

        const measurement =
          event
            ?.measurement;

        if (
          measurement
            ?.annotationUID
        ) {

          apiService
            .deleteMeasurement(
              measurement
                .annotationUID
            );

        }

      }
    );

}



/* ---------------------------
   COMMANDS & TOOLBAR
---------------------------- */

import ShareModal from './components/ShareModal';

function getCommandsModule({ servicesManager }) {
  return {
    actions: {
      openShareModal: () => {
        const { uiModalService, viewportGridService } = servicesManager.services;
        const state = viewportGridService.getState();
        const activeViewport = state.viewports[state.activeViewportIndex];
        const studyInstanceUid = activeViewport?.StudyInstanceUID;

        uiModalService.show({
          content: ShareModal,
          title: 'Share Study',
          contentProps: { studyInstanceUid },
          containerClassName: 'max-w-lg',
        });
      },
      toggleFullscreen: () => {
        const { panelService } = servicesManager.services;
        const isFullscreen = !!document.fullscreenElement;

        if (!isFullscreen) {
          document.documentElement.requestFullscreen().catch(err => {
            console.warn(`Error attempting to enable fullscreen mode: ${err.message}`);
          });
          // Collapse panels
          panelService._broadcastEvent(panelService.EVENTS.PANELS_CHANGED, { 
            options: { leftPanelClosed: true, rightPanelClosed: true } 
          });
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          }
          // Expand panels when exiting fullscreen
          panelService._broadcastEvent(panelService.EVENTS.PANELS_CHANGED, { 
            options: { leftPanelClosed: false, rightPanelClosed: false } 
          });
        }
      },
    },
      definitions: {
        openShareModal: {
          commandFn: function(context) { return this.actions.openShareModal(context); },
        },
        toggleFullscreen: {
          commandFn: function(context) { return this.actions.toggleFullscreen(context); },
        },
      },
    };
}

function getToolbarModule({ commandsManager }) {
  return [
    {
      name: 'Share',
      id: 'Share',
      uiType: 'ohif.radioGroup',
      props: {
        icon: 'link',
        label: 'Share',
        commands: 'openShareModal',
      },
    },
    {
      name: 'Fullscreen',
      id: 'Fullscreen',
      uiType: 'ohif.radioGroup',
      props: {
        icon: 'arrows-alt', // typical fullscreen icon
        label: 'Fullscreen (f)',
        commands: 'toggleFullscreen',
      },
    },
  ];
}


import ReportingPanel from './components/ReportingPanel';
import AIAnalysisPanel from './components/AIAnalysisPanel';
import ActiveUsersPanel from './components/ActiveUsersPanel';
import CollaborativeNotesPanel from './components/CollaborativeNotesPanel';
import AnnotationFiltersPanel from './components/AnnotationFiltersPanel';



function getPanelModule({ commandsManager, extensionManager, servicesManager }) {
  return [
    {
      name: 'reporting',
      iconName: 'document',
      iconLabel: 'Report',
      label: 'Reporting',
      component: ReportingPanel,
    },
    {
      name: 'aiAnalysis',
      iconName: 'brain',
      iconLabel: 'AI Analysis',
      label: 'AI Analysis',
      component: AIAnalysisPanel,
    },
    {
      name: 'activeUsers',
      iconName: 'group',
      iconLabel: 'Active Users',
      label: 'Active Participants',
      component: ActiveUsersPanel,
    },
    {
      name: 'notes',
      iconName: 'chat',
      iconLabel: 'Notes',
      label: 'Collaborative Notes',
      component: CollaborativeNotesPanel,
    },
    {
      name: 'annotationFilters',
      iconName: 'list',
      iconLabel: 'Filters',
      label: 'Annotation Visibility',
      component: AnnotationFiltersPanel,
    },
  ];
}

import getDataSourcesModule from './getDataSourcesModule';

/* ---------------------------
   EXPORT
---------------------------- */

export default {

  id:
    extensionId,

  preRegistration,
  getCommandsModule,
  getToolbarModule,
  getPanelModule,
  getDataSourcesModule
};
