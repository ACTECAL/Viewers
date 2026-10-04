import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useSystem } from '@ohif/core';

import { buildColorLegend } from '../utils/measurementColors';

function AnnotationFiltersPanel() {
  const { servicesManager } = useSystem();
  const [legend, setLegend] = useState([]);
  const [visibilityMap, setVisibilityMap] = useState({});

  useEffect(() => {
    const { measurementService } = servicesManager.services;
    if (!measurementService) return;

    const updateLegend = () => {
      const measurements = measurementService.getMeasurements();

      // buildColorLegend groups by author (AI first, then one row per doctor)
      // and keeps each doctor's colour stable across rebuilds.
      const nextLegend = buildColorLegend(measurements);
      setLegend(nextLegend);

      // New authors default to visible.
      setVisibilityMap(prev => {
        const newMap = { ...prev };
        nextLegend.forEach(entry => {
          if (newMap[entry.key] === undefined) {
            newMap[entry.key] = true;
          }
        });
        return newMap;
      });
    };

    // Initial load
    updateLegend();

    // RAW_MEASUREMENT_ADDED matters as much as MEASUREMENT_ADDED here: AI
    // measurements and rows replayed from the API both arrive through
    // addRawMeasurement, which only broadcasts the raw event.
    const subscriptions = [
      measurementService.subscribe(measurementService.EVENTS.MEASUREMENT_ADDED, updateLegend),
      measurementService.subscribe(measurementService.EVENTS.RAW_MEASUREMENT_ADDED, updateLegend),
      measurementService.subscribe(measurementService.EVENTS.MEASUREMENT_UPDATED, updateLegend),
      measurementService.subscribe(measurementService.EVENTS.MEASUREMENT_REMOVED, updateLegend),
      measurementService.subscribe(measurementService.EVENTS.MEASUREMENTS_CLEARED, updateLegend),
    ];

    return () => {
      subscriptions.forEach(sub => sub.unsubscribe());
    };
  }, [servicesManager]);

  const toggleAuthorVisibility = authorKey => {
    const { measurementService } = servicesManager.services;
    const newVisibility = !visibilityMap[authorKey];

    setVisibilityMap(prev => ({
      ...prev,
      [authorKey]: newVisibility,
    }));

    const measurements = measurementService.getMeasurements();
    const legendEntry = legend.find(entry => entry.key === authorKey);
    const uidsToToggle = legendEntry ? legendEntry.uids : [];

    if (uidsToToggle.length > 0) {
      measurementService.toggleVisibilityMeasurementMany(uidsToToggle, newVisibility);
    }
  };

  return (
    <div className="flex h-full flex-col bg-black p-4 text-white">
      <h3 className="text-primary-light mb-1 text-lg font-bold">Annotation Visibility</h3>
      <p className="mb-4 text-xs text-gray-400">
        Each colour identifies who made the measurement on the image.
      </p>

      {legend.length === 0 ? (
        <div className="text-sm text-gray-400">No annotations found on this study.</div>
      ) : (
        <div className="space-y-3">
          {legend.map(entry => (
            <div
              key={entry.key}
              className={`flex items-center justify-between rounded-md p-2 ${
                entry.isAi ? 'bg-cyan-950/60 ring-1 ring-cyan-700' : 'bg-secondary-dark'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <span
                  className="inline-block h-3.5 w-3.5 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color }}
                  aria-hidden="true"
                />
                <span className="truncate">{entry.name}</span>
                <span className="shrink-0 text-xs text-gray-400">({entry.uids.length})</span>
                {entry.isAi && (
                  <span className="shrink-0 rounded bg-cyan-900/70 px-1.5 py-0.5 text-[10px] font-bold uppercase text-cyan-100">
                    AI
                  </span>
                )}
              </span>
              <button
                className={`flex h-6 w-10 shrink-0 items-center rounded-full p-1 transition-colors ${
                  visibilityMap[entry.key] ? 'bg-primary-main' : 'bg-gray-600'
                }`}
                onClick={() => toggleAuthorVisibility(entry.key)}
                aria-label={`Toggle ${entry.name} measurements`}
              >
                <div
                  className={`h-4 w-4 rounded-full bg-white transition-transform ${
                    visibilityMap[entry.key] ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

AnnotationFiltersPanel.propTypes = {
  servicesManager: PropTypes.object.isRequired,
};

export default AnnotationFiltersPanel;
