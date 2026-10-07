// window.config is swapped at runtime by loadDynamicConfig (see
// platform/app/src/index.js), so it is read on every call rather than captured
// at import time - otherwise a late import freezes a stale apiBaseUrl/tenant.
const getApiBaseUrl = () => window.config?.apiBaseUrl;

// ────────────────────────────────────────────────
// Tenant + user resolution
//
// The ERP launches the viewer with ?tenant=... (see Receipt.js handleOpenDicom)
// and ?userId=.... localStorage is scoped to this origin, so both arrive empty
// on a cold open - every API call used to fall back to the build-time
// window.config.tenant, which is only correct for the tenant that was hardcoded
// at build time. App.tsx persists ?tenant= into localStorage.tenantName during
// bootstrap; this is the read side of that.
//
// The slug guard is deliberately strict: a bad ?tenant= would make erp-api's
// getTenantInfo 500 on every request, which is a worse failure than falling
// back to the configured tenant.
// ────────────────────────────────────────────────
const TENANT_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/i;

const getTenant = () => {
  let stored = null;

  try {
    stored = localStorage.getItem('tenantName');
  } catch (err) {
    // storage unavailable (private mode, quota, ...) - fall through to config
  }

  if (stored && TENANT_PATTERN.test(stored)) {
    return stored;
  }

  if (stored) {
    console.warn('[AUTH] Ignoring malformed tenantName in storage:', stored);
  }

  return window.config?.tenant;
};

// userId arrives via ?userId= and is written to storage by App.tsx. Falling back
// to it here matters because several call sites construct ApiService with no
// argument, and endpoints such as /dicom/gcp-token answer 401 without x-user-id
// - which used to bounce the viewer straight back into the login redirect.
const getStoredUserId = () => {
  try {
    return localStorage.getItem('actecal_userId') || undefined;
  } catch (err) {
    return undefined;
  }
};

// ────────────────────────────────────────────────
// Return-To Latch
//
// erp-api's /auth/cognito-callback bounces the browser back to a fixed URL, so
// the page the user left (e.g. an open study) is lost across the login round
// trip. The current location is latched before redirecting to Cognito and
// restored on the next boot.
//
// sessionStorage is keyed per origin + tab, so it survives the
// frontend -> Cognito -> erp-api -> frontend chain with no backend changes.
// ────────────────────────────────────────────────
const RETURN_TO_KEY = 'actecal_auth_returnTo';
const RETURN_TO_TTL_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 2;

// One Cognito round trip is the healthy path (401 -> refresh -> login -> back).
// A couple of retries absorbs a session that expired mid-redirect. Past this the
// user is not getting in, and continuing to bounce them between Cognito and the
// viewer is the endless "logs in, sees login again" cycle this guard exists to
// stop. Kept above MAX_LOGIN_ATTEMPTS so the deep link is dropped first and the
// hard stop is the last resort.
const LOGIN_ATTEMPTS_KEY = 'actecal_auth_loginAttempts';
const MAX_LOGIN_REDIRECTS = 3;

// Only same-origin paths may be restored: leading "/" but not "//", which
// browsers treat as protocol-relative (an open redirect).
const isSafeReturnTo = url =>
  typeof url === 'string' && url.startsWith('/') && !url.startsWith('//');

const readReturnTo = () => {
  try {
    const raw = sessionStorage.getItem(RETURN_TO_KEY);

    if (!raw) {
      return null;
    }

    const entry = JSON.parse(raw);

    if (!entry || !isSafeReturnTo(entry.url)) {
      sessionStorage.removeItem(RETURN_TO_KEY);
      return null;
    }

    if (Date.now() - entry.at > RETURN_TO_TTL_MS) {
      console.log('[RETURN TO] Latch expired, dropping', entry.url);
      sessionStorage.removeItem(RETURN_TO_KEY);
      return null;
    }

    return entry;
  } catch (err) {
    sessionStorage.removeItem(RETURN_TO_KEY);
    return null;
  }
};

const writeReturnTo = entry => {
  try {
    sessionStorage.setItem(RETURN_TO_KEY, JSON.stringify(entry));
  } catch (err) {
    console.warn('[RETURN TO] Could not persist latch:', err);
  }
};

export const clearReturnTo = () => {
  try {
    sessionStorage.removeItem(RETURN_TO_KEY);
  } catch (err) {
    // ignore - storage unavailable (private mode, quota, ...)
  }
};

const readLoginAttempts = () => {
  try {
    return Number(sessionStorage.getItem(LOGIN_ATTEMPTS_KEY) || 0) || 0;
  } catch (err) {
    return 0;
  }
};

const writeLoginAttempts = count => {
  try {
    sessionStorage.setItem(LOGIN_ATTEMPTS_KEY, String(count));
  } catch (err) {
    // ignore - storage unavailable
  }
};

const clearLoginAttempts = () => {
  try {
    sessionStorage.removeItem(LOGIN_ATTEMPTS_KEY);
  } catch (err) {
    // ignore - storage unavailable
  }
};

// Latch the current page. Called from redirectToLogin() just before leaving for
// Cognito. An existing latch is never overwritten - it is the page the user
// actually left from, whereas the current location may just be the URL erp-api
// bounced back to.
export const rememberReturnTo = () => {
  const existing = readReturnTo();

  if (existing) {
    // Bound the redirect loop for a user who can never authenticate.
    if (existing.attempts >= MAX_LOGIN_ATTEMPTS) {
      console.warn('[RETURN TO] Attempt limit reached, dropping latch');
      clearReturnTo();
    }

    return;
  }

  const { pathname, search, hash } = window.location;
  const url = `${pathname}${search}${hash}`;

  if (!isSafeReturnTo(url)) {
    return;
  }

  writeReturnTo({ url, at: Date.now(), attempts: 0 });
  console.log('[RETURN TO] Latched', url);
};

// Restore the latched page. Synchronous and network-free so it can run at the
// very top of the app bootstrap, before root.render() and before the extension
// preRegistration parses window.location.search for the study UIDs.
//
// After login erp-api bounces back to <viewer-origin>/?returnTo=<latched path>,
// so that query param is the primary source; the sessionStorage latch is the
// fallback for when the bounce did not carry one (e.g. an older backend, or a
// bounce that landed straight on the viewer origin).
//
// The latch is kept (not deleted) so a later 401 knows the deep link is still
// wanted; clearReturnTo() runs on the first authenticated response.
export const restoreReturnTo = () => {
  let fromQuery = null;

  try {
    fromQuery = new URLSearchParams(window.location.search).get('returnTo');
  } catch (err) {
    // ignore - malformed query string, fall back to the latch
  }

  const entry = readReturnTo();
  const attempts = entry?.attempts || 0;

  // The ?returnTo= query arrives fresh on every pass through the callback, so it
  // used to be a permanent bypass: each bounce restored the deep link and reset
  // the counter, and the viewer could never leave the loop no matter how many
  // attempts had already failed. Once the cap is hit the deep link is abandoned
  // and the app boots at "/" instead.
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    console.warn('[RETURN TO] Attempt limit reached, abandoning deep link', entry?.url);
    clearReturnTo();

    return null;
  }

  if (entry) {
    // Tick the attempt counter so the redirect loop stays bounded.
    writeReturnTo({ ...entry, attempts: attempts + 1 });
  }

  const target = isSafeReturnTo(fromQuery) ? fromQuery : entry?.url;

  if (!target) {
    return null;
  }

  // replaceState, not assign: avoids a reload and leaves no extra history entry.
  // This also drops ?returnTo=, since the target is the deep link itself.
  window.history.replaceState(window.history.state, '', target);

  console.log(
    `[RETURN TO] Restored ${target} (source: ${isSafeReturnTo(fromQuery) ? 'query' : 'latch'})`
  );

  return target;
};

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
    const response = await fetch(`${getApiBaseUrl()}/erp/${getTenant()}/auth/get-permission`, {
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

    const response = await fetch(`${getApiBaseUrl()}/erp/${getTenant()}/auth/token`, {
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

  // Bound the cycle. Every 401 that cannot be refreshed lands here, so without a
  // cap a viewer that cannot authenticate re-enters Cognito forever and the user
  // just sees the login page repeat. Releasing the deep link and booting at "/"
  // puts them back in control (the viewer can be opened again from the ERP).
  const loginAttempts = readLoginAttempts();

  if (loginAttempts >= MAX_LOGIN_REDIRECTS) {
    console.error('[AUTH REDIRECT] Redirect limit reached, not sending to Cognito again', {
      loginAttempts,
    });
    console.log('========== [AUTH REDIRECT END] ==========');
    clearReturnTo();
    clearLoginAttempts();

    if (window.location.pathname !== '/') {
      window.location.replace('/');
    }

    return;
  }

  writeLoginAttempts(loginAttempts + 1);

  // Remember the page the user is on so they land back on it after login.
  rememberReturnTo();

  const apiBaseUrl = getApiBaseUrl();
  const configTenant = getTenant();
  const tenantName = localStorage.getItem('tenantName') || configTenant || 'default';

  console.log('[AUTH REDIRECT] tenantName:', tenantName);
  console.log('[AUTH REDIRECT] config tenant:', configTenant);
  console.log('[AUTH REDIRECT] apiBaseUrl:', apiBaseUrl);

  const rawTenantConfig = localStorage.getItem('tenantConfig');

  console.log('[AUTH REDIRECT] raw tenantConfig:', rawTenantConfig);

  const tenantConfig = JSON.parse(rawTenantConfig || '{}');

  console.log('[AUTH REDIRECT] tenantConfig:', tenantConfig);

  const auth = tenantConfig?.auth || {};

  console.log('[AUTH REDIRECT] auth config:', auth);

  // window.config.auth sits between the per-tenant localStorage value and the
  // hardcoded fallbacks, so each deployment can point at its own Cognito pool
  // (and register the matching redirect_uri) without touching the bundle.
  const configAuth = window.config?.auth || {};

  const cognitoDomain =
    auth.cognitoDomain ||
    configAuth.cognitoDomain ||
    'https://ap-south-1rxdtudilc.auth.ap-south-1.amazoncognito.com';

  const clientId = auth.clientId || configAuth.clientId || '36t5q5ljl36405lcjfhajif16d';

  console.log('[AUTH REDIRECT] cognitoDomain:', cognitoDomain);
  console.log('[AUTH REDIRECT] clientId:', clientId);

  const isLocalDev =
    String(apiBaseUrl).includes('localhost') || process.env.NODE_ENV === 'development';

  console.log('[AUTH REDIRECT] isLocalDev:', isLocalDev);
  console.log('[AUTH REDIRECT] NODE_ENV:', process.env.NODE_ENV);

  // The callback is an erp-api endpoint, so it always lives on the API host.
  // Previously this was null outside local dev, which made production login
  // silently no-op below.
  const redirectUri =
    auth.redirectUri ||
    configAuth.redirectUri ||
    `${apiBaseUrl}/erp/${tenantName}/auth/cognito-callback`;

  console.log('[AUTH REDIRECT] final redirectUri:', redirectUri);
  console.log('[AUTH REDIRECT] clientId exists:', !!clientId);
  console.log('[AUTH REDIRECT] redirectUri exists:', !!redirectUri);

  if (clientId && redirectUri) {
    const currentPath = window.location.pathname + window.location.search + window.location.hash;

    // "app=viewer" tells erp-api to send the browser back to the OHIF viewer
    // host instead of the ERP portal's /callback. "origin" tells it which host
    // that is: without it the backend has to rebuild the host from the tenant,
    // which drops the browser on a different subdomain. localStorage is scoped
    // per origin, so that swap silently discarded the userId stored here and the
    // viewer came back unable to call the API.
    //
    // URLSearchParams escapes the "?" and "&" inside currentPath. Interpolating
    // the raw path would truncate any deep link with 2+ query params, because
    // erp-api re-parses `state` with URLSearchParams.
    const state = new URLSearchParams({
      tenant: tenantName,
      app: 'viewer',
      returnTo: currentPath,
      origin: window.location.origin,
    }).toString();

    const loginUrl =
      `${cognitoDomain}/login` +
      `?client_id=${clientId}` +
      `&response_type=code` +
      `&scope=email+openid+phone` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`;

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
const authFetch = async (url, options = {}) => {
  console.log('[AUTH FETCH] Request:', url);

  const requestOptions = { ...options };

  // Share/guest doctor: token cookie nahi bhi rahe to bhi 401 na aaye - har
  // request pe Bearer guest token bhejo (verifyViewerAccess header se bhi
  // verify karta hai). Cookie + header dono hone se koi bhi API 30 min tak
  // authenticate rehti hai.
  const guestToken = sessionStorage.getItem('actecal_guestToken');
  const guestPermToken = sessionStorage.getItem('actecal_permToken');
  if (guestToken) {
    requestOptions.headers = {
      ...(requestOptions.headers || {}),
      ...(!requestOptions.headers?.Authorization ? { Authorization: `Bearer ${guestToken}` } : {}),
      ...(guestPermToken
        ? { 'x-perm': guestPermToken }
        : {}),
    };
  } else if (guestPermToken) {
    requestOptions.headers = {
      ...(requestOptions.headers || {}),
      ...{ 'x-perm': guestPermToken },
    };
  }

  let response = await fetch(url, {
    ...requestOptions,
    credentials: 'include',
  });

  console.log('[AUTH FETCH] Response:', {
    url,
    status: response.status,
  });

  if (response.status === 401) {
    console.log('[AUTH FETCH] 401 detected:', url);
    console.log('[AUTH FETCH] isRefreshing:', isRefreshing);

    // A refresh only ever buys one retry. Without this a request that keeps
    // 401ing recurses through the refresh path forever.
    if (requestOptions.__retried) {
      console.error('[AUTH FETCH] 401 after refresh, giving up:', url);
      clearReturnTo();
      redirectToLogin();
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Guest share session (30-min cookies): re-open it via the public
    // /resolve-share endpoint instead of the Cognito refresh/redirect path -
    // a guest has no refresh_token, so refreshTokens() would always fail and
    // dump them on the login page. The sharecode stays in the URL for the
    // life of the link.
    const shareCode = new URLSearchParams(window.location.search).get('sharecode');
    if (shareCode && sessionStorage.getItem('actecal_guestToken')) {
      console.log('[AUTH FETCH] Guest session expired, re-opening share session');
      try {
        await new ApiService(undefined).resolveShare(shareCode);
        return authFetch(url, { ...requestOptions, __retried: true });
      } catch (shareErr) {
        console.error('[AUTH FETCH] Share session re-open failed:', shareErr);
        throw shareErr;
      }
    }

    if (isRefreshing) {
      console.log('[AUTH FETCH] Waiting for existing refresh');

      await new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      });

      return authFetch(url, { ...requestOptions, __retried: true });
    }

    try {
      console.log('[AUTH FETCH] Starting token refresh');

      await refreshTokens();

      console.log('[AUTH FETCH] Token refresh successful');
    } catch (refreshError) {
      console.error('[AUTH FETCH] Refresh failed → redirecting to login', refreshError);

      redirectToLogin();
      throw refreshError;
    }

    // refreshTokens() rotates permToken, so the retry must re-read it from
    // storage. requestOptions.headers still holds the pre-refresh value, which
    // is why the old retry kept 401ing.
    const freshUser = JSON.parse(localStorage.getItem('user') || '{}');

    response = await fetch(url, {
      ...requestOptions,
      __retried: true,
      credentials: 'include',
      headers: {
        ...requestOptions.headers,
        ...(freshUser?.permToken ? { 'x-perm': freshUser.permToken } : {}),
      },
    });

    console.log('[AUTH FETCH] Retry response:', {
      url,
      status: response.status,
    });
  }

  if (response.status === 403) {
    window.location.href = '/access-denied';
    throw new Error('Access Denied');
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  // Authenticated - the restored deep link has served its purpose, and the
  // session works, so the redirect counter is reset for any future expiry.
  clearReturnTo();
  clearLoginAttempts();

  return response.json();
};

// Per-tab session id, sent on measurement saves so the viewer can ignore its
// own MQTT echo: erp-api echoes it back in the publish payload, and the
// external-measurement listener drops messages that carry this id. Without it
// an UPDATE echo would detach the live annotation mid-drag.
export const TAB_SESSION_ID = `tab-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;

// ────────────────────────────────────────────────
// ApiService
// ────────────────────────────────────────────────
class ApiService {
  constructor(userId) {
    this.baseUrl = `${getApiBaseUrl()}/erp/${getTenant()}/dicom`;
    this.userId = userId ?? getStoredUserId();
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
        'x-session-id': TAB_SESSION_ID,
      },
      body: JSON.stringify(measurementData),
    });
  }

  // SigV4 presigned AWS IoT Core WebSocket URL (MQTT over wss). The browser
  // cannot hold AWS credentials, so erp-api signs the handshake.
  async getIotUrl() {
    return authFetch(`${this.baseUrl}/iot-url`, {
      headers: { 'x-user-id': this.userId },
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

  // Guest share entry: no Cognito session exists yet, so authFetch would 401 ->
  // refresh -> Cognito redirect ("login maangta hai"). A bare credentialed
  // fetch hits the public /resolve-share endpoint, which sets the 30-minute
  // guest cookies (access_token/guest_user/tenant). The returned guestToken +
  // userId are stored so every later call (x-user-id, Bearer fallback) works.
  async resolveShare(shareCode) {
    const url = `${getApiBaseUrl()}/erp/${getTenant()}/resolve-share?code=${encodeURIComponent(shareCode)}`;
    const response = await fetch(url, { credentials: 'include' });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    try {
      if (data?.guestToken) {
        sessionStorage.setItem('actecal_guestToken', data.guestToken);
      }
      if (data?.permToken) {
        sessionStorage.setItem('actecal_permToken', data.permToken);
      }
      if (data?.userId) {
        localStorage.setItem('actecal_userId', String(data.userId));
        this.userId = String(data.userId);
      }
      if (data?.expiresAt) {
        sessionStorage.setItem('actecal_share_session_expiry', data.expiresAt);
      }
    } catch (err) {
      console.warn('[SHARE] Failed to persist share session:', err);
    }

    return data;
  }

  // ────────────────────────────────────────────────
  // ERP HMS endpoints (templates + GCP recording)
  // ────────────────────────────────────────────────
  _hmsUrl() {
    // HMS routes are mounted at /erp/:tenant/hms on the same server
    return `${getApiBaseUrl()}/erp/${getTenant()}/hms`;
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

  // ────────────────────────────────────────────────
  // AI credit (same pattern as send-message credit checks on the backend:
  // balance is read from the tenant settings and consumed atomically).
  // ────────────────────────────────────────────────

  _permissionHeaders() {
    const headers = {};
    try {
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      if (currentUser.permToken) headers['x-perm'] = currentUser.permToken;
    } catch (err) {
      console.warn('[AI CREDIT] Could not read permToken:', err);
    }
    return headers;
  }

  async getTenantSettings() {
    return authFetch(`${getApiBaseUrl()}/erp/${getTenant()}/settings`, {
      headers: this._permissionHeaders(),
    });
  }

  async getAiCredits() {
    try {
      const settings = await this.getTenantSettings();
      const aiBalance =
        typeof settings?.aiBalance === 'number'
          ? settings.aiBalance
          : Number(settings?.aiBalance ?? 0) || 0;
      return { available: aiBalance, settings };
    } catch (error) {
      console.warn('[AI CREDIT] Failed to load tenant settings:', error);
      return { available: null, settings: null, error };
    }
  }

  async consumeAiCredit() {
    const headers = {
      'Content-Type': 'application/json',
      ...this._permissionHeaders(),
    };
    if (this.userId) headers['x-user-id'] = this.userId;
    try {
      return await authFetch(`${this.baseUrl}/ai-credit/consume`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
    } catch (error) {
      console.warn('[AI CREDIT] consumeAiCredit failed (endpoint may not be deployed):', error);
      return null;
    }
  }
}

export default ApiService;
