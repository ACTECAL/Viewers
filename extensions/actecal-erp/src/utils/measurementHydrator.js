// ────────────────────────────────────────────────
// Shared measurement hydration.
//
// Both the API replay path (measurements saved by any participant) and the AI
// path (GPU DICOM endpoint) go through here, so a row always becomes a
// correctly-keyed, correctly-coloured csTools annotation exactly once.
//
// Originally inlined in extensions/actecal-erp/src/index.js; extracted so the
// AI flow can reuse it without duplicating the tricky imageId handling.
// ────────────────────────────────────────────────

import { annotation } from '@cornerstonejs/tools';
import { triggerAnnotationRenderForViewportIds } from '@cornerstonejs/tools/utilities';
import { DicomMetadataStore } from '@ohif/core';

import { getMeasurementColorHex, getAuthorKey } from './measurementColors';

export const CORNERSTONE_SOURCE_NAME = 'Cornerstone3DTools';
export const CORNERSTONE_SOURCE_VERSION = '0.1';

/**
 * Extra measurement fields stamped onto hydrated rows. These must also be
 * registered with measurementService.addMeasurementSchemaKeys() - a top-level
 * key that is not in MEASUREMENT_SCHEMA_KEYS makes the measurement silently
 * fail validation.
 */
export const EXTRA_MEASUREMENT_KEYS = [
  'createdBy',
  'colorHex',
  'isAi',
  'aiLabel',
  'aiLocation',
  'aiSeverity',
  'aiConfidence',
  'aiModel',
  'aiLengthMm',
  'aiWidthMm',
  'aiSliceIndex',
];

// Parse the saved display text (e.g. "1895 mm") back into csTools cachedStats.
export function parseMeasurementText(primary) {
  if (!Array.isArray(primary) || !primary.length) {
    return null;
  }

  const text = String(primary[0]).trim();
  const match = text.match(/(-?[\d.,]+)\s*([a-zA-Z%°²³]*)/);

  if (!match) {
    return null;
  }

  return {
    length: parseFloat(match[1].replace(/,/g, '')),
    unit: match[2] || 'mm',
  };
}

// csTools targetIds used as cachedStats keys are in "imageId:<id>"/"volumeId:<id>"/
// "videoId:<id>" form, so the tools throw: 'getTargetIdImage: targetId must start
// with "imageId:" or "volumeId:"' otherwise.
// NOTE: this prefix is ONLY valid for cachedStats keys. Annotation
// `metadata.referencedImageId` must stay the raw cornerstone imageId
// ("wadors:..."), because that is what csTools itself stores
// (AnnotationTool.hydrateBase -> viewport.getImageIds()[i]) and what
// StackViewport.isReferenceViewable compares against getCurrentImageId().
// OHIF's MetadataProvider.getUIDsFromImageID() also only parses ids starting
// with "wadors:", so a prefixed id makes
// cornerstone.metaData.get('instance', id) return undefined and the whole
// hydration silently fails.
export function toTargetId(referencedImageId) {
  if (!referencedImageId) {
    return referencedImageId;
  }
  if (
    referencedImageId.startsWith('imageId:') ||
    referencedImageId.startsWith('volumeId:') ||
    referencedImageId.startsWith('videoId:')
  ) {
    return referencedImageId;
  }
  return `imageId:${referencedImageId}`;
}

// Inverse of toTargetId: recovers the raw cornerstone imageId from a stored
// targetId so legacy rows saved with a prefix still resolve.
export function stripTargetIdPrefix(referencedImageId) {
  if (!referencedImageId) {
    return referencedImageId;
  }
  const match = /^(?:imageId|volumeId|videoId):(.*)$/.exec(referencedImageId);
  return match ? match[1] : referencedImageId;
}

// Resolve the imageId (and series/study) for a SOPInstanceUID by scanning the
// loaded display sets of the study. The display set always owns the canonical
// imageIds that the viewport and the metadata provider use, so this is
// preferred over anything persisted on the measurement row.
export function resolveImageReference(
  displaySetService,
  studyUid,
  sopInstanceUid,
  seriesInstanceUid
) {
  if (!sopInstanceUid) {
    return null;
  }

  let displaySets = [];
  try {
    displaySets = displaySetService.getDisplaySetsBy(ds => {
      if (studyUid && ds.StudyInstanceUID !== studyUid) {
        return false;
      }
      if (seriesInstanceUid && ds.SeriesInstanceUID !== seriesInstanceUid) {
        return false;
      }
      return true;
    });
  } catch (e) {
    displaySets = displaySetService.activeDisplaySets || [];
  }

  for (const ds of displaySets) {
    const instances = ds.instances || ds.images || [];
    const imageIds = ds.imageIds || (ds.images || []).map(i => i.imageId);
    const idx = instances.findIndex(i => i.SOPInstanceUID === sopInstanceUid);

    if (idx === -1) {
      continue;
    }

    const referencedImageId = (imageIds && imageIds[idx]) || instances[idx]?.imageId;

    if (referencedImageId) {
      return {
        referencedImageId: stripTargetIdPrefix(referencedImageId),
        SOPInstanceUID: sopInstanceUid,
        SeriesInstanceUID: ds.SeriesInstanceUID || instances[idx]?.SeriesInstanceUID,
        StudyInstanceUID: ds.StudyInstanceUID || studyUid,
      };
    }
  }

  return null;
}

// ────────────────────────────────────────────────
// DICOM pixel grid -> patient/world coordinates
// ────────────────────────────────────────────────

/**
 * DICOMweb metadata arrives either as an array (DICOMweb JSON) or a
 * backslash/comma separated string (wadors metadata provider), so accept both.
 */
function toNumberArray(value) {
  if (Array.isArray(value)) {
    return value.map(v => parseFloat(v)).filter(v => !Number.isNaN(v));
  }
  if (typeof value === 'string') {
    return value
      .split('\\')
      .map(v => parseFloat(v))
      .filter(v => !Number.isNaN(v));
  }
  return [];
}

export function getImageGeometry({ studyInstanceUID, seriesInstanceUID, sopInstanceUID }) {
  let instance = null;
  try {
    instance = DicomMetadataStore.getInstance(studyInstanceUID, seriesInstanceUID, sopInstanceUID);
  } catch (err) {
    instance = null;
  }

  if (!instance) {
    return null;
  }

  const pixelSpacing = toNumberArray(instance.PixelSpacing);
  const imagePositionPatient = toNumberArray(instance.ImagePositionPatient);

  if (pixelSpacing.length < 2 || imagePositionPatient.length < 3) {
    return null;
  }

  return {
    // DICOM PixelSpacing is [row spacing (vertical), column spacing (horizontal)]
    rowSpacing: pixelSpacing[0],
    columnSpacing: pixelSpacing[1],
    imagePositionPatient,
    rows: parseInt(instance.Rows, 10) || null,
    columns: parseInt(instance.Columns, 10) || null,
    frameOfReferenceUID: instance.FrameOfReferenceUID || null,
  };
}

/**
 * Convert [{x, y}, ...] image-pixel coordinates (origin top-left, x across the
 * columns, y down the rows) into the [x, y, z] world points csTools expects,
 * using the instance's ImagePositionPatient as the origin of the first pixel
 * centre and PixelSpacing as the step per pixel.
 */
export function dicomPixelToWorld(points, geometry) {
  if (!geometry || !Array.isArray(points)) {
    return null;
  }

  const [originX, originY, originZ] = geometry.imagePositionPatient;
  const { rowSpacing, columnSpacing } = geometry;

  const world = points.map(point => {
    const col = Number(point?.x);
    const row = Number(point?.y);

    if (Number.isNaN(col) || Number.isNaN(row)) {
      return null;
    }

    return [originX + col * columnSpacing, originY + row * rowSpacing, originZ];
  });

  return world.some(p => p === null) ? null : world;
}

/**
 * Sanity check the placement: if the span we derived from the pixel grid
 * disagrees badly with the length the model reported, its coordinate convention
 * is probably not the native DICOM grid. We keep the model's number as the
 * displayed text either way - this only warns.
 */
export function validatePlacement(worldPoints, reportedLengthMm) {
  if (!worldPoints || worldPoints.length < 2 || !reportedLengthMm) {
    return null;
  }

  const [x1, y1] = worldPoints[0];
  const [x2, y2] = worldPoints[worldPoints.length - 1];
  const derived = Math.hypot(x2 - x1, y2 - y1);

  if (!derived || !reportedLengthMm) {
    return null;
  }

  const ratio = derived / reportedLengthMm;
  if (ratio >= 0.8 && ratio <= 1.25) {
    return { ok: true, derivedMm: derived, reportedMm: reportedLengthMm };
  }
  return { ok: false, derivedMm: derived, reportedMm: reportedLengthMm };
}

// ────────────────────────────────────────────────
// Row -> annotation
// ────────────────────────────────────────────────

/**
 * Convert a stored measurement row (from the get-measurements API, an IoT push,
 * or the AI endpoint) back into a csTools annotation and push it through the
 * cornerstone measurement source so that it renders on the viewport.
 *
 * @returns {string|null} the measurement uid, or null when it could not be added
 */
export function hydrateMeasurement(
  measurementService,
  displaySetService,
  extensionManager,
  cornerstoneViewportService,
  studyUid,
  m
) {
  const data =
    m && m.data && typeof m.data === 'object' && !Array.isArray(m.data) && m.data.uid ? m.data : m;

  if (!data || typeof data !== 'object' || !data.uid) {
    console.warn('Skipping invalid measurement:', m);
    return null;
  }

  // Never hydrate a row that belongs to a different study, even if the API or a
  // realtime push hands it to us.
  const rowStudyUid =
    data.StudyInstanceUID || data.metadata?.StudyInstanceUID || m.study_instance_uid;
  if (studyUid && rowStudyUid && rowStudyUid !== studyUid) {
    console.warn(
      `Skipping measurement '${data.uid}' from study '${rowStudyUid}' while hydrating '${studyUid}'`
    );
    return null;
  }

  const toolName = data.toolName;
  if (!toolName) {
    console.warn('Measurement has no toolName, skipping:', data);
    return null;
  }

  const source = measurementService.getSource(CORNERSTONE_SOURCE_NAME, CORNERSTONE_SOURCE_VERSION);
  if (!source) {
    console.warn(`Cornerstone measurement source '${CORNERSTONE_SOURCE_NAME}' not found`);
    return null;
  }

  const sourceMappings =
    measurementService.getSourceMappings(CORNERSTONE_SOURCE_NAME, CORNERSTONE_SOURCE_VERSION) || [];
  const mapping = sourceMappings.find(mp => mp.annotationType === toolName);
  if (!mapping) {
    console.warn(`No measurement mapping for tool '${toolName}', skipping:`, data);
    return null;
  }

  let seriesInstanceUID = data.SeriesInstanceUID || data.metadata?.SeriesInstanceUID || null;
  let studyInstanceUID = data.StudyInstanceUID || data.metadata?.StudyInstanceUID || studyUid;

  // Prefer the display set's own imageId: it is the exact string the viewport
  // and OHIF's metadata provider are keyed on. Only fall back to whatever was
  // persisted on the row.
  const resolved = resolveImageReference(
    displaySetService,
    studyInstanceUID,
    data.SOPInstanceUID,
    seriesInstanceUID
  );

  let referencedImageId = resolved?.referencedImageId;
  if (resolved) {
    seriesInstanceUID = seriesInstanceUID || resolved.SeriesInstanceUID;
    studyInstanceUID = resolved.StudyInstanceUID || studyInstanceUID;
  }

  if (!referencedImageId) {
    referencedImageId = stripTargetIdPrefix(
      data.referencedImageId || data.metadata?.referencedImageId || null
    );
  }

  if (!referencedImageId) {
    console.warn(`Could not resolve imageId for measurement '${data.uid}', skipping:`, data);
    return null;
  }

  // cachedStats keys must be csTools targetIds ("imageId:<id>"), but
  // metadata.referencedImageId must stay the raw imageId.
  const targetId = toTargetId(referencedImageId);

  // A row can carry explicit stats (the AI endpoint reports exact millimetres);
  // otherwise fall back to recovering them from the saved display text. The
  // explicit form is also the only way to get `width` onto a Bidirectional,
  // whose display text cannot be parsed back into two numbers.
  let cachedStats = {};
  if (data.stats && typeof data.stats === 'object' && data.stats.length != null) {
    const { length, width, unit } = data.stats;
    cachedStats = {
      [targetId]: {
        length,
        unit: unit || 'mm',
        ...(width != null ? { width } : {}),
      },
    };
  } else {
    const parsed = parseMeasurementText(data.displayText?.primary);
    cachedStats = parsed ? { [targetId]: { length: parsed.length, unit: parsed.unit } } : {};
  }

  const points = Array.isArray(data.points)
    ? data.points.map(point => {
        if (point && typeof point === 'object' && point.referencedImageId) {
          const normalizedPointId = toTargetId(point.referencedImageId);
          if (normalizedPointId !== point.referencedImageId) {
            return { ...point, referencedImageId: normalizedPointId };
          }
        }
        return point;
      })
    : data.points;

  // AI provenance rides in the annotation metadata as well as on the row:
  // toMeasurement() copies `metadata` verbatim on every rebuild (csTools
  // recalculates stats shortly after addRawMeasurement and re-runs the mapping),
  // so top-level stamps alone would be wiped within ~100ms.
  const aiMeta = {};
  if (data.isAi) {
    aiMeta.isAi = true;
    aiMeta.aiLabel = data.aiLabel;
    aiMeta.aiLocation = data.aiLocation;
    aiMeta.aiSeverity = data.aiSeverity;
    aiMeta.aiConfidence = data.aiConfidence;
    aiMeta.aiModel = data.aiModel;
    aiMeta.aiLengthMm = data.aiLengthMm;
    aiMeta.aiWidthMm = data.aiWidthMm;
    aiMeta.aiSliceIndex = data.aiSliceIndex;
  }

  const annotationObject = {
    annotationUID: data.uid,
    predecessorImageId: data.predecessorImageId,
    metadata: {
      ...aiMeta,
      toolName,
      FrameOfReferenceUID: data.FrameOfReferenceUID,
      referencedImageId,
      SOPInstanceUID: data.SOPInstanceUID,
      SeriesInstanceUID: seriesInstanceUID,
      StudyInstanceUID: studyInstanceUID,
    },
    data: {
      label: data.label || '',
      handles: {
        points,
        textBox: data.textBox,
      },
      cachedStats,
    },
  };

  const activeDataSource = extensionManager.getActiveDataSource();
  const dataSource = (activeDataSource && activeDataSource[0]) || null;

  const measurementUid = measurementService.addRawMeasurement(
    source,
    toolName,
    { annotation: annotationObject, uid: data.uid },
    mapping.toMeasurementSchema,
    dataSource
  );

  if (!measurementUid) {
    // addRawMeasurement swallows mapping errors, so surface the most likely
    // cause instead of silently rendering nothing.
    console.warn(
      `Failed to hydrate measurement '${data.uid}' (tool '${toolName}', imageId '${referencedImageId}')`
    );
    return null;
  }

  stampMeasurementFields(measurementService, measurementUid, m, data);

  // Color-code by owner: AI gets its reserved colour, each doctor a stable
  // palette colour. Render trigger lives in its own try/catch so a styling
  // failure can't suppress the draw.
  try {
    const stored = measurementService.getMeasurement(measurementUid);
    annotation.config.style.setAnnotationStyles(measurementUid, {
      color: getMeasurementColorHex(stored || { ...data, ...m }),
    });
  } catch (err) {
    console.warn('Failed to apply measurement color:', err);
  }

  try {
    if (cornerstoneViewportService) {
      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      const viewportIds = renderingEngine
        ? renderingEngine.getViewports().map(viewport => viewport.id)
        : [];
      if (viewportIds.length) {
        triggerAnnotationRenderForViewportIds(viewportIds);
      }
    }
  } catch (err) {
    console.warn('Failed to trigger annotation render:', err);
  }

  return measurementUid;
}

/**
 * Mirror the row's author / AI provenance / colour onto the stored measurement
 * so the sidebars can group and colour it without re-reading the annotation.
 */
export function stampMeasurementFields(measurementService, measurementUid, row, data) {
  try {
    const stored = measurementService.getMeasurement(measurementUid);
    if (!stored) {
      return;
    }

    // Surface the author so AnnotationFiltersPanel can group by owner instead of
    // falling back to "Unknown".
    const owner = row?.created_by ?? row?.createdBy;
    if (owner != null) {
      stored.createdBy = owner;
    }

    if (data?.isAi) {
      stored.isAi = true;
      stored.aiLabel = data.aiLabel;
      stored.aiLocation = data.aiLocation;
      stored.aiSeverity = data.aiSeverity;
      stored.aiConfidence = data.aiConfidence;
      stored.aiModel = data.aiModel;
      stored.aiLengthMm = data.aiLengthMm;
      stored.aiWidthMm = data.aiWidthMm;
      stored.aiSliceIndex = data.aiSliceIndex;
      if (stored.createdBy == null) {
        stored.createdBy = 'AI';
      }
    }

    stored.colorHex = getMeasurementColorHex(stored);
  } catch (err) {
    // Non-fatal: the annotation already exists and renders.
  }
}

export function measurementAuthorKey(measurement) {
  return getAuthorKey(measurement);
}

export default {
  CORNERSTONE_SOURCE_NAME,
  CORNERSTONE_SOURCE_VERSION,
  EXTRA_MEASUREMENT_KEYS,
  parseMeasurementText,
  toTargetId,
  stripTargetIdPrefix,
  resolveImageReference,
  getImageGeometry,
  dicomPixelToWorld,
  validatePlacement,
  hydrateMeasurement,
  stampMeasurementFields,
  measurementAuthorKey,
};
