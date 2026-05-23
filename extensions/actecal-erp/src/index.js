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

async function initializeStudy(extensionManager) {

  try {

    console.log(
      "initializeStudy called"
    );

    const queryParams =
      parse(
        window.location.search
      );

    console.log(
      "Query Params:",
      queryParams
    );

    const userId =
  queryParams.userId;

const tenant =
  queryParams.tenant;

console.log(
  "USER ID:",
  userId
);

console.log(
  "TENANT:",
  tenant
);

const apiService = new ApiService(userId);
    // URL:
    // ?StudyInstanceUIDs=103,104

    const studyInstanceUids =
      queryParams
        .StudyInstanceUIDs
        ?.split(',') ||

      (
        queryParams
          .StudyInstanceUID

          ? [
              queryParams
                .StudyInstanceUID
            ]

          : []
      );

    console.log(
      "Parsed IDs:",
      studyInstanceUids
    );

    if (
      !studyInstanceUids
        .length
    ) {

      console.error(
        "No StudyInstanceUIDs found"
      );

      return;
    }



    /* ---------------------------
       FETCH API DATA
    ---------------------------- */

    const [
      contexts,
      tokenData
    ] =
      await Promise.all([
        apiService
          .fetchStudyContext(
            studyInstanceUids
          ),

        apiService
          .getGCPToken(
            studyInstanceUids
          ),
      ]);

      /* ---------------------------
   CONFIGURE DATA SOURCE
---------------------------- */


/* ---------------------------
   CONFIGURE DATA SOURCE
---------------------------- */

try {
  const { dicomStorePath } = contexts;   // ← yahan [0] lagana zaroori hai
  console.log("dicomStorePath:", dicomStorePath);

  const gcpUrl = `https://healthcare.googleapis.com/v1/${dicomStorePath}/dicomWeb`;
  console.log("GCP URL:", gcpUrl);
console.log(
  "active data source",
  extensionManager.getActiveDataSource()
);
  if (extensionManager) {
    extensionManager.updateDataSourceConfiguration(
      "ohif",   // ← yeh data source ka naam hai (default usually 'dicomweb' hota hai)
      {
        wadoUriRoot: gcpUrl,
        qidoRoot: gcpUrl,
        wadoRoot: gcpUrl,
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
        // Agar aur options chahiye toh add kar sakte ho
        // name: 'GCP-Actecal',
        // enableStudyLazyLoad: true,
      }
    );

    console.log("✅ Datasource updated successfully using extensionManager");
  } else {
    console.warn("ExtensionManager not available");
  }

  const ds = extensionManager.getActiveDataSource();

console.log(
  "CONFIG AFTER UPDATE",
  ds?.[0]?.getConfig?.()
);

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
function preRegistration({  extensionManager,
  servicesManager,
  commandsManager,}) {


  console.log(
    "Actecal extension loaded"
  );



  // Initialize viewer
  // initializeStudy(extensionManager);

    initializeStudy(extensionManager);




  /* ---------------------------
     MEASUREMENT EVENTS
  ---------------------------- */

  measurementService
    .subscribe(
      'MEASUREMENT_ADDED',
      event => {

        console.log(
          "MEASUREMENT_ADDED:",
          event
        );

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
   EXPORT
---------------------------- */

export default {

  id:
    extensionId,

  preRegistration,

};
