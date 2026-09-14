import { useEffect, useRef, useState, useCallback } from 'react';

// Cloud Run transcribe service that hosts AI-generated clinical reports.
const API_BASE =
  'https://transcribe-service-381629948277.asia-southeast1.run.app';
const POLL_INTERVAL = 10000;
const MAX_POLL_ATTEMPTS = 90; // 90 * 10s = 15 min safety cap so we never poll forever.

const extractRoot = (lexicalJSONTree) => {
  if (!lexicalJSONTree) return null;
  if (lexicalJSONTree.editorState?.root) return lexicalJSONTree.editorState;
  if (lexicalJSONTree.root) return lexicalJSONTree;
  return null;
};

export const useClinicalScribe = ({
  tenantName,
  visitId,
  editorInstanceRef,
  onStatusChange,
  onLexicalApplied,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [reportStatus, setReportStatus] = useState('idle'); // idle | in-progress | finalizing | finalized | error
  const pollingTimerRef = useRef(null);
  const activeRef = useRef(false);
  const pollAttemptsRef = useRef(0);

  // Always keep the latest tenantName/visitId in refs so the polling interval
  // and stop/finalize handlers never hit the transcribe API with a stale or
  // empty value (the render that scheduled them may still hold visitId='').
  const tenantNameRef = useRef(tenantName);
  tenantNameRef.current = tenantName;
  const visitIdRef = useRef(visitId);
  visitIdRef.current = visitId;

  const getEditor = useCallback(
    () => editorInstanceRef?.current || null,
    [editorInstanceRef],
  );

  const setStatus = useCallback(
    (status) => {
      setReportStatus(status);
      onStatusChange?.(status);
    },
    [onStatusChange],
  );

  // Loads a Lexical state tree directly into the editor.
  const updateLexicalEditor = useCallback(
    (lexicalJSONTree) => {
      const editor = getEditor();
      const stateRoot = extractRoot(lexicalJSONTree);
      if (!editor || !stateRoot) return;
      const serialized = JSON.stringify(stateRoot);
      editor.update(() => {
        try {
          const editorState = editor.parseEditorState(serialized);
          editor.setEditorState(editorState);
          onLexicalApplied?.(serialized);
        } catch (err) {
          console.error('AI scribe: failed to parse lexical tree', err);
        }
      });
    },
    [getEditor, onLexicalApplied],
  );

  const stopPolling = useCallback(() => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    activeRef.current = false;
    setIsRecording(false);
  }, []);

  const pollForReport = useCallback(async () => {
    // Read from refs so the setInterval callback always uses the current
    // tenant/visit even if the closure captured an earlier (empty) value.
    const activeTenant = tenantNameRef.current;
    const activeVisit = visitIdRef.current;
    if (!activeRef.current || !activeTenant || !activeVisit) {
      console.warn('[scribe] pollForReport blocked:', { active: activeRef.current, tenantName: activeTenant, visitId: activeVisit });
      return;
    }
    try {
      const response = await fetch(
        `${API_BASE}/get-ai-analysis/${activeTenant}/${activeVisit}`,
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
      const result = await response.json();
      if (!activeRef.current) return;

      pollAttemptsRef.current += 1;

      if (result.status === 'success' || result.status === 'completed') {
        stopPolling();
        setStatus('finalized');
        updateLexicalEditor(result.data?.lexical);
      } else if (result.status === 'in-progress' && result.data?.lexical) {
        updateLexicalEditor(result.data.lexical);
      } else if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
        // Session never became ready after the cap - stop so we don't poll
        // forever against an invalid/missing session.
        stopPolling();
        setStatus('error');
      } else {
        // Unknown/not-ready status (session warming up, session not found yet,
        // etc.) - keep polling; the AI transcript may just be starting.
        console.log(
          'AI scribe: session not ready yet, continuing to poll',
          result.status,
        );
      }
    } catch (error) {
      console.error('AI scribe polling error:', error);
    }
  }, [stopPolling, setStatus, updateLexicalEditor]);

  // Starts the polling sequence (call when the AI transcription begins).
const startScribeSync = useCallback(() => {
    const activeTenant = tenantNameRef.current;
    const activeVisit = visitIdRef.current;
    if (!activeTenant || !activeVisit) {
      console.warn('[scribe] startScribeSync blocked (tenantName/visitId not ready):', { tenantName: activeTenant, visitId: activeVisit });
      return false;
    }
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    pollAttemptsRef.current = 0;
    activeRef.current = true;
    setIsRecording(true);
    setStatus('in-progress');
    pollForReport();
    pollingTimerRef.current = setInterval(pollForReport, POLL_INTERVAL);
    return true;
}, [pollForReport, setStatus]);

  // Called when the doctor ends the consultation / finalizes the report.
  const finalizeConsultation = useCallback(
    async ({ applyLexical = true } = {}) => {
      stopPolling();
      const activeTenant = tenantNameRef.current;
      const activeVisit = visitIdRef.current;
      if (!activeTenant || !activeVisit) {
        console.warn('[scribe] finalizeConsultation blocked:', { tenantName: activeTenant, visitId: activeVisit });
        return null;
      }

      setIsFinalizing(true);
      setStatus('finalizing');

      try {
        const response = await fetch(
          `${API_BASE}/${activeTenant}/${activeVisit}/end-meeting`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
        );
        const result = await response.json();

        if (response.ok && result.status === 'success') {
          setStatus('finalized');
          if (applyLexical) {
            updateLexicalEditor(result.data?.lexical);
          }
          return result;
        }
        console.error('AI scribe finalization failed:', result.message);
        setStatus('error');
        return null;
      } catch (error) {
        console.error('AI scribe finalization network error:', error);
        setStatus('error');
        return null;
      } finally {
        setIsFinalizing(false);
      }
    },
    [stopPolling, setStatus, updateLexicalEditor],
  );

  // Stop polling when the context keys change (new visit/meeting).
  useEffect(() => {
    stopPolling();
  }, [tenantName, visitId, stopPolling]);

  // Clean up timers on unmount.
  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, []);

  return {
    isRecording,
    isFinalizing,
    reportStatus,
    startScribeSync,
    stopPolling,
    finalizeConsultation,
    updateLexicalEditor,
  };
};

export default useClinicalScribe;