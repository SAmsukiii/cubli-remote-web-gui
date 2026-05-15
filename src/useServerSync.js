import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeLivePacket } from './telemetryNormalize';

const CLIENT_ID_KEY = 'cubliClientId';
const DISPLAY_NAME_KEY = 'cubliDisplayName';
const SERVER_URL_KEY = 'cubliServerUrl';
const FALLBACK_SERVER_URL = 'http://localhost:5050';
const SERVER_PORT_CANDIDATES = ['5050', '5058', '5051', '5052', '5053', '5055'];
const MAX_SAMPLE_QUEUE = 1200;
const MAX_EVENT_QUEUE = 300;
const DEFAULT_UPLOAD_RATE_HZ = 1;
const MAX_BATCH_SAMPLES = 50;
const MAX_BATCH_EVENTS = 30;
const DEFAULT_SERVER_URL = getDefaultServerUrl();
const LIVE_PUBLISH_PATH = '/api/live/publish';
const LIVE_PUBLISH_FAST_PATH = '/api/live/publish-fast';
const LIVE_PUBLISH_404_MESSAGE = 'HTTP 404: /api/live/publish endpoint not found. Check that npm run server is running and server/index.js includes POST /api/live/publish.';
const LIVE_PUBLISH_404_BACKOFF_MS = 5000;
const LIVE_PUBLISH_MIN_INTERVAL_MS = 10;
const API_SERVER_VERIFY_TTL_MS = 15000;
const LIVE_LATEST_POLL_INTERVAL_MS = 50; // fallback only; skipped while SSE live stream is connected
const ACCESS_STATE_POLL_INTERVAL_MS = 500;
const SERVER_SERIAL_STATUS_POLL_INTERVAL_MS = 200;

function makeClientId() {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `client-${random}`;
}

function getStoredClientId() {
  if (typeof window === 'undefined') return makeClientId();
  const existing = getLocalStorageValue(CLIENT_ID_KEY);
  if (existing) return existing;
  const next = makeClientId();
  setLocalStorageValue(CLIENT_ID_KEY, next);
  return next;
}

function replaceDisplayNameControlChars(value) {
  return Array.from(String(value || '')).map((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : char;
  }).join('');
}

function sanitizeDisplayName(value) {
  return replaceDisplayNameControlChars(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

function encodeClientName(value) {
  return encodeURIComponent(sanitizeDisplayName(value));
}

function asciiClientNameFallback(value) {
  return sanitizeDisplayName(value)
    .replace(/[^\x20-\x7E]/g, '')
    .slice(0, 30);
}

function getCurrentPageHeaderValue() {
  if (typeof window === 'undefined') return '/';
  const path = window.location.pathname || '/';
  return encodeURI(path).replace(/[^\x20-\x7E]/g, '');
}

function makeClientHeaders(clientId, displayName, extraHeaders = {}) {
  return {
    ...extraHeaders,
    'X-Cubli-Client-Id': String(clientId || ''),
    'X-Cubli-Client-Name-Encoded': encodeClientName(displayName),
    'X-Cubli-Client-Name': asciiClientNameFallback(displayName),
    'X-Cubli-Page': getCurrentPageHeaderValue(),
  };
}

function getStoredDisplayName() {
  if (typeof window === 'undefined') return '';
  return sanitizeDisplayName(getLocalStorageValue(DISPLAY_NAME_KEY));
}

function makeSuggestedDisplayName(role = 'Viewer', clientId = '') {
  const prefix = String(role || 'Viewer').toLowerCase() === 'admin' ? 'Admin' : 'Viewer';
  const suffix = String(clientId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-4)
    .toUpperCase() || Math.random().toString(36).slice(2, 6).toUpperCase();
  return sanitizeDisplayName(`${prefix}-${suffix}`);
}

function addClientIdentityToJsonBody(body, clientId, displayName) {
  if (!body || typeof body !== 'string') return body;
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return body;
    return JSON.stringify({
      ...parsed,
      clientId: parsed.clientId || clientId,
      clientName: parsed.clientName || displayName,
      displayName: parsed.displayName || displayName,
    });
  } catch (_) {
    return body;
  }
}

function cleanServerUrl(url) {
  return String(url || FALLBACK_SERVER_URL).trim().replace(/\/+$/, '');
}

function getLocalStorageValue(key, fallback = '') {
  if (typeof window === 'undefined') return fallback;
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch (_) {
    return fallback;
  }
}

function setLocalStorageValue(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(value || ''));
  } catch (_) {
    // Ignore blocked storage; the app can continue with in-memory state.
  }
}

function isLocalHostName(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '[::1]' || value === '::1';
}

function isHostedOrigin(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'onrender.com' || value.endsWith('.onrender.com')
    || value === 'trycloudflare.com' || value.endsWith('.trycloudflare.com')
    || value === 'netlify.app' || value.endsWith('.netlify.app');
}

function hasBadHostedPort(url) {
  return /onrender\.com:\d+|trycloudflare\.com:\d+|netlify\.app:\d+/i.test(String(url || ''));
}

function isKnownServerPort(port) {
  return SERVER_PORT_CANDIDATES.includes(String(port || ''));
}

function parseServerUrl(url) {
  if (typeof window === 'undefined') return null;
  try {
    return new URL(cleanServerUrl(url), window.location.href);
  } catch (_) {
    return null;
  }
}

function urlTargetsLocalHost(url) {
  const raw = String(url || '').trim().toLowerCase();
  if (/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(raw)) return true;
  const parsed = parseServerUrl(url);
  return parsed ? isLocalHostName(parsed.hostname) : false;
}

function getLocationDefaultServerUrl() {
  if (typeof window === 'undefined') return FALLBACK_SERVER_URL;

  const { protocol, hostname, origin } = window.location;

  if (isHostedOrigin(hostname)) return origin;
  if (isLocalHostName(hostname)) return FALLBACK_SERVER_URL;
  if (protocol === 'https:') return origin;
  return `http://${hostname || 'localhost'}:5050`;
}

function shouldIgnoreServerUrlForCurrentLocation(url) {
  if (typeof window === 'undefined') return false;

  const cleaned = cleanServerUrl(url);
  const { protocol, hostname, origin } = window.location;
  const pageIsLocal = isLocalHostName(hostname);
  const parsed = parseServerUrl(cleaned);

  if (isHostedOrigin(hostname)) {
    return cleaned !== origin;
  }

  if (isLikelyFrontendDevUrl(cleaned)) return true;

  if (protocol === 'https:' && !pageIsLocal) {
    if (urlTargetsLocalHost(cleaned) || hasBadHostedPort(cleaned)) return true;
    if (!parsed) return false;
    if (parsed.hostname === hostname && parsed.port) return true;
    return isKnownServerPort(parsed.port);
  }

  return false;
}

function normalizeServerUrlForCurrentLocation(url) {
  const cleaned = cleanServerUrl(url);
  if (typeof window === 'undefined') return cleaned;
  return shouldIgnoreServerUrlForCurrentLocation(cleaned)
    ? getLocationDefaultServerUrl()
    : cleaned;
}

function persistServerUrl(url) {
  setLocalStorageValue(SERVER_URL_KEY, cleanServerUrl(url));
}

function isFrontendDevPort(port) {
  const number = Number(port);
  if (!Number.isFinite(number)) return false;
  // React dev server commonly uses 3000 and automatically moves to 3001, 3002...
  // Vite/preview ports are included as a guard for future builds.
  return (number >= 3000 && number <= 3999) || number === 5173 || number === 4173;
}

function isLikelyFrontendDevUrl(url) {
  if (typeof window === 'undefined') return false;
  try {
    const parsed = new URL(cleanServerUrl(url), window.location.href);
    return isFrontendDevPort(parsed.port);
  } catch (_) {
    return false;
  }
}

function getDefaultServerUrl() {
  if (typeof window === 'undefined') return FALLBACK_SERVER_URL;

  const defaultUrl = getLocationDefaultServerUrl();
  const stored = getLocalStorageValue(SERVER_URL_KEY);
  if (!stored) return defaultUrl;

  const cleaned = cleanServerUrl(stored);
  if (shouldIgnoreServerUrlForCurrentLocation(cleaned)) {
    persistServerUrl(defaultUrl);
    return defaultUrl;
  }
  return cleaned;
}

function uniqueCleanUrls(urls) {
  const seen = new Set();
  return urls
    .map((url) => cleanServerUrl(url))
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

function makeServerUrlCandidates(preferredUrl) {
  if (typeof window === 'undefined') return uniqueCleanUrls([preferredUrl, FALLBACK_SERVER_URL]);

  const host = window.location.hostname || 'localhost';
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const origin = window.location.origin;
  const candidates = [origin, preferredUrl, DEFAULT_SERVER_URL];

  if (isHostedOrigin(host)) return uniqueCleanUrls([origin]);

  if (window.location.protocol === 'https:' && !isLocalHostName(host)) {
    return uniqueCleanUrls(candidates.filter((candidate) => !shouldIgnoreServerUrlForCurrentLocation(candidate)));
  }

  SERVER_PORT_CANDIDATES.forEach((port) => {
    if (isLocalHostName(host)) {
      candidates.push(`http://localhost:${port}`);
      candidates.push(`http://127.0.0.1:${port}`);
    } else {
      candidates.push(`${protocol}//${host}:${port}`);
    }
  });

  return uniqueCleanUrls(candidates);
}

async function probeCubliServer(baseUrl, clientId = '', displayName = '') {
  const cleanedUrl = cleanServerUrl(baseUrl);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), 1200) : null;
  const headers = {
    ...makeClientHeaders(clientId, displayName),
    'Accept': 'application/json',
  };

  try {
    const healthResponse = await fetch(`${cleanedUrl}/api/health`, {
      method: 'GET',
      cache: 'no-store',
      headers,
      signal: controller?.signal,
    });
    if (!healthResponse.ok) return null;
    const healthContentType = healthResponse.headers.get('content-type') || '';
    if (!healthContentType.includes('application/json')) return null;
    const health = await healthResponse.json();
    if (!health?.ok || !(health.service === 'cubli-server-sync' || health.serverInfo || health.serial)) {
      return null;
    }

    // Important: /api/health alone is not enough. An old Cubli server can
    // answer health but still not include the live bridge routes, causing
    // POST /api/live/publish to return 404 forever. Accept only servers that
    // also expose /api/live/latest.
    const liveResponse = await fetch(`${cleanedUrl}/api/live/latest`, {
      method: 'GET',
      cache: 'no-store',
      headers,
      signal: controller?.signal,
    });
    if (!liveResponse.ok) return null;
    const liveContentType = liveResponse.headers.get('content-type') || '';
    if (!liveContentType.includes('application/json')) return null;
    const live = await liveResponse.json();
    if (!live?.ok) return null;

    return { ...health, liveProbe: live, bridgeApiVerified: true };
  } catch (_) {
    return null;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

function legacyCommandToKey(command) {
  const raw = String(command || '').trim();
  const upper = raw.toUpperCase();
  const exact = {
    'TARE': 'tare',
    'STOP': 'stop',
    'STATUS?': 'status',
    'MAC?': 'macInfo',
    'EBIMU_DEFAULT': 'ebimuDefault',
    'EBIMU_START': 'ebimuStart',
    'EBIMU_STOP': 'ebimuStop',
    'MAG_OFF': 'magOff',
    'MAG_ON': 'magOn',
    'MAG_AUTO': 'magAuto',
    'GYRO_250': 'gyro250',
    'GYRO_500': 'gyro500',
    'GYRO_1000': 'gyro1000',
    'GYRO_2000': 'gyro2000',
    'ACC_2G': 'acc2g',
    'ACC_4G': 'acc4g',
    'ACC_8G': 'acc8g',
    'ACC_16G': 'acc16g',
  };
  if (exact[upper]) return { commandKey: exact[upper], params: {} };
  const accFactor = upper.match(/^ACCF,\s*([-+0-9.]+)$/);
  if (accFactor) return { commandKey: 'accFactor', params: { factor: Number(accFactor[1]) } };
  return { commandKey: '', params: {} };
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function firstFinite(values, fallback = null) {
  for (const value of values) {
    const number = finiteNumber(value, null);
    if (number !== null) return number;
  }
  return fallback;
}

function normalizeGainValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number < 0 || number > 10) return null;
  return number;
}

function normalizeGainTriplet(values = {}, names = ['x', 'y', 'z']) {
  const [a, b, c] = names.map((name) => normalizeGainValue(values[name]));
  if (a === null || b === null || c === null) return null;
  return { [names[0]]: a, [names[1]]: b, [names[2]]: c };
}

function normalizeSource(source) {
  const text = String(source || '').toLowerCase();
  if (text === 'server-serial' || text.includes('server')) return 'server-serial';
  if (text === 'admin-web-serial' || text === 'legacy-web-serial' || text.includes('web-serial') || text === 'serial') return 'admin-web-serial';
  if (text.includes('ble')) return 'ble';
  if (text.includes('phone')) return 'phone';
  return source || 'unknown';
}

function packetToCommonSample(packet, fallbackSource = 'unknown', stats = {}) {
  const src = packet || {};
  const q = Array.isArray(src.q) && src.q.length === 4
    ? src.q
    : [src.q0, src.q1, src.q2, src.q3];

  const q0 = finiteNumber(q[0], finiteNumber(src.q0, 1));
  const q1 = finiteNumber(q[1], finiteNumber(src.q1, 0));
  const q2 = finiteNumber(q[2], finiteNumber(src.q2, 0));
  const q3 = finiteNumber(q[3], finiteNumber(src.q3, 0));

  return {
    pcTimeMs: firstFinite([src.pcTimeMs, src.pc_time_ms, src.updatedAt], Date.now()),
    source: normalizeSource(src.source || fallbackSource),
    q0,
    q1,
    q2,
    q3,
    rollDeg: firstFinite([src.rollDeg, src.roll_deg, src.roll], 0),
    pitchDeg: firstFinite([src.pitchDeg, src.pitch_deg, src.pitch], 0),
    yawDeg: firstFinite([src.yawDeg, src.yaw_deg, src.yaw], 0),
    encoderXDeg: firstFinite([src.encoderXDeg, src.enc_x_deg, src.encoder?.x], null),
    encoderYDeg: firstFinite([src.encoderYDeg, src.enc_y_deg, src.encoder?.y], null),
    encoderZDeg: firstFinite([src.encoderZDeg, src.enc_z_deg, src.encoder?.z], null),
    encoderQ0: firstFinite([src.encoderQ0, src.enc_q0, src.encoder?.q0], null),
    encoderQ1: firstFinite([src.encoderQ1, src.enc_q1, src.encoder?.q1], null),
    encoderQ2: firstFinite([src.encoderQ2, src.enc_q2, src.encoder?.q2], null),
    encoderQ3: firstFinite([src.encoderQ3, src.enc_q3, src.encoder?.q3], null),
    qerr_deg: firstFinite([src.qerr_deg, src.qerrDeg, src.qerrTelemetryDeg], null),
    qerrDeg: firstFinite([src.qerrDeg, src.qerr_deg, src.qerrTelemetryDeg], null),
    qerrSource: src.qerrSource || '',
    wx: firstFinite([src.wx, src.wxTelemetry], null),
    wy: firstFinite([src.wy, src.wyTelemetry], null),
    wz: firstFinite([src.wz, src.wzTelemetry], null),
    angularRateSource: src.angularRateSource || '',
    RPM1: firstFinite([src.RPM1], null),
    RPM2: firstFinite([src.RPM2], null),
    RPM3: firstFinite([src.RPM3], null),
    RPMcmd1: firstFinite([src.RPMcmd1], null),
    RPMcmd2: firstFinite([src.RPMcmd2], null),
    RPMcmd3: firstFinite([src.RPMcmd3], null),
    PWM1: firstFinite([src.PWM1], null),
    PWM2: firstFinite([src.PWM2], null),
    PWM3: firstFinite([src.PWM3], null),
    Tbodycmd_x_Nm: firstFinite([src.Tbodycmd_x_Nm], null),
    Tbodycmd_y_Nm: firstFinite([src.Tbodycmd_y_Nm], null),
    Tbodycmd_z_Nm: firstFinite([src.Tbodycmd_z_Nm], null),
    Tmotor1_Nm: firstFinite([src.Tmotor1_Nm], null),
    Tmotor2_Nm: firstFinite([src.Tmotor2_Nm], null),
    Tmotor3_Nm: firstFinite([src.Tmotor3_Nm], null),
    control_mode: src.control_mode ?? '',
    EBIMU_status: src.EBIMU_status ?? '',
    logging_status: src.logging_status ?? '',
    timestamp: firstFinite([src.timestamp, src.ebimu_timestamp_ms, src.ebimuTimestampMs], null),
    seq: firstFinite([src.seq, src.packetCount, src.rxCount], null),
    validCount: firstFinite([src.validCount, stats.validCount], null),
    invalidCount: firstFinite([src.invalidCount, stats.invalidCount], null),
    warningCount: firstFinite([src.warningCount, stats.warningCount], null),
    raw: typeof src.raw === 'string' ? src.raw : '',
  };
}

function makeEvent(event, fallbackSource = 'ui') {
  const src = event || {};
  return {
    pcTimeMs: firstFinite([src.pcTimeMs], Date.now()),
    source: normalizeSource(src.source || fallbackSource),
    eventType: src.eventType || 'COMMAND',
    label: src.label || src.eventType || 'Command',
    detail: src.detail || {},
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const message = data?.error || data?.message || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export default function useServerSync() {
  const [clientId] = useState(getStoredClientId);
  const [displayName, setDisplayNameState] = useState(getStoredDisplayName);
  const [serverUrl, setServerUrlState] = useState(DEFAULT_SERVER_URL);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [lastError, setLastError] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const [sessionEndedAt, setSessionEndedAt] = useState(null);
  const [autoUpload, setAutoUpload] = useState(false);
  const [uploadRateHz, setUploadRateHzState] = useState(DEFAULT_UPLOAD_RATE_HZ);
  const [queueLength, setQueueLength] = useState(0);
  const [eventQueueLength, setEventQueueLength] = useState(0);
  const [uploadedSampleCount, setUploadedSampleCount] = useState(0);
  const [uploadedEventCount, setUploadedEventCount] = useState(0);
  const [failedUploadCount, setFailedUploadCount] = useState(0);
  const [lastUploadAt, setLastUploadAt] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [bridgeEnabled, setBridgeEnabled] = useState(false);
  const [lastPublishAt, setLastPublishAt] = useState(null);
  const [lastPublishError, setLastPublishError] = useState('');
  const [lastPublishHttpStatus, setLastPublishHttpStatus] = useState(null);
  const [publishCount, setPublishCount] = useState(0);
  const [publishFailedCount, setPublishFailedCount] = useState(0);
  const [publishBackoffUntil, setPublishBackoffUntil] = useState(null);

  const [serverSerialPorts, setServerSerialPorts] = useState([]);
  const [serverSerialPath, setServerSerialPath] = useState('');
  const [serverSerialBaudRate, setServerSerialBaudRateState] = useState(115200);
  const [useServerSerialImu, setUseServerSerialImu] = useState(false);
  const [serverSerialStatus, setServerSerialStatus] = useState({
    serialportAvailable: false,
    serialportLoadError: '',
    isConnected: false,
    isOpening: false,
    path: '',
    baudRate: 115200,
    isStale: false,
    lastError: '',
    lastRawLine: '',
    lastInvalidReason: '',
    lastReceivedAt: null,
    latestPacket: null,
    latestSharedPacket: null,
    activeSharedSource: '',
    publisherClientId: '',
    publisherDisplayName: '',
    publisherRole: '',
    publishedAt: null,
    latestSharedPacketAgeMs: null,
    liveStatus: 'NONE',
    bridge: {
      enabledByServer: true,
      source: 'admin-web-serial',
      sourceLabel: 'Admin Web Serial Bridge',
      adminBridgeLive: false,
      pendingCount: 0,
      recentCommands: [],
      lastBridgeCommand: null,
    },
    lastBridgeCommand: null,
    recentPackets: [],
    chartData: [],
    rawLines: [],
    diagnostics: null,
    validCount: 0,
    invalidCount: 0,
    ignoredCount: 0,
    warningCount: 0,
    lastCommand: '',
    access: null,
    serverInfo: null,
  });

  const sampleQueueRef = useRef([]);
  const eventQueueRef = useRef([]);
  const uploadBusyRef = useRef(false);
  const sessionIdRef = useRef('');
  const autoUploadRef = useRef(false);
  const serverUrlRef = useRef(DEFAULT_SERVER_URL);
  const latestServerSerialPacketRef = useRef(null);
  const publishPrevPacketRef = useRef(null);
  const lastPublishAtRef = useRef(0);
  const consecutivePublish404Ref = useRef(0);
  const publishBackoffUntilRef = useRef(0);
  const apiServerVerifiedUrlRef = useRef('');
  const apiServerVerifiedAtRef = useRef(0);
  const liveLatestPollBusyRef = useRef(false);
  const liveStreamRef = useRef(null);
  const liveStreamConnectedRef = useRef(false);
  const liveStreamReconnectTimerRef = useRef(null);
  const liveStateFlushTimerRef = useRef(null);
  const pendingLiveStateRef = useRef(null);
  const safeDisplayName = sanitizeDisplayName(displayName);
  const hasDisplayName = Boolean(safeDisplayName);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    autoUploadRef.current = autoUpload;
  }, [autoUpload]);

  useEffect(() => {
    const normalized = normalizeServerUrlForCurrentLocation(serverUrl);
    serverUrlRef.current = normalized;
    if (normalized !== serverUrl) {
      setServerUrlState(normalized);
      persistServerUrl(normalized);
    }
  }, [serverUrl]);

  const refreshQueueLengths = useCallback(() => {
    setQueueLength(sampleQueueRef.current.length);
    setEventQueueLength(eventQueueRef.current.length);
  }, []);

  const setServerUrl = useCallback((value) => {
    const cleaned = normalizeServerUrlForCurrentLocation(value);
    setServerUrlState(cleaned);
    persistServerUrl(cleaned);
  }, []);

  const setDisplayName = useCallback((value) => {
    const next = sanitizeDisplayName(value);
    if (!next) return '';
    setDisplayNameState(next);
    setLocalStorageValue(DISPLAY_NAME_KEY, next);
    setLastError('');
    return next;
  }, []);

  const getSuggestedDisplayName = useCallback((role = 'Viewer') => (
    makeSuggestedDisplayName(role, clientId)
  ), [clientId]);

  const publishEndpointUrl = useMemo(() => `${normalizeServerUrlForCurrentLocation(serverUrl)}${LIVE_PUBLISH_FAST_PATH}`, [serverUrl]);

  const requestJson = useCallback((url, options = {}) => {
    return fetchJson(url, {
      ...options,
      body: addClientIdentityToJsonBody(options.body, clientId, safeDisplayName),
      headers: makeClientHeaders(clientId, safeDisplayName, options.headers || {}),
    });
  }, [clientId, safeDisplayName]);

  const applyHealthData = useCallback((data) => {
    if (!data?.serial && !data?.access && !data?.serverInfo) return;
    setServerSerialStatus((prev) => ({
      ...prev,
      access: data.access || prev.access,
      serverInfo: data.serverInfo || prev.serverInfo,
      serialportAvailable: data.serial?.available ?? prev.serialportAvailable,
      serialportLoadError: data.serial?.error || prev.serialportLoadError,
      diagnostics: data.serial?.diagnostics || prev.diagnostics,
      lastError: '',
    }));
  }, []);

  const discoverServerUrl = useCallback(async (preferredUrl = serverUrlRef.current) => {
    if (!hasDisplayName) return '';
    const candidates = makeServerUrlCandidates(preferredUrl);
    for (const candidate of candidates) {
      const data = await probeCubliServer(candidate, clientId, safeDisplayName);
      if (!data) continue;
      serverUrlRef.current = cleanServerUrl(candidate);
      apiServerVerifiedUrlRef.current = serverUrlRef.current;
      apiServerVerifiedAtRef.current = Date.now();
      setServerUrlState(serverUrlRef.current);
      persistServerUrl(serverUrlRef.current);
      applyHealthData(data);
      setConnectionStatus('connected');
      setLastError('');
      return serverUrlRef.current;
    }

    const message = `Cubli Node server was not found. Tried: ${candidates.join(', ')}`;
    setConnectionStatus('error');
    setLastError(message);
    return '';
  }, [applyHealthData, clientId, safeDisplayName, hasDisplayName]);

  const ensureApiServerUrl = useCallback(async (preferredUrl = serverUrlRef.current, options = {}) => {
    const current = normalizeServerUrlForCurrentLocation(preferredUrl);
    if (current !== cleanServerUrl(preferredUrl)) {
      serverUrlRef.current = current;
      setServerUrlState(current);
      persistServerUrl(current);
    }
    if (!hasDisplayName) return current;
    const now = Date.now();

    // Critical for 100 Hz live publishing: do not probe /api/health and
    // /api/live/latest before every packet. A verified server URL is reused for
    // a short TTL and re-checked only on startup, URL change, forced checks, or
    // publish errors.
    if (
      !options.force &&
      !isLikelyFrontendDevUrl(current) &&
      apiServerVerifiedUrlRef.current === current &&
      now - apiServerVerifiedAtRef.current < API_SERVER_VERIFY_TTL_MS
    ) {
      return current;
    }

    if (isLikelyFrontendDevUrl(current)) {
      const detectedUrl = await discoverServerUrl(current);
      return detectedUrl || current;
    }

    // Verify that the selected URL is not an old server without live bridge
    // endpoints. This prevents a stale 5050 process from stealing traffic
    // while the real server is running on 5058.
    const verified = await probeCubliServer(current, clientId, safeDisplayName);
    if (verified) {
      apiServerVerifiedUrlRef.current = current;
      apiServerVerifiedAtRef.current = Date.now();
      return current;
    }
    const detectedUrl = await discoverServerUrl(current);
    return detectedUrl || current;
  }, [clientId, discoverServerUrl, safeDisplayName, hasDisplayName]);

  const setUploadRateHz = useCallback((value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    setUploadRateHzState(Math.min(5, Math.max(0.2, number)));
  }, []);

  const clearQueues = useCallback(() => {
    sampleQueueRef.current = [];
    eventQueueRef.current = [];
    refreshQueueLengths();
  }, [refreshQueueLengths]);

  const testConnection = useCallback(async () => {
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    setConnectionStatus('testing');
    setLastError('');

    try {
      const data = await probeCubliServer(baseUrl, clientId, safeDisplayName);
      if (!data) throw new Error(`Cubli Node server was not found at ${baseUrl}`);
      applyHealthData(data);
      setConnectionStatus('connected');
      return true;
    } catch (err) {
      // A 404 here usually means the browser is talking to the wrong port, for
      // example 5050 while the Node server is actually on 5058. Auto-detect the
      // running Cubli server instead of leaving publish stuck on the bad URL.
      const detectedUrl = await discoverServerUrl(baseUrl);
      if (detectedUrl) return true;
      setConnectionStatus('error');
      setLastError(err?.message || 'Server connection failed');
      return false;
    }
  }, [applyHealthData, clientId, discoverServerUrl, safeDisplayName]);

  const startSession = useCallback(async () => {
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    setLastError('');

    try {
      const startedAt = new Date().toISOString();
      const data = await requestJson(`${baseUrl}/api/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          clientName: safeDisplayName,
          displayName: safeDisplayName,
          app: 'Cubli ADCS Simulator',
          startedAt,
        }),
      });

      const nextSessionId = data.sessionId || data.id || '';
      if (!nextSessionId) throw new Error('Server did not return sessionId');

      sampleQueueRef.current = [];
      eventQueueRef.current = [];
      setSessionId(nextSessionId);
      setSessionStartedAt(data.startedAt || startedAt);
      setSessionEndedAt(null);
      setUploadedSampleCount(0);
      setUploadedEventCount(0);
      setFailedUploadCount(0);
      setLastUploadAt(null);
      setConnectionStatus('connected');
      refreshQueueLengths();
      return nextSessionId;
    } catch (err) {
      setConnectionStatus('error');
      setLastError(err?.message || 'Start session failed');
      return '';
    }
  }, [safeDisplayName, refreshQueueLengths, requestJson]);

  const enqueueSample = useCallback((packet, fallbackSource = 'unknown', stats = {}) => {
    if (!autoUploadRef.current || !sessionIdRef.current) return false;
    if (!packet) return false;

    const sample = packetToCommonSample(packet, fallbackSource, stats);
    sampleQueueRef.current.push(sample);

    if (sampleQueueRef.current.length > MAX_SAMPLE_QUEUE) {
      sampleQueueRef.current.splice(0, sampleQueueRef.current.length - MAX_SAMPLE_QUEUE);
    }

    refreshQueueLengths();
    return true;
  }, [refreshQueueLengths]);

  const recordEvent = useCallback((event, fallbackSource = 'ui') => {
    if (!autoUploadRef.current || !sessionIdRef.current) return false;

    eventQueueRef.current.push(makeEvent(event, fallbackSource));
    if (eventQueueRef.current.length > MAX_EVENT_QUEUE) {
      eventQueueRef.current.splice(0, eventQueueRef.current.length - MAX_EVENT_QUEUE);
    }

    refreshQueueLengths();
    return true;
  }, [refreshQueueLengths]);

  const flushNow = useCallback(async () => {
    const activeSessionId = sessionIdRef.current;
    if (!autoUploadRef.current || !activeSessionId || uploadBusyRef.current) return false;
    if (sampleQueueRef.current.length === 0 && eventQueueRef.current.length === 0) return true;

    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    const samples = sampleQueueRef.current.splice(0, MAX_BATCH_SAMPLES);
    const events = eventQueueRef.current.splice(0, MAX_BATCH_EVENTS);
    refreshQueueLengths();

    uploadBusyRef.current = true;
    setIsUploading(true);
    setLastError('');

    try {
      if (samples.length > 0) {
        await requestJson(`${baseUrl}/api/sessions/${encodeURIComponent(activeSessionId)}/samples`, {
          method: 'POST',
          body: JSON.stringify({ samples }),
        });
        setUploadedSampleCount((prev) => prev + samples.length);
      }

      if (events.length > 0) {
        await requestJson(`${baseUrl}/api/sessions/${encodeURIComponent(activeSessionId)}/events`, {
          method: 'POST',
          body: JSON.stringify({ events }),
        });
        setUploadedEventCount((prev) => prev + events.length);
      }

      setLastUploadAt(Date.now());
      setConnectionStatus('connected');
      return true;
    } catch (err) {
      if (events.length > 0) {
        eventQueueRef.current = [...events, ...eventQueueRef.current].slice(0, MAX_EVENT_QUEUE);
      }
      if (samples.length > 0) {
        sampleQueueRef.current = [...samples, ...sampleQueueRef.current].slice(0, MAX_SAMPLE_QUEUE);
      }
      refreshQueueLengths();
      setConnectionStatus('error');
      setLastError(err?.message || 'Upload failed');
      setFailedUploadCount((prev) => prev + 1);
      return false;
    } finally {
      uploadBusyRef.current = false;
      setIsUploading(false);
    }
  }, [refreshQueueLengths, requestJson]);

  const publishLivePacket = useCallback(async (packet, source, options = {}) => {
    if (!safeDisplayName) {
      setLastPublishError('Enter a display name before publishing live data.');
      return false;
    }
    if (!packet) return false;
    const now = Date.now();
    const minIntervalMs = Number(options.minIntervalMs ?? LIVE_PUBLISH_MIN_INTERVAL_MS);
    if (!options.force && now - lastPublishAtRef.current < minIntervalMs) return false;

    if (publishBackoffUntilRef.current && now < publishBackoffUntilRef.current) {
      const remainingMs = publishBackoffUntilRef.current - now;
      setLastPublishError(`${LIVE_PUBLISH_404_MESSAGE} Publish is paused for ${Math.ceil(remainingMs / 1000)}s after repeated 404 responses.`);
      return false;
    }

    const normalized = normalizeLivePacket(packet, source, {
      prevPacket: publishPrevPacketRef.current,
      desiredAttitude: serverSerialStatus.latestDesiredAttitude,
      publisherClientId: clientId,
      publisherRole: 'admin',
      now,
    });

    if (!normalized || normalized.invalid || normalized.ok === false) {
      const message = normalized?.invalidReason || 'Live packet normalization failed';
      setLastError(message);
      setLastPublishError(message);
      setPublishFailedCount((prev) => prev + 1);
      return false;
    }

    const makeSyntheticPublishData = () => {
      const publishedAt = Date.now();
      const latestSharedPacket = {
        ...normalized,
        source: 'admin-web-serial',
        sourceLabel: 'Admin Web Serial Bridge',
        publishedAt,
        publisherClientId: clientId,
        publisherDisplayName: safeDisplayName,
        publisherRole: 'admin',
      };
      return {
        ok: true,
        latestSharedPacket,
        activeSharedSource: 'admin-web-serial',
        publisherClientId: clientId,
        publisherDisplayName: safeDisplayName,
        publisherRole: 'admin',
        publishedAt,
        latestSharedPacketAgeMs: 0,
        liveStatus: 'LIVE',
      };
    };

    const handlePublishSuccess = (data = makeSyntheticPublishData()) => {
      const latestSharedPacket = data.latestSharedPacket || makeSyntheticPublishData().latestSharedPacket;
      if (latestSharedPacket) {
        publishPrevPacketRef.current = latestSharedPacket;
        latestServerSerialPacketRef.current = latestSharedPacket;
        setServerSerialStatus((prev) => ({
          ...prev,
          latestPacket: latestSharedPacket,
          latestSharedPacket,
          activeSharedSource: data.activeSharedSource || latestSharedPacket.source || prev.activeSharedSource,
          publisherClientId: data.publisherClientId || latestSharedPacket.publisherClientId || prev.publisherClientId,
          publisherDisplayName: data.publisherDisplayName || latestSharedPacket.publisherDisplayName || prev.publisherDisplayName,
          publisherRole: data.publisherRole || latestSharedPacket.publisherRole || prev.publisherRole,
          publishedAt: data.publishedAt || latestSharedPacket.publishedAt || prev.publishedAt,
          latestSharedPacketAgeMs: data.latestSharedPacketAgeMs ?? prev.latestSharedPacketAgeMs,
          liveStatus: data.liveStatus || prev.liveStatus,
          bridge: data.bridge || prev.bridge,
          lastBridgeCommand: data.bridge?.lastBridgeCommand || prev.lastBridgeCommand,
          latestDesiredAttitude: data.latestDesiredAttitude || prev.latestDesiredAttitude,
          access: data.access || prev.access,
        }));
      }
      consecutivePublish404Ref.current = 0;
      publishBackoffUntilRef.current = 0;
      apiServerVerifiedUrlRef.current = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
      apiServerVerifiedAtRef.current = Date.now();
      setPublishBackoffUntil(null);
      setLastPublishAt(data.publishedAt || latestSharedPacket?.publishedAt || Date.now());
      setLastPublishHttpStatus(data.httpStatus || 200);
      setLastPublishError('');
      setPublishCount((prev) => prev + 1);
      setConnectionStatus('connected');
      setLastError('');
      return true;
    };

    const makePublishPayload = () => JSON.stringify({
      clientId,
      clientName: safeDisplayName,
      displayName: safeDisplayName,
      source: 'admin-web-serial',
      packet: { ...normalized, source: 'admin-web-serial', sourceLabel: 'Admin Web Serial Bridge' },
    });

    const postPublish = async (baseUrl) => {
      const endpointPath = options.fast ? LIVE_PUBLISH_FAST_PATH : LIVE_PUBLISH_PATH;
      const response = await fetch(`${cleanServerUrl(baseUrl)}${endpointPath}`, {
        method: 'POST',
        headers: makeClientHeaders(clientId, safeDisplayName, {
          'Content-Type': 'application/json',
        }),
        body: makePublishPayload(),
      });

      if (response.status === 204) {
        return { ...makeSyntheticPublishData(), httpStatus: 204 };
      }

      const text = await response.text();
      let data = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (_) {
          data = { raw: text };
        }
      }

      if (!response.ok) {
        const message = data?.error || data?.message || `HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return data;
    };

    const baseUrl = await ensureApiServerUrl(serverUrlRef.current);
    lastPublishAtRef.current = now;

    try {
      const data = await postPublish(baseUrl);
      return handlePublishSuccess(data);
    } catch (err) {
      let publishError = err;
      // If /api/live/publish is 404, do not keep hammering the wrong port.
      // Search the actual Cubli server (/api/health), switch serverUrl, and
      // retry once immediately. This directly fixes 5050 vs 5058 mismatch.
      if (Number(publishError?.status) === 404 && !options.skipDiscoveryRetry) {
        const detectedUrl = await discoverServerUrl(baseUrl);
        if (detectedUrl && detectedUrl !== baseUrl) {
          try {
            const retryData = await postPublish(detectedUrl);
            return handlePublishSuccess(retryData);
          } catch (retryErr) {
            publishError = retryErr;
          }
        }
      }

      const is404 = Number(publishError?.status) === 404;
      const endpointText = `${normalizeServerUrlForCurrentLocation(serverUrlRef.current)}${LIVE_PUBLISH_PATH}`;
      const errorMessage = is404
        ? `${LIVE_PUBLISH_404_MESSAGE} Current endpoint: ${endpointText}`
        : (publishError?.message || 'Live publish failed');
      if (is404) {
        consecutivePublish404Ref.current += 1;
        if (consecutivePublish404Ref.current >= 2) {
          const backoffUntil = Date.now() + LIVE_PUBLISH_404_BACKOFF_MS;
          publishBackoffUntilRef.current = backoffUntil;
          setPublishBackoffUntil(backoffUntil);
        }
      } else {
        consecutivePublish404Ref.current = 0;
      }
      setLastPublishHttpStatus(publishError?.status || null);
      setLastPublishError(errorMessage);
      setPublishFailedCount((prev) => prev + 1);
      setConnectionStatus('error');
      setLastError(errorMessage);
      return false;
    }
  }, [clientId, discoverServerUrl, safeDisplayName, ensureApiServerUrl, serverSerialStatus.latestDesiredAttitude]);

  const publishCommandState = useCallback(async (commandKey, params = {}, label = '') => {
    const key = String(commandKey || '').trim();
    if (!key) return false;
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/live/command`, {
        method: 'POST',
        body: JSON.stringify({ clientId, commandKey: key, params, label }),
      });
      setServerSerialStatus((prev) => ({
        ...prev,
        latestDesiredAttitude: data.latestDesiredAttitude || prev.latestDesiredAttitude,
        lastCommandInfo: data.lastCommandInfo || prev.lastCommandInfo,
        latestSharedPacket: data.latestSharedPacket || prev.latestSharedPacket,
        latestPacket: data.latestSharedPacket || prev.latestPacket,
        access: data.access || prev.access,
      }));
      setConnectionStatus('connected');
      setLastError('');
      return true;
    } catch (err) {
      setConnectionStatus('error');
      setLastError(err?.message || 'Live command state publish failed');
      return false;
    }
  }, [clientId, requestJson]);

  const requestBridgeCommand = useCallback(async (commandKey, params = {}, eventMeta = {}) => {
    const key = String(commandKey || '').trim();
    if (!key) return false;
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/bridge/command-request`, {
        method: 'POST',
        body: JSON.stringify({ clientId, commandKey: key, params }),
      });
      setServerSerialStatus((prev) => ({
        ...prev,
        bridge: data.bridge || prev.bridge,
        lastBridgeCommand: data.bridge?.lastBridgeCommand || data.command || prev.lastBridgeCommand,
        latestDesiredAttitude: data.latestDesiredAttitude || prev.latestDesiredAttitude,
        lastCommandInfo: data.lastCommandInfo || prev.lastCommandInfo,
        latestSharedPacket: data.latestSharedPacket || prev.latestSharedPacket,
        latestPacket: data.latestSharedPacket || prev.latestPacket,
        access: data.access || prev.access,
        lastError: '',
      }));
      recordEvent({
        eventType: eventMeta.eventType || 'BRIDGE_COMMAND_REQUEST',
        label: eventMeta.label || data.command?.label || 'Bridge Command',
        source: 'admin-web-serial',
        detail: { commandKey: key, params, commandId: data.commandId, ...(eventMeta.detail || {}) },
      }, 'admin-web-serial');
      setConnectionStatus('connected');
      setLastError('');
      return data.commandId || true;
    } catch (err) {
      setConnectionStatus('error');
      setLastError(err?.message || 'Bridge command request failed');
      setServerSerialStatus((prev) => ({ ...prev, lastError: err?.message || 'Bridge command request failed' }));
      return false;
    }
  }, [clientId, recordEvent, requestJson]);

  const pollBridgeCommands = useCallback(async () => {
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/bridge/commands/poll?clientId=${encodeURIComponent(clientId)}&clientName=${encodeURIComponent(safeDisplayName)}`, { method: 'GET' });
      setServerSerialStatus((prev) => ({
        ...prev,
        bridge: data.bridge || prev.bridge,
        lastBridgeCommand: data.bridge?.lastBridgeCommand || prev.lastBridgeCommand,
        access: data.access || prev.access,
      }));
      setConnectionStatus('connected');
      return Array.isArray(data.commands) ? data.commands : [];
    } catch (err) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: err?.message || 'Bridge command polling failed' }));
      return [];
    }
  }, [clientId, safeDisplayName, requestJson]);

  const ackBridgeCommand = useCallback(async (commandId, ok, sentLine = '', error = '') => {
    const id = String(commandId || '').trim();
    if (!id) return false;
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/bridge/commands/${encodeURIComponent(id)}/ack`, {
        method: 'POST',
        body: JSON.stringify({ clientId, ok: Boolean(ok), sentLine, error }),
      });
      setServerSerialStatus((prev) => ({
        ...prev,
        bridge: data.bridge || prev.bridge,
        lastBridgeCommand: data.bridge?.lastBridgeCommand || data.command || prev.lastBridgeCommand,
        latestDesiredAttitude: data.latestDesiredAttitude || prev.latestDesiredAttitude,
        lastCommandInfo: data.lastCommandInfo || prev.lastCommandInfo,
        latestSharedPacket: data.latestSharedPacket || prev.latestSharedPacket,
        latestPacket: data.latestSharedPacket || prev.latestPacket,
        access: data.access || prev.access,
      }));
      setConnectionStatus('connected');
      setLastError('');
      return true;
    } catch (err) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: err?.message || 'Bridge command ack failed' }));
      return false;
    }
  }, [clientId, requestJson]);


  const setServerSerialBaudRate = useCallback((value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return;
    setServerSerialBaudRateState(number);
  }, []);

  const updateServerSerialStatusState = useCallback((data) => {
    if (!data) return data;
    setServerSerialStatus((prev) => ({ ...prev, ...data }));
    if (data.latestPacket?.updatedAt) {
      latestServerSerialPacketRef.current = data.latestPacket;
    }
    if (data.latestSharedPacket?.updatedAt || data.latestSharedPacket?.publishedAt) {
      latestServerSerialPacketRef.current = data.latestSharedPacket;
    }
    if (data.path) setServerSerialPath(data.path);
    if (data.baudRate) setServerSerialBaudRateState(data.baudRate);
    return data;
  }, []);

  const refreshServerSerialStatus = useCallback(async () => {
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/serial/status`, { method: 'GET' });
      updateServerSerialStatusState(data);
      return data;
    } catch (err) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: err?.message || 'Server serial status failed' }));
      return null;
    }
  }, [requestJson, updateServerSerialStatusState]);

  const listServerSerialPorts = useCallback(async () => {
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/serial/ports`, { method: 'GET' });
      const ports = Array.isArray(data.ports) ? data.ports : [];
      setServerSerialPorts(ports);
      setServerSerialStatus((prev) => ({
        ...prev,
        diagnostics: data.diagnostics || prev.diagnostics,
        serialportAvailable: data.diagnostics?.serialportAvailable ?? prev.serialportAvailable,
        serialportLoadError: data.diagnostics?.serialportLoadError || prev.serialportLoadError,
        lastError: data.ok === false ? data.error || prev.lastError : '',
      }));
      if (!serverSerialPath && ports[0]?.path) setServerSerialPath(ports[0].path);
      return ports;
    } catch (err) {
      setServerSerialPorts(Array.isArray(err?.data?.ports) ? err.data.ports : []);
      setServerSerialStatus((prev) => ({
        ...prev,
        diagnostics: err?.data?.diagnostics || prev.diagnostics,
        serialportAvailable: err?.data?.diagnostics?.serialportAvailable ?? prev.serialportAvailable,
        serialportLoadError: err?.data?.diagnostics?.serialportLoadError || prev.serialportLoadError,
        lastError: err?.message || 'List serial ports failed',
      }));
      return [];
    }
  }, [requestJson, serverSerialPath]);

  const connectServerSerial = useCallback(async () => {
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/serial/connect`, {
        method: 'POST',
        body: JSON.stringify({ path: serverSerialPath, baudRate: serverSerialBaudRate }),
      });
      updateServerSerialStatusState(data);
      return true;
    } catch (err) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: err?.message || 'Server serial connect failed' }));
      return false;
    }
  }, [requestJson, serverSerialBaudRate, serverSerialPath, updateServerSerialStatusState]);

  const disconnectServerSerial = useCallback(async () => {
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/serial/disconnect`, { method: 'POST' });
      updateServerSerialStatusState(data);
      setUseServerSerialImu(false);
      return true;
    } catch (err) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: err?.message || 'Server serial disconnect failed' }));
      return false;
    }
  }, [requestJson, updateServerSerialStatusState]);

  const sendServerSerialCommand = useCallback(async (commandKeyOrCommand, paramsOrMeta = {}, maybeMeta = {}) => {
    const explicitKey = String(commandKeyOrCommand || '').trim();
    const knownKeys = new Set([
      'tare', 'stop', 'emergencyStop', 'targetAttitude', 'ebimuDefault', 'ebimuStart', 'ebimuStop',
      'magOff', 'magOn', 'magAuto', 'gyro250', 'gyro500', 'gyro1000', 'gyro2000',
      'acc2g', 'acc4g', 'acc8g', 'acc16g', 'accFactor', 'status', 'macInfo',
      'attitudeKp', 'attitudeKd',
    ]);
    const mapped = knownKeys.has(explicitKey)
      ? { commandKey: explicitKey, params: paramsOrMeta || {} }
      : legacyCommandToKey(explicitKey);
    const commandKey = mapped.commandKey;
    const params = mapped.params || {};
    const eventMeta = knownKeys.has(explicitKey) ? maybeMeta : paramsOrMeta;
    if (!commandKey) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: 'Unsupported server serial command' }));
      return false;
    }
    const commandId = await requestBridgeCommand(commandKey, params, {
      eventType: eventMeta.eventType || 'BRIDGE_COMMAND_REQUEST',
      label: eventMeta.label || 'Bridge Command',
      detail: eventMeta.detail || {},
    });
    return Boolean(commandId);
  }, [requestBridgeCommand]);

  const sendServerControllerCommand = useCallback(async (type, v1 = 0, v2 = 0, v3 = 0, eventMeta = {}) => {
    const cleanType = Number(type);
    if (cleanType === 0) return sendServerSerialCommand('stop', {}, eventMeta);
    if (cleanType === 1) return sendServerSerialCommand('targetAttitude', { roll: v1, pitch: v2, yaw: v3 }, eventMeta);
    if (cleanType === 2) return sendServerSerialCommand('tare', {}, eventMeta);
    if (cleanType === 60) return sendServerSerialCommand('attitudeKp', { kx: v1, ky: v2, kz: v3 }, eventMeta);
    if (cleanType === 61) return sendServerSerialCommand('attitudeKd', { dx: v1, dy: v2, dz: v3 }, eventMeta);
    if (cleanType === 50) {
      const cmdId = Number(v1);
      const value = Number(v2);
      if (cmdId === 1) {
        if (value === 0) return sendServerSerialCommand('magOff', {}, eventMeta);
        if (value === 1) return sendServerSerialCommand('magOn', {}, eventMeta);
        if (value === 2) return sendServerSerialCommand('magAuto', {}, eventMeta);
      }
      if (cmdId === 2 && [250, 500, 1000, 2000].includes(value)) return sendServerSerialCommand(`gyro${value}`, {}, eventMeta);
      if (cmdId === 3 && [2, 4, 8, 16].includes(value)) return sendServerSerialCommand(`acc${value}g`, {}, eventMeta);
      if (cmdId === 4) return sendServerSerialCommand('accFactor', { factor: value || 10 }, eventMeta);
      if (cmdId === 9) return sendServerSerialCommand('ebimuDefault', {}, eventMeta);
      if (cmdId === 10) return sendServerSerialCommand('ebimuStart', {}, eventMeta);
      if (cmdId === 11) return sendServerSerialCommand('ebimuStop', {}, eventMeta);
    }
    setServerSerialStatus((prev) => ({ ...prev, lastError: 'Unsupported bridge controller command' }));
    return false;
  }, [sendServerSerialCommand]);

  const sendTargetAttitude = useCallback((roll, pitch, yaw) => (
    sendServerSerialCommand('targetAttitude', { roll, pitch, yaw }, { eventType: 'TARGET_ATTITUDE', label: 'Send Target Attitude' })
  ), [sendServerSerialCommand]);

  const sendAttitudeKp = useCallback((kx, ky, kz) => {
    const gains = normalizeGainTriplet({ kx, ky, kz }, ['kx', 'ky', 'kz']);
    if (!gains) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: 'Attitude Kp gains must be finite numbers from 0 to 10' }));
      return Promise.resolve(false);
    }
    return sendServerSerialCommand('attitudeKp', gains, {
      eventType: 'ATT_GAIN_KP',
      label: 'Attitude Kp',
      detail: gains,
    });
  }, [sendServerSerialCommand]);

  const sendAttitudeKd = useCallback((dx, dy, dz) => {
    const gains = normalizeGainTriplet({ dx, dy, dz }, ['dx', 'dy', 'dz']);
    if (!gains) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: 'Attitude Kd gains must be finite numbers from 0 to 10' }));
      return Promise.resolve(false);
    }
    return sendServerSerialCommand('attitudeKd', gains, {
      eventType: 'ATT_GAIN_KD',
      label: 'Attitude Kd',
      detail: gains,
    });
  }, [sendServerSerialCommand]);

  const sendAttitudeGains = useCallback(async (kx, ky, kz, dx, dy, dz) => {
    const kpOk = await sendAttitudeKp(kx, ky, kz);
    if (!kpOk) return false;
    return sendAttitudeKd(dx, dy, dz);
  }, [sendAttitudeKd, sendAttitudeKp]);

  const sendEbimuShortcut = useCallback((commandKey, label, params = {}) => (
    sendServerSerialCommand(commandKey, params, { eventType: 'EBIMU_RUNTIME', label, detail: params })
  ), [sendServerSerialCommand]);

  const clearServerSerialStats = useCallback(async () => {
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/serial/clear-stats`, { method: 'POST' });
      latestServerSerialPacketRef.current = null;
      updateServerSerialStatusState(data);
      return true;
    } catch (err) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: err?.message || 'Clear server serial stats failed' }));
      return false;
    }
  }, [requestJson, updateServerSerialStatusState]);

  const loginAdmin = useCallback(async ({ adminId, password }) => {
    const firstBaseUrl = await ensureApiServerUrl(serverUrlRef.current);
    setLastError('');

    const postLogin = (baseUrl) => requestJson(`${cleanServerUrl(baseUrl)}/api/admin/login`, {
      method: 'POST',
      body: JSON.stringify({ clientId, adminId, password }),
    });

    try {
      let data;
      try {
        data = await postLogin(firstBaseUrl);
      } catch (err) {
        if (Number(err?.status) !== 404 && !isLikelyFrontendDevUrl(firstBaseUrl)) throw err;
        const detectedUrl = await discoverServerUrl(firstBaseUrl);
        if (!detectedUrl || cleanServerUrl(detectedUrl) === cleanServerUrl(firstBaseUrl)) throw err;
        data = await postLogin(detectedUrl);
      }

      setServerSerialStatus((prev) => ({ ...prev, access: data.access || prev.access, lastError: '' }));
      setConnectionStatus('connected');
      return true;
    } catch (err) {
      setConnectionStatus('error');
      const message = err?.status === 404
        ? `Admin login API was not found at ${normalizeServerUrlForCurrentLocation(serverUrlRef.current)}/api/admin/login. Server URL must point to the Node/Express server, not the React dev server on 3000/3001.`
        : (err?.message || 'Admin login failed');
      setLastError(message);
      setServerSerialStatus((prev) => ({ ...prev, lastError: message }));
      return false;
    }
  }, [clientId, discoverServerUrl, ensureApiServerUrl, requestJson]);

  const logoutAdmin = useCallback(async () => {
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/admin/logout`, {
        method: 'POST',
        body: JSON.stringify({ clientId }),
      });
      setServerSerialStatus((prev) => ({ ...prev, access: data.access || prev.access, lastError: '' }));
      return true;
    } catch (err) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: err?.message || 'Admin logout failed' }));
      return false;
    }
  }, [clientId, requestJson]);

  const refreshAccessState = useCallback(async () => {
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/state`, { method: 'GET' });
      setServerSerialStatus((prev) => ({
        ...prev,
        ...(data.serial || {}),
        latestSharedPacket: data.latestSharedPacket || data.serial?.latestSharedPacket || prev.latestSharedPacket,
        latestPacket: data.serial?.latestPacket || data.latestSharedPacket || prev.latestPacket,
        activeSharedSource: data.activeSharedSource || data.serial?.activeSharedSource || prev.activeSharedSource,
        publisherClientId: data.publisherClientId || data.serial?.publisherClientId || prev.publisherClientId,
        publisherDisplayName: data.publisherDisplayName || data.serial?.publisherDisplayName || prev.publisherDisplayName,
        publisherRole: data.publisherRole || data.serial?.publisherRole || prev.publisherRole,
        publishedAt: data.publishedAt || data.serial?.publishedAt || prev.publishedAt,
        latestSharedPacketAgeMs: data.latestSharedPacketAgeMs ?? data.serial?.latestSharedPacketAgeMs ?? prev.latestSharedPacketAgeMs,
        liveStatus: data.liveStatus || data.serial?.liveStatus || prev.liveStatus,
        bridge: data.bridge || data.serial?.bridge || prev.bridge,
        lastBridgeCommand: data.bridge?.lastBridgeCommand || data.serial?.bridge?.lastBridgeCommand || prev.lastBridgeCommand,
        access: data.access || prev.access,
        serverInfo: data.serverInfo || data.serial?.serverInfo || prev.serverInfo,
      }));
      if (data.serial?.latestPacket?.updatedAt) {
        latestServerSerialPacketRef.current = data.serial.latestPacket;
      }
      if (data.latestSharedPacket?.updatedAt || data.latestSharedPacket?.publishedAt) {
        latestServerSerialPacketRef.current = data.latestSharedPacket;
      }
      return data.access || null;
    } catch (err) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: err?.message || 'Access state refresh failed' }));
      return null;
    }
  }, [requestJson]);

  const applyLivePayload = useCallback((data, { updateState = true } = {}) => {
    if (!data || typeof data !== 'object') return null;

    const packet = data.latestSharedPacket || data.packet || null;
    if (packet?.updatedAt || packet?.publishedAt) {
      latestServerSerialPacketRef.current = packet;
      if (typeof window !== 'undefined') {
        window.__CUBLI_SERVER_SERIAL_PACKET = packet;
      }
    }

    if (!updateState) return packet;

    setServerSerialStatus((prev) => ({
      ...prev,
      latestSharedPacket: packet || prev.latestSharedPacket,
      latestPacket: packet || prev.latestPacket,
      activeSharedSource: data.activeSharedSource || packet?.source || prev.activeSharedSource,
      publisherClientId: data.publisherClientId || packet?.publisherClientId || prev.publisherClientId,
      publisherDisplayName: data.publisherDisplayName || packet?.publisherDisplayName || prev.publisherDisplayName,
      publisherRole: data.publisherRole || packet?.publisherRole || prev.publisherRole,
      publishedAt: data.publishedAt || packet?.publishedAt || prev.publishedAt,
      latestSharedPacketAgeMs: data.latestSharedPacketAgeMs ?? data.ageMs ?? prev.latestSharedPacketAgeMs,
      liveStatus: data.liveStatus || prev.liveStatus,
      bridge: data.bridge || prev.bridge,
      lastBridgeCommand: data.bridge?.lastBridgeCommand || prev.lastBridgeCommand,
      latestDesiredAttitude: data.latestDesiredAttitude || prev.latestDesiredAttitude,
      access: data.access || prev.access,
      lastError: '',
    }));

    return packet;
  }, []);

  const scheduleLiveStateFlush = useCallback((data) => {
    applyLivePayload(data, { updateState: false });
    pendingLiveStateRef.current = data;

    if (typeof window === 'undefined') {
      applyLivePayload(data, { updateState: true });
      return;
    }

    // 100 Hz packets should drive the 3D ref immediately, but React UI state
    // should not re-render 100 times per second. Flush status panels at ~25 Hz.
    if (liveStateFlushTimerRef.current) return;
    liveStateFlushTimerRef.current = window.setTimeout(() => {
      const latest = pendingLiveStateRef.current;
      pendingLiveStateRef.current = null;
      liveStateFlushTimerRef.current = null;
      if (latest) applyLivePayload(latest, { updateState: true });
    }, 40);
  }, [applyLivePayload]);

  const refreshLiveLatest = useCallback(async () => {
    if (liveLatestPollBusyRef.current) return null;
    liveLatestPollBusyRef.current = true;

    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/live/latest`, { method: 'GET' });
      applyLivePayload(data, { updateState: true });
      setConnectionStatus('connected');
      return data;
    } catch (err) {
      // Do not spam the UI at 50 Hz with transient polling errors. The slower
      // /api/state poll still reports connection problems.
      return null;
    } finally {
      liveLatestPollBusyRef.current = false;
    }
  }, [applyLivePayload, requestJson]);

  const grantControl = useCallback(async (targetClientId) => {
    const target = String(targetClientId || '').trim();
    if (!target) return false;
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/clients/${encodeURIComponent(target)}/grant-control`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setServerSerialStatus((prev) => ({ ...prev, access: data.access || prev.access, lastError: '' }));
      return true;
    } catch (err) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: err?.message || 'Grant control failed' }));
      return false;
    }
  }, [requestJson]);

  const revokeControl = useCallback(async () => {
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const currentController = serverSerialStatus.access?.controllerClientId || '';
      const url = currentController
        ? `${baseUrl}/api/clients/${encodeURIComponent(currentController)}/revoke-control`
        : `${baseUrl}/api/access/revoke-control`;
      const data = await requestJson(url, { method: 'POST' });
      setServerSerialStatus((prev) => ({ ...prev, access: data.access || prev.access, lastError: '' }));
      return true;
    } catch (err) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: err?.message || 'Revoke control failed' }));
      return false;
    }
  }, [requestJson, serverSerialStatus.access?.controllerClientId]);

  const resetAccessState = useCallback(async () => {
    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      const data = await requestJson(`${baseUrl}/api/access/reset`, { method: 'POST' });
      setServerSerialStatus((prev) => ({ ...prev, access: data.access || prev.access, lastError: '' }));
      return true;
    } catch (err) {
      setServerSerialStatus((prev) => ({ ...prev, lastError: err?.message || 'Reset server state failed' }));
      return false;
    }
  }, [requestJson]);

  const sendEmergencyStop = useCallback(async () => {
    const commandId = await requestBridgeCommand('emergencyStop', {}, {
      eventType: 'EMERGENCY_STOP',
      label: 'Emergency Stop',
      detail: { command: 'STOP', clientId, role: serverSerialStatus.access?.myEffectiveRole || 'viewer' },
    });
    return Boolean(commandId);
  }, [clientId, requestBridgeCommand, serverSerialStatus.access?.myEffectiveRole]);

  const stopSession = useCallback(async () => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) return;
    const endedAt = new Date().toISOString();

    if (autoUploadRef.current) {
      eventQueueRef.current.push(makeEvent({
        eventType: 'SESSION_STOP',
        label: 'Stop Session',
        detail: { endedAt },
      }, 'server'));
      await flushNow();
    }

    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrlRef.current);
    try {
      await requestJson(`${baseUrl}/api/sessions/${encodeURIComponent(activeSessionId)}/stop`, {
        method: 'POST',
        body: JSON.stringify({ endedAt }),
      });
    } catch (err) {
      setConnectionStatus('error');
      setLastError(err?.message || 'Stop session failed');
      return;
    }

    setSessionEndedAt(endedAt);
    setSessionId('');
    sessionIdRef.current = '';
    refreshQueueLengths();
  }, [flushNow, refreshQueueLengths, requestJson]);

  useEffect(() => {
    // On page load, quickly find the actual Node server. This fixes the common
    // case where `npm run server` is running on PORT=5058 but the old UI still
    // points to 5050.
    if (!hasDisplayName) return undefined;
    discoverServerUrl(serverUrlRef.current);
    return undefined;
  }, [discoverServerUrl, hasDisplayName]);

  useEffect(() => {
    if (!autoUpload || !sessionId) return undefined;
    const intervalMs = Math.round(1000 / Math.max(0.2, Math.min(5, uploadRateHz)));
    const timer = window.setInterval(() => {
      flushNow();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [autoUpload, flushNow, sessionId, uploadRateHz]);


  useEffect(() => {
    if (!useServerSerialImu && !serverSerialStatus.isConnected) return undefined;
    const timer = window.setInterval(() => {
      refreshServerSerialStatus();
    }, SERVER_SERIAL_STATUS_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshServerSerialStatus, serverSerialStatus.isConnected, useServerSerialImu]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return undefined;
    if (!hasDisplayName) return undefined;

    const baseUrl = normalizeServerUrlForCurrentLocation(serverUrl);
    if (isLikelyFrontendDevUrl(baseUrl)) return undefined;

    let closed = false;

    const connect = () => {
      if (closed) return;
      const url = `${baseUrl}/api/live/stream?clientId=${encodeURIComponent(clientId)}&clientName=${encodeURIComponent(safeDisplayName)}`;
      const eventSource = new window.EventSource(url);
      liveStreamRef.current = eventSource;

      eventSource.onopen = () => {
        liveStreamConnectedRef.current = true;
        setConnectionStatus('connected');
      };

      eventSource.addEventListener('live', (event) => {
        try {
          const data = JSON.parse(event.data);
          liveStreamConnectedRef.current = true;
          scheduleLiveStateFlush(data);
          setConnectionStatus('connected');
        } catch (_) {
          // Ignore malformed SSE frames and keep the fallback polling alive.
        }
      });

      eventSource.addEventListener('state', (event) => {
        try {
          const data = JSON.parse(event.data);
          liveStreamConnectedRef.current = true;
          scheduleLiveStateFlush(data);
          setConnectionStatus('connected');
        } catch (_) {
          // Ignore malformed SSE frames and keep the fallback polling alive.
        }
      });

      eventSource.onerror = () => {
        liveStreamConnectedRef.current = false;
        eventSource.close();
        if (liveStreamRef.current === eventSource) liveStreamRef.current = null;
        if (!closed && !liveStreamReconnectTimerRef.current) {
          liveStreamReconnectTimerRef.current = window.setTimeout(() => {
            liveStreamReconnectTimerRef.current = null;
            connect();
          }, 1000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      liveStreamConnectedRef.current = false;
      if (liveStreamReconnectTimerRef.current) {
        window.clearTimeout(liveStreamReconnectTimerRef.current);
        liveStreamReconnectTimerRef.current = null;
      }
      if (liveStreamRef.current) {
        liveStreamRef.current.close();
        liveStreamRef.current = null;
      }
      if (liveStateFlushTimerRef.current) {
        window.clearTimeout(liveStateFlushTimerRef.current);
        liveStateFlushTimerRef.current = null;
      }
    };
  }, [clientId, safeDisplayName, hasDisplayName, scheduleLiveStateFlush, serverUrl]);

  useEffect(() => {
    // Fallback for browsers/network paths where EventSource is unavailable.
    // Do not keep polling /api/live/latest while SSE is connected; that extra
    // 20 Hz HTTP traffic was a major source of Viewer-side stutter.
    if (!hasDisplayName) return undefined;
    refreshLiveLatest();
    const timer = window.setInterval(() => {
      if (!liveStreamConnectedRef.current) refreshLiveLatest();
    }, LIVE_LATEST_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasDisplayName, refreshLiveLatest]);

  useEffect(() => {
    if (!hasDisplayName) return undefined;
    refreshAccessState();
    const timer = window.setInterval(() => {
      refreshAccessState();
    }, ACCESS_STATE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasDisplayName, refreshAccessState]);

  const downloadUrl = useMemo(() => {
    if (!sessionId) return '';
    return `${normalizeServerUrlForCurrentLocation(serverUrl)}/api/sessions/${encodeURIComponent(sessionId)}/download`;
  }, [serverUrl, sessionId]);

  return {
    clientId,
    displayName: safeDisplayName,
    clientName: safeDisplayName,
    hasDisplayName,
    setDisplayName,
    getSuggestedDisplayName,
    role: serverSerialStatus.access?.myEffectiveRole || 'viewer',
    isAdmin: serverSerialStatus.access?.myEffectiveRole === 'admin',
    isController: serverSerialStatus.access?.myEffectiveRole === 'controller',
    loginAdmin,
    logoutAdmin,
    serverUrl,
    setServerUrl,
    connectionStatus,
    lastError,
    bridgeEnabled,
    setBridgeEnabled,
    publishEndpointUrl,
    lastPublishAt,
    lastPublishError,
    lastPublishHttpStatus,
    publishCount,
    publishFailedCount,
    publishBackoffUntil,
    latestSharedPacket: serverSerialStatus.latestSharedPacket,
    latestSharedPacketAgeMs: serverSerialStatus.latestSharedPacketAgeMs,
    activeSharedSource: serverSerialStatus.activeSharedSource,
    publishedAt: serverSerialStatus.publishedAt,
    liveStatus: serverSerialStatus.liveStatus,
    sessionId,
    sessionStartedAt,
    sessionEndedAt,
    autoUpload,
    setAutoUpload,
    uploadRateHz,
    setUploadRateHz,
    queueLength,
    eventQueueLength,
    uploadedSampleCount,
    uploadedEventCount,
    failedUploadCount,
    lastUploadAt,
    isUploading,
    isSessionActive: Boolean(sessionId),
    downloadUrl,
    serverSerial: {
      ports: serverSerialPorts,
      selectedPath: serverSerialPath,
      setSelectedPath: setServerSerialPath,
      baudRate: serverSerialBaudRate,
      setBaudRate: setServerSerialBaudRate,
      useAsSource: useServerSerialImu,
      setUseAsSource: setUseServerSerialImu,
      status: serverSerialStatus,
      latestPacket: serverSerialStatus.latestPacket,
      latestPacketRef: latestServerSerialPacketRef,
      bridge: serverSerialStatus.bridge,
      lastBridgeCommand: serverSerialStatus.lastBridgeCommand,
      listPorts: listServerSerialPorts,
      connect: connectServerSerial,
      disconnect: disconnectServerSerial,
      refreshStatus: refreshServerSerialStatus,
      requestBridgeCommand,
      pollBridgeCommands,
      ackBridgeCommand,
      sendCommand: sendServerSerialCommand,
      sendCommandKey: sendServerSerialCommand,
      sendControllerCommand: sendServerControllerCommand,
      sendTare: () => sendServerSerialCommand('tare', {}, { eventType: 'TARE', label: 'Set Zero / Tare' }),
      sendStop: () => sendServerSerialCommand('stop', {}, { eventType: 'STOP', label: 'Stop' }),
      sendTarget: sendTargetAttitude,
      sendAttitudeKp,
      sendAttitudeKd,
      sendAttitudeGains,
      sendEbimuShortcut,
      sendStatus: () => sendServerSerialCommand('status', {}, { eventType: 'STATUS_REQUEST', label: 'Status' }),
      sendMacInfo: () => sendServerSerialCommand('macInfo', {}, { eventType: 'MAC_REQUEST', label: 'MAC Info' }),
      sendAccFactor: (factor) => sendEbimuShortcut('accFactor', 'Accel Filter Factor', { factor }),
      sendEbimuRuntime: (cmdId, value = 0, label = 'EBIMU Runtime') => sendServerControllerCommand(50, cmdId, value, 0, { eventType: 'EBIMU_RUNTIME', label, detail: { cmdId, value } }),
      clearStats: clearServerSerialStats,
      refreshAccessState,
      grantControl,
      revokeControl,
      resetAccessState,
      sendEmergencyStop,
    },
    testConnection,
    startSession,
    stopSession,
    enqueueSample,
    publishLivePacket,
    publishCommandState,
    recordEvent,
    flushNow,
    clearQueues,
  };
}
