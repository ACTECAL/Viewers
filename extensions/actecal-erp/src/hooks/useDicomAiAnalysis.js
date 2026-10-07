// ────────────────────────────────────────────────
// Runs the GPU DICOM analysis for whatever is currently on screen and turns the
// result into real OHIF measurements.
//
// Pipeline:
//   1. resolve the active viewport -> study / series / SOP instance
//   2. pull the raw instance over WADO-RS (what the model actually analyzes)
//   3. POST it to /analyze-dicom
//   4. convert each returned pixel coordinate into patient coordinates and push
//      it through the shared hydrator, so the AI caliper renders on the viewport
//      alongside the doctors' measurements
//   5. persist to the ERP measurement API and append to the Lexical report
//
// AI measurements are always drawn in the reserved AI colour, never a doctor
// palette colour, so a reader can never mistake the model for a colleague.
// ────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';

import ApiService from '../services/ApiService';
import {
  analyzeDicomSlice,
  extractSopInstanceUID,
  fetchInstanceDicomBlob,
  getDicomAiConfig,
  normalizeMeasurements,
  updateDicomMeasurement,
} from '../services/DicomAiService';
import { captureActiveViewport, getActiveViewportInfo } from '../utils/captureActiveViewport';
import {
  dicomPixelToWorld,
  getImageGeometry,
  hydrateMeasurement,
  validatePlacement,
} from '../utils/measurementHydrator';
import { AI_AUTHOR_KEY, AI_COLOR } from '../utils/measurementColors';

const STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  INSUFFICIENT: 'insufficient',
  SUCCESS: 'success',
  ERROR: 'error',
};

/** Tolerates the endpoint sending [row, col] as strings, or a single value. */
function areSpacingsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  return a.every((value, i) => Math.abs(Number(value) - Number(b[i])) < 1e-6);
}

/** data: URL -> Blob, so the captured viewport can ride along in the FormData. */
function dataUrlToBlob(dataUrl, type = 'image/jpeg') {
  const [header, base64] = String(dataUrl).split(',');
  const mimeMatch = header.match(/^data:([^;]+);/);
  const mime = mimeMatch ? mimeMatch[1] : type;
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/**
 * Find the instance the viewport is actually showing. The display set owns the
 * authoritative SOPInstanceUID <-> imageId mapping, so this also gives us the
 * slice index to sanity-check the model's answer against.
 */
function resolveActiveInstance(displaySetService, viewport, displaySetInstanceUID) {
  const displaySet = displaySetInstanceUID
    ? displaySetService?.getDisplaySetByUID(displaySetInstanceUID)
    : null;

  const instances = displaySet?.instances || [];
  const imageIds = displaySet?.imageIds || [];
  const currentImageId = viewport?.getCurrentImageId?.() || null;

  let index = instances.findIndex(instance => instance.imageId === currentImageId);
  if (index === -1 && currentImageId) {
    index = imageIds.findIndex(imageId => imageId === currentImageId);
  }
  if (index === -1) {
    index = viewport?.getCurrentImageIdIndex?.() ?? -1;
  }

  const instance = index >= 0 ? instances[index] : instances[0];
  if (!instance) {
    return null;
  }

  return {
    sopInstanceUID: instance.SOPInstanceUID,
    seriesInstanceUID: instance.SeriesInstanceUID || displaySet?.SeriesInstanceUID,
    studyInstanceUID: instance.StudyInstanceUID || displaySet?.StudyInstanceUID,
    instanceNumber: instance.InstanceNumber ?? null,
    // 1-based position of the displayed slice within the display set.
    sliceIndex: index >= 0 ? index + 1 : null,
    displaySet,
  };
}

/**
 * Build the row shape the hydrator expects out of one normalized AI
 * measurement. `stats` carries the model's own millimetres so the rendered
 * label reports exactly what the model said.
 */
function buildAiRow(measurement, context, index) {
  const { worldPoints, instance, studyInstanceUID, model } = context;

  return {
    uid: `ai-${Date.now()}-${index}-${measurement.id}`,
    toolName: measurement.toolType,
    label: measurement.label,
    points: worldPoints,
    stats: {
      length: measurement.lengthMm ?? undefined,
      width: measurement.widthMm ?? undefined,
      unit: 'mm',
    },
    SOPInstanceUID: instance.sopInstanceUID,
    SeriesInstanceUID: instance.seriesInstanceUID,
    StudyInstanceUID: studyInstanceUID,
    FrameOfReferenceUID: context.geometry?.frameOfReferenceUID ?? null,
    referencedImageId: instance.imageId || null,
    // Provenance: read back by the sidebars, the legend and the report.
    created_by: AI_AUTHOR_KEY,
    colorHex: AI_COLOR,
    isAi: true,
    aiLabel: measurement.label,
    aiLocation: measurement.location,
    aiSeverity: measurement.severity,
    aiConfidence: measurement.confidence,
    aiModel: model,
    aiLengthMm: measurement.lengthMm,
    aiWidthMm: measurement.widthMm,
    aiSliceIndex: measurement.sliceIndex ?? instance.sliceIndex,
  };
}

function describeMeasurement(measurement, uid) {
  const parts = [];
  if (measurement.lengthMm != null) {
    parts.push(
      measurement.widthMm != null
        ? `${measurement.lengthMm} x ${measurement.widthMm} mm`
        : `${measurement.lengthMm} mm`
    );
  }
  return {
    uid,
    id: measurement.id,
    label: measurement.label,
    location: measurement.location,
    severity: measurement.severity,
    confidence: measurement.confidence,
    sliceIndex: measurement.sliceIndex,
    toolType: measurement.toolType,
    lengthMm: measurement.lengthMm,
    widthMm: measurement.widthMm,
    measurementText: parts.join(' - ') || 'AI finding',
  };
}

export function useDicomAiAnalysis({ servicesManager, extensionManager }) {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState(null);
  const [aiMeasurements, setAiMeasurements] = useState([]);
  const [credit, setCredit] = useState(null);
  const [originalImage, setOriginalImage] = useState(null);

  // Show the available AI credit in the panel header before the first run.
  useEffect(() => {
    let cancelled = false;
    new ApiService()
      .getAiCredits()
      .then(credits => {
        if (!cancelled) {
          setCredit(credits.available);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  const runAnalysis = useCallback(async () => {
    setStatus(STATUS.LOADING);
    setErrorMessage('');
    setResult(null);
    setAiMeasurements([]);

    try {
      const { displaySetService, measurementService } = servicesManager.services;
      const info = getActiveViewportInfo(servicesManager);

      if (!info.studyInstanceUid || !info.viewport) {
        setStatus(STATUS.ERROR);
        setErrorMessage('No active image is open to analyze. Open a study first.');
        return;
      }

      const instance = resolveActiveInstance(
        displaySetService,
        info.viewport,
        info.displaySetInstanceUID
      );

      if (!instance?.sopInstanceUID) {
        setStatus(STATUS.ERROR);
        setErrorMessage('Could not work out which slice is displayed. Nothing was sent.');
        return;
      }

      // Rendered viewport JPEG: shows the model the exact window/level the
      // radiologist is reading, and doubles as a fallback if WADO-RS refuses to
      // hand over the instance.
      let viewportBlob = null;
      try {
        const captured = captureActiveViewport(servicesManager);
        setOriginalImage(captured.dataUrl);
        viewportBlob = dataUrlToBlob(captured.dataUrl, captured.mimeType);
      } catch (err) {
        console.warn('[dicom-ai] Could not capture the viewport image:', err);
      }

      const api = new ApiService();

      // Credit gate - identical to the existing Gemini flow: a tenant with no AI
      // balance left must not consume GPU time.
      const credits = await api.getAiCredits();
      setCredit(credits.available);
      if (credits.available !== null && credits.available <= 0) {
        setStatus(STATUS.INSUFFICIENT);
        return;
      }

      let geometry = getImageGeometry({
        studyInstanceUID: instance.studyInstanceUID || info.studyInstanceUid,
        seriesInstanceUID: instance.seriesInstanceUID,
        sopInstanceUID: instance.sopInstanceUID,
      });

      let dicomBlob = null;
      try {
        dicomBlob = await fetchInstanceDicomBlob({
          servicesManager,
          extensionManager,
          studyInstanceUID: instance.studyInstanceUID || info.studyInstanceUid,
          seriesInstanceUID: instance.seriesInstanceUID,
          sopInstanceUID: instance.sopInstanceUID,
        });
      } catch (err) {
        // A PACS that will not serve application/dicom (secondary capture,
        // PDF/sr viewport, some gateway proxies) still leaves us the rendered
        // slice, which the model can read.
        console.warn(
          '[dicom-ai] WADO-RS retrieval failed, falling back to the viewport image:',
          err
        );
        if (!viewportBlob) {
          throw err;
        }
      }

      const config = getDicomAiConfig();
      const analysis = await analyzeDicomSlice({
        dicomBlob: dicomBlob || viewportBlob,
        viewportBlob,
        studyInstanceUID: instance.studyInstanceUID || info.studyInstanceUid,
        sopInstanceUID: instance.sopInstanceUID,
        seriesInstanceUID: instance.seriesInstanceUID,
        modality: config.modality,
      });

      const normalized = normalizeMeasurements(analysis);
      const resolvedSop = extractSopInstanceUID(analysis, instance.sopInstanceUID);
      const model = analysis.model || analysis.model_used || config.model || 'GPU Vision';

      // The endpoint echoes the study facts it read off the header. Its
      // pixel_spacing is worth trusting over ours when the two disagree, since
      // it is what the model's coordinates were measured against.
      const reportedSpacing = Array.isArray(analysis?.metadata?.pixel_spacing)
        ? analysis.metadata.pixel_spacing
        : null;
      if (
        reportedSpacing &&
        geometry &&
        !areSpacingsEqual(reportedSpacing, geometry.pixelSpacing)
      ) {
        console.warn(
          '[dicom-ai] Endpoint reports pixel spacing ' +
            `${JSON.stringify(reportedSpacing)} but the viewer metadata says ` +
            `${JSON.stringify(geometry.pixelSpacing)}; using the endpoint value for placement.`
        );
        geometry = { ...geometry, pixelSpacing: reportedSpacing };
      }

      setResult({
        raw: analysis,
        status: analysis.status || 'success',
        model,
        // Narrative output. This endpoint reports `findings` + `impression`;
        // older builds used `conclusion`, so accept either.
        findings: analysis.findings || analysis.conclusion || '',
        impression: analysis.impression || analysis.conclusion || '',
        latencySec: analysis.inference_latency_sec ?? analysis.inferenceLatencySec ?? null,
        measurementCount: normalized.length,
        analyzedAt: new Date().toISOString(),
        usedDicomFile: !!dicomBlob,
      });

      // Optional atomic credit consumption, mirroring send-message balance
      // deduction. Tolerates the endpoint not being deployed.
      if (config.deductCredit !== false) {
        const consumed = await api.consumeAiCredit();
        if (consumed?.data?.aiBalance != null) {
          setCredit(consumed.data.aiBalance);
        }
      }

      if (!normalized.length) {
        setStatus(STATUS.SUCCESS);
        return;
      }

      const studyInstanceUID = instance.studyInstanceUID || info.studyInstanceUid;
      const created = [];

      normalized.forEach((measurement, index) => {
        const worldPoints = dicomPixelToWorld(measurement.points, geometry);

        if (!worldPoints) {
          console.warn(
            '[dicom-ai] Could not place measurement on the viewport (no DICOM geometry ' +
              `for SOP ${instance.sopInstanceUID}); skipping "${measurement.label}".`,
            measurement
          );
          return;
        }

        // The model reports millimetres from the image it analyzed; if our
        // pixel->patient conversion lands far from that, its coordinate
        // convention is not the native DICOM grid. We still draw it and still
        // show the model's own numbers - this only makes the mismatch visible.
        const check = validatePlacement(worldPoints, measurement.lengthMm);
        if (check && !check.ok) {
          console.warn(
            `[dicom-ai] Placement for "${measurement.label}" spans ${check.derivedMm.toFixed(1)}mm ` +
              `but the model reported ${check.reportedMm}mm - its points may not be in the ` +
              'native DICOM pixel grid.'
          );
        }

        if (
          measurement.sliceIndex != null &&
          instance.sliceIndex != null &&
          measurement.sliceIndex !== instance.sliceIndex
        ) {
          console.warn(
            `[dicom-ai] Model reported slice_index ${measurement.sliceIndex} but slice ` +
              `${instance.sliceIndex} is displayed; placing on the displayed slice.`
          );
        }

        const row = buildAiRow(
          measurement,
          { worldPoints, instance, studyInstanceUID, model },
          index
        );

        const uid = hydrateMeasurement(
          measurementService,
          displaySetService,
          extensionManager,
          servicesManager.services.cornerstoneViewportService,
          studyInstanceUID,
          { ...row, created_by: AI_AUTHOR_KEY }
        );

        if (uid) {
          created.push(describeMeasurement(measurement, uid));
          // Persist. addRawMeasurement only broadcasts RAW_MEASUREMENT_ADDED, so
          // the ERP save and the report injection that normally hang off
          // MEASUREMENT_ADDED have to happen here.
          api
            .saveMeasurement(studyInstanceUID, {
              uid,
              SOPInstanceUID: row.SOPInstanceUID,
              FrameOfReferenceUID: row.FrameOfReferenceUID,
              points: row.points,
              toolName: row.toolName,
              label: row.label,
              type: row.toolName === 'Bidirectional' ? 'Bidirectional' : 'Length',
              eventType: 'ADD',
              SeriesInstanceUID: row.SeriesInstanceUID,
              StudyInstanceUID: row.StudyInstanceUID,
              referencedImageId: row.referencedImageId,
              isLocked: false,
              isVisible: true,
              displayText: {
                primary: [
                  row.toolName === 'Bidirectional'
                    ? `L: ${row.stats.length} mm`
                    : `${row.stats.length} mm`,
                  ...(row.stats.width != null ? [`W: ${row.stats.width} mm`] : []),
                ],
                secondary: [],
              },
              created_by: AI_AUTHOR_KEY,
              colorHex: AI_COLOR,
              isAi: true,
              aiLabel: row.aiLabel,
              aiLocation: row.aiLocation,
              aiSeverity: row.aiSeverity,
              aiConfidence: row.aiConfidence,
              aiModel: row.aiModel,
              aiLengthMm: row.aiLengthMm,
              aiWidthMm: row.aiWidthMm,
              aiSliceIndex: row.aiSliceIndex,
            })
            .catch(err => console.error('[dicom-ai] Failed to persist AI measurement:', err));

          // Inject into the Lexical diagnostic report.
          window.dispatchEvent(
            new CustomEvent('actecal:injectMeasurement', {
              detail: {
                measurement: {
                  uid,
                  toolName: row.toolName,
                  label: `AI - ${row.label}`,
                  isAi: true,
                  displayText: {
                    primary: [
                      `AI: ${row.label}${
                        row.stats.length != null
                          ? ` - ${row.stats.length}${
                              row.stats.width != null ? ` x ${row.stats.width}` : ''
                            } mm`
                          : ''
                      }`,
                    ],
                  },
                },
              },
            })
          );
        }
      });

      setAiMeasurements(created);

      // Tell the GPU box what was drawn. Best effort - never undo the analysis.
      updateDicomMeasurement({
        studyInstanceUID,
        sopInstanceUID: resolvedSop,
        measurements: normalized,
      }).catch(err => console.warn('[dicom-ai] update-dicom-measurement failed:', err));

      if (created.length !== normalized.length) {
        console.warn(`[dicom-ai] Placed ${created.length} of ${normalized.length} measurements.`);
      }

      setStatus(STATUS.SUCCESS);
    } catch (error) {
      console.error('[dicom-ai] Analysis failed:', error);
      setStatus(STATUS.ERROR);
      setErrorMessage(error.message || 'AI analysis failed. Please try again.');
    }
  }, [servicesManager, extensionManager]);

  return {
    status,
    errorMessage,
    result,
    aiMeasurements,
    credit,
    originalImage,
    setCredit,
    runAnalysis,
    STATUS,
  };
}

export default useDicomAiAnalysis;
