import Cookies from 'js-cookie';

const API_BASE_URL = window.config.apiBaseUrl;
const TENANT = window.config.tenant;

class ApiService {
  constructor(userId) {
    this.baseUrl =  `${API_BASE_URL}/erp/${TENANT}/dicom`;
      this.userId =userId;
  }


  getHeaders(additionalHeaders = {}) {
    const headers = { ...additionalHeaders };
    if (this.userId) {
      headers['x-user-id'] = this.userId;
    }
    const guestToken = sessionStorage.getItem('actecal_guestToken');
    if (guestToken) {
      headers['Authorization'] = `Bearer ${guestToken}`;
    }
    return headers;
  }

  async getGCPToken(studyInstanceUids) {
    const uids = Array.isArray(studyInstanceUids) ? studyInstanceUids.join(',') : studyInstanceUids;
    const response = await fetch(`${this.baseUrl}/gcp-token?uids=${uids}`, {
      credentials: 'include',
      headers: this.getHeaders(),
    });
    return response.json();
  }

async fetchStudyContext(studyInstanceUids) {
    const uids = Array.isArray(studyInstanceUids) ? studyInstanceUids.join(',') : studyInstanceUids;
    const response = await fetch(`${this.baseUrl}/studies/context?uids=${uids}`, {
      credentials: 'include',
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async fetchMeasurements(studyInstanceUid) {
    const response = await fetch(`${this.baseUrl}/studies/${studyInstanceUid}/measurements`, {
      credentials: 'include',
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async saveMeasurement(studyInstanceUid, measurementData) {
    const response = await fetch(`${this.baseUrl}/studies/${studyInstanceUid}/measurements`, {
      method: 'POST',
      credentials: 'include',
      headers: this.getHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(measurementData),
    });
    return response.json();
  }

  async fetchDraftReport(studyInstanceUid) {
    const response = await fetch(`${this.baseUrl}/get-draft-report?studyInstanceUid=${studyInstanceUid}`, {
      credentials: 'include',
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error('Failed to fetch draft report');
    }
    return response.json();
  }

  async getSubmitReportUrls(studyInstanceUid) {
    const response = await fetch(`${this.baseUrl}/submit-report?studyInstanceUid=${studyInstanceUid}`, {
      credentials: 'include',
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error('Failed to fetch submit report URLs');
    }
    return response.json();
  }

  async confirmReportSubmission(studyInstanceUid) {
    const response = await fetch(`${this.baseUrl}/submit-report`, {
      method: 'POST',
      credentials: 'include',
      headers: this.getHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ studyInstanceUid }),
    });
    if (!response.ok) {
      throw new Error('Failed to confirm report submission');
    }
    return response.json();
  }

  async deleteMeasurement(annotationUID) {
    const response = await fetch(`${this.baseUrl}/measurements/${annotationUID}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: this.getHeaders(),
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
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async shareStudy(data) {
    const response = await fetch(`${this.baseUrl}/share`, {
      method: 'POST',
      credentials: 'include',
      headers: this.getHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(data),
    });
    return response.json();
  }
  async resolveShare(shareCode) {
    const response = await fetch(`${this.baseUrl}/resolve-share?code=${shareCode}`, {
      credentials: 'include',
      headers: this.getHeaders(),
    });
    return response.json();
  }
}

export default ApiService;
