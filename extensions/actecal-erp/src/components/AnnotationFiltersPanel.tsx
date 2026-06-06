import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

function AnnotationFiltersPanel({ servicesManager }) {
  const [authors, setAuthors] = useState([]);
  const [visibilityMap, setVisibilityMap] = useState({});

  useEffect(() => {
    const { measurementService } = servicesManager.services;
    if (!measurementService) return;

    const updateAuthors = () => {
      const measurements = measurementService.getMeasurements();
      
      const authorGroups = {};
      measurements.forEach(m => {
        // Find author name/id from metadata
        const author = m.createdBy || m.authorName || m.author || 'Unknown';
        if (!authorGroups[author]) {
          authorGroups[author] = [];
        }
        authorGroups[author].push(m.uid);
      });

      setAuthors(Object.keys(authorGroups).sort());
      
      // Initialize visibility map if new authors are found
      setVisibilityMap(prev => {
        const newMap = { ...prev };
        Object.keys(authorGroups).forEach(author => {
          if (newMap[author] === undefined) {
            newMap[author] = true; // default visible
          }
        });
        return newMap;
      });
    };

    // Initial load
    updateAuthors();

    // Subscriptions
    const subscriptions = [
      measurementService.subscribe(measurementService.EVENTS.MEASUREMENT_ADDED, updateAuthors),
      measurementService.subscribe(measurementService.EVENTS.MEASUREMENT_UPDATED, updateAuthors),
      measurementService.subscribe(measurementService.EVENTS.MEASUREMENT_REMOVED, updateAuthors),
      measurementService.subscribe(measurementService.EVENTS.MEASUREMENTS_CLEARED, updateAuthors)
    ];

    return () => {
      subscriptions.forEach(sub => sub.unsubscribe());
    };
  }, [servicesManager]);

  const toggleAuthorVisibility = (author) => {
    const { measurementService } = servicesManager.services;
    const newVisibility = !visibilityMap[author];
    
    setVisibilityMap(prev => ({
      ...prev,
      [author]: newVisibility
    }));

    const measurements = measurementService.getMeasurements();
    const uidsToToggle = measurements
      .filter(m => (m.createdBy || m.authorName || m.author || 'Unknown') === author)
      .map(m => m.uid);

    if (uidsToToggle.length > 0) {
      measurementService.toggleVisibilityMeasurementMany(uidsToToggle, newVisibility);
    }
  };

  return (
    <div className="flex h-full flex-col bg-black text-white p-4">
      <h3 className="mb-4 text-lg font-bold text-primary-light">Annotation Visibility</h3>
      
      {authors.length === 0 ? (
        <div className="text-gray-400 text-sm">No annotations found on this study.</div>
      ) : (
        <div className="space-y-3">
          {authors.map(author => (
            <div key={author} className="flex items-center justify-between rounded-md bg-secondary-dark p-2">
              <span className="text-sm font-medium">{author}</span>
              <button
                className={`flex h-6 w-10 items-center rounded-full p-1 transition-colors ${
                  visibilityMap[author] ? 'bg-primary-main' : 'bg-gray-600'
                }`}
                onClick={() => toggleAuthorVisibility(author)}
              >
                <div
                  className={`h-4 w-4 rounded-full bg-white transition-transform ${
                    visibilityMap[author] ? 'translate-x-4' : 'translate-x-0'
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
