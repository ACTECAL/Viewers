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
  const studyInstanceUid = queryParams.StudyInstanceUID;

  apiService.fetchDataSourceConfiguration(studyInstanceUid).then(({ datastoreId, region }) => {
    const awsHealthImagingUrl = `https://runtime.medical-imaging.${region}.amazonaws.com/datastore/${datastoreId}/dicomWeb`;

    const activeDataSource = extensionManager.getActiveDataSource();

    if (activeDataSource && activeDataSource[0]) {
      activeDataSource[0].updateDataSourceConfiguration({
        wadoUriRoot: awsHealthImagingUrl,
        qidoRoot: awsHealthImagingUrl,
        wadoRoot: awsHealthImagingUrl,
      });

      apiService.fetchMeasurements(studyInstanceUid).then(measurements => {
        measurements.forEach(measurement => {
          measurementService.addRawMeasurement(
            measurementSource,
            'customAnnotationType',
            measurement,
            toMeasurementSchema
          );
        });
      });
    } else {
      console.error('No active data source found.');
    }
  });

  IoTService.connect(studyInstanceUid);
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
