const API_BASE_URL = window.config.apiBaseUrl;
const TENANT = window.config.tenant;
console.log(API_BASE_URL, TENANT);
// ────────────────────────────────────────────────
// Token Refresh State (shared across fetch calls)
// ────────────────────────────────────────────────
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error = null) => {
  failedQueue.forEach(prom => {
    if (error) prom.reject(error);
    else prom.resolve();
  });
  failedQueue = [];
};

// Fetch fresh permissions + permToken from the erp-api backend.
// Called after a successful token refresh so the stored user stays valid.
const fetchAndStorePermissions = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/erp/${TENANT}/auth/get-permission`, {
      credentials: 'include',
    });

    if (!response.ok) return;

    const data = await response.json();

    if (data?.permToken) {
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      const updatedUser = {
        ...currentUser,
        permToken: data.permToken,
        permission: data.permission || currentUser.permission,
        userId: data.userId || currentUser.userId,
      };
      localStorage.setItem('user', JSON.stringify(updatedUser));
    }
  } catch (err) {
    console.error('Permission fetch failed:', err);
  }
};

// Refresh the Cognito access token: erp-api reads the httpOnly
// refresh_token cookie and re-issues fresh cookies
// (POST /erp/:tenant/auth/token).
const refreshTokens = async () => {
  console.log('[AUTH REFRESH] Called');
  console.log('[AUTH REFRESH] isRefreshing:', isRefreshing);

  if (isRefreshing) {
    console.log('[AUTH REFRESH] Already refreshing, adding to queue');

    return new Promise((resolve, reject) => {
      failedQueue.push({ resolve, reject });
    });
  }

  isRefreshing = true;

  try {
    console.log('[AUTH REFRESH] Calling /auth/token');

    const response = await fetch(`${API_BASE_URL}/erp/${TENANT}/auth/token`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    console.log('[AUTH REFRESH] Response:', response.status);

    if (!response.ok) {
      throw new Error(`Refresh failed: ${response.status}`);
    }

    await fetchAndStorePermissions();

    processQueue();

    console.log('[AUTH REFRESH] Refresh successful');

    return true;
  } catch (err) {
    console.error('[AUTH REFRESH] Refresh error:', err);

    processQueue(err);
    throw err;
  } finally {
    isRefreshing = false;
  }
};

// Redirect to Cognito login. After login Cognito calls the erp-api
// /erp/:tenant/auth/cognito-callback which exchanges the code and sets the
// httpOnly access/refresh cookies, then bounces back to the frontend.
const redirectToLogin = () => {
  console.log('========== [AUTH REDIRECT START] ==========');

  const tenantName = localStorage.getItem('tenantName') || TENANT || 'default';

  console.log('[AUTH REDIRECT] tenantName:', tenantName);
  console.log('[AUTH REDIRECT] TENANT:', TENANT);
  console.log('[AUTH REDIRECT] API_BASE_URL:', API_BASE_URL);

  const rawTenantConfig = localStorage.getItem('tenantConfig');

  console.log('[AUTH REDIRECT] raw tenantConfig:', rawTenantConfig);

  const tenantConfig = JSON.parse(rawTenantConfig || '{}');

  console.log('[AUTH REDIRECT] tenantConfig:', tenantConfig);

  const auth = tenantConfig?.auth || {};

  console.log('[AUTH REDIRECT] auth config:', auth);

  const cognitoDomain =
    auth.cognitoDomain || 'https://ap-south-1rxdtudilc.auth.ap-south-1.amazoncognito.com';

  const clientId = auth.clientId || '36t5q5ljl36405lcjfhajif16d';

  console.log('[AUTH REDIRECT] cognitoDomain:', cognitoDomain);
  console.log('[AUTH REDIRECT] clientId:', clientId);

  const isLocalDev = API_BASE_URL.includes('localhost') || process.env.NODE_ENV === 'development';

  console.log('[AUTH REDIRECT] isLocalDev:', isLocalDev);
  console.log('[AUTH REDIRECT] NODE_ENV:', process.env.NODE_ENV);

  const redirectUri =
    auth.redirectUri ||
    (isLocalDev ? `${API_BASE_URL}/erp/${tenantName}/auth/cognito-callback` : null);

  console.log('[AUTH REDIRECT] auth.redirectUri:', auth.redirectUri);
  console.log('[AUTH REDIRECT] final redirectUri:', redirectUri);

  console.log('[AUTH REDIRECT] clientId exists:', !!clientId);
  console.log('[AUTH REDIRECT] redirectUri exists:', !!redirectUri);

  if (clientId && redirectUri) {
    const loginUrl =
      `${cognitoDomain}/login` +
      `?client_id=${clientId}` +
      `&response_type=code` +
      `&scope=email+openid+phone` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(`tenant=${tenantName}`)}`;

    console.log('[AUTH REDIRECT] FINAL LOGIN URL:', loginUrl);
    console.log('[AUTH REDIRECT] Redirecting to Cognito login...');

    console.log('========== [AUTH REDIRECT END] ==========');

    window.location.href = loginUrl;
  } else {
    console.error('[AUTH REDIRECT] Cannot redirect to Cognito!', {
      clientId,
      redirectUri,
      tenantName,
      cognitoDomain,
      isLocalDev,
    });

    console.log('========== [AUTH REDIRECT FAILED] ==========');

    // Do not redirect to "/"
  }
};

// ────────────────────────────────────────────────
// Enhanced Fetch with 401 Refresh Logic
// ────────────────────────────────────────────────
// const authFetch = async (url, options = {}) => {
//   let response = await fetch(url, {
//     ...options,
//     credentials: 'include',
//   });

//   // Handle 401 → the Cognito access token (cookie) expired.
//   // Refresh it via /auth/token and retry the original request.
//   if (response.status === 401) {
//     if (isRefreshing) {
//       // Wait for the ongoing refresh, then retry
//       await new Promise((resolve, reject) => {
//         failedQueue.push({ resolve, reject });
//       });
//       return authFetch(url, options);
//     }

//     try {
//       await refreshTokens();
//       // Retry original request with the fresh cookie
//       response = await fetch(url, {
//         ...options,
//         credentials: 'include',
//       });
//     } catch (refreshError) {
//       console.error('[AUTH FETCH] Refresh failed → redirecting to login');
//       redirectToLogin();
//       throw refreshError;
//     }
//   }

//   // Handle 403
//   if (response.status === 403) {
//     window.location.href = '/access-denied';
//     throw new Error('Access Denied');
//   }

//   if (!response.ok) {
//     throw new Error(`HTTP error! status: ${response.status}`);
//   }

//   return response.json();
// };

const authFetch = async (url, options = {}) => {
  console.log('[AUTH FETCH] Request:', url);

  let response = await fetch(url, {
    ...options,
    credentials: 'include',
  });

  console.log('[AUTH FETCH] Response:', {
    url,
    status: response.status,
  });

  if (response.status === 401) {
    console.log('[AUTH FETCH] 401 detected:', url);
    console.log('[AUTH FETCH] isRefreshing:', isRefreshing);

    if (isRefreshing) {
      console.log('[AUTH FETCH] Waiting for existing refresh');

      await new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      });

      return authFetch(url, options);
    }

    try {
      console.log('[AUTH FETCH] Starting token refresh');

      await refreshTokens();

      console.log('[AUTH FETCH] Token refresh successful');

      response = await fetch(url, {
        ...options,
        credentials: 'include',
      });

      console.log('[AUTH FETCH] Retry response:', {
        url,
        status: response.status,
      });
    } catch (refreshError) {
      console.error('[AUTH FETCH] Refresh failed → redirecting to login', refreshError);

      redirectToLogin();
      throw refreshError;
    }
  }

  if (response.status === 403) {
    window.location.href = '/access-denied';
    throw new Error('Access Denied');
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
};

// ────────────────────────────────────────────────
// ApiService
// ────────────────────────────────────────────────
class ApiService {
  constructor(userId) {
    this.baseUrl = `${API_BASE_URL}/erp/${TENANT}/dicom`;
    this.userId = userId;
  }

  async getWorklist(userId = null) {
    let url = `${this.baseUrl}/worklist`;
    const queryUserId = userId || this.userId;

    if (queryUserId) {
      url += `?userId=${queryUserId}`;
    }

    return authFetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async getGCPToken(studyInstanceUids) {
    const uids = Array.isArray(studyInstanceUids) ? studyInstanceUids.join(',') : studyInstanceUids;
    return authFetch(`${this.baseUrl}/gcp-token?uids=${uids}`, {
      headers: { 'x-user-id': this.userId },
    });
  }

  async fetchStudyContext(studyInstanceUids) {
    const uids = Array.isArray(studyInstanceUids) ? studyInstanceUids.join(',') : studyInstanceUids;
    return authFetch(`${this.baseUrl}/studies/context?uids=${uids}`);
  }

  async fetchMeasurements(studyInstanceUid) {
    return authFetch(`${this.baseUrl}/studies/${studyInstanceUid}/measurements`);
  }

  async saveMeasurement(studyInstanceUid, measurementData) {
    return authFetch(`${this.baseUrl}/studies/${studyInstanceUid}/measurements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': this.userId,
      },
      body: JSON.stringify(measurementData),
    });
  }

  async deleteMeasurement(annotationUID) {
    return authFetch(`${this.baseUrl}/measurements/${annotationUID}`, {
      method: 'DELETE',
      headers: { 'x-user-id': this.userId },
    });
  }

  async fetchDataSourceConfiguration(studyInstanceUid) {
    const context = await this.fetchStudyContext(studyInstanceUid);
    const { datastoreId, imageSetId, region } = context;
    return { datastoreId, imageSetId, region };
  }

  async getDoctors() {
    return authFetch(`${this.baseUrl}/doctors`);
  }

  async shareStudy(studyInstanceUid, data = {}) {
    return authFetch(`${this.baseUrl}/studies/${studyInstanceUid}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async resolveShare(shareCode) {
    return authFetch(`${this.baseUrl}/resolve-share?code=${encodeURIComponent(shareCode)}`);
  }

  // ────────────────────────────────────────────────
  // ERP HMS endpoints (templates + GCP recording)
  // ────────────────────────────────────────────────
  _hmsUrl() {
    // HMS routes are mounted at /erp/:tenant/hms on the same server
    return `${API_BASE_URL}/erp/${TENANT}/hms`;
  }

  async getTemplates(limit = 10, pagenumber = 1, departmentId = null) {
    return authFetch(`${this._hmsUrl()}/get-templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, pagenumber, department_id: departmentId }),
    });
  }

  async viewTemplate(templateId) {
    return authFetch(`${this._hmsUrl()}/view-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId }),
    });
  }

  async getDraftReport(studyInstanceUid) {
    return authFetch(`${this.baseUrl}/get-draft-report?studyInstanceUid=${studyInstanceUid}`);
  }

  async getAutoFillTemplate(studyInstanceUid) {
    return authFetch(
      `${this.baseUrl}/get-auto-fill-template?studyInstanceUid=${encodeURIComponent(studyInstanceUid)}`
    );
  }

  async getPatientHistory(studyInstanceUid) {
    return authFetch(
      `${this.baseUrl}/get-patient-history?studyInstanceUid=${encodeURIComponent(studyInstanceUid)}`
    );
  }

  async submitReportViaERP({ studyInstanceUid, template, pdfBase64, reportType }) {
    return authFetch(`${this.baseUrl}/submit-report-erp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studyInstanceUid,
        template,
        pdfBase64,
        reportType,
      }),
    });
  }

  async getRecordingConfig(refId) {
    const res = await authFetch(`${this._hmsUrl()}/get-recording-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiptno: refId }),
    });
    console.log('[scribe] getRecordingConfig response:', res);
    return res;
  }
}

export default ApiService;
