import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useSystem } from '@ohif/core';
import { eventTarget, Enums } from '@cornerstonejs/core';
import { annotation } from '@cornerstonejs/tools';

export default function FloatingDeleteMeasurement() {
  const { servicesManager } = useSystem();
  const [selectedMeasurementId, setSelectedMeasurementId] = useState(null);
  const [hasMeasurements, setHasMeasurements] = useState(false);

  useEffect(() => {
    const { measurementService } = servicesManager.services;
    
    if (!measurementService) return;

    const checkState = () => {
      const measurements = measurementService.getMeasurements();
      setHasMeasurements(measurements && measurements.length > 0);
      const initialSelected = measurements.find(m => m.isSelected);
      setSelectedMeasurementId(initialSelected ? initialSelected.uid : null);
    };

    const onMeasurementUpdated = ({ detail }) => {
      checkState();
    };

    // Initial check
    checkState();

    const subUpdated = measurementService.subscribe(measurementService.EVENTS.MEASUREMENT_UPDATED, onMeasurementUpdated);
    const subAdded = measurementService.subscribe(measurementService.EVENTS.MEASUREMENT_ADDED, checkState);
    const subRemoved = measurementService.subscribe(measurementService.EVENTS.MEASUREMENT_REMOVED, checkState);
    const subCleared = measurementService.subscribe(measurementService.EVENTS.MEASUREMENTS_CLEARED, checkState);

    return () => {
      subUpdated.unsubscribe();
      subAdded.unsubscribe();
      subRemoved.unsubscribe();
      subCleared.unsubscribe();
    };
  }, [servicesManager]);

  if (!hasMeasurements) return null;

  return ReactDOM.createPortal(
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (selectedMeasurementId) {
          servicesManager.services.measurementService.remove(selectedMeasurementId);
          setSelectedMeasurementId(null);
        }
      }}
      className={`fixed bottom-28 right-4 z-[999999] rounded-full w-14 h-14 flex items-center justify-center shadow-[0_5px_25px_rgba(0,0,0,1)] pointer-events-auto transition-transform active:scale-95 text-white ${selectedMeasurementId ? 'bg-red-600' : 'bg-red-900 opacity-50 cursor-not-allowed'}`}
      aria-label="Delete Measurement"
      disabled={!selectedMeasurementId}
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>,
    document.body
  );
}
