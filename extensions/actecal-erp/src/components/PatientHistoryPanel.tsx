import React, { useEffect, useState } from 'react';
import { useSystem } from '@ohif/core';
import ApiService from '../services/ApiService';

const PatientHistoryPanel = () => {
  const { servicesManager } = useSystem();
  const { viewportGridService, displaySetService } = servicesManager.services;
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [studyInstanceUid, setStudyInstanceUid] = useState(null);

  // Resolve the active study from the current viewport (grid state is a Map
  // keyed by viewportId; the study UID lives on the display set, not the viewport).
  const resolveStudy = () => {
    const state = viewportGridService?.getState();
    const activeViewport = state?.activeViewportId && state?.viewports?.get(state.activeViewportId);
    const displaySetInstanceUid = activeViewport?.displaySetInstanceUIDs?.[0];
    const displaySet = displaySetInstanceUid
      ? displaySetService?.getDisplaySetByUID(displaySetInstanceUid)
      : undefined;
    setStudyInstanceUid(displaySet?.StudyInstanceUID);
  };

  // Re-resolve whenever the active viewport or grid changes so the history
  // always follows the patient whose study is currently open.
  useEffect(() => {
    resolveStudy();
    const subscription = viewportGridService?.subscribe(
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      resolveStudy
    );
    const gridSubscription = viewportGridService?.subscribe(
      viewportGridService.EVENTS.GRID_STATE_CHANGED,
      resolveStudy
    );
    return () => {
      subscription?.unsubscribe?.();
      gridSubscription?.unsubscribe?.();
    };
  }, [viewportGridService, displaySetService]);

  // Fetch the current patient's past test reports from the backend.
  useEffect(() => {
    if (!studyInstanceUid) {
      setLoading(false);
      setHistory([]);
      return;
    }

    let cancelled = false;
    const fetchHistory = async () => {
      setLoading(true);
      try {
        const apiService = new ApiService();
        const res = await apiService.getPatientHistory(studyInstanceUid);
        const list = res?.data || (Array.isArray(res) ? res : []);
        if (!cancelled) setHistory(Array.isArray(list) ? list : []);
      } catch (error) {
        console.error('Failed to fetch patient history', error);
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchHistory();
    return () => { cancelled = true; };
  }, [studyInstanceUid]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-4 text-white">
        Loading patient history...
      </div>
    );
  }

  if (!studyInstanceUid) {
    return (
      <div className="flex flex-col p-4 text-white">
        <h3 className="mb-4 text-lg font-semibold">Patient History</h3>
        <p className="text-sm text-gray-400">No study selected.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col p-4 text-white">
      <div className="flex flex-col gap-1 mb-4">
        <h3 className="text-lg font-semibold">Patient History</h3>
        {history.length > 0 && history[0]?.patientName && (
          <span className="text-sm text-primary-light">{history[0].patientName}</span>
        )}
      </div>
      {history.length === 0 ? (
        <p className="text-sm text-gray-400">No previous history found.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {history.map((item, index) => (
            <div key={item.reportId || item.erpRefId || index} className="flex flex-col rounded bg-secondary-dark p-3 text-sm">
              <span className="font-bold text-primary-light">
                {item.testName || item.departmentName || 'Report'}
              </span>
              {item.testName && item.departmentName && item.departmentName !== item.testName && (
                <span className="text-white">Dept: {item.departmentName}</span>
              )}
              <span className="text-xs text-gray-400 mt-1">
                {(item.reportType || 'report').toUpperCase()} • {item.createdDate || ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PatientHistoryPanel;