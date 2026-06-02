import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useSystem } from '@ohif/core';

function AIAnalysisPanel({ servicesManager, extensionManager }) {
  const { viewportGridService } = servicesManager.services;
  const [analysis, setAnalysis] = useState('Running AI Analysis...');

  useEffect(() => {
    const fetchAnalysis = async () => {
      try {
        const state = viewportGridService.getState();
        const activeViewport = state.viewports[state.activeViewportIndex];
        const studyInstanceUid = activeViewport?.StudyInstanceUID;
        
        if (!studyInstanceUid) {
          setAnalysis('No active study.');
          return;
        }

        // Placeholder for AI analysis findings
        setAnalysis(`AI Findings for study: ${studyInstanceUid}\n\n- No nodule detected.\n- Lungs clear.\n- Heart size normal.`);
      } catch (error) {
        console.error('Failed to load AI analysis', error);
        setAnalysis('Error loading AI analysis.');
      }
    };

    fetchAnalysis();
  }, [viewportGridService]);

  return (
    <div className="flex flex-col h-full bg-primary-dark p-2 text-white">
      <h3 className="text-lg font-bold mb-2">AI Analysis</h3>
      <div className="flex-1 w-full bg-secondary-dark text-white p-2 border border-secondary-light rounded overflow-auto whitespace-pre-wrap">
        {analysis}
      </div>
      <button className="mt-2 bg-primary-main hover:bg-primary-light text-white font-bold py-2 px-4 rounded">
        Re-run Analysis
      </button>
    </div>
  );
}

AIAnalysisPanel.propTypes = {
  servicesManager: PropTypes.shape({
    services: PropTypes.shape({
      viewportGridService: PropTypes.shape({
        getState: PropTypes.func.isRequired,
      }).isRequired,
    }).isRequired,
  }).isRequired,
  extensionManager: PropTypes.object,
};

export default AIAnalysisPanel;
