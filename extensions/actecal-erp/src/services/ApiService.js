// import Cookies from 'js-cookie';

// const API_BASE_URL = window.config.apiBaseUrl;
// const TENANT = window.config.tenant;

// class ApiService {
//   constructor(userId) {
//     this.baseUrl =  `${API_BASE_URL}/erp/${TENANT}/dicom`;
//       this.userId =userId;
//   }


//   getHeaders(additionalHeaders = {}) {
//     const headers = { ...additionalHeaders };
//     if (this.userId) {
//       headers['x-user-id'] = this.userId;
//     }
//     const guestToken = sessionStorage.getItem('actecal_guestToken');
//     if (guestToken) {
//       headers['Authorization'] = `Bearer ${guestToken}`;
//     }
//     return headers;
//   }

//   async getGCPToken(studyInstanceUids) {
//     const uids = Array.isArray(studyInstanceUids) ? studyInstanceUids.join(',') : studyInstanceUids;
//     const response = await fetch(`${this.baseUrl}/gcp-token?uids=${uids}`, {
//       credentials: 'include',
//       headers: this.getHeaders(),
//     });
//     return response.json();
//   }

// async fetchStudyContext(studyInstanceUids) {
//     const uids = Array.isArray(studyInstanceUids) ? studyInstanceUids.join(',') : studyInstanceUids;
//     const response = await fetch(`${this.baseUrl}/studies/context?uids=${uids}`, {
//       credentials: 'include',
//       headers: this.getHeaders(),
//     });
//     return response.json();
//   }

//   async fetchMeasurements(studyInstanceUid) {
//     const response = await fetch(`${this.baseUrl}/studies/${studyInstanceUid}/measurements`, {
//       credentials: 'include',
//       headers: this.getHeaders(),
//     });
//     return response.json();
//   }

//   async saveMeasurement(studyInstanceUid, measurementData) {
//     const response = await fetch(`${this.baseUrl}/studies/${studyInstanceUid}/measurements`, {
//       method: 'POST',
//       credentials: 'include',
//       headers: this.getHeaders({
//         'Content-Type': 'application/json',
//       }),
//       body: JSON.stringify(measurementData),
//     });
//     return response.json();
//   }

//   async fetchDraftReport(studyInstanceUid) {
//     const response = await fetch(`${this.baseUrl}/get-draft-report?studyInstanceUid=${studyInstanceUid}`, {
//       credentials: 'include',
//       headers: this.getHeaders(),
//     });
//     if (!response.ok) {
//       throw new Error('Failed to fetch draft report');
//     }
//     return response.json();
//   }

//   async getSubmitReportUrls(studyInstanceUid) {
//     const response = await fetch(`${this.baseUrl}/submit-report?studyInstanceUid=${studyInstanceUid}`, {
//       credentials: 'include',
//       headers: this.getHeaders(),
//     });
//     if (!response.ok) {
//       throw new Error('Failed to fetch submit report URLs');
//     }
//     return response.json();
//   }

//   async confirmReportSubmission(studyInstanceUid) {
//     const response = await fetch(`${this.baseUrl}/submit-report`, {
//       method: 'POST',
//       credentials: 'include',
//       headers: this.getHeaders({
//         'Content-Type': 'application/json',
//       }),
//       body: JSON.stringify({ studyInstanceUid }),
//     });
//     if (!response.ok) {
//       throw new Error('Failed to confirm report submission');
//     }
//     return response.json();
//   }

//   async deleteMeasurement(annotationUID) {
//     const response = await fetch(`${this.baseUrl}/measurements/${annotationUID}`, {
//       method: 'DELETE',
//       credentials: 'include',
//       headers: this.getHeaders(),
//     });
//     return response.json();
//   }

//   async fetchDataSourceConfiguration(studyInstanceUid) {
//     const context = await this.fetchStudyContext(studyInstanceUid);
//     const { datastoreId, imageSetId, region } = context;
//     return {
//       datastoreId,
//       imageSetId,
//       region,
//     };
//   }

//   async getDoctors() {
//     const response = await fetch(`${this.baseUrl}/doctors`, {
//       credentials: 'include',
//       headers: this.getHeaders(),
//     });
//     return response.json();
//   }

//   async shareStudy(data) {
//     const response = await fetch(`${this.baseUrl}/share`, {
//       method: 'POST',
//       credentials: 'include',
//       headers: this.getHeaders({
//         'Content-Type': 'application/json',
//       }),
//       body: JSON.stringify(data),
//     });
//     return response.json();
//   }
//   async resolveShare(shareCode) {
//     const response = await fetch(`${this.baseUrl}/resolve-share?code=${shareCode}`, {
//       credentials: 'include',
//       headers: this.getHeaders(),
//     });
//     return response.json();
//   }
// }

// export default ApiService;
import Cookies from 'js-cookie';

const API_BASE_URL = window.config.apiBaseUrl;
const TENANT = window.config.tenant;

// ────────────────────────────────────────────────
// Global Refresh State (shared across fetch calls)
// ────────────────────────────────────────────────
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve();
  });
  failedQueue = [];
};

// ────────────────────────────────────────────────
// Refresh Token + Permissions
// ────────────────────────────────────────────────
const refreshTokens = async () => {
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      failedQueue.push({ resolve, reject });
    });
  }

  isRefreshing = true;

  try {
    const response = await fetch(`${API_BASE_URL}/${TENANT}/auth/token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!response.ok) throw new Error('Refresh failed');

    // Fetch fresh permissions (same as your axios version)
    await fetchAndStorePermissions();

    processQueue();
    return true;
  } catch (err) {
    processQueue(err);
    throw err;
  } finally {
    isRefreshing = false;
  }
};

// ────────────────────────────────────────────────
// Fetch + Store Permissions (same as axios)
// ────────────────────────────────────────────────
const fetchAndStorePermissions = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/${TENANT}/auth/get-permission`, {
      credentials: 'include',
    });

    const data = await response.json();

    if (data?.permToken) {
      const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
      const updatedUser = {
        ...currentUser,
        permToken: data.permToken,
        permission: data.permission || currentUser.permission,
        userId: data.userId || currentUser.userId,
      };
      localStorage.setItem("user", JSON.stringify(updatedUser));
    }
  } catch (err) {
    console.error("❌ Permission fetch failed:", err);
  }
};

// ────────────────────────────────────────────────
// Redirect to Login (Cognito) - Same as your axios code
// ────────────────────────────────────────────────
const redirectToLogin = () => {
  const tenantName =
    process.env.REACT_APP_ENV === "local"
      ? "autolight"
      : localStorage.getItem("tenantName") || "default";

  const tenantConfig = JSON.parse(localStorage.getItem("tenantConfig") || "{}");
  const cognitoDomain =
    tenantConfig?.auth?.cognitoDomain ||
    "https://ap-south-1rxdtudilc.auth.ap-south-1.amazoncognito.com";

  const clientId = tenantConfig?.auth?.clientId;
  const redirectUri = tenantConfig?.auth?.redirectUri;

  const finalRedirectUri =
    process.env.REACT_APP_ENV === "local"
      ? "http://localhost:4000/erp/autolight/auth/cognito-callback"
      : redirectUri;

  if (clientId && finalRedirectUri) {
    const loginUrl = `${cognitoDomain}/login?client_id=${clientId}&response_type=code&scope=email+openid+phone&redirect_uri=${encodeURIComponent(
      finalRedirectUri
    )}&state=${encodeURIComponent(`tenant=${tenantName}`)}`;
    window.location.href = loginUrl;
  } else {
    window.location.href = "/";
  }
};

// ────────────────────────────────────────────────
// Enhanced Fetch with 401 Refresh Logic
// ────────────────────────────────────────────────
const authFetch = async (url, options = {}) => {
  let response = await fetch(url, {
    ...options,
    credentials: 'include',
  });

  // Handle 401
  if (response.status === 401) {
    const originalRequest = { url, options };

    if (isRefreshing) {
      // Wait for ongoing refresh
      await new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      });
      // Retry after queue is processed
      return authFetch(url, options);
    }

    try {
      await refreshTokens();
      // Retry original request
      response = await fetch(url, {
        ...options,
        credentials: 'include',
      });
    } catch (refreshError) {
      console.error("[AUTH FETCH] Refresh failed → redirecting to login");
      redirectToLogin();
      throw refreshError;
    }
  }

  // Handle 403
  if (response.status === 403) {
    window.location.href = "/access-denied";
    throw new Error("Access Denied");
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
};

// ────────────────────────────────────────────────
// Updated ApiService
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
      headers: { "x-user-id": this.userId },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(measurementData),
    });
  }

  async deleteMeasurement(annotationUID) {
    return authFetch(`${this.baseUrl}/measurements/${annotationUID}`, {
      method: 'DELETE',
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

  async shareStudy(data) {
    return authFetch(`${this.baseUrl}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }
}

export default ApiService;
