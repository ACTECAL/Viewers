import Cookies from 'js-cookie';

const API_BASE_URL = process.env.API_BASE_URL;

class ApiService {
  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  async getGCPToken(studyInstanceUids) {
    const uids = Array.isArray(studyInstanceUids) ? studyInstanceUids.join(',') : studyInstanceUids;
    const response = await fetch(`${this.baseUrl}/auth/gcp-token?uids=${uids}`, {
      credentials: 'include',
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
