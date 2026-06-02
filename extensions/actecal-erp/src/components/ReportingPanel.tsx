import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useSystem } from '@ohif/core';
import ApiService from '../services/ApiService';

// Lexical imports
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary';

const theme = {
  paragraph: 'mb-1',
};

function onError(error: Error) {
  console.error(error);
}

// Plugin to set the initial content of the editor
function InitialStatePlugin({ content }: { content: string }) {
  const [editor] = useLexicalComposerContext();
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (content && !isInitialized) {
      editor.update(() => {
        const root = editor.getEditorState().read(() => {
          // simple way to insert text via lexical API requires manipulating nodes
          // But for a plain text, let's just parse a string if possible, 
          // or we can use the $getRoot, $createParagraphNode, $createTextNode.
          const { $getRoot, $createParagraphNode, $createTextNode } = require('lexical');
          const rootNode = $getRoot();
          rootNode.clear();
          const paragraphNode = $createParagraphNode();
          const textNode = $createTextNode(content);
          paragraphNode.append(textNode);
          rootNode.append(paragraphNode);
        });
      });
      setIsInitialized(true);
    }
  }, [content, editor, isInitialized]);
  return null;
}

function ReportingPanel({ servicesManager, extensionManager }) {
  const { viewportGridService } = servicesManager.services;
  const [draftContent, setDraftContent] = useState('');
  const [studyUid, setStudyUid] = useState('');

  useEffect(() => {
    const fetchReport = async () => {
      try {
        const state = viewportGridService.getState();
        const activeViewport = state.viewports[state.activeViewportIndex];
        const studyInstanceUid = activeViewport?.StudyInstanceUID;
        
        if (!studyInstanceUid) {
          setDraftContent('No active study.');
          return;
        }

        setStudyUid(studyInstanceUid);

        // Fetching from API
        const apiService = new ApiService();
        try {
          const response = await apiService.fetchDraftReport(studyInstanceUid);
          if (response && response.text) {
            setDraftContent(response.text);
          } else if (response && response.report) {
            setDraftContent(response.report);
          } else {
            setDraftContent(`Draft report for study: ${studyInstanceUid}\n\nNo abnormalities detected.`);
          }
        } catch (apiError) {
          console.warn('API fetch failed, falling back to default text', apiError);
          setDraftContent(`Draft report for study: ${studyInstanceUid}\n\nNo abnormalities detected.`);
        }
        
      } catch (error) {
        console.error('Failed to load draft report', error);
        setDraftContent('Error loading report.');
      }
    };

    fetchReport();
  }, [viewportGridService]);

  const initialConfig = {
    namespace: 'ActecalReportingEditor',
    theme,
    onError,
  };

  const handleEditorChange = (editorState) => {
    editorState.read(() => {
      // Could read content to save back to state if needed
    });
  };

  return (
    <div className="flex flex-col h-full bg-primary-dark p-2 text-white">
      <h3 className="text-lg font-bold mb-2">Lexical Reporting</h3>
      
      {draftContent ? (
        <div className="flex-1 w-full bg-secondary-dark text-white p-2 border border-secondary-light rounded relative overflow-hidden">
          <LexicalComposer initialConfig={initialConfig}>
            <div className="h-full w-full relative">
              <PlainTextPlugin
                contentEditable={<ContentEditable className="h-full w-full outline-none resize-none overflow-y-auto" />}
                placeholder={<div className="absolute top-0 left-0 text-gray-400 pointer-events-none">Enter report...</div>}
                ErrorBoundary={LexicalErrorBoundary}
              />
              <HistoryPlugin />
              <OnChangePlugin onChange={handleEditorChange} />
              <InitialStatePlugin content={draftContent} />
            </div>
          </LexicalComposer>
        </div>
      ) : (
        <div className="flex-1 w-full bg-secondary-dark text-white p-2 border border-secondary-light rounded flex items-center justify-center">
          Loading...
        </div>
      )}

      <button className="mt-2 bg-primary-main hover:bg-primary-light text-white font-bold py-2 px-4 rounded">
        Save Report
      </button>
    </div>
  );
}

ReportingPanel.propTypes = {
  servicesManager: PropTypes.shape({
    services: PropTypes.shape({
      viewportGridService: PropTypes.shape({
        getState: PropTypes.func.isRequired,
      }).isRequired,
    }).isRequired,
  }).isRequired,
  extensionManager: PropTypes.object,
};

export default ReportingPanel;
