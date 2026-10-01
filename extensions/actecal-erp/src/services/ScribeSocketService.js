// ────────────────────────────────────────────────
// Primary transport for the clinical scribe.
//
// The GPU box is the source of truth: it streams speech tokens, the running
// discussion summary and the finalized Lexical AST over ONE WebSocket. This
// service owns that socket and nothing else - it has no knowledge of the REST
// polling fallback, so useClinicalScribe can fail over in either direction
// without either layer needing to know about the other.
//
// Everything below is instance state, never closure state. The first version of
// this handler read `reportStatus` from the render that created the socket, so
// `onclose` could never observe "finalized" and would happily start a poller on
// an unmounted panel. Handlers read `this.*` instead, which is always current.
//
// window.config is read per call (see the note at the top of ApiService.js) so a
// runtime config swap via loadDynamicConfig is picked up without a reload.
// ────────────────────────────────────────────────

// Reconnect schedule in ms. Capped at 30s: past that, waiting longer than the
// consultation is pointless and the REST fallback is already covering the gap.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

// Websocket frames are binary under the hood, but the server speaks JSON text,
// so ping/pong must be sent as a string or the frame is rejected.
const HEARTBEAT_FRAME = JSON.stringify({ action: 'ping' });

const DEFAULT_END_MEETING_TIMEOUT_MS = 45000;

// Print every attempt while the socket is still plausibly coming back, then go
// quiet to at most one line per this many ms.
const VERBOSE_RECONNECT_ATTEMPTS = 3;
const QUIET_RECONNECT_LOG_MS = 5 * 60 * 1000;

// The attempt URL contains a live bearer token, so it must never reach the
// console verbatim. A wrong host/port is the single most common cause of a
// silent fallback, which is exactly why the redacted URL is logged once.
function redactUrl(url) {
  return String(url).replace(/([?&]token=)[^&]*/i, '$1***');
}

// The GPU box currently accepts tokenless WebSocket connections (verified live:
// it answers a bare URL with `ready` + session + pings, and rejects any JWT it
// did not issue with a 1008 auth_error). So the app deliberately sends no token
// in the handshake; if the box later enforces auth, gate.the GPU URL behind a
// VPN/VPC and re-enable a token in buildUrl() + getGpuConfig().

const getGpuConfig = () => {
  const gpu = (typeof window !== 'undefined' && window.config && window.config.gpu) || {};
  return {
    enabled: gpu.enabled !== false,
    baseUrl: gpu.baseUrl || '',
    wsUrl: gpu.wsUrl || '',
    timeoutMs: gpu.timeoutMs || 60000,
    modality: gpu.modality || 'CT',
  };
};

const getScribeConfig = () => {
  const scribe = (typeof window !== 'undefined' && window.config && window.config.scribe) || {};
  return {
    transcribeBaseUrl: scribe.transcribeBaseUrl || '',
    pollIntervalMs: scribe.pollIntervalMs || 10000,
    maxPollAttempts: scribe.maxPollAttempts || 90,
    socketConnectTimeoutMs: scribe.socketConnectTimeoutMs || 5000,
    // `??` not `||` here: 0 is the documented "no heartbeat" value, and `||`
    // would silently turn it back into 30s and start sending an undocumented
    // {"action":"ping"} the transcribe protocol does not define.
    wsHeartbeatMs: scribe.wsHeartbeatMs ?? 30000,
    // Once the backoff ladder is exhausted, retry at this fixed interval rather
    // than every 30s. A GPU box that is down for a whole consultation should not
    // get hammered, but a box that comes back mid-consultation must still be
    // found, so this throttles instead of giving up.
    reconnectMaxIntervalMs: scribe.reconnectMaxIntervalMs || 120000,
    // 0 = retry forever (the default). Set a positive number to stop after that
    // many attempts; the REST fallback keeps running either way.
    maxReconnectAttempts: scribe.maxReconnectAttempts || 0,
  };
};

export const scribeConfig = getScribeConfig;
export const gpuConfig = getGpuConfig;

class ScribeSocketService {
  constructor() {
    this.ws = null;
    this.state = 'idle'; // idle | connecting | open | closed | error
    this.attempt = 0;
    this.params = null;
    // Distinguishes "the server hung up" (reconnect) from "we asked it to stop"
    // (do not reconnect). Without this, stopScribeSync() would trigger a
    // reconnect that fires the fallback poller on an unmounted component.
    this.shouldReconnect = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.connectTimer = null;
    this.listeners = new Map();
    this.endMeetingWaiters = [];
    // Reset per connect() so each consultation logs its target exactly once.
    this.loggedUrl = null;
    this.lastReconnectLogAt = 0;
    this.problemCount = 0;
    this.lastProblemLogAt = 0;
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    this.listeners.get(event)?.forEach(handler => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[scribe-socket] listener for "${event}" threw`, err);
      }
    });
  }

  isOpen() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  buildUrl() {
    const { wsUrl } = getGpuConfig();
    if (!wsUrl) {
      return null;
    }
    const query = [
      `tenant=${encodeURIComponent(this.params.tenant)}`,
      `visit_id=${encodeURIComponent(this.params.visitId)}`,
      `department=${encodeURIComponent(this.params.department || '')}`,
      `test_type=${encodeURIComponent(this.params.testType || '')}`,
    ].join('&');
    return `${wsUrl}?${query}`;
  }

  // The viewer is currently served over plain HTTP (the bundled Dockerfile
  // runs nginx-unprivileged on :80), which is the only reason a ws:// URL is
  // reachable. If anyone puts TLS in front of the viewer this becomes mixed
  // content and the socket dies silently - say so once, loudly, rather than
  // leaving the doctor wondering why it fell back to polling.
  warnIfMixedContent() {
    if (typeof window === 'undefined' || window.location.protocol !== 'https:') {
      return;
    }
    const { wsUrl } = getGpuConfig();
    if (wsUrl && wsUrl.startsWith('ws://')) {
      console.error(
        `[scribe-socket] Viewer is on HTTPS but gpu.wsUrl is "${wsUrl}". The browser will ` +
          'block this as mixed content, so the WebSocket can never open and transcription ' +
          'will silently fall back to REST polling. Set gpu.wsUrl to a wss:// URL.'
      );
    }
  }

  setState(next, detail) {
    this.state = next;
    this.emit('state', { state: next, attempt: this.attempt, ...detail });
  }

  scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer) {
      return;
    }
    const { reconnectMaxIntervalMs, maxReconnectAttempts } = getScribeConfig();

    if (maxReconnectAttempts > 0 && this.attempt >= maxReconnectAttempts) {
      this.shouldReconnect = false;
      console.error(
        `[scribe-socket] giving up after ${this.attempt} attempts. The report will keep ` +
          'updating via Cloud Run REST polling for the rest of this consultation.'
      );
      this.emit('gaveup', { attempts: this.attempt });
      return;
    }

    // Below the ladder, back off fast (a box that is merely restarting comes
    // back within seconds). Once it is exhausted, settle into a slow, steady
    // retry so a box that is down all consultation is not hit every 30s.
    const ladderExhausted = this.attempt >= BACKOFF_MS.length;
    const delay = ladderExhausted ? reconnectMaxIntervalMs : BACKOFF_MS[this.attempt];
    // Jitter keeps a fleet of viewers from stampeding the GPU box at the same
    // instant after it restarts.
    const wait = Math.round(delay * (0.75 + Math.random() * 0.5));
    this.attempt += 1;
    this.logReconnect(wait, ladderExhausted);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, wait);
  }

  // Without this, a dead GPU box prints an identical ~20-line stack every 30s
  // for the length of the consultation, which buries the one line that
  // actually matters ("handing over to REST polling").
  logReconnect(wait, ladderExhausted) {
    const now = Date.now();
    if (!this.lastReconnectLogAt) {
      this.lastReconnectLogAt = now;
    }
    const verbose = this.attempt <= VERBOSE_RECONNECT_ATTEMPTS;
    const due = now - this.lastReconnectLogAt >= QUIET_RECONNECT_LOG_MS;
    if (verbose || due || ladderExhausted) {
      this.lastReconnectLogAt = now;
      console.warn(
        `[scribe-socket] GPU WebSocket unreachable; retrying in ${Math.round(wait / 1000)}s ` +
          `(attempt ${this.attempt}). Report continues via Cloud Run polling.`
      );
    }
  }

  startHeartbeat() {
    this.clearHeartbeat();
    const { wsHeartbeatMs } = getScribeConfig();
    // Off by default. The transcribe WebSocket protocol only documents
    // {"action":"end_meeting"} going out, and it may reject or close on an
    // action it does not recognise. Set scribe.wsHeartbeatMs to a non-zero value
    // (e.g. 30000) once the GPU box has confirmed it answers a ping.
    if (!wsHeartbeatMs || wsHeartbeatMs <= 0) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      // Browsers cannot detect a half-open TCP connection on their own, so a
      // silent GPU restart would otherwise leave us "connected" and silent
      // forever. If a ping cannot be written, tear the socket down ourselves and
      // let the backoff path take over.
      if (!this.isOpen()) {
        this.clearHeartbeat();
        return;
      }
      try {
        this.ws.send(HEARTBEAT_FRAME);
      } catch (err) {
        console.warn('[scribe-socket] heartbeat send failed, forcing reconnect', err);
        this.clearHeartbeat();
        this.hardClose();
      }
    }, wsHeartbeatMs);
  }

  clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  clearConnectTimer() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  hardClose() {
    this.clearHeartbeat();
    this.clearConnectTimer();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      // Drop the handlers first: we are about to close deliberately, and
      // onclose would otherwise schedule another reconnect.
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch (err) {
        /* already closing */
      }
    }
  }

  connect({ tenant, visitId, department, testType }) {
    if (!tenant || !visitId) {
      console.warn('[scribe-socket] connect blocked: tenant/visitId not ready', {
        tenant,
        visitId,
      });
      return false;
    }
    if (!getGpuConfig().enabled) {
      console.log('[scribe-socket] disabled via gpu.enabled');
      return false;
    }
    if (!getGpuConfig().wsUrl) {
      console.warn('[scribe-socket] gpu.wsUrl is not configured');
      return false;
    }
    if (this.ws || this.reconnectTimer) {
      return true;
    }

    this.params = { tenant, visitId, department, testType };
    this.shouldReconnect = true;
    this.attempt = 0;
    this.loggedUrl = null;
    this.lastReconnectLogAt = 0;
    this.problemCount = 0;
    this.lastProblemLogAt = 0;
    this.open();
    return true;
  }

  open() {
    if (!this.shouldReconnect) {
      return;
    }
    const url = this.buildUrl();
    if (!url) {
      this.shouldReconnect = false;
      return;
    }
    this.warnIfMixedContent();
    this.setState('connecting');

    // Log the real target once per consultation (token redacted). Without this
    // there is no way to tell "GPU box is down" from "we are dialling the wrong
    // host" - both look identical, a bare 5s handshake timeout.
    if (this.loggedUrl !== url) {
      this.loggedUrl = url;
      console.log(`[scribe-socket] connecting to ${redactUrl(url)}`);
    }

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error('[scribe-socket] constructor threw', err);
      this.shouldReconnect = false;
      this.setState('error', { error: err });
      this.emit('unreachable', { error: err });
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.clearConnectTimer();
      this.attempt = 0;
      // A real connection clears the dedupe window, so if the box dies again
      // later in the same consultation the cause is reported immediately
      // instead of staying silent for the rest of the quiet window.
      this.problemCount = 0;
      this.lastProblemLogAt = 0;
      console.log('[scribe-socket] GPU WebSocket open - live transcription active');
      this.setState('open');
      this.startHeartbeat();
    };

    ws.onmessage = event => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        console.warn('[scribe-socket] non-JSON frame ignored', err);
        return;
      }
      // Raw visibility into every frame the GPU box sends (expand the object in
      // the console for the full payload). A live consultation shows
      // transcript -> parallel_summary -> completed here in real time.
      console.log('[scribe-socket] <- frame', msg);
      this.route(msg);
    };

    ws.onerror = err => {
      // The spec fires onclose right after onerror, so reconnect is handled in
      // one place only. Closing here would just race it.
      // Name the target here too: a browser gives no detail on a WebSocket
      // error, so this line is the only clue about *which* host refused us.
      this.logTransportProblem('socket error', err);
    };

    ws.onclose = event => {
      this.clearHeartbeat();
      this.clearConnectTimer();
      this.ws = null;
      this.setState('closed', { code: event?.code, reason: event?.reason });
      if (event?.code && event.code !== 1005 && event.code !== 1006 && event.code !== 1000) {
        this.logTransportProblem(`server closed the socket (code ${event.code})`, null);
      }
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      } else {
        this.emit('stopped', { code: event?.code });
      }
    };

    // Do not hang forever on a host that accepts TCP but never completes the
    // handshake - the REST fallback must take over.
    const { socketConnectTimeoutMs } = getScribeConfig();
    this.connectTimer = setTimeout(() => {
      if (this.ws === ws && ws.readyState !== WebSocket.OPEN) {
        // No onerror and no onclose within the window means the packets are
        // being dropped somewhere (firewall/closed host) rather than refused.
        this.logTransportProblem(
          `no handshake within ${socketConnectTimeoutMs}ms - host is not answering`,
          null
        );
        this.hardClose();
        const error = new Error('handshake timeout');
        this.setState('error', { error });
        this.emit('unreachable', { error });
        // Keep retrying in the background: the REST fallback covers the gap, but
        // the socket must still be allowed to come back mid-consultation.
        this.scheduleReconnect();
      }
    }, socketConnectTimeoutMs);
  }

  // Every transport failure funnels through here so a dead GPU box produces a
  // short, deduped, target-named line instead of a wall of identical stacks.
  logTransportProblem(what, detail) {
    const now = Date.now();
    const due = now - (this.lastProblemLogAt || 0) >= QUIET_RECONNECT_LOG_MS;
    if (this.problemCount > 0 && !due) {
      this.problemCount += 1;
      return;
    }
    this.problemCount = 1;
    this.lastProblemLogAt = now;
    const target = this.loggedUrl ? redactUrl(this.loggedUrl) : 'the configured gpu.wsUrl';
    console.warn(`[scribe-socket] ${what} - target: ${target}`, detail || '');
  }

  route(msg) {
    switch (msg?.type) {
      // Sent by the GPU box once the handshake completes (e.g. "Whisper L4 GPU
      // server ready"). It carries no report data - onopen already fires at the
      // same moment - so acknowledging it is all that is needed.
      case 'ready':
        console.log('[scribe-socket] GPU box ready:', msg?.message || msg?.type);
        break;
      // The GPU box rejects our token as a JWT (e.g. "Not enough segments", or a
      // signature mismatch). Retrying cannot fix a config problem, so this is
      // terminal for the socket: stop, and let the REST fallback own the session.
      case 'auth_error': {
        console.error(
          `[scribe-socket] GPU box rejected our token: HTTP ${msg?.status} "${msg?.detail}". ` +
            'The WebSocket is disabled for this consultation; report updates continue ' +
            'via Cloud Run REST polling.'
        );
        this.shouldReconnect = false;
        this.emit('authfailed', { status: msg?.status, detail: msg?.detail });
        this.hardClose();
        break;
      }
      case 'transcript':
        this.emit('transcript', msg);
        break;
      case 'parallel_summary':
        // Carries both halves of the live report: the running discussion summary
        // for the side panel and the Lexical AST for the editor.
        this.emit('parallel_summary', msg);
        break;
      case 'completed':
        this.resolveEndMeeting(msg);
        this.emit('completed', msg);
        break;
      default:
        // Forward compatible: a new server event must not throw in a
        // consultation and take the doctor down with it.
        console.log('[scribe-socket] unhandled message type', msg?.type);
    }
  }

  resolveEndMeeting(msg) {
    const waiters = this.endMeetingWaiters;
    this.endMeetingWaiters = [];
    waiters.forEach(({ resolve, timeout }) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(msg);
    });
  }

  // Anything still awaiting `completed` will never hear back once the socket is
  // deliberately torn down (unmount, tenant/visit change, poll taking over).
  // Settle those promises now; a hung finalize would strand the panel in
  // "finalizing" forever because its only remaining exit is the REST fallback
  // that a rejected await is what triggers.
  failEndMeetingWaiters(error) {
    const waiters = this.endMeetingWaiters;
    this.endMeetingWaiters = [];
    waiters.forEach(({ reject, timeout }) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });
  }

  send(payload) {
    if (!this.isOpen()) {
      return false;
    }
    try {
      const wire = typeof payload === 'string' ? payload : JSON.stringify(payload);
      // Mirror of the <- frame log above: the full request/response exchange is
      // recoverable from the console for a consultation.
      console.log('[scribe-socket] -> send', payload);
      this.ws.send(wire);
      return true;
    } catch (err) {
      console.error('[scribe-socket] send failed', err);
      return false;
    }
  }

  // Audio streaming frames (the raw webm/Opus chunks the box transcribes) go
  // out as binary WebSocket frames; JSON.stringify would mangle them. The GPU
  // box identifies its messages by frame type, so a browser-supported binary
  // payload (ArrayBuffer / TypedArray / Blob) is passed straight through.
  sendBinary(data) {
    if (!this.isOpen()) {
      return false;
    }
    try {
      this.ws.send(data);
      const bytes = data && typeof data.byteLength === 'number' ? data.byteLength : data?.size || 0;
      console.log(`[scribe-socket] -> frame (${bytes} bytes binary)`);
      return true;
    } catch (err) {
      console.error('[scribe-socket] sendBinary failed', err);
      return false;
    }
  }

  // Resolves with the server's `completed` payload. Rejects on timeout so the
  // caller can fall back to the REST end-meeting endpoint rather than leaving
  // the report stuck on "finalizing".
  endMeeting(timeoutMs = DEFAULT_END_MEETING_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (!this.send({ action: 'end_meeting' })) {
        reject(new Error('socket is not open'));
        return;
      }
      const timeout = setTimeout(() => {
        this.endMeetingWaiters = this.endMeetingWaiters.filter(w => w.timeout !== timeout);
        reject(new Error(`end_meeting timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.endMeetingWaiters.push({ resolve, reject, timeout });
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    this.attempt = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.failEndMeetingWaiters(new Error('socket disconnected before the server replied'));
    this.hardClose();
    this.setState('idle');
  }
}

export default new ScribeSocketService();
