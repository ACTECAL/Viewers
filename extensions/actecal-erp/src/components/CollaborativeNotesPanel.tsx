import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useSystem } from '@ohif/core';

const API_BASE_URL = window.config.apiBaseUrl;
const TENANT = window.config.tenant;

function CollaborativeNotesPanel() {
  const { servicesManager } = useSystem();
  const [notes, setNotes] = useState([]);
  const [inputText, setInputText] = useState('');
  const [studyUid, setStudyUid] = useState(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

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

    return () => subscription.unsubscribe();
  }, [servicesManager, studyUid]);

  const getHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    const userId = localStorage.getItem('actecal_userId');
    const guestToken = sessionStorage.getItem('actecal_guestToken');
    
    if (userId) headers['x-user-id'] = userId;
    if (guestToken) headers['Authorization'] = `Bearer ${guestToken}`;
    
    return headers;
  };

  const fetchNotes = async () => {
    if (!studyUid) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/erp/${TENANT}/dicom/studies/${studyUid}/notes`, {
        credentials: 'include',
        headers: getHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setNotes(data || []);
      }
    } catch (e) {
      console.error("Failed to fetch notes", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();

    // Listen for real-time IoT Core pushes for new notes
    const handleNewNote = (event) => {
      const newNote = event.detail;
      setNotes((prev) => [...prev, newNote]);
    };
    window.addEventListener('ACTECAL_NEW_NOTE', handleNewNote);
    
    return () => window.removeEventListener('ACTECAL_NEW_NOTE', handleNewNote);
  }, [studyUid]);

  useEffect(() => {
    // Scroll to bottom on new note
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [notes]);

  const submitNote = async () => {
    if (!inputText.trim() || !studyUid) return;
    
    const notePayload = { text: inputText };
    setInputText(''); // optimistic clear
    
    try {
      const res = await fetch(`${API_BASE_URL}/erp/${TENANT}/dicom/studies/${studyUid}/notes`, {
        method: 'POST',
        credentials: 'include',
        headers: getHeaders(),
        body: JSON.stringify(notePayload)
      });
      if (res.ok) {
        const savedNote = await res.json();
        // Assume IoT Core will echo it back to us anyway, or append locally
        setNotes((prev) => [...prev, savedNote]);
      }
    } catch (e) {
      console.error("Failed to post note", e);
    }
  };

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
        {!studyUid ? (
          <div className="text-gray-400">Please load a study to view notes.</div>
        ) : loading && notes.length === 0 ? (
          <div className="text-gray-400">Loading notes...</div>
        ) : notes.length === 0 ? (
          <div className="text-gray-400 text-sm">No notes yet. Be the first to start the discussion.</div>
        ) : (
          notes.map((note, idx) => (
            <div key={idx} className="rounded-md bg-secondary-dark p-3">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span className="font-bold text-primary-light">{note.authorName || 'User'}</span>
                <span>{new Date(note.createdAt).toLocaleTimeString()}</span>
              </div>
              <p className="text-sm">{note.text}</p>
            </div>
          ))
        )}
      </div>
      
      {studyUid && (
        <div className="p-3 border-t border-secondary-main">
          <div className="flex gap-2">
            <input 
              type="text" 
              className="flex-1 rounded-md bg-secondary-main p-2 text-white outline-none"
              placeholder="Type a note..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitNote()}
            />
            <button 
              className="rounded-md bg-primary-main px-4 py-2 font-semibold hover:bg-primary-light"
              onClick={submitNote}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

CollaborativeNotesPanel.propTypes = {
  servicesManager: PropTypes.object.isRequired,
};

export default CollaborativeNotesPanel;
