// ────────────────────────────────────────────────
// Measurement colour coding.
//
// Two populations share the viewport:
//   - AI measurements produced by the GPU DICOM endpoint
//   - doctor measurements drawn with the OHIF caliper tools (including
//     measurements replayed from other participants over IoT)
//
// AI is a single reserved colour so it can never be confused with a human.
// Every doctor is handed a distinct colour from DOCTOR_COLOR_PALETTE and keeps
// it for the whole session, so two radiologists reading the same study can see
// at a glance who measured what.
// ────────────────────────────────────────────────

// Reserved for AI. Kept out of the doctor palette so a doctor can never be
// mistaken for the model.
export const AI_COLOR = '#22d3ee';
export const AI_AUTHOR_KEY = 'AI';
export const AI_AUTHOR_NAME = 'AI';
export const UNKNOWN_AUTHOR = 'Unknown';

// Fallback when a measurement predates this module and carries no colorHex.
export const DEFAULT_COLOR = '#f00';

// High-contrast, colour-blind-distinguishable set. Ordered so the first few
// doctors in a session get the most easily told apart colours.
export const DOCTOR_COLOR_PALETTE = [
  '#f97316', // orange
  '#22c55e', // green
  '#a855f7', // purple
  '#eab308', // yellow
  '#ec4899', // pink
  '#3b82f6', // blue
  '#14b8a6', // teal
  '#8b5cf6', // violet
];

// authorKey -> hex. Module-level so the assignment survives re-renders,
// measurement hydration and panel remounts within a session. Without this a
// doctor would change colour every time the list rebuilt.
const assignedColors = new Map();
let nextPaletteIndex = 0;

export function getCurrentUserId() {
  if (typeof window === 'undefined') {
    return null;
  }
  return new URLSearchParams(window.location.search).get('userId') || null;
}

export function isAiMeasurement(measurement) {
  if (!measurement) {
    return false;
  }
  if (measurement.isAi === true || measurement.metadata?.isAi === true) {
    return true;
  }
  const owner = getRawOwner(measurement);
  return owner != null && String(owner).toUpperCase() === AI_AUTHOR_KEY;
}

// The author may sit at the top level (stamped after addRawMeasurement) or in
// the annotation metadata (which survives csTools rebuilding the measurement).
function getRawOwner(measurement) {
  return (
    measurement?.createdBy ?? measurement?.created_by ?? measurement?.metadata?.createdBy ?? null
  );
}

/**
 * Stable group key for a measurement: 'AI' for the model, otherwise the doctor
 * id that created it.
 */
export function getAuthorKey(measurement) {
  if (isAiMeasurement(measurement)) {
    return AI_AUTHOR_KEY;
  }
  const owner = getRawOwner(measurement);
  if (owner == null || owner === '') {
    return UNKNOWN_AUTHOR;
  }
  return String(owner);
}

export function getAuthorDisplayName(measurement) {
  if (isAiMeasurement(measurement)) {
    return AI_AUTHOR_NAME;
  }
  return measurement?.authorName ?? measurement?.author ?? getAuthorKey(measurement);
}

function pickFromPalette(key) {
  const colour = DOCTOR_COLOR_PALETTE[nextPaletteIndex % DOCTOR_COLOR_PALETTE.length];
  nextPaletteIndex += 1;
  assignedColors.set(key, colour);
  return colour;
}

/**
 * Colour for an author key. Deterministic within a session: the first call for
 * a key fixes the colour, every later call returns the same value.
 */
export function getColorForAuthor(authorKey) {
  const key = String(authorKey ?? UNKNOWN_AUTHOR);
  if (key === AI_AUTHOR_KEY) {
    return AI_COLOR;
  }
  const existing = assignedColors.get(key);
  if (existing) {
    return existing;
  }
  return pickFromPalette(key);
}

/**
 * The css colour a measurement should be drawn in. Prefers an explicitly
 * persisted colorHex so a measurement reloads in the colour it was created with,
 * and falls back to author-key assignment.
 */
export function getMeasurementColorHex(measurement) {
  if (!measurement) {
    return DEFAULT_COLOR;
  }
  if (measurement.colorHex) {
    return measurement.colorHex;
  }
  return getColorForAuthor(getAuthorKey(measurement));
}

// ────────────────────────────────────────────────
// Legend, consumed by the Annotation Visibility panel.
// ────────────────────────────────────────────────

/**
 * Build the legend rows from a list of measurements: one entry for the AI plus
 * one per doctor, ordered AI-first then alphabetically by doctor name.
 */
export function buildColorLegend(measurements = []) {
  const groups = new Map();

  measurements.forEach(measurement => {
    const key = getAuthorKey(measurement);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: getAuthorDisplayName(measurement),
        color: getMeasurementColorHex(measurement),
        isAi: key === AI_AUTHOR_KEY,
        uids: [],
      });
    }
    groups.get(key).uids.push(measurement.uid);
  });

  return [...groups.values()].sort((a, b) => {
    if (a.isAi !== b.isAi) {
      return a.isAi ? -1 : 1;
    }
    return String(a.name).localeCompare(String(b.name));
  });
}

/** Drop cached assignments, e.g. when the session switches user. */
export function resetColorAssignments() {
  assignedColors.clear();
  nextPaletteIndex = 0;
}

export default {
  AI_COLOR,
  AI_AUTHOR_KEY,
  AI_AUTHOR_NAME,
  UNKNOWN_AUTHOR,
  DEFAULT_COLOR,
  DOCTOR_COLOR_PALETTE,
  getCurrentUserId,
  isAiMeasurement,
  getAuthorKey,
  getAuthorDisplayName,
  getColorForAuthor,
  getMeasurementColorHex,
  buildColorLegend,
  resetColorAssignments,
};
