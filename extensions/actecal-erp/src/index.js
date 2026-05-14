import ApiService from './services/ApiService';
import IoTService from './services/IoTService';
import { MeasurementService, ExtensionManager, CommandsManager, ServicesManager, ServiceProvidersManager, HotkeysManager } from '@ohif/core';
import { parse } from 'query-string';

const extensionId = 'actecal-erp';

const measurementService = new MeasurementService();

const measurementSource = measurementService.createSource('actecal-erp', '1');
const toMeasurementSchema = data => ({
  ...data,
  source: measurementSource,
});

const apiService = new ApiService();

const commandsManager = new CommandsManager();
const servicesManager = new ServicesManager(commandsManager);
const serviceProvidersManager = new ServiceProvidersManager();
const hotkeysManager = new HotkeysManager(commandsManager, servicesManager);

const extensionManager = new ExtensionManager({
  commandsManager,
  servicesManager,
  serviceProvidersManager,
  hotkeysManager,
  appConfig: {},
});

function preRegistration() {
  measurementService.subscribe('MEASUREMENT_ADDED', event => {
    console.log('MEASUREMENT_ADDED event:', event);
    if (
      event &&
      typeof event === 'object' &&
      'measurement' in event &&
      typeof event.measurement === 'object' &&
      event.measurement !== null &&
      'studyInstanceUid' in event.measurement
    ) {
      apiService.saveMeasurement(event.measurement.studyInstanceUid, event.measurement);
    } else {
      console.warn('MEASUREMENT_ADDED event missing measurement or studyInstanceUid property:', event);
    }
  });

  measurementService.subscribe('MEASUREMENT_REMOVED', event => {
    console.log('MEASUREMENT_REMOVED event:', event);
    if (
      event &&
      typeof event === 'object' &&
      'measurement' in event &&
      typeof event.measurement === 'object' &&
      event.measurement !== null &&
      'annotationUID' in event.measurement
    ) {
      apiService.deleteMeasurement(event.measurement.annotationUID);
    } else {
      console.warn('MEASUREMENT_REMOVED event missing measurement or annotationUID property:', event);
    }
  });
}

function onModeEnter() {
  const queryParams = parse(window.location.search);
  // Support both 'StudyInstanceUIDs' (plural) and the standard 'StudyInstanceUID'
  const studyInstanceUids = queryParams.StudyInstanceUIDs?.split(',') ||
                           (queryParams.StudyInstanceUID ? [queryParams.StudyInstanceUID] : []);

  if (studyInstanceUids.length === 0) {
    console.error('No StudyInstanceUIDs found in the URL.');
    return;
  }

  // 1. Fetch GCP Context and Bearer Token from ERP (using credentials: 'include')
  Promise.all([
    apiService.fetchStudyContext(studyInstanceUids),
    apiService.getGCPToken(studyInstanceUids)
  ]).then(([contexts, tokenData]) => {

    // We use the context of the first study to define the primary DICOMweb gateway
    const { projectId, location, datasetId, dicomStoreId } = contexts[0];
    const gcpUrl = `https://healthcare.googleapis.com/v1/projects/${projectId}/locations/${location}/datasets/${datasetId}/dicomStores/${dicomStoreId}/dicomWeb`;

    const activeDataSource = extensionManager.getActiveDataSource();

    if (activeDataSource && activeDataSource[0]) {
      // 2. Configure GCP Auth Headers
      activeDataSource[0].updateDataSourceConfiguration({
        wadoUriRoot: gcpUrl,
        qidoRoot: gcpUrl,
        wadoRoot: gcpUrl,
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });

      // 3. Fetch and Load Measurements for all studies in parallel
      studyInstanceUids.forEach(uid => {
        apiService.fetchMeasurements(uid).then(measurements => {
          measurements.forEach(measurement => {
            // Map the stored DB record back into OHIF's MeasurementService
            measurementService.addRawMeasurement(
              measurementSource,
              'customAnnotationType',
              measurement,
              toMeasurementSchema
            );
          });
        });

        // 4. Connect IoT Service for real-time collaboration on this specific study
        IoTService.connect(uid);
      });
    } else {
      console.error('No active data source found.');
    }
  }).catch(err => {
    console.error('Failed to initialize study context or tokens:', err);
  });
}

function getCommandsModule({ servicesManager }) {
  return {
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
  };
}

function getToolbarModule({ commandsManager }) {
  return [
    {
      id: 'Share',
      uiType: 'ohif.radioGroup',
      props: {
        icon: 'link',
        label: 'Share',
        commands: 'openShareModal',
      },
    },
  ];
}

export default {
  id: extensionId,
  preRegistration,
  onModeEnter,
};

export { getCommandsModule, getToolbarModule };
