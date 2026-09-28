// Capture the currently displayed viewport image as a base64 data URL,
// so the image the user has open at the time of clicking "AI Analysis"
// is exactly what gets sent to the AI model.

export function getActiveViewportInfo(servicesManager) {
  const { viewportGridService, cornerstoneViewportService, displaySetService } =
    servicesManager.services;

  // Grid state exposes viewports as a Map keyed by viewportId, with the active
  // id on state.activeViewportId. The study UID is not stored on the viewport
  // itself - it lives on the display set, so resolve it through the display
  // set service (same pattern as PatientHistoryPanel).
  const state = viewportGridService?.getState();
  const activeViewportId = state?.activeViewportId || null;
  const activeViewport = activeViewportId ? state?.viewports?.get(activeViewportId) : null;

  const displaySetInstanceUID = activeViewport?.displaySetInstanceUIDs?.[0] || null;
  const displaySet = displaySetInstanceUID
    ? displaySetService?.getDisplaySetByUID(displaySetInstanceUID)
    : null;
  const studyInstanceUid = displaySet?.StudyInstanceUID || null;

  const viewportId = activeViewportId;

  let renderingEngine = null;
  try {
    renderingEngine = cornerstoneViewportService?.getRenderingEngine() || null;
  } catch (error) {
    renderingEngine = null;
  }

  let viewport = null;
  if (renderingEngine && viewportId) {
    try {
      viewport = renderingEngine.getViewport(viewportId) || null;
    } catch (error) {
      viewport = null;
    }
  }
  if (!viewport && renderingEngine) {
    try {
      viewport = renderingEngine.getViewports()?.[0] || null;
    } catch (error) {
      viewport = null;
    }
  }

  return { viewportId, studyInstanceUid, displaySetInstanceUID, viewport, renderingEngine };
}

export function grabCanvasElement(viewport) {
  try {
    const enabledElement = viewport.getEnabledElement?.() || null;
    if (enabledElement?.element) {
      return enabledElement.element.querySelector?.('canvas') || null;
    }
  } catch (error) {
    /* fall through to other accessors */
  }
  try {
    if (viewport.element) {
      return viewport.element.querySelector?.('canvas') || null;
    }
  } catch (error) {
    return null;
  }
  return null;
}

export function captureActiveViewport(servicesManager, options = {}) {
  const { viewport } = getActiveViewportInfo(servicesManager);
  if (!viewport) {
    throw new Error('No active viewport found. Open an image first.');
  }

  const mimeType = options.mimeType || 'image/jpeg';
  const quality = options.quality ?? 0.85;

  let dataUrl = null;

  try {
    const canvas = typeof viewport.getCanvas === 'function' ? viewport.getCanvas() : null;
    if (canvas && typeof canvas.toDataURL === 'function') {
      dataUrl = canvas.toDataURL(mimeType, quality);
    }
  } catch (error) {
    dataUrl = null;
  }

  if (!dataUrl) {
    const elementCanvas = grabCanvasElement(viewport);
    if (elementCanvas && typeof elementCanvas.toDataURL === 'function') {
      dataUrl = elementCanvas.toDataURL(mimeType, quality);
    }
  }

  if (!dataUrl) {
    throw new Error('Could not capture the active viewport image.');
  }

  const comma = dataUrl.indexOf(',');
  const header = comma >= 0 ? dataUrl.slice(0, comma) : '';
  const typeMatch = header.match(/^data:([^;]+);/);
  const resolvedMime = typeMatch ? typeMatch[1] : mimeType;
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;

  return { imageBase64: base64, mimeType: resolvedMime, dataUrl };
}

export default {
  getActiveViewportInfo,
  captureActiveViewport,
};