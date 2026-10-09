/**
 * Apply a measurement change that arrived from another doctor over MQTT.
 *
 * The hard part is UPDATE. `measurementService.addRawMeasurement` upserts by uid
 * (MeasurementService.ts:453-468), so the internal representation updates, but
 * the caliper on screen does not move: cornerstone's annotationState exposes
 * addAnnotation / removeAnnotation / invalidateAnnotation and has no `setValue`
 * (@cornerstonejs/tools/.../annotation/annotationState.js:119).
 *
 * So an update is remove-then-re-add on the live annotation state.
 *
 * That is dangerous: removing emits MEASUREMENT_REMOVED and re-adding emits
 * MEASUREMENT_ADDED, which our own subscribers would treat as a real user edit
 * - writing a DELETE tombstone to the database and publishing a DELETE back onto
 * MQTT, which would ping-pong between viewers. Every entry point therefore runs
 * inside `runRemoteApply`, which flips a flag the local handlers check.
 */

import { annotationState } from '@cornerstonejs/tools';

import { hydrateMeasurement } from './measurementHydrator';

/**
 * Depth counter rather than a boolean: a remote apply can trigger another one
 * synchronously (csTools re-emitting stats updates), and only the outermost
 * frame should clear the flag.
 */
let remoteApplyDepth = 0;

export function isApplyingRemoteChange() {
  return remoteApplyDepth > 0;
}

/**
 * Run `fn` with remote-apply semantics: local change handlers will see
 * `isApplyingRemoteChange()` and suppress their save/publish side effects.
 */
export function runRemoteApply(fn) {
  remoteApplyDepth += 1;
  try {
    return fn();
  } finally {
    remoteApplyDepth -= 1;
  }
}

// No render call here on purpose: hydrateMeasurement already triggers
// triggerAnnotationRenderForViewportIds once the annotation is in place
// (measurementHydrator.js:450-462), so an ADD/UPDATE would render twice. A
// DELETE goes through measurementService.remove(), which drives the render
// through cornerstone's own listeners.

/**
 * Detach an annotation from the live cornerstone state so it can be re-added
 * with new geometry. Must not go through `measurementService.remove`, which
 * would emit MEASUREMENT_REMOVED.
 */
function detachLiveAnnotation(annotationUid) {
  try {
    const existing = annotationState.getAnnotation(annotationUid);
    if (!existing) {
      return false;
    }
    annotationState.removeAnnotation(annotationUid);
    return true;
  } catch (err) {
    // Not being in the live state is normal (the remote doctor may be on a
    // different slice, or the row may have been restored from the DB).
    console.warn('[mqtt] could not detach annotation', annotationUid, err);
    return false;
  }
}

const ACTION = {
  ADD: 'ADD',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
};

function normalizeAction(action) {
  return String(action || '').toUpperCase();
}

/**
 * @param {object} deps
 * @param {import('@ohif/core').MeasurementService} deps.measurementService
 * @param {object} deps.displaySetService
 * @param {object} deps.extensionManager
 * @param {object} deps.cornerstoneViewportService
 * @param {string} deps.studyInstanceUid Study the local viewer currently has open.
 * @param {object} message Payload published by the other doctor.
 * @returns {{applied: boolean, reason?: string, action: string, annotationUid: string}}
 */
export function applyRemoteMeasurement(deps, message) {
  const {
    measurementService,
    displaySetService,
    extensionManager,
    cornerstoneViewportService,
    studyInstanceUid,
  } = deps;

  const annotationUid = message?.annotationUid || message?.measurement?.uid;
  const action = normalizeAction(message?.action);

  const fail = reason => ({ applied: false, reason, action, annotationUid });

  if (!annotationUid) {
    return fail('missing-annotation-uid');
  }

  const normalizedAction = action === 'CREATE' ? ACTION.ADD : action;

  if (!Object.values(ACTION).includes(normalizedAction)) {
    return fail(`unsupported-action:${message?.action}`);
  }

  // Only ever apply changes for a study this viewer actually has open.
  const messageStudy = message.studyInstanceUid || studyInstanceUid;
  if (messageStudy && studyInstanceUid && messageStudy !== studyInstanceUid) {
    return fail('study-mismatch');
  }

  return runRemoteApply(() => {
    const known = measurementService.getMeasurement(annotationUid);

    if (normalizedAction === ACTION.DELETE) {
      if (!known) {
        return fail('unknown-annotation');
      }
      try {
        // remove() is correct here: this annotation is genuinely going away, so
        // the local handler should remove it too. runRemoteApply keeps that from
        // becoming a tombstone POST or an MQTT DELETE echo.
        measurementService.remove(annotationUid);
      } catch (err) {
        console.warn('[mqtt] remote remove failed:', err);
        return fail('remove-failed');
      }
      return { applied: true, action: normalizedAction, annotationUid };
    }

    const measurement = message.measurement;
    if (!measurement) {
      return fail('missing-measurement');
    }

    if (normalizedAction === ACTION.UPDATE && known) {
      // Free the live annotation before re-adding, otherwise cornerstone keeps
      // the old geometry and the re-add is ignored.
      detachLiveAnnotation(annotationUid);
    }

    let hydratedUid;
    try {
      hydratedUid = hydrateMeasurement(
        measurementService,
        displaySetService,
        extensionManager,
        cornerstoneViewportService,
        messageStudy,
        { ...measurement, uid: annotationUid }
      );
    } catch (err) {
      console.warn('[mqtt] failed to apply remote measurement:', err);
      return fail('hydrate-failed');
    }

    if (!hydratedUid) {
      return fail('hydrate-returned-null');
    }

    return {
      applied: true,
      action: normalizedAction,
      annotationUid,
      // UPDATE on a row we had never seen behaves as an add; surface which it
      // actually was so callers/logs are not misleading.
      effectiveAction: known ? normalizedAction : ACTION.ADD,
    };
  });
}
