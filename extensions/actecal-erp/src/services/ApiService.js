import Cookies from 'js-cookie';

const API_BASE_URL = window.config.apiBaseUrl;
const TENANT = window.config.tenant;

class ApiService {
  constructor(userId) {
    this.baseUrl =  `${API_BASE_URL}/erp/${TENANT}/dicom`;
      this.userId =userId;
  }


  async getGCPToken(studyInstanceUids) {

    const uids = Array.isArray(studyInstanceUids) ? studyInstanceUids.join(',') : studyInstanceUids;
    const response = await fetch(`${this.baseUrl}/gcp-token?uids=${uids}`, {
      credentials: 'include',
        headers: {
          "x-user-id": this.userId,
        },
    });
    return response.json();
  }

async fetchStudyContext(studyInstanceUids) {
    const uids = Array.isArray(studyInstanceUids) ? studyInstanceUids.join(',') : studyInstanceUids;
    const response = await fetch(`${this.baseUrl}/studies/context?uids=${uids}`, {
      credentials: 'include',
    });
    return response.json();
  }

  async fetchMeasurements(studyInstanceUid) {
    const response = await fetch(`${this.baseUrl}/studies/${studyInstanceUid}/measurements`, {
      credentials: 'include',
    });
    return response.json();
  }

  async saveMeasurement(studyInstanceUid, measurementData) {
    const response = await fetch(`${this.baseUrl}/studies/${studyInstanceUid}/measurements`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(measurementData),
    });
    return response.json();
  }

  async deleteMeasurement(annotationUID) {
    const response = await fetch(`${this.baseUrl}/measurements/${annotationUID}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return response.json();
  }

  async fetchDataSourceConfiguration(studyInstanceUid) {
    const context = await this.fetchStudyContext(studyInstanceUid);
    const { datastoreId, imageSetId, region } = context;
    return {
      datastoreId,
      imageSetId,
      region,
    };
  }

  async getDoctors() {
    const response = await fetch(`${this.baseUrl}/doctors`, {
      credentials: 'include',
    });
    return response.json();
  }

  async shareStudy(data) {
    const response = await fetch(`${this.baseUrl}/share`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    return response.json();
  }
}

export default ApiService;
