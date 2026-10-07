import { Client } from 'paho-mqtt';

import ApiService from './ApiService';

/**
 * MQTT-over-WebSocket bridge to AWS IoT Core.
 *
 * The browser never holds AWS credentials: erp-api issues a SigV4 presigned
 * URL (GET /dicom/iot-url) and paho connects with it via connect({ uris }).
 * The signature expires after `expiresIn` seconds, so every (re)open fetches
 * a fresh URL instead of reusing a stale one.
 *
 * connect()/disconnect() are ref-counted: index.js joins a study's topic for
 * the whole session while ActiveUsersPanel connects/disconnects as it
 * mounts, and neither may tear down the other's connection.
 *
 * Topic shape matches erp-api's publisher: erp/study/<StudyInstanceUID>/updates
 */

const TOPIC_PREFIX = 'erp/study/';
const TOPIC_SUFFIX = '/updates';
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;
const CONNECT_TIMEOUT_S = 15;

const topicForStudy = studyUid => `${TOPIC_PREFIX}${studyUid}${TOPIC_SUFFIX}`;

// Client IDs must be unique per connection: two tabs sharing one ID would
// make AWS IoT kick the older connection, i.e. exactly when a second doctor
// opens the study. Prefixed with the thing name for policy friendliness.
const makeClientId = () =>
  `erp_iot_service-${Math.random()
    .toString(36)
    .slice(2, 10)}-${Date.now().toString(36)}`;

class IoTService {
  constructor() {
    this.client = null;
    this.clientId = makeClientId();
    this.studies = new Set();
    this.subscribed = new Set();
    this.refCount = 0;
    this.stopped = true;
    this.opening = false;
    this.retryTimer = null;
    this.retryAttempt = 0;
  }

  async connect(studyInstanceUid) {
    this.stopped = false;
    this.refCount += 1;

    const hadStudy = studyInstanceUid ? this.studies.has(studyInstanceUid) : true;
    if (studyInstanceUid) {
      this.studies.add(studyInstanceUid);
    }

    if (this.client?.isConnected()) {
      if (!hadStudy) {
        this.subscribePending();
      }
      return;
    }

    if (this.opening) {
      // An open is already in flight; the new study is in `this.studies` and
      // will be subscribed by subscribePending() once it succeeds.
      return;
    }

    await this.open();
  }

  disconnect() {
    this.refCount = Math.max(0, this.refCount - 1);

    if (this.refCount > 0) {
      return;
    }

    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.studies.clear();
    this.subscribed.clear();

    if (this.client) {
      try {
        this.client.disconnect();
      } catch (err) {
        // Already gone - nothing to do.
      }
      this.client = null;
    }
  }

  async open() {
    this.opening = true;

    let url;
    try {
      ({ url } = await new ApiService().getIotUrl());
    } catch (err) {
      this.opening = false;
      console.warn('[mqtt] failed to fetch presigned URL:', err?.message || err);
      this.scheduleRetry();
      return;
    }

    if (this.stopped) {
      this.opening = false;
      return;
    }

    try {
      const host = new URL(url).hostname;
      const client = new Client(host, 443, '/mqtt', this.clientId);

      client.onMessageArrived = message => this.onMessage(message);
      client.onConnectionLost = resp => this.onConnectionLost(resp);

      this.client = client;

      client.connect({
        useSSL: true,
        // The presigned https:// URL is rewritten to wss:// by paho; the
        // X-Amz-* query string travels along untouched.
        uris: [url],
        timeout: CONNECT_TIMEOUT_S,
        onSuccess: () => {
          this.opening = false;
          this.retryAttempt = 0;
          this.subscribePending();
        },
        onFailure: err => {
          this.opening = false;
          console.warn('[mqtt] connect failed:', err?.errorMessage || err);
          this.scheduleRetry();
        },
      });
    } catch (err) {
      this.opening = false;
      console.warn('[mqtt] connect error:', err?.message || err);
      this.scheduleRetry();
    }
  }

  scheduleRetry() {
    if (this.stopped || this.retryTimer) {
      return;
    }

    const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** this.retryAttempt);
    this.retryAttempt += 1;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) {
        this.open();
      }
    }, delay);
  }

  onConnectionLost(resp) {
    if (this.stopped || !resp || resp.errorCode === 0) {
      return;
    }

    console.warn('[mqtt] connection lost:', resp.errorMessage);
    this.subscribed.clear();
    this.scheduleRetry();
  }

  subscribePending() {
    if (!this.client?.isConnected()) {
      return;
    }

    this.studies.forEach(studyUid => {
      if (this.subscribed.has(studyUid)) {
        return;
      }

      this.client.subscribe(topicForStudy(studyUid), {
        qos: 1,
        onSuccess: () => {
          this.subscribed.add(studyUid);
        },
        onFailure: err => {
          console.warn('[mqtt] subscribe failed for', studyUid, err?.errorMessage || err);
        },
      });
    });
  }

  onMessage(message) {
    try {
      const payload = JSON.parse(message.payloadString);

      if (!payload || typeof payload !== 'object') {
        return;
      }

      // Topic is the authority for the study when the payload omits it
      // (legacy DELETE payloads only carried an annotationUid).
      const topicStudy = (message.destinationName || '').split('/')[2] || null;

      window.dispatchEvent(
        new CustomEvent('actecal:externalMeasurement', {
          detail: {
            ...payload,
            studyInstanceUid: payload.studyInstanceUid || topicStudy,
          },
        })
      );
    } catch (err) {
      console.warn('[mqtt] ignoring malformed message:', err);
    }
  }
}

export default new IoTService();
