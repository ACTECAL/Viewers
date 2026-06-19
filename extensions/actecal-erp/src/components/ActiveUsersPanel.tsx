import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import IoTService from '../services/IoTService';
import { useSystem } from '@ohif/core';

function ActiveUsersPanel() {
  const { servicesManager } = useSystem();
  const [activeUsers, setActiveUsers] = useState([]);
  const [studyUid, setStudyUid] = useState(null);

  useEffect(() => {
    const { viewportGridService } = servicesManager.services;
    const subscription = viewportGridService.subscribe(
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      () => {
        const state = viewportGridService.getState();
        const activeViewport = state.viewports[state.activeViewportIndex];
        const currentUid = activeViewport?.StudyInstanceUID;
        
        if (currentUid && currentUid !== studyUid) {
          setStudyUid(currentUid);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [servicesManager, studyUid]);

  useEffect(() => {
    if (!studyUid) return;

    // Connect to IoT Core to join this specific study's "room"
    IoTService.connect(studyUid);

    // Subscribe to presence updates
    const handlePresenceUpdate = (event) => {
      setActiveUsers(event.detail.users || []);
    };

    window.addEventListener('ACTECAL_PRESENCE_UPDATE', handlePresenceUpdate);

    return () => {
      window.removeEventListener('ACTECAL_PRESENCE_UPDATE', handlePresenceUpdate);
      IoTService.disconnect(); // Disconnect when component unmounts
    };
  }, [studyUid]);

  return (
    <div className="flex h-full flex-col bg-black text-white p-4">
      <h3 className="mb-4 text-lg font-bold text-primary-light">Active Participants</h3>
      
      {!studyUid ? (
        <div className="text-gray-400">Please load a study to view participants.</div>
      ) : activeUsers.length === 0 ? (
        <div className="text-gray-400 text-sm">You are the only person currently viewing this study.</div>
      ) : (
        <ul className="space-y-2">
          {activeUsers.map((user, index) => (
            <li key={index} className="flex items-center space-x-2 rounded-md bg-secondary-dark p-2">
              <div className="h-2 w-2 rounded-full bg-green-500"></div>
              <span>{user.name || user.id || 'Guest User'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

ActiveUsersPanel.propTypes = {
  servicesManager: PropTypes.object.isRequired,
};

export default ActiveUsersPanel;
