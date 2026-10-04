// ────────────────────────────────────────────────
// GPU DICOM analysis endpoint.
//
// Talks to the L4 box configured in window.config.gpu:
//   POST {baseUrl}/analyze-dicom             -> findings + millimetre measurements
//   POST {baseUrl}/update-dicom-measurement  -> push a confirmed measurement back
//
// The image we upload is the real DICOM instance pulled over WADO-RS, so the
// model gets the actual pixel data / Hounsfield values rather than a screenshot.
// We also attach the rendered viewport JPEG so the model knows exactly which
// window/level the radiologist is looking at.
// ────────────────────────────────────────────────

const DEFAULT_PROMPT = 'Detect acute hemorrhage, mass effect, or nodule with exact measurements';

const DEFAULT_CONFIG = {
  enabled: true,
  baseUrl: '',
  // The GPU vision model needs longer than the 60s scribe socket timeout, so
  // analysis gets its own knob rather than reusing gpu.timeoutMs.
  analysisTimeoutMs: 120000,
  modality: 'CT',
  prompt: DEFAULT_PROMPT,
  apiToken: '',
  deductCredit: true,
};

export function getDicomAiConfig() {
  const gpu = (typeof window !== 'undefined' && window.config && window.config.gpu) || {};
  return {
    ...DEFAULT_CONFIG,
    ...gpu,
    // Accept either spelling so an existing config keeps working.
    prompt: gpu.dicomPrompt || gpu.prompt || DEFAULT_PROMPT,
    apiToken: gpu.apiToken || gpu.authToken || '',
    analysisTimeoutMs: gpu.timeoutAnalysisMs || DEFAULT_CONFIG.analysisTimeoutMs,
  };
}

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}');
  } catch (err) {
    return {};
  }
}

/**
 * Bearer token for the GPU box.
 *
 * This app's ERP/Cognito session is cookie based (`credentials: 'include'`),
 * so there is no readable access token - localStorage['user'] holds `permToken`,
 * which is the credential the app itself presents to privileged endpoints.
 * A config override (gpu.apiToken) wins if the box expects something else.
 */
export function getAuthToken() {
  const config = getDicomAiConfig();
  if (config.apiToken) {
    return config.apiToken;
  }

  const user = readStoredUser();
  let token = user.accessToken || user.token || user.idToken || user.permToken || null;

  if (!token) {
    try {
      token = sessionStorage.getItem('actecal_guestToken');
    } catch (err) {
      token = null;
    }
  }

  return token;
}

export function getAuthHeaders() {
  const config = getDicomAiConfig();
  const user = readStoredUser();
  const headers = {};

  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (user.permToken) {
    headers['x-perm'] = user.permToken;
  }

  const userId = config.userId || user.userId;
  if (userId) {
    headers['x-user-id'] = userId;
  }

  return headers;
}

// ────────────────────────────────────────────────
// Instance retrieval (WADO-RS)
// ────────────────────────────────────────────────

function getActiveDataSource(extensionManager) {
  const active = extensionManager?.getActiveDataSource?.();
  return (active && active[0]) || null;
}

/**
 * Pull the raw DICOM instance (P10 byte stream) for the given UIDs over
 * WADO-RS, authenticated with the same header OHIF uses for DICOMweb.
 */
export async function fetchInstanceDicomBlob({
  servicesManager,
  extensionManager,
  studyInstanceUID,
  seriesInstanceUID,
  sopInstanceUID,
}) {
  if (!studyInstanceUID || !seriesInstanceUID || !sopInstanceUID) {
    throw new Error('Missing study/series/SOP UIDs - cannot retrieve the DICOM instance.');
  }

  const dataSource = getActiveDataSource(extensionManager);
  const config = dataSource?.getConfig?.() || {};
  const wadoRoot = config.wadoUriRoot || config.wadoRoot;

  if (!wadoRoot) {
    throw new Error('No WADO-RS root configured on the active data source.');
  }

  const url = `${wadoRoot}/studies/${studyInstanceUID}/series/${seriesInstanceUID}/instances/${sopInstanceUID}`;

  let authHeaders = {};
  try {
    authHeaders =
      servicesManager?.services?.userAuthenticationService?.getAuthorizationHeader?.() || {};
  } catch (err) {
    authHeaders = {};
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...authHeaders,
      Accept: 'application/dicom',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Could not retrieve the DICOM instance (HTTP ${response.status}). The viewer is probably ` +
        'rendering a modality the PACS will not hand over as application/dicom.'
    );
  }

  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) {
    throw new Error('The DICOMweb server returned an empty instance.');
  }

  return new Blob([buffer], { type: 'application/dicom' });
}

// ────────────────────────────────────────────────
// Analyze
// ────────────────────────────────────────────────

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

/**
 * POST the instance to /analyze-dicom.
 *
 * @param {Object}   params
 * @param {Blob}     params.dicomBlob          raw instance, sent as `file`
 * @param {Blob}     [params.viewportBlob]     rendered viewport JPEG (optional)
 * @param {string}   params.studyInstanceUID
 * @param {string}   [params.sopInstanceUID]
 * @param {string}   [params.modality]
 * @param {string}   [params.prompt]
 * @returns {Promise<Object>} the parsed response
 */
export async function analyzeDicomSlice({
  dicomBlob,
  viewportBlob = null,
  studyInstanceUID,
  sopInstanceUID,
  seriesInstanceUID = '',
  modality,
  prompt,
  signal,
}) {
  const config = getDicomAiConfig();

  if (config.enabled === false) {
    throw new Error('DICOM AI analysis is disabled in config (gpu.enabled = false).');
  }
  if (!config.baseUrl) {
    throw new Error('GPU base URL not configured. Set window.config.gpu.baseUrl.');
  }
  if (!dicomBlob) {
    throw new Error('No DICOM instance to analyze.');
  }

  const formData = new FormData();
  formData.append('file', dicomBlob, 'instance.dcm');
  if (viewportBlob) {
    formData.append('viewport_image', viewportBlob, 'viewport_slice.jpg');
  }
  formData.append('study_instance_uid', studyInstanceUID || '');
  if (sopInstanceUID) {
    formData.append('sop_instance_uid', sopInstanceUID);
  }
  if (seriesInstanceUID) {
    formData.append('series_instance_uid', seriesInstanceUID);
  }
  formData.append('modality', modality || config.modality || 'CT');
  formData.append('prompt', prompt || config.prompt || DEFAULT_PROMPT);

  const timeout = withTimeout(config.analysisTimeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/analyze-dicom`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData,
      signal: signal || timeout.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `DICOM analysis failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`
      );
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(
        `DICOM analysis timed out after ${Math.round(config.analysisTimeoutMs / 1000)}s.`
      );
    }
    throw error;
  } finally {
    timeout.cancel();
  }
}

/**
 * Push a measurement the operator confirmed back to the GPU box so it can be
 * written into the DICOM annotations. Best effort: a failure here must not undo
 * an analysis the radiologist can already see.
 */
export async function updateDicomMeasurement({ studyInstanceUID, sopInstanceUID, measurements }) {
  const config = getDicomAiConfig();

  if (!config.baseUrl) {
    return null;
  }

  const response = await fetch(`${config.baseUrl}/update-dicom-measurement`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({
      study_instance_uid: studyInstanceUID,
      sop_instance_uid: sopInstanceUID,
      measurements,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.warn(
      `[dicom-ai] update-dicom-measurement rejected (HTTP ${response.status}): ${detail.slice(0, 300)}`
    );
    return null;
  }

  return response.json().catch(() => null);
}

// ────────────────────────────────────────────────
// Response normalisation
// ────────────────────────────────────────────────

const SUPPORTED_TOOL_TYPES = new Set(['Length', 'Bidirectional']);

function toPoint(value) {
  if (Array.isArray(value)) {
    return { x: Number(value[0]), y: Number(value[1]) };
  }
  if (value && typeof value === 'object') {
    // DICOM pixel grids are addressed row/col; this box reports them that way.
    if (value.col !== undefined && value.row !== undefined) {
      return { x: Number(value.col), y: Number(value.row) };
    }
    return { x: Number(value.x), y: Number(value.y) };
  }
  return null;
}

/**
 * Coerce the endpoint's point list into `[{x, y}, ...]`.
 *
 * Only the first two points are kept: every tool we support (Length,
 * Bidirectional, Cobb, Angle) is a two-point annotation, and a polyline from a
 * vision model would need a different annotation state anyway.
 */
function normalizePoints(source) {
  let points;

  if (Array.isArray(source)) {
    points = source.map(toPoint);
  } else if (source && typeof source === 'object') {
    // Two-point shorthand: {start_point, end_point} / {start, end}.
    const start = source.start_point ?? source.start ?? source.startPoint;
    const end = source.end_point ?? source.end ?? source.endPoint;
    points = [toPoint(start), toPoint(end)];
  }

  if (!Array.isArray(points)) {
    return null;
  }

  const cleaned = points
    .filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))
    .slice(0, 2);

  return cleaned.length >= 2 ? cleaned : null;
}

function toFiniteNumber(value) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Pull the measurement list out of whatever shape the endpoint returned and
 * coerce every field the viewer relies on. Accepts `{measurements: []}`,
 * `{data: {measurements: []}}`, `{results: []}` and a bare array.
 */
export function normalizeMeasurements(raw) {
  const list = Array.isArray(raw)
    ? raw
    : (raw?.measurements ?? raw?.data?.measurements ?? raw?.results ?? raw?.data?.results ?? []);

  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .filter(entry => entry && typeof entry === 'object')
    .map((entry, index) => {
      const toolType = String(entry.tool_type || entry.toolName || 'Length');
      const lengthMm = toFiniteNumber(entry.length_mm ?? entry.length);
      const widthMm = toFiniteNumber(entry.width_mm ?? entry.width);

      return {
        id: entry.id || `ai-${index + 1}`,
        // The GPU box uses cornerstone's own tool names ("Length",
        // "Bidirectional"), which is what OHIF's measurement mappings expect.
        toolType: SUPPORTED_TOOL_TYPES.has(toolType) ? toolType : 'Length',
        label: entry.label || 'AI finding',
        location: entry.location || null,
        severity: entry.severity || null,
        confidence: entry.confidence ?? null,
        lengthMm,
        widthMm,
        sliceIndex: toFiniteNumber(entry.slice_index),
        points: normalizePoints(entry.points ?? entry.coordinates ?? entry),
      };
    })
    .filter(measurement => measurement.points !== null);
}

export function extractSopInstanceUID(raw, fallback) {
  return raw?.sop_instance_uid || raw?.data?.sop_instance_uid || fallback || null;
}

export default {
  getDicomAiConfig,
  getAuthToken,
  getAuthHeaders,
  fetchInstanceDicomBlob,
  analyzeDicomSlice,
  updateDicomMeasurement,
  normalizeMeasurements,
  extractSopInstanceUID,
  DEFAULT_PROMPT,
};
