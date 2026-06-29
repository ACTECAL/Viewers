import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

const PatientHistoryPanel = ({ servicesManager, extensionManager }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  // We fetch the study instance uid from the viewport or active state
  useEffect(() => {
    // Placeholder logic for API call
    const fetchHistory = async () => {
      setLoading(true);
      try {
        // Simulate API call using active study instance UID
        // const { displaySetService } = servicesManager.services;
        // const activeDisplaySets = displaySetService.getActiveDisplaySets();
        // const studyInstanceUid = activeDisplaySets?.[0]?.StudyInstanceUID;
        
        // Mock API response
        setTimeout(() => {
          setHistory([
            { date: '2023-10-12', description: 'Previous CT Chest', status: 'Signed Off' },
            { date: '2022-05-04', description: 'X-Ray Chest', status: 'Reported' },
          ]);
          setLoading(false);
        }, 1000);

      } catch (error) {
        console.error('Failed to fetch patient history', error);
        setLoading(false);
      }
    };

    fetchHistory();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-4 text-white">
        Loading patient history...
      </div>
    );
  }

  return (
    <div className="flex flex-col p-4 text-white">
      <h3 className="mb-4 text-lg font-semibold">Patient History</h3>
      {history.length === 0 ? (
        <p className="text-sm text-gray-400">No previous history found.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {history.map((item, index) => (
            <div key={index} className="flex flex-col rounded bg-secondary-dark p-3 text-sm">
              <span className="font-bold text-primary-light">{item.date}</span>
              <span className="text-white">{item.description}</span>
              <span className="text-xs text-gray-400 mt-1">Status: {item.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

PatientHistoryPanel.propTypes = {
  servicesManager: PropTypes.object.isRequired,
  extensionManager: PropTypes.object.isRequired,
};

export default PatientHistoryPanel;
