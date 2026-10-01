import { useEffect, useRef, useState, useCallback } from 'react';
import ScribeSocketService, { scribeConfig } from '../services/ScribeSocketService';

const extractRoot = lexicalJSONTree => {
  if (!lexicalJSONTree) return null;
  if (lexicalJSONTree.editorState?.root) return lexicalJSONTree.editorState;
  if (lexicalJSONTree.root) return lexicalJSONTree;
  return null;
};

// Transport is deliberately not a piece of state. Two independent sources can
// race to change it (the socket opens while a poll response is already in
// flight), and React batches state updates, so the winner is whichever render
// lands last. A ref is read at the moment of use instead, which is what the
// in-flight guard below needs.
const TRANSPORT = { WEBSOCKET: 'websocket', POLLING: 'polling' };

export const useClinicalScribe = ({
  tenantName,
  visitId,
  department = 'general',
  testType = 'consultation',
  editorInstanceRef,
  onStatusChange = null,
  onLexicalApplied = null,
  onRealtimeTranscript = null,
  onRunningSummaryUpdate = null,
}) => {
  const [reportStatus, setReportStatus] = useState('idle');
  // idle | connecting | connected-ws | fallback-polling | finalizing | finalized | error
  const [liveTranscript, setLiveTranscript] = useState('');
  const [runningSummary, setRunningSummary] = useState('');
  const [transport, setTransport] = useState(null); // 'websocket' | 'polling' | null
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const pollingTimerRef = useRef(null);
  // The doctor-facing session flag. Async callbacks check this before touching
  // state so a response that lands after stop/unmount is dropped instead of
  // resurrecting a poller on a dead panel.
  const activeRef = useRef(false);
  const transportRef = useRef(null);
  const pollAttemptsRef = useRef(0);
  // Bumped every time we hand over between transports. A poll that was in flight
  // when the socket took over captures the epoch it started in and is discarded
  // on arrival, so a stale REST snapshot cannot overwrite fresher WS content.
  const epochRef = useRef(0);
  const finalizedRef = useRef(false);
  const finalizingRef = useRef(false);
  // True only while finalizeConsultation() is awaiting the server's reply. The
  // completed handler consults it so the final AST is applied exactly once.
  const finalizeInFlightRef = useRef(false);
  // Points at the current effect's liveness flag, or null once torn down, so an
  // in-flight finalize can bail out instead of polling a dead panel.
  const mountedRef = useRef(null);

  // Always keep the latest tenantName/visitId in refs so the polling interval
  // and stop/finalize handlers never hit the transcribe API with a stale or
  // empty value (the render that scheduled them may still hold visitId='').
  const tenantNameRef = useRef(tenantName);
  tenantNameRef.current = tenantName;
  const visitIdRef = useRef(visitId);
  visitIdRef.current = visitId;

  const getEditor = useCallback(() => editorInstanceRef?.current || null, [editorInstanceRef]);

  const setStatus = useCallback(
    status => {
      setReportStatus(status);
      onStatusChange?.(status);
    },
    [onStatusChange],
  );

  const setActiveTransport = useCallback(next => {
    transportRef.current = next;
    setTransport(next);
  }, []);

  // Loads a Lexical state tree directly into the editor.
  const updateLexicalEditor = useCallback(
    (lexicalJSONTree, source) => {
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
          console.error(`AI scribe: failed to parse lexical tree from ${source}`, err);
        }
      });
    },
    [getEditor, onLexicalApplied],
  );

  const applyRunningSummary = useCallback(
    summary => {
      if (!summary) return;
      setRunningSummary(summary);
      onRunningSummaryUpdate?.(summary);
    },
    [onRunningSummaryUpdate],
  );

  const appendTranscript = useCallback(
    text => {
      if (!text) return;
      setLiveTranscript(prev => `${prev} ${text}`.trim());
      onRealtimeTranscript?.(text);
    },
    [onRealtimeTranscript],
  );

  // ── Fallback: Cloud Run REST polling ──────────────────────────────
  // This is NOT a degraded feature, it is the safety net that keeps the report
  // filling in when the GPU socket is down. It is only started once the socket
  // is judged unreachable, and stopped the moment the socket is back.
  const stopFallbackPolling = useCallback(() => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }, []);

  const startFallbackPolling = useCallback(() => {
    if (pollingTimerRef.current) {
      return;
    }
    if (!activeRef.current || finalizedRef.current) {
      return;
    }
    const { transcribeBaseUrl, pollIntervalMs } = scribeConfig();
    if (!transcribeBaseUrl) {
      console.warn('[scribe] no scribe.transcribeBaseUrl configured; cannot fall back to polling');
      return;
    }
    console.warn(`[scribe] WebSocket unavailable - falling back to REST polling every ${pollIntervalMs}ms`);
    setActiveTransport(TRANSPORT.POLLING);
    setStatus('fallback-polling');
    pollAttemptsRef.current = 0;

    pollingTimerRef.current = setInterval(async () => {
      const epochAtRequest = epochRef.current;
      const activeTenant = tenantNameRef.current;
      const activeVisit = visitIdRef.current;
      if (!activeRef.current || !activeTenant || !activeVisit) {
        return;
      }
      try {
        const response = await fetch(
          `${transcribeBaseUrl}/get-ai-analysis/${activeTenant}/${activeVisit}`,
          { headers: { 'Content-Type': 'application/json' } },
        );
        const result = await response.json();
        if (!activeRef.current) return;

        // The socket may have taken over while this request was in flight; if so
        // the response is a snapshot of the past and must not be applied.
        if (epochAtRequest !== epochRef.current || transportRef.current === TRANSPORT.WEBSOCKET) {
          console.log('[scribe] discarding stale poll response (transport changed in flight)');
          return;
        }

        pollAttemptsRef.current += 1;
        const data = result?.data;

        if (result?.status === 'success' || result?.status === 'completed') {
          stopFallbackPolling();
          setStatus('finalized');
          finalizedRef.current = true;
          activeRef.current = false;
          ScribeSocketService.disconnect();
          // Same guard as the socket's completed handler: a finalize that is
          // already in flight owns the final AST, so do not push it twice.
          if (!finalizeInFlightRef.current) {
            updateLexicalEditor(data?.lexical, 'poll-final');
          }
        } else if (result?.status === 'in-progress' && data?.lexical) {
          updateLexicalEditor(data.lexical, 'poll');
        } else if (pollAttemptsRef.current >= scribeConfig().maxPollAttempts) {
          stopFallbackPolling();
          setStatus('error');
          activeRef.current = false;
        } else {
          console.log('[scribe] session not ready yet, continuing to poll', result?.status);
        }

        if (data?.running_summary) {
          applyRunningSummary(data.running_summary);
        }
      } catch (error) {
        console.error('[scribe] polling error:', error);
      }
    }, pollIntervalMs);
  }, [setActiveTransport, setStatus, stopFallbackPolling, updateLexicalEditor, applyRunningSummary]);

  // ── Primary: GPU WebSocket ────────────────────────────────────────
  // Registered once and torn down on unmount. Kept out of useCallback deps on
  // purpose: re-subscribing on every identity change of the callbacks below
  // would drop messages that arrive in between.
  useEffect(() => {
    const offState = ScribeSocketService.on('state', ({ state }) => {
      if (state === 'open') {
        if (!activeRef.current || finalizedRef.current) {
          return;
        }
        // Socket recovered: it is the primary path again, so stand the poller
        // down and invalidate any REST request still in flight.
        epochRef.current += 1;
        setActiveTransport(TRANSPORT.WEBSOCKET);
        setStatus('connected-ws');
        stopFallbackPolling();
      } else if (state === 'connecting' && activeRef.current) {
        setStatus('connecting');
      }
    });

    const offUnreachable = ScribeSocketService.on('unreachable', ({ error }) => {
      console.warn('[scribe] WebSocket unreachable, handing over to REST polling:', error?.message || error);
      startFallbackPolling();
    });

    // The socket gave up for good. Nothing to switch - polling is already the
    // active transport and must keep running, so only the status is updated to
    // stop the panel from sitting on a misleading "connecting".
    const offGaveup = ScribeSocketService.on('gaveup', ({ attempts }) => {
      console.warn(`[scribe] giving up on the GPU WebSocket after ${attempts} attempts; staying on REST polling`);
      if (activeRef.current && !finalizedRef.current) {
        setStatus('polling-only');
      }
    });

    // The GPU box rejects the token we sent (JWT). Retrying cannot help, so the
    // socket is dead for this consultation; polling owns the session from here.
    const offAuthfailed = ScribeSocketService.on('authfailed', ({ status, detail }) => {
      console.warn(
        `[scribe] GPU WebSocket auth rejected (HTTP ${status}: ${detail}); report updates continue via REST polling`
      );
      if (activeRef.current && !finalizedRef.current) {
        setStatus('polling-only');
      }
    });

    const offClosed = ScribeSocketService.on('closed', () => {
      if (!activeRef.current || finalizingRef.current || finalizedRef.current) {
        return;
      }
      startFallbackPolling();
    });

    const offTranscript = ScribeSocketService.on('transcript', msg => {
      if (!activeRef.current) return;
      appendTranscript(msg.text);
    });

    const offParallel = ScribeSocketService.on('parallel_summary', msg => {
      if (!activeRef.current) return;
      applyRunningSummary(msg.running_summary);
      if (msg.lexical) {
        updateLexicalEditor(msg.lexical, 'ws');
      }
    });

    const offCompleted = ScribeSocketService.on('completed', msg => {
      if (!activeRef.current && !finalizingRef.current) {
        return;
      }
      stopFallbackPolling();
      setActiveTransport(TRANSPORT.WEBSOCKET);
      setIsFinalizing(false);
      finalizingRef.current = false;
      finalizeInFlightRef.current = false;
      finalizedRef.current = true;
      activeRef.current = false;
      setStatus('finalized');
      // When the doctor pressed stop, finalizeConsultation is already awaiting
      // this very message and applies the AST itself so it can honour
      // applyLexical. Applying here as well would push the state into the
      // editor twice and double every entry in the Lexical undo history.
      if (msg?.data?.lexical && !finalizeInFlightRef.current) {
        updateLexicalEditor(msg.data.lexical, 'ws-final');
      }
    });

    return () => {
      offState();
      offUnreachable();
      offGaveup();
      offAuthfailed();
      offClosed();
      offTranscript();
      offParallel();
      offCompleted();
    };
  }, [
    setActiveTransport,
    setStatus,
    startFallbackPolling,
    stopFallbackPolling,
    appendTranscript,
    applyRunningSummary,
    updateLexicalEditor,
  ]);

  const startScribeSync = useCallback(() => {
    const activeTenant = tenantNameRef.current;
    const activeVisit = visitIdRef.current;
    if (!activeTenant || !activeVisit) {
      console.warn('[scribe] startScribeSync blocked (tenantName/visitId not ready):', {
        tenantName: activeTenant,
        visitId: activeVisit,
      });
      return false;
    }
    if (activeRef.current) {
      return true;
    }

    activeRef.current = true;
    finalizedRef.current = false;
    finalizingRef.current = false;
    epochRef.current += 1;
    setIsRecording(true);
    setStatus('connecting');

    const started = ScribeSocketService.connect({
      tenant: activeTenant,
      visitId: activeVisit,
      department,
      testType,
    });

    if (!started) {
      // Either gpu.enabled is off or gpu.wsUrl is missing. Go straight to
      // polling rather than sitting in "connecting" forever.
      startFallbackPolling();
    }
    return true;
  }, [department, testType, setStatus, startFallbackPolling]);

  const finalizeConsultation = useCallback(
    async ({ applyLexical = true } = {}) => {
      stopFallbackPolling();
      finalizingRef.current = true;
      finalizeInFlightRef.current = true;
      setIsFinalizing(true);
      setStatus('finalizing');

      const activeTenant = tenantNameRef.current;
      const activeVisit = visitIdRef.current;
      if (!activeTenant || !activeVisit) {
        console.warn('[scribe] finalizeConsultation blocked:', {
          tenantName: activeTenant,
          visitId: activeVisit,
        });
        finalizingRef.current = false;
        finalizeInFlightRef.current = false;
        setIsFinalizing(false);
        return null;
      }

      // Primary: ask the GPU box to flush its backlog and finalize the AST.
      if (ScribeSocketService.isOpen()) {
        try {
          const msg = await ScribeSocketService.endMeeting();
          if (applyLexical && msg?.data?.lexical) {
            updateLexicalEditor(msg.data.lexical, 'ws-final');
          }
          return msg;
        } catch (error) {
          // Timed out or dropped mid-flush. The REST endpoint can still finish
          // the job, so fall through rather than leaving the report unfinalized.
          console.warn('[scribe] end_meeting over WebSocket failed, using REST fallback:', error);
          if (!mountedRef.current) {
            // Unmounted (or a new consultation took over) while we waited; the
            // panel that asked for this result is gone.
            return null;
          }
        }
      }

      // Close the session out before applying the AST, so a late frame from a
      // socket that never noticed the consultation ended cannot overwrite the
      // result we just got.
      finalizedRef.current = true;
      activeRef.current = false;
      ScribeSocketService.disconnect();

      // Fallback: Cloud Run end-meeting.
      try {
        const { transcribeBaseUrl } = scribeConfig();
        const response = await fetch(`${transcribeBaseUrl}/${activeTenant}/${activeVisit}/end-meeting`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const result = await response.json();
        if (response.ok && (result?.status === 'success' || result?.status === 'completed')) {
          if (applyLexical && result.data?.lexical) {
            updateLexicalEditor(result.data.lexical, 'rest-final');
          }
          setStatus('finalized');
          return result;
        }
        console.error('[scribe] finalization failed:', result?.message || result);
        setStatus('error');
        return null;
      } catch (error) {
        console.error('[scribe] finalization network error:', error);
        setStatus('error');
        return null;
      } finally {
        finalizingRef.current = false;
        finalizeInFlightRef.current = false;
        setIsFinalizing(false);
      }
    },
    [stopFallbackPolling, setStatus, updateLexicalEditor],
  );

  const stopScribeSync = useCallback(() => {
    activeRef.current = false;
    finalizingRef.current = false;
    finalizeInFlightRef.current = false;
    stopFallbackPolling();
    ScribeSocketService.disconnect();
    setActiveTransport(null);
    setIsRecording(false);
  }, [stopFallbackPolling, setActiveTransport]);

  // Stop on tenant/visit change (new consultation) and on unmount. Clearing
  // activeRef before disconnecting is what stops the socket's onclose from
  // starting a poller that outlives the panel.
  useEffect(() => {
    const mounted = { current: true };
    mountedRef.current = mounted;
    return () => {
      mounted.current = false;
      mountedRef.current = null;
      activeRef.current = false;
      stopFallbackPolling();
      ScribeSocketService.disconnect();
    };
  }, [tenantName, visitId, stopFallbackPolling]);

  return {
    isRecording,
    isFinalizing,
    reportStatus,
    liveTranscript,
    runningSummary,
    transport,
    startScribeSync,
    stopScribeSync,
    finalizeConsultation,
    updateLexicalEditor,
  };
};

export default useClinicalScribe;
