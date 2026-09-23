// import { Client } from 'paho-mqtt';
// import { MeasurementService } from '@ohif/core';

// const measurementService = new MeasurementService();
// const IOT_CORE_BASE_URL =  window.config.iotCoreBaseUrl;

// class IoTService {
//   constructor() {
//     this.client = null;
//   }

//   connect(studyInstanceUid) {
//     this.client = new Client(IOT_CORE_BASE_URL, 'clientId-' + Math.random());

//     this.client.onMessageArrived = this.onMessage.bind(this);

//     this.client.connect({
//       onSuccess: () => {
//         this.client.subscribe(`erp/study/${studyInstanceUid}/updates`);
//       },
//     });
//   }

//   onMessage(message) {
//     const payload = JSON.parse(message.payloadString);
//     const { action, data } = payload;

//     if (action === 'CREATE') {
//       measurementService.addRawMeasurement(
//         measurementService.createSource('actecal-erp', '1'),
//         'customAnnotationType',
//         { ...data, source: 'external', color: '#FF8C00' },
//         d => d
//       );
//     } else if (action === 'DELETE') {
//       measurementService.remove(data.annotationUID);
//     }
//   }
// }

// export default new IoTService();

import { Client } from 'paho-mqtt';

const IOT_CORE_BASE_URL = window.config.iotCoreBaseUrl;

class IoTService {
  constructor() {
    this.client = null;
  }

  connect(studyInstanceUid) {
    this.client = new Client(IOT_CORE_BASE_URL, 'clientId-' + Math.random());

    this.client.onMessageArrived = this.onMessage.bind(this);

    this.client.connect({
      onSuccess: () => {
        this.client.subscribe(`erp/study/${studyInstanceUid}/updates`);
      },
    });
  }

  disconnect() {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }

  onMessage(message) {
    const topic = message.destinationName || '';
    const studyUid = topic.split('/')[2] || null;

    const payload = JSON.parse(message.payloadString);
    const { action, data } = payload;

    if (action === 'CREATE') {
      // Hydration happens in index.js where the real MeasurementService lives.
      window.dispatchEvent(
        new CustomEvent('actecal:externalMeasurement', {
          detail: { measurement: { ...data, studyInstanceUid: studyUid } },
        })
      );
    }
  }
}

export default new IoTService();
