const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let SerialPort = null;
let ReadlineParser = null;
let serialportLoadError = '';
try {
  const serialport = require('serialport');
  SerialPort = serialport.SerialPort;
  ReadlineParser = serialport.ReadlineParser;
} catch (err) {
  serialportLoadError = err?.message || 'serialport package is not installed';
}

const PORT = Number(process.env.PORT || 5050);
const HOST = '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const BUILD_DIR = path.join(__dirname, '..', 'build');
const BUILD_INDEX = path.join(BUILD_DIR, 'index.html');
const DEFAULT_ADMIN_CREDENTIALS = [
  { id: 'admin', password: '1234', label: 'Admin' },
  { id: 'sscstu9307', password: 'sscstudent9333', label: 'Legacy Admin' },
];
const ENV_ADMIN_CREDENTIAL = process.env.CUBLI_ADMIN_ID && process.env.CUBLI_ADMIN_PASSWORD
  ? { id: process.env.CUBLI_ADMIN_ID, password: process.env.CUBLI_ADMIN_PASSWORD, label: 'Environment Admin' }
  : null;
const CLIENT_STALE_MS = Number(process.env.CUBLI_CLIENT_STALE_MS || 7000);
const LIVE_STALE_MS = Number(process.env.CUBLI_LIVE_STALE_MS || 1000);
const MAX_CHART_POINTS = 240;
const MAX_RAW_LINES = 60;
const MAX_BRIDGE_COMMANDS = 80;
const EULER_SEQUENCES = Object.freeze(['ZYX', 'XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY']);
const ENCODER_SYNC_THRESHOLD_MS = 1000;
const WHEEL_RPM_COMMAND_LIMIT = 800;
const DEFAULT_RPY_DISPLAY_SIGNS = Object.freeze({ roll: 1, pitch: 1, yaw: -1 });
const DEFAULT_BODY_RATE_WZ_DISPLAY_SIGN = 1;

const SOURCE_LABELS = {
  'server-serial': 'Server Remote Serial',
  'admin-web-serial': 'Admin Web Serial Bridge',
  'legacy-web-serial': 'Admin Web Serial Bridge',
  ble: 'Admin BLE',
  phone: 'Admin Phone Sensor',
};

fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const accessState = {
  adminClientId: null,
  adminLoginId: '',
  adminLabel: '',
  controllerClientId: null,
  clients: new Map(),
  log: [],
};

const liveStreamClients = new Set();

const sharedState = {
  latestSharedPacket: null,
  activeSharedSource: '',
  sourceLabel: '',
  publisherClientId: '',
  publisherDisplayName: '',
  publisherRole: '',
  publishedAt: null,
  latestDesiredAttitude: null,
  lastCommandInfo: null,
  chartData: [],
  rawLines: [],
  previousRatePacket: null,
  omegaEstimate: null,
};

const serialState = {
  port: null,
  parser: null,
  path: '',
  baudRate: 115200,
  isConnected: false,
  isOpening: false,
  connectedAt: null,
  lastError: '',
  lastRawLine: '',
  lastInvalidReason: '',
  lastReceivedAt: null,
  latestPacket: null,
  recentPackets: [],
  chartData: [],
  rawLines: [],
  counters: { valid: 0, invalid: 0, ignored: 0, warning: 0 },
  lastCommand: '',
};

const bridgeState = {
  sequence: 0,
  commandQueue: [],
};

let activeSessionId = '';
let activeSessionStartedAtMs = null;

function sendLiveStreamEvent(res, eventName, payload) {
  try {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch (_) {
    liveStreamClients.delete(res);
  }
}

function broadcastLiveStream(eventName, payload) {
  if (liveStreamClients.size === 0) return;
  liveStreamClients.forEach((client) => sendLiveStreamEvent(client, eventName, payload));
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

function strictFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function firstStrictFinite(values, fallback = null) {
  for (const value of values) {
    const number = strictFiniteNumber(value, null);
    if (number !== null) return number;
  }
  return fallback;
}

function getAdminCredentials() {
  const credentials = [...DEFAULT_ADMIN_CREDENTIALS];
  if (ENV_ADMIN_CREDENTIAL?.id && ENV_ADMIN_CREDENTIAL?.password) {
    const exists = credentials.some((item) => item.id === ENV_ADMIN_CREDENTIAL.id && item.password === ENV_ADMIN_CREDENTIAL.password);
    if (!exists) credentials.push(ENV_ADMIN_CREDENTIAL);
  }
  return credentials;
}

function findAdminCredential(id, password) {
  const adminId = String(id || '').trim();
  const adminPassword = String(password || '');
  return getAdminCredentials().find((credential) => (
    credential.id === adminId && credential.password === adminPassword
  )) || null;
}

function normalizeEulerSequence(sequence, fallback = 'ZYX') {
  const text = String(sequence || '').trim().toUpperCase();
  return EULER_SEQUENCES.includes(text) ? text : fallback;
}

function normalizeSign(value, fallback = 1) {
  const number = Number(value);
  if (number === -1) return -1;
  if (number === 1) return 1;
  return fallback === -1 ? -1 : 1;
}

function normalizeRpySigns(source = {}, fallback = DEFAULT_RPY_DISPLAY_SIGNS) {
  return {
    roll: normalizeSign(source.roll ?? source.rollSign, fallback.roll),
    pitch: normalizeSign(source.pitch ?? source.pitchSign, fallback.pitch),
    yaw: normalizeSign(source.yaw ?? source.yawSign, fallback.yaw),
  };
}

function signsLabel(signs = DEFAULT_RPY_DISPLAY_SIGNS) {
  const safeSigns = normalizeRpySigns(signs);
  return `[${safeSigns.roll > 0 ? '+' : '-'},${safeSigns.pitch > 0 ? '+' : '-'},${safeSigns.yaw > 0 ? '+' : '-'}]`;
}

function applyEulerDisplaySigns(euler = {}, signs = DEFAULT_RPY_DISPLAY_SIGNS) {
  const safeSigns = normalizeRpySigns(signs);
  return {
    roll: strictFiniteNumber(euler.roll, null) === null ? null : euler.roll * safeSigns.roll,
    pitch: strictFiniteNumber(euler.pitch, null) === null ? null : euler.pitch * safeSigns.pitch,
    yaw: strictFiniteNumber(euler.yaw, null) === null ? null : euler.yaw * safeSigns.yaw,
    sequence: euler.sequence,
  };
}

function encoderTimerDelta(timerX, timerY, timerZ) {
  const timers = [timerX, timerY, timerZ].map((value) => strictFiniteNumber(value, null));
  if (!timers.every((value) => value !== null)) return null;
  return Math.max(...timers) - Math.min(...timers);
}

function normalizeEncoderStatus({ explicitStatus = '', hasData, hasAllAxes, timerX, timerY, timerZ, updatedAt, now, freshMs }) {
  if (!hasData) return 'NONE';
  if (updatedAt && now - updatedAt > freshMs) return 'STALE';

  const explicit = String(explicitStatus || '').trim().toUpperCase();
  if (explicit === 'STALE' || explicit === 'HOLD_LAST' || explicit === 'MIXED') return explicit;
  if (!hasAllAxes) return 'PARTIAL';

  const delta = encoderTimerDelta(timerX, timerY, timerZ);
  if (delta !== null && delta > ENCODER_SYNC_THRESHOLD_MS) return 'MIXED';
  return 'LIVE';
}

function normalizeEncoderTelemetry(packet = {}, options = {}) {
  const nested = packet?.encoder || {};
  const now = finiteNumber(options.now, Date.now());
  const freshMs = finiteNumber(options.encoderFreshMs, LIVE_STALE_MS);
  const encoderEulerSequence = normalizeEulerSequence(options.encoderEulerSequence || packet.encoderEulerSequence || nested.eulerSequence);
  const encoderDisplaySigns = normalizeRpySigns({
    roll: options.encoderDisplayRollSign ?? packet.encoderDisplayRollSign ?? nested.displayRollSign,
    pitch: options.encoderDisplayPitchSign ?? packet.encoderDisplayPitchSign ?? nested.displayPitchSign,
    yaw: options.encoderDisplayYawSign ?? packet.encoderDisplayYawSign ?? nested.displayYawSign,
  }, DEFAULT_RPY_DISPLAY_SIGNS);
  const encX = firstStrictFinite([packet.enc_x_deg, packet.encoderXDeg, nested.x], null);
  const encY = firstStrictFinite([packet.enc_y_deg, packet.encoderYDeg, nested.y], null);
  const encZ = firstStrictFinite([packet.enc_z_deg, packet.encoderZDeg, nested.z], null);
  const rawQ0 = firstStrictFinite([packet.enc_q0, packet.encoderQ0, nested.q0], null);
  const rawQ1 = firstStrictFinite([packet.enc_q1, packet.encoderQ1, nested.q1], null);
  const rawQ2 = firstStrictFinite([packet.enc_q2, packet.encoderQ2, nested.q2], null);
  const rawQ3 = firstStrictFinite([packet.enc_q3, packet.encoderQ3, nested.q3], null);
  const encoderQ = [rawQ0, rawQ1, rawQ2, rawQ3].every((value) => value !== null)
    ? normalizeQuat([rawQ0, rawQ1, rawQ2, rawQ3])
    : null;
  const encQ0 = encoderQ ? encoderQ[0] : null;
  const encQ1 = encoderQ ? encoderQ[1] : null;
  const encQ2 = encoderQ ? encoderQ[2] : null;
  const encQ3 = encoderQ ? encoderQ[3] : null;
  const encoderEulerRaw = encoderQ ? quaternionToEulerDeg(encoderQ, encoderEulerSequence) : null;
  const encoderEuler = encoderEulerRaw ? applyEulerDisplaySigns(encoderEulerRaw, encoderDisplaySigns) : null;
  const timerX = firstStrictFinite([packet.enc_timer_x, packet.encoderTimerX, nested.timerX, nested.timer_x], null);
  const timerY = firstStrictFinite([packet.enc_timer_y, packet.encoderTimerY, nested.timerY, nested.timer_y], null);
  const timerZ = firstStrictFinite([packet.enc_timer_z, packet.encoderTimerZ, nested.timerZ, nested.timer_z], null);
  const encoderUpdatedAt = firstStrictFinite([packet.encoderUpdatedAt, nested.updatedAt], null);
  const hasEncoderData = [encX, encY, encZ, rawQ0, rawQ1, rawQ2, rawQ3, timerX, timerY, timerZ]
    .some((value) => value !== null);
  const hasAllAxes = [encX, encY, encZ].every((value) => value !== null);
  const hasValidQuaternion = Boolean(encoderQ);
  const encoderStatus = normalizeEncoderStatus({
    explicitStatus: packet.encoderStatus || nested.status,
    hasData: hasEncoderData,
    hasAllAxes,
    timerX,
    timerY,
    timerZ,
    updatedAt: encoderUpdatedAt,
    now,
    freshMs,
  });
  const encoderSource = packet.encoderSource || nested.source || (hasEncoderData ? 'Gimbal Rotary Encoder packet' : '');
  const encoderRpySource = encoderEuler ? `encoder quaternion ${encoderEulerSequence}, display signs ${signsLabel(encoderDisplaySigns)}` : '';

  return {
    enc_x_deg: encX,
    enc_y_deg: encY,
    enc_z_deg: encZ,
    encoderXDeg: encX,
    encoderYDeg: encY,
    encoderZDeg: encZ,
    enc_q0: encQ0,
    enc_q1: encQ1,
    enc_q2: encQ2,
    enc_q3: encQ3,
    encoderQ0: encQ0,
    encoderQ1: encQ1,
    encoderQ2: encQ2,
    encoderQ3: encQ3,
    enc_timer_x: timerX,
    enc_timer_y: timerY,
    enc_timer_z: timerZ,
    encoderTimerX: timerX,
    encoderTimerY: timerY,
    encoderTimerZ: timerZ,
    encoderUpdatedAt,
    encoderSource,
    encoderStatus,
    encoderEulerSequence,
    encoderDisplayRollSign: encoderDisplaySigns.roll,
    encoderDisplayPitchSign: encoderDisplaySigns.pitch,
    encoderDisplayYawSign: encoderDisplaySigns.yaw,
    encoderRawRollDeg: encoderEulerRaw?.roll ?? null,
    encoderRawPitchDeg: encoderEulerRaw?.pitch ?? null,
    encoderRawYawDeg: encoderEulerRaw?.yaw ?? null,
    encoderRollDeg: encoderEuler?.roll ?? null,
    encoderPitchDeg: encoderEuler?.pitch ?? null,
    encoderYawDeg: encoderEuler?.yaw ?? null,
    encoderRpySource,
    encoderHasQuaternion: hasValidQuaternion,
    encoderFresh: encoderStatus === 'LIVE',
    encoder: {
      x: encX,
      y: encY,
      z: encZ,
      q0: encQ0,
      q1: encQ1,
      q2: encQ2,
      q3: encQ3,
      timerX,
      timerY,
      timerZ,
      updatedAt: encoderUpdatedAt,
      source: encoderSource,
      status: encoderStatus,
      eulerSequence: encoderEulerSequence,
      displayRollSign: encoderDisplaySigns.roll,
      displayPitchSign: encoderDisplaySigns.pitch,
      displayYawSign: encoderDisplaySigns.yaw,
      rawRollDeg: encoderEulerRaw?.roll ?? null,
      rawPitchDeg: encoderEulerRaw?.pitch ?? null,
      rawYawDeg: encoderEulerRaw?.yaw ?? null,
      rollDeg: encoderEuler?.roll ?? null,
      pitchDeg: encoderEuler?.pitch ?? null,
      yawDeg: encoderEuler?.yaw ?? null,
      rpySource: encoderRpySource,
    },
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pushLimited(array, item, max) {
  array.push(item);
  if (array.length > max) array.splice(0, array.length - max);
}

function normalizeSourceKey(source) {
  const text = String(source || '').toLowerCase();
  if (text === 'server-serial' || text.includes('server')) return 'server-serial';
  if (text === 'admin-web-serial' || text === 'legacy-web-serial' || text.includes('web-serial') || text === 'serial') return 'admin-web-serial';
  if (text.includes('ble')) return 'ble';
  if (text.includes('phone')) return 'phone';
  return source || 'unknown';
}

function normalizeQuat(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const values = raw.map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm < 0.5 || norm > 1.5 || norm < 1e-9) return null;
  return values.map((value) => value / norm);
}

function quatDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

function quatConjugate(q) {
  return [q[0], -q[1], -q[2], -q[3]];
}

function quatMultiply(a, b) {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

function quaternionToMatrixElements(q) {
  const [w, x, y, z] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return {
    m11: 1 - (yy + zz),
    m12: xy - wz,
    m13: xz + wy,
    m21: xy + wz,
    m22: 1 - (xx + zz),
    m23: yz - wx,
    m31: xz - wy,
    m32: yz + wx,
    m33: 1 - (xx + yy),
  };
}

function quaternionToEulerDeg(rawQ, sequence = 'ZYX') {
  const q = normalizeQuat(rawQ);
  if (!q) return null;
  const order = normalizeEulerSequence(sequence);
  const { m11, m12, m13, m21, m22, m23, m31, m32, m33 } = quaternionToMatrixElements(q);
  let x = 0;
  let y = 0;
  let z = 0;
  const limit = 0.9999999;

  switch (order) {
    case 'XYZ':
      y = Math.asin(clamp(m13, -1, 1));
      if (Math.abs(m13) < limit) {
        x = Math.atan2(-m23, m33);
        z = Math.atan2(-m12, m11);
      } else {
        x = Math.atan2(m32, m22);
        z = 0;
      }
      break;
    case 'YXZ':
      x = Math.asin(-clamp(m23, -1, 1));
      if (Math.abs(m23) < limit) {
        y = Math.atan2(m13, m33);
        z = Math.atan2(m21, m22);
      } else {
        y = Math.atan2(-m31, m11);
        z = 0;
      }
      break;
    case 'ZXY':
      x = Math.asin(clamp(m32, -1, 1));
      if (Math.abs(m32) < limit) {
        y = Math.atan2(-m31, m33);
        z = Math.atan2(-m12, m22);
      } else {
        y = 0;
        z = Math.atan2(m21, m11);
      }
      break;
    case 'YZX':
      z = Math.asin(clamp(m21, -1, 1));
      if (Math.abs(m21) < limit) {
        x = Math.atan2(-m23, m22);
        y = Math.atan2(-m31, m11);
      } else {
        x = 0;
        y = Math.atan2(m13, m33);
      }
      break;
    case 'XZY':
      z = Math.asin(-clamp(m12, -1, 1));
      if (Math.abs(m12) < limit) {
        x = Math.atan2(m32, m22);
        y = Math.atan2(m13, m11);
      } else {
        x = Math.atan2(-m23, m33);
        y = 0;
      }
      break;
    case 'ZYX':
    default:
      y = Math.asin(-clamp(m31, -1, 1));
      if (Math.abs(m31) < limit) {
        x = Math.atan2(m32, m33);
        z = Math.atan2(m21, m11);
      } else {
        x = 0;
        z = Math.atan2(-m12, m22);
      }
      break;
  }

  const roll = x * 180 / Math.PI;
  const pitch = y * 180 / Math.PI;
  const yaw = z * 180 / Math.PI;
  if (![roll, pitch, yaw].every(Number.isFinite)) return null;
  return { roll, pitch, yaw, sequence: order };
}

function eulerDegToQuatZYX(rollDeg, pitchDeg, yawDeg) {
  const roll = finiteNumber(rollDeg);
  const pitch = finiteNumber(pitchDeg);
  const yaw = finiteNumber(yawDeg);
  if ([roll, pitch, yaw].some((value) => value === null)) return null;

  const r = roll * Math.PI / 180;
  const p = pitch * Math.PI / 180;
  const y = yaw * Math.PI / 180;
  const cr = Math.cos(r / 2);
  const sr = Math.sin(r / 2);
  const cp = Math.cos(p / 2);
  const sp = Math.sin(p / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  return normalizeQuat([
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
  ]);
}

function computeQerrDeg(qCurrent, desired) {
  const current = normalizeQuat(qCurrent);
  if (!current || !desired) return null;
  const qd = [desired.qd0 ?? desired.targetQd0, desired.qd1 ?? desired.targetQd1, desired.qd2 ?? desired.targetQd2, desired.qd3 ?? desired.targetQd3];
  const desiredQuat = Array.isArray(desired)
    ? normalizeQuat(desired)
    : qd.every((value) => strictFiniteNumber(value, null) !== null)
      ? normalizeQuat(qd)
    : eulerDegToQuatZYX(desired.rollDeg ?? desired.desiredRollDeg ?? desired.roll, desired.pitchDeg ?? desired.desiredPitchDeg ?? desired.pitch, desired.yawDeg ?? desired.desiredYawDeg ?? desired.yaw);
  if (!desiredQuat) return null;
  const dot = clamp(Math.abs(quatDot(current, desiredQuat)), -1, 1);
  const angleDeg = 2 * Math.acos(dot) * 180 / Math.PI;
  return Number.isFinite(angleDeg) ? angleDeg : null;
}

function estimateAngularRate(prevPacket, currentPacket) {
  if (!prevPacket || !currentPacket) return null;
  const prevTime = firstFinite([prevPacket.pcTimeMs, prevPacket.pc_time_ms, prevPacket.updatedAt, prevPacket.publishedAt], null);
  const nowTime = firstFinite([currentPacket.pcTimeMs, currentPacket.pc_time_ms, currentPacket.updatedAt, currentPacket.publishedAt], null);
  const dt = (nowTime - prevTime) / 1000;
  if (!Number.isFinite(dt) || dt < 0.005 || dt > 1.0) return null;
  const prevQ = normalizeQuat(prevPacket.q || [prevPacket.q0, prevPacket.q1, prevPacket.q2, prevPacket.q3]);
  let nowQ = normalizeQuat(currentPacket.q || [currentPacket.q0, currentPacket.q1, currentPacket.q2, currentPacket.q3]);
  if (!prevQ || !nowQ) return null;
  if (quatDot(prevQ, nowQ) < 0) nowQ = nowQ.map((value) => -value);
  let delta = normalizeQuat(quatMultiply(nowQ, quatConjugate(prevQ)));
  if (!delta) return null;
  if (delta[0] < 0) delta = delta.map((value) => -value);
  const angle = 2 * Math.acos(clamp(delta[0], -1, 1));
  let omegaRad = [0, 0, 0];
  if (angle > 1e-7) {
    const sinHalf = Math.sin(angle / 2);
    if (Math.abs(sinHalf) > 1e-9) {
      omegaRad = [delta[1], delta[2], delta[3]].map((axis) => axis / sinHalf * angle / dt);
    }
  }
  if (omegaRad.some((value) => !Number.isFinite(value))) return null;
  return { wx: omegaRad[0], wy: omegaRad[1], wz: omegaRad[2], valid: true, lastUpdatedAt: nowTime };
}

function lowPassRate(previous, next, alpha = 0.28) {
  if (!previous || !previous.valid) return next;
  return {
    ...next,
    wx: alpha * next.wx + (1 - alpha) * previous.wx,
    wy: alpha * next.wy + (1 - alpha) * previous.wy,
    wz: alpha * next.wz + (1 - alpha) * previous.wz,
  };
}

function normalizePublishedPacket(packet, source, identity) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    return { ok: false, error: 'packet object is required' };
  }

  const now = Date.now();
  const resolvedSource = normalizeSourceKey(source || packet.source || 'admin-web-serial');
  if (!SOURCE_LABELS[resolvedSource]) return { ok: false, error: 'Unsupported live packet source' };
  const imuEulerSequence = normalizeEulerSequence(packet.imuEulerSequence);
  const encoderEulerSequence = normalizeEulerSequence(packet.encoderEulerSequence);
  const imuDisplaySigns = normalizeRpySigns({
    roll: packet.imuDisplayRollSign,
    pitch: packet.imuDisplayPitchSign,
    yaw: packet.imuDisplayYawSign,
  }, DEFAULT_RPY_DISPLAY_SIGNS);
  const bodyRateWzDisplaySign = normalizeSign(packet.bodyRateWzDisplaySign, DEFAULT_BODY_RATE_WZ_DISPLAY_SIGN);

  const rawQ = Array.isArray(packet.q) && packet.q.length === 4 ? packet.q : [packet.q0, packet.q1, packet.q2, packet.q3];
  let q = normalizeQuat(rawQ);
  if (!q) return { ok: false, error: 'packet quaternion is invalid' };

  const previousQ = sharedState.latestSharedPacket?.q;
  if (Array.isArray(previousQ) && previousQ.length === 4 && quatDot(previousQ, q) < 0) {
    q = q.map((value) => -value);
  }

  const rawEuler = quaternionToEulerDeg(q, imuEulerSequence);
  if (!rawEuler) return { ok: false, error: 'packet quaternion could not be converted to Euler angles' };
  const euler = applyEulerDisplaySigns(rawEuler, imuDisplaySigns);

  const pcTimeMs = firstFinite([packet.pcTimeMs, packet.pc_time_ms, packet.updatedAt, packet.timestamp], now);
  const desired = sharedState.latestDesiredAttitude;
  const telemetryQerr = firstFinite([packet.qerrTelemetryDeg, packet.qerr_deg, packet.qerrDeg], null);
  const qerrDeg = telemetryQerr !== null ? telemetryQerr : computeQerrDeg(q, desired);
  const qerrSource = telemetryQerr !== null ? (packet.qerrSource || 'satellite telemetry') : (qerrDeg !== null ? 'computed fallback' : '');

  const wxTelemetry = firstFinite([packet.wxTelemetry, packet.wx], null);
  const wyTelemetry = firstFinite([packet.wyTelemetry, packet.wy], null);
  const wzTelemetry = firstFinite([packet.wzTelemetry, packet.wz], null);
  const incomingRateSource = String(packet.angularRateSource || '').toLowerCase();
  const hasTelemetryRate = [wxTelemetry, wyTelemetry, wzTelemetry].every((value) => value !== null)
    && !incomingRateSource.includes('computed')
    && !incomingRateSource.includes('estimated');

  let omega = sharedState.omegaEstimate;
  if (!hasTelemetryRate) {
    const estimated = estimateAngularRate(sharedState.previousRatePacket, { ...packet, q, pcTimeMs, updatedAt: pcTimeMs });
    if (estimated) {
      omega = lowPassRate(sharedState.omegaEstimate, estimated);
      sharedState.omegaEstimate = omega;
    }
  }
  sharedState.previousRatePacket = { q, pcTimeMs, updatedAt: pcTimeMs, seq: packet.seq };

  const rateFresh = Boolean(omega?.valid && omega.lastUpdatedAt && pcTimeMs - omega.lastUpdatedAt <= 1000);
  const wx = hasTelemetryRate ? wxTelemetry : (rateFresh ? omega.wx : null);
  const wy = hasTelemetryRate ? wyTelemetry : (rateFresh ? omega.wy : null);
  const wz = hasTelemetryRate ? wzTelemetry : (rateFresh ? omega.wz : null);
  const wzDisplay = wz === null ? null : wz * bodyRateWzDisplaySign;
  const angularRateSource = hasTelemetryRate ? (packet.angularRateSource || 'satellite body rate') : (rateFresh ? 'computed from quaternion' : '');
  const encoderTelemetry = normalizeEncoderTelemetry(packet, {
    now,
    encoderEulerSequence,
    encoderDisplayRollSign: packet.encoderDisplayRollSign,
    encoderDisplayPitchSign: packet.encoderDisplayPitchSign,
    encoderDisplayYawSign: packet.encoderDisplayYawSign,
  });

  const publishedAt = now;
  const normalized = {
    pcTimeMs,
    pc_time_ms: pcTimeMs,
    updatedAt: pcTimeMs,
    publishedAt,
    serverReceivedAt: new Date(publishedAt).toISOString(),
    serverReceivedAtMs: publishedAt,
    source: 'admin-web-serial',
    sourceLabel: SOURCE_LABELS['admin-web-serial'],
    publisherClientId: identity.clientId || packet.publisherClientId || '',
    publisherDisplayName: identity.displayName || identity.clientName || packet.publisherDisplayName || '',
    publisherRole: identity.role || packet.publisherRole || '',

    q0: q[0], q1: q[1], q2: q[2], q3: q[3], q,
    norm: Math.sqrt(rawQ.map(Number).reduce((sum, value) => sum + value * value, 0)),

    Roll_deg: euler.roll,
    Pitch_deg: euler.pitch,
    Yaw_deg: euler.yaw,
    rawRollDeg: rawEuler.roll,
    rawPitchDeg: rawEuler.pitch,
    rawYawDeg: rawEuler.yaw,
    rollDeg: euler.roll,
    pitchDeg: euler.pitch,
    yawDeg: euler.yaw,
    roll_deg: euler.roll,
    pitch_deg: euler.pitch,
    yaw_deg: euler.yaw,
    imuEulerSequence,
    imuDisplayRollSign: imuDisplaySigns.roll,
    imuDisplayPitchSign: imuDisplaySigns.pitch,
    imuDisplayYawSign: imuDisplaySigns.yaw,
    rpySource: `quaternion ${imuEulerSequence}, display signs ${signsLabel(imuDisplaySigns)}`,
    remoteRollDeg: firstFinite([packet.remoteRollDeg, packet.Roll_deg, packet.rollDeg, packet.roll_deg, packet.roll], null),
    remotePitchDeg: firstFinite([packet.remotePitchDeg, packet.Pitch_deg, packet.pitchDeg, packet.pitch_deg, packet.pitch], null),
    remoteYawDeg: firstFinite([packet.remoteYawDeg, packet.Yaw_deg, packet.yawDeg, packet.yaw_deg, packet.yaw], null),

    desired_roll_deg: desired?.rollDeg ?? null,
    desired_pitch_deg: desired?.pitchDeg ?? null,
    desired_yaw_deg: desired?.yawDeg ?? null,
    desiredRollDeg: desired?.rollDeg ?? null,
    desiredPitchDeg: desired?.pitchDeg ?? null,
    desiredYawDeg: desired?.yawDeg ?? null,
    targetInputRollDeg: desired?.inputRollDeg ?? null,
    targetInputPitchDeg: desired?.inputPitchDeg ?? null,
    targetInputYawDeg: desired?.inputYawDeg ?? null,
    targetRpySequence: desired?.targetRpySequence ?? '',
    targetRollSign: desired?.targetRollSign ?? null,
    targetPitchSign: desired?.targetPitchSign ?? null,
    targetYawSign: desired?.targetYawSign ?? null,
    targetQd0: desired?.qd0 ?? null,
    targetQd1: desired?.qd1 ?? null,
    targetQd2: desired?.qd2 ?? null,
    targetQd3: desired?.qd3 ?? null,
    qerr_deg: qerrDeg,
    qerrDeg,
    qerrSource,
    qerrComputed: qerrSource === 'computed fallback',

    wx,
    wy,
    wz,
    wzRaw: wz,
    wz_raw: wz,
    wzDisplay,
    wz_display: wzDisplay,
    bodyRateWzDisplaySign,
    angularRateSource,
    RPM1: finiteNumber(packet.RPM1, null),
    RPM2: finiteNumber(packet.RPM2, null),
    RPM3: finiteNumber(packet.RPM3, null),
    RPMcmd1: finiteNumber(packet.RPMcmd1, null),
    RPMcmd2: finiteNumber(packet.RPMcmd2, null),
    RPMcmd3: finiteNumber(packet.RPMcmd3, null),
    PWM1: finiteNumber(packet.PWM1, null),
    PWM2: finiteNumber(packet.PWM2, null),
    PWM3: finiteNumber(packet.PWM3, null),
    Tbodycmd_x_Nm: finiteNumber(packet.Tbodycmd_x_Nm, null),
    Tbodycmd_y_Nm: finiteNumber(packet.Tbodycmd_y_Nm, null),
    Tbodycmd_z_Nm: finiteNumber(packet.Tbodycmd_z_Nm, null),
    Tmotor1_Nm: finiteNumber(packet.Tmotor1_Nm, null),
    Tmotor2_Nm: finiteNumber(packet.Tmotor2_Nm, null),
    Tmotor3_Nm: finiteNumber(packet.Tmotor3_Nm, null),
    control_mode: packet.control_mode ?? '',
    EBIMU_status: packet.EBIMU_status ?? '',
    logging_status: packet.logging_status ?? '',
    timestamp: firstFinite([packet.timestamp, packet.ebimu_timestamp_ms, packet.ebimuTimestampMs], null),
    ebimu_timestamp_ms: firstFinite([packet.ebimu_timestamp_ms, packet.timestamp, packet.ebimuTimestampMs], null),
    ebimuTimestampMs: firstFinite([packet.ebimuTimestampMs, packet.ebimu_timestamp_ms, packet.timestamp], null),
    seq: firstFinite([packet.seq, packet.packetCount, packet.rxCount], null),
    rxCount: firstFinite([packet.rxCount, packet.packetCount, packet.seq], null),
    raw: typeof packet.raw === 'string' ? packet.raw : '',
    lastCommandKey: packet.lastCommandKey || sharedState.lastCommandInfo?.commandKey || '',
    lastCommandLabel: packet.lastCommandLabel || sharedState.lastCommandInfo?.label || '',
    lastCommandParams: packet.lastCommandParams || sharedState.lastCommandInfo?.params || {},
    lastCommandLineSent: packet.lastCommandLineSent || sharedState.lastCommandInfo?.serialLineSent || '',
    lastCommandAt: packet.lastCommandAt || sharedState.lastCommandInfo?.at || null,
    lastCommandByClientId: packet.lastCommandByClientId || sharedState.lastCommandInfo?.clientId || '',
    lastCommandAllowed: typeof packet.lastCommandAllowed === 'boolean' ? packet.lastCommandAllowed : sharedState.lastCommandInfo?.allowed ?? null,
    lastCommandDenied: Boolean(packet.lastCommandDenied || sharedState.lastCommandInfo?.denied),
    ...encoderTelemetry,
  };

  return { ok: true, packet: normalized };
}

function getLanAddressCandidates() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  Object.entries(interfaces).forEach(([name, items]) => {
    (items || []).forEach((item) => {
      const family = typeof item.family === 'string' ? item.family : `IPv${item.family}`;
      const address = String(item.address || '').trim();
      if (family !== 'IPv4' || item.internal || !address) return;
      if (address.startsWith('127.') || address.startsWith('169.254.')) return;
      const lowerName = String(name || '').toLowerCase();
      let priority = 20;
      if (/(wi-?fi|wireless|wlan)/.test(lowerName)) priority = 0;
      else if (/(ethernet|^eth|^en)/.test(lowerName)) priority = 5;
      if (/(virtual|vmware|virtualbox|docker|wsl|hyper-v|vethernet|loopback|bluetooth|tailscale|zerotier)/.test(lowerName)) priority += 100;
      candidates.push({ name, address, priority });
    });
  });
  const unique = new Map();
  candidates.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)).forEach((candidate) => {
    if (!unique.has(candidate.address)) unique.set(candidate.address, candidate);
  });
  return Array.from(unique.values());
}

function getServerInfo() {
  const lanCandidates = getLanAddressCandidates();
  const lanIp = lanCandidates[0]?.address || '';
  const host = lanIp || 'localhost';
  return {
    port: PORT,
    lanIp,
    lanCandidates: lanCandidates.map((candidate) => candidate.address),
    lanInterfaces: lanCandidates.map((candidate) => ({ name: candidate.name, address: candidate.address })),
    localUrl: `http://localhost:${PORT}`,
    localServerUrl: `http://localhost:${PORT}`,
    serverUrl: `http://${host}:${PORT}`,
    appUrlDev: `http://${host}:3000`,
    appUrlBuilt: `http://${host}:${PORT}`,
    localAppUrlDev: 'http://localhost:3000',
    servingBuild: fs.existsSync(BUILD_INDEX),
  };
}

function getBaseRole(clientId) {
  return clientId && clientId === accessState.adminClientId ? 'admin' : 'viewer';
}

function getEffectiveRole(clientId) {
  if (!clientId) return 'viewer';
  if (clientId === accessState.adminClientId) return 'admin';
  if (clientId === accessState.controllerClientId) return 'controller';
  return 'viewer';
}

function sanitizeClientName(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

function shortClientId(clientId = '') {
  const text = String(clientId || '').trim();
  return text ? text.slice(0, 8) : '';
}

function getStoredClientName(clientId = '') {
  const client = accessState.clients.get(clientId);
  return sanitizeClientName(client?.displayName || client?.clientName || '');
}

function getClientLabel(clientId = '') {
  return getStoredClientName(clientId) || shortClientId(clientId) || 'Unknown';
}

function decodeClientNameHeader(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return decodeURIComponent(text);
  } catch (_) {
    return '';
  }
}

function readClientName(req, clientId = '') {
  return sanitizeClientName(
    decodeClientNameHeader(req.get('x-cubli-client-name-encoded'))
      || req.get('x-cubli-client-name')
      || req.body?.displayName
      || req.body?.clientName
      || req.query?.displayName
      || req.query?.clientName
      || getStoredClientName(clientId)
      || shortClientId(clientId)
      || ''
  );
}

function isClientConnected(client, now = Date.now()) {
  const lastSeenMs = client?.lastSeenAt ? new Date(client.lastSeenAt).getTime() : 0;
  return Boolean(lastSeenMs && now - lastSeenMs <= CLIENT_STALE_MS);
}

function rememberClient(identity) {
  const safeIdentity = identity || {};
  const clientId = String(safeIdentity.clientId || '').trim();
  if (!clientId) return;
  const previous = accessState.clients.get(clientId) || {};
  const displayName = sanitizeClientName(safeIdentity.displayName || safeIdentity.clientName || previous?.displayName || previous?.clientName || shortClientId(clientId) || '');
  accessState.clients.set(clientId, {
    clientId,
    displayName,
    clientName: displayName,
    role: getBaseRole(clientId),
    connectedAt: previous.connectedAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    page: safeIdentity.page || previous.page || '',
    source: safeIdentity.source || previous.source || '',
  });
}

function cleanupStaleController() {
  const controllerId = accessState.controllerClientId;
  if (!controllerId) return;
  const controller = accessState.clients.get(controllerId);
  if (controller && isClientConnected(controller)) return;
  accessState.controllerClientId = null;
  appendAccessLog({ type: 'CONTROL_AUTO_REVOKED', previousControllerClientId: controllerId, previousControllerDisplayName: getClientLabel(controllerId) });
}

function cleanupStaleAdmin() {
  const adminId = accessState.adminClientId;
  if (!adminId) return false;
  const admin = accessState.clients.get(adminId);
  if (admin && isClientConnected(admin)) return false;
  accessState.adminClientId = null;
  accessState.adminLoginId = '';
  accessState.adminLabel = '';
  if (accessState.controllerClientId === adminId) accessState.controllerClientId = null;
  appendAccessLog({ type: 'ADMIN_AUTO_LOGOUT', previousAdminClientId: adminId, previousAdminDisplayName: getClientLabel(adminId), reason: admin ? 'admin heartbeat stale' : 'admin client missing' });
  return true;
}

function readClientIdentity(req) {
  const clientId = String(req.get('x-cubli-client-id') || req.body?.clientId || req.query?.clientId || '').trim();
  const displayName = readClientName(req, clientId);
  cleanupStaleAdmin();
  const identity = {
    clientId,
    displayName,
    clientName: displayName,
    page: String(req.get('x-cubli-page') || req.body?.page || req.query?.page || '').trim(),
    source: String(req.get('x-cubli-source') || req.body?.source || req.query?.source || '').trim(),
    role: getEffectiveRole(clientId),
  };
  rememberClient(identity);
  cleanupStaleAdmin();
  cleanupStaleController();
  identity.role = getEffectiveRole(clientId);
  return identity;
}

function getIdentity(req) {
  return readClientIdentity(req);
}

function readIdentity(req) {
  return getIdentity(req);
}

function publicAccessState(forClientId = '') {
  cleanupStaleAdmin();
  cleanupStaleController();
  const now = Date.now();
  const safeForClientId = String(forClientId || '').trim();
  const clients = Array.from(accessState.clients.values()).filter((client) => client?.clientId).map((client) => {
    const connected = isClientConnected(client, now);
    const displayName = sanitizeClientName(client?.displayName || client?.clientName || shortClientId(client?.clientId) || '');
    const clientId = String(client?.clientId || '').trim();
    return {
      ...client,
      clientId,
      displayName,
      clientName: displayName,
      role: getBaseRole(clientId),
      effectiveRole: getEffectiveRole(clientId),
      isAdmin: clientId === accessState.adminClientId,
      isController: clientId === accessState.controllerClientId,
      isMe: clientId === safeForClientId,
      connected,
      stale: !connected,
      lastSeen: client.lastSeenAt,
      lastSeenMs: client.lastSeenAt ? new Date(client.lastSeenAt).getTime() : null,
    };
  });
  const role = getEffectiveRole(safeForClientId);
  const selfName = getStoredClientName(safeForClientId);
  const controllerDisplayName = getStoredClientName(accessState.controllerClientId);
  const adminDisplayName = getStoredClientName(accessState.adminClientId);
  return {
    clientId: safeForClientId,
    displayName: selfName,
    clientName: selfName,
    role,
    myRole: role,
    myEffectiveRole: role,
    isAdmin: role === 'admin',
    isController: role === 'controller',
    adminClientId: accessState.adminClientId,
    adminDisplayName,
    adminClientName: adminDisplayName,
    adminLoginId: accessState.adminLoginId || '',
    adminLabel: accessState.adminLabel || '',
    controllerClientId: accessState.controllerClientId,
    controllerDisplayName,
    controllerClientName: controllerDisplayName,
    commandOwner: accessState.controllerClientId ? `Control assigned to: ${getClientLabel(accessState.controllerClientId)}` : 'Admin has control',
    connectedClientCount: clients.filter((client) => client.connected).length,
    clients,
    accessLog: accessState.log.slice(-20),
  };
}

function requireAdmin(req, res) {
  const identity = readIdentity(req);
  if (!identity.clientId || identity.role !== 'admin') {
    res.status(403).json({ ok: false, error: 'Admin permission is required', access: publicAccessState(identity.clientId) });
    return null;
  }
  return identity;
}

function appendAccessLog(event) {
  const row = { time: new Date().toISOString(), ...event };
  accessState.log.push(row);
  if (accessState.log.length > 80) accessState.log.splice(0, accessState.log.length - 80);
  return row;
}

function safeSessionId(raw) {
  const text = String(raw || '').trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(text) ? text : '';
}

function makeSessionId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `cubli_${stamp}_${crypto.randomBytes(4).toString('hex')}`;
}

function getSessionDir(sessionId) {
  const clean = safeSessionId(sessionId);
  return clean ? path.join(SESSIONS_DIR, clean) : null;
}

function sessionExists(sessionId) {
  const dir = getSessionDir(sessionId);
  return Boolean(dir && fs.existsSync(dir));
}

function appendJsonLines(filePath, rows) {
  fs.appendFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}

function appendActiveSessionSample(sample) {
  if (!activeSessionId || !sessionExists(activeSessionId)) return false;
  appendJsonLines(path.join(getSessionDir(activeSessionId), 'samples.jsonl'), [{ serverReceivedAt: new Date().toISOString(), ...sample }]);
  return true;
}

function appendActiveSessionEvent(event) {
  if (!activeSessionId || !sessionExists(activeSessionId)) return false;
  appendJsonLines(path.join(getSessionDir(activeSessionId), 'events.jsonl'), [{ serverReceivedAt: new Date().toISOString(), pcTimeMs: Date.now(), ...event }]);
  return true;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!text) return [];
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_) { return { raw: line, parseError: true }; }
  });
}

function normalizeRows(body, key) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.[key])) return body[key];
  if (body && typeof body === 'object') return [body];
  return [];
}

function setLatestSharedPacket(packet, meta = {}) {
  const source = normalizeSourceKey(meta.source || packet.source || 'admin-web-serial');
  const publishedAt = meta.publishedAt || Date.now();
  const sourceLabel = meta.sourceLabel || SOURCE_LABELS[source] || packet.sourceLabel || source;
  const encoderTelemetry = normalizeEncoderTelemetry(packet, {
    now: publishedAt,
    encoderEulerSequence: packet.encoderEulerSequence,
    encoderDisplayRollSign: packet.encoderDisplayRollSign,
    encoderDisplayPitchSign: packet.encoderDisplayPitchSign,
    encoderDisplayYawSign: packet.encoderDisplayYawSign,
  });
  const sharedPacket = {
    ...packet,
    ...encoderTelemetry,
    source,
    sourceLabel,
    publishedAt,
    publisherClientId: meta.publisherClientId ?? packet.publisherClientId ?? '',
    publisherDisplayName: sanitizeClientName(meta.publisherDisplayName ?? packet.publisherDisplayName ?? ''),
    publisherRole: meta.publisherRole ?? packet.publisherRole ?? '',
    Roll_deg: packet.Roll_deg ?? packet.roll_deg ?? packet.rollDeg ?? null,
    Pitch_deg: packet.Pitch_deg ?? packet.pitch_deg ?? packet.pitchDeg ?? null,
    Yaw_deg: packet.Yaw_deg ?? packet.yaw_deg ?? packet.yawDeg ?? null,
  };
  sharedState.latestSharedPacket = sharedPacket;
  sharedState.activeSharedSource = source;
  sharedState.sourceLabel = sourceLabel;
  sharedState.publisherClientId = sharedPacket.publisherClientId;
  sharedState.publisherDisplayName = sharedPacket.publisherDisplayName;
  sharedState.publisherRole = sharedPacket.publisherRole;
  sharedState.publishedAt = publishedAt;
  pushLimited(sharedState.chartData, {
    sample: sharedState.chartData.length + 1,
    time: sharedPacket.pc_time_ms ?? sharedPacket.pcTimeMs ?? publishedAt,
    roll: sharedPacket.roll_deg ?? sharedPacket.rollDeg,
    pitch: sharedPacket.pitch_deg ?? sharedPacket.pitchDeg,
    yaw: sharedPacket.yaw_deg ?? sharedPacket.yawDeg,
    qerr: sharedPacket.qerr_deg ?? sharedPacket.qerrDeg,
    wx: sharedPacket.wx,
    wy: sharedPacket.wy,
    wz: sharedPacket.wzDisplay ?? sharedPacket.wz,
    RPM1: sharedPacket.RPM1,
    RPM2: sharedPacket.RPM2,
    RPM3: sharedPacket.RPM3,
    RPMcmd1: sharedPacket.RPMcmd1,
    RPMcmd2: sharedPacket.RPMcmd2,
    RPMcmd3: sharedPacket.RPMcmd3,
    encX: sharedPacket.enc_x_deg ?? sharedPacket.encoderXDeg,
    encY: sharedPacket.enc_y_deg ?? sharedPacket.encoderYDeg,
    encZ: sharedPacket.enc_z_deg ?? sharedPacket.encoderZDeg,
    encoderRoll: sharedPacket.encoderStatus === 'LIVE' ? sharedPacket.encoderRollDeg : null,
    encoderPitch: sharedPacket.encoderStatus === 'LIVE' ? sharedPacket.encoderPitchDeg : null,
    encoderYaw: sharedPacket.encoderStatus === 'LIVE' ? sharedPacket.encoderYawDeg : null,
  }, MAX_CHART_POINTS);
  if (sharedPacket.raw) pushLimited(sharedState.rawLines, { time: publishedAt, raw: sharedPacket.raw, source, sourceLabel }, MAX_RAW_LINES);
  appendActiveSessionSample(sharedPacket);
  // High-rate stream packet. Keep this payload small; status/bridge/client
  // management data is still available through /api/state. Sending bridgeStatus
  // at 100 Hz made Viewer browsers stutter on slower PCs/phones.
  broadcastLiveStream('live', {
    ok: true,
    latestSharedPacket: sharedPacket,
    latestSharedPacketUpdatedAt: sharedState.publishedAt,
    latestSharedPacketAgeMs: 0,
    activeSharedSource: sharedState.activeSharedSource,
    publisherClientId: sharedState.publisherClientId,
    publisherDisplayName: sharedState.publisherDisplayName,
    publisherRole: sharedState.publisherRole,
    publishedAt: sharedState.publishedAt,
    liveStatus: 'LIVE',
  });
  return sharedPacket;
}

function sanitizeSharedState() {
  const storedPacket = sharedState.latestSharedPacket;
  const packet = storedPacket
    ? {
        ...storedPacket,
        ...normalizeEncoderTelemetry(storedPacket, {
          now: Date.now(),
          encoderEulerSequence: storedPacket.encoderEulerSequence,
          encoderDisplayRollSign: storedPacket.encoderDisplayRollSign,
          encoderDisplayPitchSign: storedPacket.encoderDisplayPitchSign,
          encoderDisplayYawSign: storedPacket.encoderDisplayYawSign,
        }),
      }
    : null;
  const ageMs = packet?.publishedAt ? Date.now() - packet.publishedAt : null;
  return {
    latestSharedPacket: packet,
    latestDesiredAttitude: sharedState.latestDesiredAttitude,
    lastCommandInfo: sharedState.lastCommandInfo,
    activeSharedSource: sharedState.activeSharedSource || '',
    sourceLabel: sharedState.sourceLabel || '',
    publisherClientId: sharedState.publisherClientId || '',
    publisherDisplayName: sharedState.publisherDisplayName || '',
    publisherRole: sharedState.publisherRole || '',
    publishedAt: sharedState.publishedAt || null,
    latestSharedPacketAgeMs: ageMs,
    ageMs,
    liveStatus: !packet ? 'NONE' : ageMs > LIVE_STALE_MS ? 'STALE' : 'LIVE',
    chartData: sharedState.chartData,
    rawLines: sharedState.rawLines,
  };
}

function serialDiagnostics({ portCount = null, message = '' } = {}) {
  return {
    platform: process.platform,
    cwd: process.cwd(),
    nodeVersion: process.version,
    serialportAvailable: Boolean(SerialPort && ReadlineParser),
    serialportLoadError,
    portCount,
    message: message || (SerialPort && ReadlineParser ? 'serialport package is available.' : 'serialport package is not available. Run npm install.'),
  };
}

function sanitizeSerialStatus(clientId = '') {
  const shared = sanitizeSharedState();
  return {
    serialportAvailable: Boolean(SerialPort && ReadlineParser),
    serialportLoadError,
    isConnected: serialState.isConnected,
    isOpening: serialState.isOpening,
    path: serialState.path,
    baudRate: serialState.baudRate,
    connectedAt: serialState.connectedAt,
    isStale: serialState.isConnected && serialState.lastReceivedAt ? Date.now() - serialState.lastReceivedAt > 700 : false,
    lastError: serialState.lastError,
    lastRawLine: shared.rawLines[shared.rawLines.length - 1]?.raw || serialState.lastRawLine,
    lastInvalidReason: serialState.lastInvalidReason,
    lastReceivedAt: serialState.lastReceivedAt,
    latestPacket: shared.latestSharedPacket || serialState.latestPacket,
    latestSharedPacket: shared.latestSharedPacket,
    activeSharedSource: shared.activeSharedSource,
    sourceLabel: shared.sourceLabel,
    publisherClientId: shared.publisherClientId,
    publisherDisplayName: shared.publisherDisplayName,
    publisherRole: shared.publisherRole,
    publishedAt: shared.publishedAt,
    liveStatus: shared.liveStatus,
    latestSharedPacketAgeMs: shared.latestSharedPacketAgeMs,
    ageMs: shared.ageMs,
    latestDesiredAttitude: shared.latestDesiredAttitude,
    lastCommandInfo: shared.lastCommandInfo,
    recentPackets: serialState.recentPackets,
    chartData: shared.chartData.length ? shared.chartData : serialState.chartData,
    rawLines: shared.rawLines.length ? shared.rawLines : serialState.rawLines,
    validCount: serialState.counters.valid,
    invalidCount: serialState.counters.invalid,
    ignoredCount: serialState.counters.ignored,
    warningCount: serialState.counters.warning,
    lastCommand: serialState.lastCommand,
    bridge: bridgeStatus(),
    diagnostics: serialDiagnostics(),
    serverInfo: getServerInfo(),
    access: publicAccessState(clientId),
  };
}

function makeCommandDescriptor(commandKey, label, serialLine, params = {}) {
  return { commandKey, label, serialLine, params };
}

function assertRange(value, label, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return number;
}

function formatGain(value) {
  return assertRange(value, 'Attitude gain', 0, 10).toFixed(3);
}

function formatWheelRpm(value, label = 'Wheel RPM') {
  return Math.round(assertRange(value, label, -WHEEL_RPM_COMMAND_LIMIT, WHEEL_RPM_COMMAND_LIMIT));
}

function buildSerialCommandFromKey(commandKey, params = {}) {
  const key = String(commandKey || '').trim();
  switch (key) {
    // Firmware currently exposes TARE as the known runtime reference reset.
    // Keep these command keys distinct so firmware-specific CUBLI_INIT/ENC_TARE
    // lines can be swapped in later without changing the web/server contract.
    case 'cubliInitialize': return makeCommandDescriptor(key, 'Cubli Initialize', 'TARE', { usesFirmwareCommand: 'TARE' });
    case 'encoderInitialize':
    case 'encoderTare': return makeCommandDescriptor(key, 'Gimbal Encoder Initialize', 'TARE', { usesFirmwareCommand: 'TARE' });
    case 'tare': return makeCommandDescriptor(key, 'Set Zero / Tare', 'TARE');
    case 'stop': return makeCommandDescriptor(key, 'Stop / Motor Stop', 'STOP');
    case 'emergencyStop': return makeCommandDescriptor(key, 'Emergency Stop', 'STOP');
    case 'status': return makeCommandDescriptor(key, 'Status', 'STATUS?');
    case 'macInfo': return makeCommandDescriptor(key, 'MAC Info', 'MAC?');
    case 'wheelRpmX': {
      const rpm = formatWheelRpm(params.rpm ?? params.value ?? params.x ?? params.target1, 'Wheel X RPM');
      return makeCommandDescriptor(key, 'Wheel RPM X', `RPM,1,${rpm}`, { axis: 1, rpm });
    }
    case 'wheelRpmY': {
      const rpm = formatWheelRpm(params.rpm ?? params.value ?? params.y ?? params.target1, 'Wheel Y RPM');
      return makeCommandDescriptor(key, 'Wheel RPM Y', `RPM,2,${rpm}`, { axis: 2, rpm });
    }
    case 'wheelRpmZ': {
      const rpm = formatWheelRpm(params.rpm ?? params.value ?? params.z ?? params.target1, 'Wheel Z RPM');
      return makeCommandDescriptor(key, 'Wheel RPM Z', `RPM,3,${rpm}`, { axis: 3, rpm });
    }
    case 'wheelRpmAll': {
      const x = formatWheelRpm(params.x ?? params.rpmX ?? params.r1 ?? params.target1 ?? params.rpm ?? 0, 'Wheel X RPM');
      const y = formatWheelRpm(params.y ?? params.rpmY ?? params.r2 ?? params.target2 ?? params.rpm ?? 0, 'Wheel Y RPM');
      const z = formatWheelRpm(params.z ?? params.rpmZ ?? params.r3 ?? params.target3 ?? params.rpm ?? 0, 'Wheel Z RPM');
      return makeCommandDescriptor(key, 'Wheel RPM All', `RPMALL,${x},${y},${z}`, { x, y, z });
    }
    case 'wheelRpmStop': return makeCommandDescriptor(key, 'Stop RPM Test', 'RPMSTOP');
    case 'targetAttitude': {
      const roll = Number(params.roll ?? params.target1 ?? 0) || 0;
      const pitch = Number(params.pitch ?? params.target2 ?? 0) || 0;
      const yaw = Number(params.yaw ?? params.target3 ?? 0) || 0;
      return makeCommandDescriptor(key, 'Send Target Attitude', `CMD,1,${roll},${pitch},${yaw},0`, {
        ...params,
        roll,
        pitch,
        yaw,
      });
    }
    case 'ebimuDefault': return makeCommandDescriptor(key, 'EBIMU Default Setup', 'EBIMU_DEFAULT');
    case 'ebimuStart': return makeCommandDescriptor(key, 'EBIMU Start', 'EBIMU_START');
    case 'ebimuStop': return makeCommandDescriptor(key, 'EBIMU Stop', 'EBIMU_STOP');
    case 'magOff': return makeCommandDescriptor(key, 'Mag Off', 'MAG_OFF');
    case 'magOn': return makeCommandDescriptor(key, 'Mag On', 'MAG_ON');
    case 'magAuto': return makeCommandDescriptor(key, 'Mag Auto', 'MAG_AUTO');
    case 'gyro250': return makeCommandDescriptor(key, '250 dps', 'GYRO_250');
    case 'gyro500': return makeCommandDescriptor(key, '500 dps', 'GYRO_500');
    case 'gyro1000': return makeCommandDescriptor(key, '1000 dps', 'GYRO_1000');
    case 'gyro2000': return makeCommandDescriptor(key, '2000 dps', 'GYRO_2000');
    case 'acc2g': return makeCommandDescriptor(key, '2 g', 'ACC_2G');
    case 'acc4g': return makeCommandDescriptor(key, '4 g', 'ACC_4G');
    case 'acc8g': return makeCommandDescriptor(key, '8 g', 'ACC_8G');
    case 'acc16g': return makeCommandDescriptor(key, '16 g', 'ACC_16G');
    case 'accFactor': {
      const factor = assertRange(params.factor ?? params.value, 'Accel filter factor', 1, 50);
      return makeCommandDescriptor(key, 'Accel Filter Factor', `ACCF,${factor}`, { factor });
    }
    case 'attitudeKp': {
      const kx = formatGain(params.kx ?? params.x ?? params.target1);
      const ky = formatGain(params.ky ?? params.y ?? params.target2);
      const kz = formatGain(params.kz ?? params.z ?? params.target3);
      return makeCommandDescriptor(key, 'Attitude Kp', `KP,${kx},${ky},${kz}`, {
        kx: Number(kx),
        ky: Number(ky),
        kz: Number(kz),
      });
    }
    case 'attitudeKd': {
      const dx = formatGain(params.dx ?? params.x ?? params.target1);
      const dy = formatGain(params.dy ?? params.y ?? params.target2);
      const dz = formatGain(params.dz ?? params.z ?? params.target3);
      return makeCommandDescriptor(key, 'Attitude Kd', `KD,${dx},${dy},${dz}`, {
        dx: Number(dx),
        dy: Number(dy),
        dz: Number(dz),
      });
    }
    default: throw new Error('Unsupported serial command');
  }
}

function makeBridgeCommandId() {
  bridgeState.sequence += 1;
  return `bridge-${Date.now().toString(36)}-${bridgeState.sequence.toString(36)}`;
}

function publicBridgeCommand(command) {
  if (!command) return null;
  const displayName = sanitizeClientName(command.displayName || command.clientName || getStoredClientName(command.clientId));
  const adminDisplayName = sanitizeClientName(command.adminDisplayName || command.adminClientName || getStoredClientName(command.adminClientId));
  return { ...command, displayName, clientName: displayName, adminDisplayName, adminClientName: adminDisplayName };
}

function bridgeStatus() {
  const now = Date.now();
  const adminBridgeLive = Boolean(sharedState.latestSharedPacket?.source === 'admin-web-serial' && sharedState.publishedAt && now - sharedState.publishedAt <= LIVE_STALE_MS);
  const pendingCount = bridgeState.commandQueue.filter((command) => command.status === 'pending' || command.status === 'dispatching').length;
  return {
    enabledByServer: true,
    source: 'admin-web-serial',
    sourceLabel: SOURCE_LABELS['admin-web-serial'],
    adminBridgeLive,
    pendingCount,
    recentCommands: bridgeState.commandQueue.slice(-12).map(publicBridgeCommand),
    lastBridgeCommand: publicBridgeCommand(bridgeState.commandQueue[bridgeState.commandQueue.length - 1]),
  };
}

function setLastCommandInfo(command, options = {}) {
  const now = Date.now();
  const info = {
    pcTimeMs: now,
    at: new Date(now).toISOString(),
    clientId: command.clientId,
    displayName: sanitizeClientName(command.displayName || command.clientName || getStoredClientName(command.clientId)),
    clientName: sanitizeClientName(command.displayName || command.clientName || getStoredClientName(command.clientId)),
    role: command.role,
    commandId: command.commandId || '',
    commandKey: command.commandKey,
    label: command.label,
    params: command.params || {},
    serialLineSent: options.sentLine || '',
    allowed: options.ok !== false,
    denied: options.ok === false,
    reason: options.reason || options.error || '',
    source: 'admin-web-serial',
    bridgeStatus: command.status,
  };
  sharedState.lastCommandInfo = info;
  if (options.ok === true && command.commandKey === 'targetAttitude') {
    sharedState.latestDesiredAttitude = {
      rollDeg: Number(command.params.roll) || 0,
      pitchDeg: Number(command.params.pitch) || 0,
      yawDeg: Number(command.params.yaw) || 0,
      inputRollDeg: Number(command.params.inputRoll) || 0,
      inputPitchDeg: Number(command.params.inputPitch) || 0,
      inputYawDeg: Number(command.params.inputYaw) || 0,
      targetRpySequence: command.params.targetRpySequence || command.params.targetSequence || 'ZYX',
      targetRollSign: normalizeSign(command.params.targetRollSign, 1),
      targetPitchSign: normalizeSign(command.params.targetPitchSign, 1),
      targetYawSign: normalizeSign(command.params.targetYawSign, -1),
      qd0: strictFiniteNumber(command.params.qd0, null),
      qd1: strictFiniteNumber(command.params.qd1, null),
      qd2: strictFiniteNumber(command.params.qd2, null),
      qd3: strictFiniteNumber(command.params.qd3, null),
      updatedAt: info.at,
      updatedAtMs: now,
      clientId: command.clientId,
      label: command.label,
      source: 'last_commanded_desired_attitude',
    };
  }
  if (sharedState.latestSharedPacket) {
    sharedState.latestSharedPacket = {
      ...sharedState.latestSharedPacket,
      latestDesiredAttitude: sharedState.latestDesiredAttitude,
      desired_roll_deg: sharedState.latestDesiredAttitude?.rollDeg ?? sharedState.latestSharedPacket.desired_roll_deg ?? null,
      desired_pitch_deg: sharedState.latestDesiredAttitude?.pitchDeg ?? sharedState.latestSharedPacket.desired_pitch_deg ?? null,
      desired_yaw_deg: sharedState.latestDesiredAttitude?.yawDeg ?? sharedState.latestSharedPacket.desired_yaw_deg ?? null,
      desiredRollDeg: sharedState.latestDesiredAttitude?.rollDeg ?? sharedState.latestSharedPacket.desiredRollDeg ?? null,
      desiredPitchDeg: sharedState.latestDesiredAttitude?.pitchDeg ?? sharedState.latestSharedPacket.desiredPitchDeg ?? null,
      desiredYawDeg: sharedState.latestDesiredAttitude?.yawDeg ?? sharedState.latestSharedPacket.desiredYawDeg ?? null,
      lastCommandKey: info.commandKey,
      lastCommandLabel: info.label,
      lastCommandParams: info.params,
      lastCommandLineSent: info.serialLineSent,
      lastCommandAt: info.at,
      lastCommandByClientId: info.clientId,
      lastCommandAllowed: info.allowed,
      lastCommandDenied: info.denied,
    };
  }
  return info;
}

function statePayload(clientId = '') {
  const shared = sanitizeSharedState();
  const displayName = getStoredClientName(clientId);
  return {
    ok: true,
    clientId,
    displayName,
    clientName: displayName,
    role: getEffectiveRole(clientId),
    serverInfo: getServerInfo(),
    access: publicAccessState(clientId),
    latestSharedPacket: shared.latestSharedPacket,
    latestSharedPacketAgeMs: shared.latestSharedPacketAgeMs,
    latestDesiredAttitude: shared.latestDesiredAttitude,
    activeSharedSource: shared.activeSharedSource,
    publisherClientId: shared.publisherClientId,
    publisherDisplayName: shared.publisherDisplayName,
    publisherRole: shared.publisherRole,
    publishedAt: shared.publishedAt,
    liveStatus: shared.liveStatus,
    bridge: bridgeStatus(),
    serialStatus: serialState.isConnected ? 'connected' : serialState.isOpening ? 'opening' : 'disconnected',
    serial: sanitizeSerialStatus(clientId),
  };
}

app.get('/api/health', (req, res) => {
  const identity = readIdentity(req);
  res.json({
    ok: true,
    service: 'cubli-server-sync',
    apiVersion: 'web-serial-bridge-v4',
    endpoints: {
      health: true,
      livePublish: true,
      liveLatest: true,
      state: true,
      adminLogin: true,
    },
    time: new Date().toISOString(),
    dataDir: DATA_DIR,
    serverInfo: getServerInfo(),
    serial: {
      available: Boolean(SerialPort && ReadlineParser),
      connected: serialState.isConnected,
      path: serialState.path,
      error: serialState.lastError || serialportLoadError || '',
      diagnostics: serialDiagnostics(),
    },
    access: publicAccessState(identity.clientId),
  });
});

app.get('/api/state', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const identity = readIdentity(req);
  res.json(statePayload(identity.clientId));
});

app.get('/api/live/stream', (req, res) => {
  readIdentity(req);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();

  liveStreamClients.add(res);
  sendLiveStreamEvent(res, 'state', { ok: true, ...sanitizeSharedState(), bridge: bridgeStatus() });

  const heartbeat = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch (_) {
      clearInterval(heartbeat);
      liveStreamClients.delete(res);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    liveStreamClients.delete(res);
  });
});

app.get('/api/live/latest', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const identity = readIdentity(req);
  const shared = sanitizeSharedState();
  res.json({
    ok: true,
    latestSharedPacket: shared.latestSharedPacket,
    latestSharedPacketUpdatedAt: shared.publishedAt,
    latestSharedPacketAgeMs: shared.latestSharedPacketAgeMs,
    activeSharedSource: shared.activeSharedSource,
    publisherClientId: shared.publisherClientId,
    publisherDisplayName: shared.publisherDisplayName,
    publisherRole: shared.publisherRole,
    publishedAt: shared.publishedAt,
    liveStatus: shared.liveStatus,
    latestDesiredAttitude: shared.latestDesiredAttitude,
    bridge: bridgeStatus(),
    access: publicAccessState(identity.clientId),
  });
});

app.post('/api/live/publish-fast', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const identity = requireAdmin(req, res);
  if (!identity) return;
  if (!req.body?.packet) {
    return res.status(400).json({ ok: false, error: 'packet is required' });
  }

  const normalized = normalizePublishedPacket(req.body.packet, req.body.source || req.body.packet.source || 'admin-web-serial', identity);
  if (!normalized.ok) {
    return res.status(400).json({ ok: false, error: normalized.error || 'Invalid live packet' });
  }

  setLatestSharedPacket(normalized.packet, {
    source: 'admin-web-serial',
    sourceLabel: SOURCE_LABELS['admin-web-serial'],
    publisherClientId: identity.clientId,
    publisherDisplayName: identity.displayName,
    publisherRole: 'admin',
    publishedAt: Date.now(),
  });

  // Fast path for 100 Hz local bridge. The Viewer receives the packet through
  // /api/live/stream, so the Admin does not need a full JSON response here.
  return res.status(204).end();
});

app.post('/api/live/publish', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const identity = requireAdmin(req, res);
  if (!identity) return;
  if (!req.body?.packet) {
    return res.status(400).json({ ok: false, error: 'packet is required', latestSharedPacket: sharedState.latestSharedPacket, access: publicAccessState(identity.clientId) });
  }

  const normalized = normalizePublishedPacket(req.body.packet, req.body.source || req.body.packet.source || 'admin-web-serial', identity);
  if (!normalized.ok) {
    return res.status(400).json({ ok: false, error: normalized.error || 'Invalid live packet', latestSharedPacket: sharedState.latestSharedPacket, access: publicAccessState(identity.clientId) });
  }

  const latestSharedPacket = setLatestSharedPacket(normalized.packet, {
    source: 'admin-web-serial',
    sourceLabel: SOURCE_LABELS['admin-web-serial'],
    publisherClientId: identity.clientId,
    publisherDisplayName: identity.displayName,
    publisherRole: 'admin',
    publishedAt: Date.now(),
  });
  const shared = sanitizeSharedState();
  res.json({
    ok: true,
    latestSharedPacket,
    latestDesiredAttitude: shared.latestDesiredAttitude,
    activeSharedSource: shared.activeSharedSource,
    publisherClientId: shared.publisherClientId,
    publisherDisplayName: shared.publisherDisplayName,
    publisherRole: shared.publisherRole,
    publishedAt: shared.publishedAt,
    latestSharedPacketAgeMs: shared.latestSharedPacketAgeMs,
    liveStatus: shared.liveStatus,
    bridge: bridgeStatus(),
    access: publicAccessState(identity.clientId),
  });
});

app.post('/api/live/command', (req, res) => {
  const identity = requireAdmin(req, res);
  if (!identity) return;
  let descriptor;
  try {
    descriptor = buildSerialCommandFromKey(req.body?.commandKey, req.body?.params || {});
  } catch (err) {
    return res.status(400).json({ ok: false, error: err?.message || 'Unsupported live command', access: publicAccessState(identity.clientId) });
  }
  const command = { ...descriptor, clientId: identity.clientId, displayName: identity.displayName, clientName: identity.displayName, role: identity.role, status: 'direct' };
  const info = setLastCommandInfo(command, { ok: true, reason: 'admin web serial direct command state' });
  appendActiveSessionEvent({ source: 'admin-web-serial', eventType: 'ADMIN_DIRECT_COMMAND', label: descriptor.label, clientId: identity.clientId, displayName: identity.displayName, clientName: identity.displayName, role: identity.role, commandKey: descriptor.commandKey, params: descriptor.params });
  res.json({ ok: true, latestDesiredAttitude: sharedState.latestDesiredAttitude, lastCommandInfo: info, latestSharedPacket: sharedState.latestSharedPacket, access: publicAccessState(identity.clientId) });
});

app.post('/api/bridge/command-request', (req, res) => {
  const identity = readIdentity(req);
  if (!identity.clientId) return res.status(400).json({ ok: false, error: 'clientId is required', access: publicAccessState(identity.clientId) });
  if (identity.role !== 'admin' && identity.role !== 'controller') return res.status(403).json({ ok: false, error: 'Viewer cannot send commands', access: publicAccessState(identity.clientId) });

  let descriptor;
  try {
    descriptor = buildSerialCommandFromKey(req.body?.commandKey, req.body?.params || {});
  } catch (err) {
    return res.status(400).json({ ok: false, error: err?.message || 'Unsupported bridge command', access: publicAccessState(identity.clientId) });
  }

  const now = Date.now();
  const command = {
    commandId: makeBridgeCommandId(),
    requestedAt: new Date(now).toISOString(),
    requestedAtMs: now,
    clientId: identity.clientId,
    displayName: identity.displayName,
    clientName: identity.displayName,
    role: identity.role,
    commandKey: descriptor.commandKey,
    label: descriptor.label,
    params: descriptor.params || {},
    serialLine: descriptor.serialLine,
    status: 'pending',
  };
  bridgeState.commandQueue.push(command);
  if (bridgeState.commandQueue.length > MAX_BRIDGE_COMMANDS) bridgeState.commandQueue.splice(0, bridgeState.commandQueue.length - MAX_BRIDGE_COMMANDS);
  setLastCommandInfo(command, { ok: null, reason: 'queued for Admin Web Serial Bridge' });
  appendActiveSessionEvent({ source: 'admin-web-serial', eventType: 'BRIDGE_COMMAND_QUEUED', label: command.label, clientId: identity.clientId, displayName: identity.displayName, clientName: identity.displayName, role: identity.role, commandId: command.commandId, commandKey: command.commandKey, params: command.params, allowed: true });
  res.status(202).json({ ok: true, commandId: command.commandId, command: publicBridgeCommand(command), lastCommandInfo: sharedState.lastCommandInfo, latestDesiredAttitude: sharedState.latestDesiredAttitude, latestSharedPacket: sharedState.latestSharedPacket, bridge: bridgeStatus(), access: publicAccessState(identity.clientId) });
});

app.get('/api/bridge/commands/poll', (req, res) => {
  const identity = requireAdmin(req, res);
  if (!identity) return;
  const now = Date.now();
  const pending = bridgeState.commandQueue.filter((command) => command.status === 'pending').slice(0, 10);
  pending.forEach((command) => {
    command.status = 'dispatching';
    command.adminClientId = identity.clientId;
    command.adminDisplayName = identity.displayName;
    command.adminClientName = identity.displayName;
    command.dispatchedAt = new Date(now).toISOString();
    command.dispatchedAtMs = now;
    setLastCommandInfo(command, { ok: null, reason: 'Admin bridge is relaying command...' });
  });
  res.json({ ok: true, commands: pending.map(publicBridgeCommand), bridge: bridgeStatus(), access: publicAccessState(identity.clientId) });
});

app.post('/api/bridge/commands/:commandId/ack', (req, res) => {
  const identity = requireAdmin(req, res);
  if (!identity) return;
  const command = bridgeState.commandQueue.find((item) => item.commandId === String(req.params.commandId || '').trim());
  if (!command) return res.status(404).json({ ok: false, error: 'Bridge command not found', bridge: bridgeStatus(), access: publicAccessState(identity.clientId) });
  const now = Date.now();
  const ok = Boolean(req.body?.ok);
  const sentLine = String(req.body?.sentLine || command.serialLine || '').trim();
  const error = ok ? '' : String(req.body?.error || 'Admin Web Serial bridge failed to send command').trim();
  command.status = ok ? 'executed' : 'failed';
  command.ok = ok;
  command.sentLine = ok ? sentLine : '';
  command.error = error;
  command.adminClientId = identity.clientId;
  command.adminDisplayName = identity.displayName;
  command.adminClientName = identity.displayName;
  command.ackedAt = new Date(now).toISOString();
  command.ackedAtMs = now;
  const info = setLastCommandInfo(command, { ok, sentLine: ok ? sentLine : '', error, reason: ok ? 'Admin bridge relayed command.' : error });
  appendActiveSessionEvent({ source: 'admin-web-serial', eventType: ok ? 'BRIDGE_COMMAND_EXECUTED' : 'BRIDGE_COMMAND_FAILED', label: command.label, clientId: command.clientId, displayName: getStoredClientName(command.clientId), clientName: getStoredClientName(command.clientId), role: command.role, adminClientId: identity.clientId, adminDisplayName: identity.displayName, adminClientName: identity.displayName, commandId: command.commandId, commandKey: command.commandKey, params: command.params, serialLineSent: ok ? sentLine : '', allowed: ok, reason: error });
  res.json({ ok: true, command: publicBridgeCommand(command), lastCommandInfo: info, latestDesiredAttitude: sharedState.latestDesiredAttitude, latestSharedPacket: sharedState.latestSharedPacket, bridge: bridgeStatus(), access: publicAccessState(identity.clientId) });
});

app.post('/api/admin/login', (req, res) => {
  const identity = readIdentity(req);
  const adminId = String(req.body?.adminId || '').trim();
  const password = String(req.body?.password || '');
  if (!identity.clientId) return res.status(400).json({ ok: false, error: 'clientId is required', access: publicAccessState(identity.clientId) });
  cleanupStaleAdmin();
  const credential = findAdminCredential(adminId, password);
  if (!credential) {
    appendAccessLog({ type: 'ADMIN_LOGIN_FAILED', clientId: identity.clientId, displayName: identity.displayName, clientName: identity.displayName });
    return res.status(403).json({ ok: false, error: 'Invalid Admin ID or password', access: publicAccessState(identity.clientId) });
  }
  if (accessState.adminClientId && accessState.adminClientId !== identity.clientId) {
    const currentAdmin = accessState.clients.get(accessState.adminClientId);
    if (currentAdmin && isClientConnected(currentAdmin)) {
      appendAccessLog({
        type: 'ADMIN_LOGIN_BLOCKED',
        clientId: identity.clientId,
        displayName: identity.displayName,
        clientName: identity.displayName,
        currentAdminClientId: accessState.adminClientId,
        currentAdminDisplayName: getClientLabel(accessState.adminClientId),
      });
      return res.status(409).json({ ok: false, error: 'Another Admin is already logged in', access: publicAccessState(identity.clientId) });
    }
    cleanupStaleAdmin();
  }
  const previousAdminClientId = accessState.adminClientId && accessState.adminClientId !== identity.clientId
    ? accessState.adminClientId
    : null;
  accessState.adminClientId = identity.clientId;
  accessState.adminLoginId = credential.id;
  accessState.adminLabel = credential.label || 'Admin';
  if (accessState.controllerClientId === identity.clientId || accessState.controllerClientId === previousAdminClientId) {
    accessState.controllerClientId = null;
  }
  rememberClient(identity);
  appendAccessLog({
    type: previousAdminClientId ? 'ADMIN_TAKEOVER_LOGIN' : 'ADMIN_LOGIN',
    adminClientId: identity.clientId,
    adminDisplayName: identity.displayName,
    adminClientName: identity.displayName,
    adminLoginId: credential.id,
    adminLabel: credential.label || 'Admin',
    previousAdminClientId,
    previousAdminDisplayName: getClientLabel(previousAdminClientId),
  });
  res.json({ ok: true, access: publicAccessState(identity.clientId) });
});

app.post('/api/admin/logout', (req, res) => {
  const identity = readIdentity(req);
  if (identity.clientId && accessState.adminClientId === identity.clientId) {
    appendAccessLog({ type: 'ADMIN_LOGOUT', adminClientId: identity.clientId, adminDisplayName: identity.displayName, adminClientName: identity.displayName, previousControllerClientId: accessState.controllerClientId || null, previousControllerDisplayName: getClientLabel(accessState.controllerClientId) });
    accessState.adminClientId = null;
    accessState.adminLoginId = '';
    accessState.adminLabel = '';
    accessState.controllerClientId = null;
    rememberClient(identity);
  }
  res.json({ ok: true, access: publicAccessState(identity.clientId) });
});

app.get('/api/auth/state', (req, res) => {
  const identity = readIdentity(req);
  res.json({ ok: true, clientId: identity.clientId, displayName: identity.displayName, clientName: identity.displayName, role: identity.role, access: publicAccessState(identity.clientId) });
});

app.get('/api/access/state', (req, res) => {
  const identity = readIdentity(req);
  res.json({ ok: true, access: publicAccessState(identity.clientId) });
});

app.get('/api/clients', (req, res) => {
  const identity = requireAdmin(req, res);
  if (!identity) return;
  res.json({ ok: true, clients: publicAccessState(identity.clientId).clients, access: publicAccessState(identity.clientId) });
});

function grantControl(req, res) {
  const identity = requireAdmin(req, res);
  if (!identity) return;
  const targetClientId = String(req.params.clientId || req.body?.targetClientId || '').trim();
  const target = accessState.clients.get(targetClientId);
  if (!targetClientId || !target) return res.status(400).json({ ok: false, error: 'Target Viewer client is required', access: publicAccessState(identity.clientId) });
  if (targetClientId === accessState.adminClientId) return res.status(400).json({ ok: false, error: 'Control can only be granted to a Viewer', access: publicAccessState(identity.clientId) });
  if (!isClientConnected(target)) return res.status(400).json({ ok: false, error: 'Target client is disconnected or stale', access: publicAccessState(identity.clientId) });
  const previousControllerClientId = accessState.controllerClientId;
  accessState.controllerClientId = targetClientId;
  appendAccessLog({
    type: previousControllerClientId && previousControllerClientId !== targetClientId ? 'CONTROL_REPLACED' : 'CONTROL_GRANTED',
    adminClientId: identity.clientId,
    adminDisplayName: identity.displayName,
    adminClientName: identity.displayName,
    targetClientId,
    targetDisplayName: getClientLabel(targetClientId),
    targetClientName: getClientLabel(targetClientId),
    previousControllerClientId: previousControllerClientId || null,
    previousControllerDisplayName: getClientLabel(previousControllerClientId),
  });
  res.json({ ok: true, access: publicAccessState(identity.clientId) });
}

function revokeControl(req, res) {
  const identity = requireAdmin(req, res);
  if (!identity) return;
  const previousControllerClientId = accessState.controllerClientId;
  accessState.controllerClientId = null;
  appendAccessLog({ type: 'CONTROL_REVOKED', adminClientId: identity.clientId, adminDisplayName: identity.displayName, adminClientName: identity.displayName, previousControllerClientId: previousControllerClientId || null, previousControllerDisplayName: getClientLabel(previousControllerClientId) });
  res.json({ ok: true, access: publicAccessState(identity.clientId) });
}

app.post('/api/clients/:clientId/grant-control', grantControl);
app.post('/api/clients/:clientId/revoke-control', revokeControl);
app.post('/api/access/grant-control', grantControl);
app.post('/api/access/revoke-control', revokeControl);
app.post('/api/access/reset', (req, res) => {
  const identity = requireAdmin(req, res);
  if (!identity) return;
  const previousControllerClientId = accessState.controllerClientId;
  const previousControllerDisplayName = getClientLabel(previousControllerClientId);
  accessState.controllerClientId = null;
  accessState.clients.clear();
  rememberClient(identity);
  appendAccessLog({ type: 'ACCESS_RESET', adminClientId: identity.clientId, adminDisplayName: identity.displayName, adminClientName: identity.displayName, previousControllerClientId: previousControllerClientId || null, previousControllerDisplayName });
  res.json({ ok: true, access: publicAccessState(identity.clientId) });
});

app.post('/api/sessions', (req, res) => {
  const identity = requireAdmin(req, res);
  if (!identity) return;
  const sessionId = makeSessionId();
  const dir = getSessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const startedAt = req.body?.startedAt || new Date().toISOString();
  activeSessionId = sessionId;
  activeSessionStartedAtMs = Number.isFinite(new Date(startedAt).getTime()) ? new Date(startedAt).getTime() : Date.now();
  const meta = { sessionId, startedAt, clientName: identity.displayName || req.body?.clientName || 'Cubli Remote Web GUI', displayName: identity.displayName || req.body?.displayName || '', app: req.body?.app || 'Cubli ADCS Simulator', createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'samples.jsonl'), '', { flag: 'a' });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '', { flag: 'a' });
  res.status(201).json(meta);
});

app.post('/api/sessions/:sessionId/samples', (req, res) => {
  readIdentity(req);
  const sessionId = safeSessionId(req.params.sessionId);
  if (!sessionId || !sessionExists(sessionId)) return res.status(404).json({ ok: false, error: 'session not found' });
  const rows = normalizeRows(req.body, 'samples');
  if (!rows.length) return res.status(400).json({ ok: false, error: 'samples array is required' });
  const now = new Date().toISOString();
  appendJsonLines(path.join(getSessionDir(sessionId), 'samples.jsonl'), rows.map((row) => ({ serverReceivedAt: now, ...row })));
  res.json({ ok: true, sessionId, received: rows.length });
});

app.post('/api/sessions/:sessionId/events', (req, res) => {
  readIdentity(req);
  const sessionId = safeSessionId(req.params.sessionId);
  if (!sessionId || !sessionExists(sessionId)) return res.status(404).json({ ok: false, error: 'session not found' });
  const rows = normalizeRows(req.body, 'events');
  if (!rows.length) return res.status(400).json({ ok: false, error: 'events array is required' });
  const now = new Date().toISOString();
  appendJsonLines(path.join(getSessionDir(sessionId), 'events.jsonl'), rows.map((row) => ({ serverReceivedAt: now, ...row })));
  res.json({ ok: true, sessionId, received: rows.length });
});

app.post('/api/sessions/:sessionId/stop', (req, res) => {
  const identity = requireAdmin(req, res);
  if (!identity) return;
  const sessionId = safeSessionId(req.params.sessionId);
  if (!sessionId || !sessionExists(sessionId)) return res.status(404).json({ ok: false, error: 'session not found' });
  const endedAt = req.body?.endedAt || new Date().toISOString();
  appendActiveSessionEvent({ source: 'server', eventType: 'SESSION_STOP', label: 'Stop Session', detail: { endedAt, clientId: identity.clientId, role: identity.role } });
  if (activeSessionId === sessionId) {
    activeSessionId = '';
    activeSessionStartedAtMs = null;
  }
  res.json({ ok: true, sessionId, endedAt });
});

app.get('/api/sessions/:sessionId/download', (req, res) => {
  const sessionId = safeSessionId(req.params.sessionId);
  if (!sessionId || !sessionExists(sessionId)) return res.status(404).json({ ok: false, error: 'session not found' });
  const dir = getSessionDir(sessionId);
  const metaPath = path.join(dir, 'meta.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : { sessionId };
  const payload = { meta, samples: readJsonl(path.join(dir, 'samples.jsonl')), events: readJsonl(path.join(dir, 'events.jsonl')) };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${sessionId}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

app.get('/api/serial/status', (req, res) => {
  const identity = readIdentity(req);
  res.json({ ok: true, ...sanitizeSerialStatus(identity.clientId) });
});

app.get('/api/serial/ports', async (req, res) => {
  readIdentity(req);
  if (!SerialPort) return res.status(500).json({ ok: false, error: serialportLoadError || 'serialport package is not available. Run npm install.', ports: [], diagnostics: serialDiagnostics({ portCount: 0 }) });
  try {
    const ports = await SerialPort.list();
    const normalized = ports.map((port) => ({ path: port.path || '', manufacturer: port.manufacturer || '', serialNumber: port.serialNumber || '', vendorId: port.vendorId || '', productId: port.productId || '', friendlyName: port.friendlyName || '', pnpId: port.pnpId || '' }));
    res.json({ ok: true, ports: normalized, diagnostics: serialDiagnostics({ portCount: normalized.length, message: `Found ${normalized.length} serial port(s).` }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'SerialPort.list failed', ports: [], diagnostics: serialDiagnostics({ portCount: 0 }) });
  }
});

app.post('/api/serial/connect', (req, res) => {
  const identity = requireAdmin(req, res);
  if (!identity) return;
  res.status(400).json({ ok: false, error: 'Server Serial Direct Mode is disabled in this build. Use Admin Web Serial Bridge.', ...sanitizeSerialStatus(identity.clientId) });
});
app.post('/api/serial/disconnect', (req, res) => {
  const identity = requireAdmin(req, res);
  if (!identity) return;
  res.json({ ok: true, ...sanitizeSerialStatus(identity.clientId) });
});
app.post('/api/serial/clear-stats', (req, res) => {
  const identity = requireAdmin(req, res);
  if (!identity) return;
  serialState.lastRawLine = '';
  serialState.lastInvalidReason = '';
  serialState.recentPackets = [];
  serialState.chartData = [];
  serialState.rawLines = [];
  serialState.counters = { valid: 0, invalid: 0, ignored: 0, warning: 0 };
  res.json({ ok: true, ...sanitizeSerialStatus(identity.clientId) });
});

function serialCommandResponse(req, res, emergency = false) {
  const identity = readIdentity(req);
  if (!identity.clientId) return res.status(400).json({ ok: false, error: 'clientId is required', status: sanitizeSerialStatus(identity.clientId) });
  if (!emergency && identity.role !== 'admin' && identity.role !== 'controller') return res.status(403).json({ ok: false, error: 'Viewer cannot send commands', status: sanitizeSerialStatus(identity.clientId) });
  if (emergency && identity.role !== 'admin') return res.status(403).json({ ok: false, error: 'Admin permission is required', status: sanitizeSerialStatus(identity.clientId) });
  res.status(400).json({ ok: false, error: 'Server Serial Direct Mode is disabled. Use bridge command request.', status: sanitizeSerialStatus(identity.clientId) });
}
app.post('/api/serial/command', (req, res) => serialCommandResponse(req, res, false));
app.post('/api/serial/controller', (req, res) => serialCommandResponse(req, res, false));
app.post('/api/serial/tare', (req, res) => serialCommandResponse(req, res, false));
app.post('/api/serial/stop', (req, res) => serialCommandResponse(req, res, false));
app.post('/api/serial/emergency-stop', (req, res) => serialCommandResponse(req, res, true));

if (fs.existsSync(BUILD_INDEX)) {
  app.use(express.static(BUILD_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(BUILD_INDEX);
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err?.message || 'server error' });
});

app.listen(PORT, HOST, () => {
  const lanAddresses = getLanAddressCandidates().map((candidate) => candidate.address);
  console.log(`[Cubli Server] listening on ${HOST}:${PORT}`);
  console.log(`[Cubli Server] Server local: http://localhost:${PORT}`);
  if (lanAddresses.length) lanAddresses.forEach((address) => console.log(`[Cubli Server] Server LAN:   http://${address}:${PORT}`));
  else console.log('[Cubli Server] Server LAN:   no non-internal IPv4 address found');
  console.log(`[Cubli Server] data dir: ${DATA_DIR}`);
  console.log(fs.existsSync(BUILD_INDEX) ? `[Cubli Server] static app: ${BUILD_DIR}` : '[Cubli Server] static app: build folder not found; run npm run build to serve React from this server');
  console.log(SerialPort && ReadlineParser ? '[Cubli Server] serial bridge: optional serialport package ready' : `[Cubli Server] serial bridge: optional direct mode disabled (${serialportLoadError})`);
});
