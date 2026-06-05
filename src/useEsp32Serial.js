import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_ENCODER_ANGLE_TO_QUAT_SEQUENCE,
  DEFAULT_ENCODER_DISPLAY_SIGNS,
  DEFAULT_ENCODER_FRESH_MS,
  DEFAULT_ENCODER_TIMER_SPREAD_MS,
  applyEulerDisplaySigns,
  eulerDegToQuat,
  normalizeEulerSequence,
  normalizeLivePacket,
  normalizeRpySigns,
  normalizeSign,
  quaternionToEulerDeg,
} from './telemetryNormalize';

const MAX_BUFFER_LENGTH = 262144;
const MAX_RECENT_PACKETS = 10;
const MAX_CHART_POINTS = 90;
const MAX_CSV_LOG_QUEUE = 50000;
const BAUD_RATE = 115200;
const UI_FLUSH_INTERVAL_MS = 100;
const CSV_UI_STATS_INTERVAL_MS = 500;
const ENCODER_AGE_FRESH_MS = DEFAULT_ENCODER_FRESH_MS;
const ENCODER_SYNC_THRESHOLD_MS = DEFAULT_ENCODER_TIMER_SPREAD_MS;
const WEB_SERIAL_UNSUPPORTED_MESSAGE = 'Web Serial is supported only on Chrome/Edge desktop over HTTPS or localhost';
const PORT_BUSY_MESSAGE = 'Port busy: close Arduino Serial Monitor or another app using the COM port';

const DEFAULT_PACKET = {
  source: 'none',
  pc_time_ms: 0,
  q0: 1,
  q1: 0,
  q2: 0,
  q3: 0,
  q: [1, 0, 0, 0],
  norm: 1,
  roll_deg: 0,
  pitch_deg: 0,
  yaw_deg: 0,
  desired_roll_deg: null,
  desired_pitch_deg: null,
  desired_yaw_deg: null,
  desiredRollDeg: null,
  desiredPitchDeg: null,
  desiredYawDeg: null,
  latestDesiredAttitude: null,
  ebimu_timestamp_ms: 0,
  seq: 0,
  rxCount: 0,
  enc_x_deg: null,
  enc_y_deg: null,
  enc_z_deg: null,
  encoderXDeg: null,
  encoderYDeg: null,
  encoderZDeg: null,
  enc_q0: null,
  enc_q1: null,
  enc_q2: null,
  enc_q3: null,
  encoderQ0: null,
  encoderQ1: null,
  encoderQ2: null,
  encoderQ3: null,
  enc_timer_x: null,
  enc_timer_y: null,
  enc_timer_z: null,
  enc_age_x: null,
  enc_age_y: null,
  enc_age_z: null,
  encoderTimerX: null,
  encoderTimerY: null,
  encoderTimerZ: null,
  encoderAgeX: null,
  encoderAgeY: null,
  encoderAgeZ: null,
  encoderUpdatedAt: null,
  encoderSource: '',
  encoderStatus: 'NONE',
  encoderAngleToQuatSequence: 'ZYX',
  encoderEulerSequence: 'ZYX',
  encoderQuatSource: '',
  encoderRollDeg: null,
  encoderPitchDeg: null,
  encoderYawDeg: null,
  encoderRpySource: '',
  rawRollDeg: 0,
  rawPitchDeg: 0,
  rawYawDeg: 0,
  imuDisplayRollSign: 1,
  imuDisplayPitchSign: 1,
  imuDisplayYawSign: 1,
  encoderRawRollDeg: null,
  encoderRawPitchDeg: null,
  encoderRawYawDeg: null,
  encoderDisplayRollSign: 1,
  encoderDisplayPitchSign: 1,
  encoderDisplayYawSign: 1,
  wzRaw: null,
  wzDisplay: null,
  bodyRateWzDisplaySign: 1,
  encoderHasQuaternion: false,
  encoderFresh: false,
  imuEulerSequence: 'ZYX',
  rpySource: 'quaternion ZYX',
  encoder: {
    x: null,
    y: null,
    z: null,
    q0: null,
    q1: null,
    q2: null,
    q3: null,
    timerX: null,
    timerY: null,
    timerZ: null,
    ageX: null,
    ageY: null,
    ageZ: null,
    updatedAt: null,
    source: '',
    status: 'NONE',
    angleToQuatSequence: 'ZYX',
    eulerSequence: 'ZYX',
    quatSource: '',
    rollDeg: null,
    pitchDeg: null,
    yawDeg: null,
    rpySource: '',
  },
  raw: '',
  updatedAt: 0,
};

function cleanLine(line) {
  return String(line || '')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '')
    .trim();
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseOptionalNumberToken(token) {
  const text = String(token ?? '').trim();
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'nan') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function firstFiniteValue(values, fallback = null) {
  for (const value of values) {
    const number = finiteOrNull(value);
    if (number !== null) return number;
  }
  return fallback;
}

function detectCsvSampleType(packet = {}) {
  const explicit = String(packet.sample_type || packet.sampleType || '').trim().toUpperCase();
  if (explicit === 'TEL' || explicit === 'IMU' || explicit === 'ENC' || explicit === 'COMMAND') return explicit;

  const rawPrefix = String(packet.raw_prefix || packet.rawPrefix || '').trim().toUpperCase();
  if (rawPrefix === 'TEL' || rawPrefix === 'IMU' || rawPrefix === 'ENC') return rawPrefix;
  if (rawPrefix === 'CMD' || rawPrefix === 'COMMAND') return 'COMMAND';

  if (packet.encoderOnly || String(packet.source || '').toUpperCase().includes('ENC')) return 'ENC';
  if (String(packet.source || '').toUpperCase().includes('COMMAND')) return 'COMMAND';
  if ([packet.q0, packet.q1, packet.q2, packet.q3].every((value) => finiteOrNull(value) !== null)) return 'TEL';
  return '';
}

function resolveCsvSampleClock(packet = {}, lastClock = null, now = Date.now()) {
  const packetTime = firstFiniteValue([
    packet.timestamp,
    packet.ebimu_timestamp_ms,
    packet.ebimuTimestampMs,
  ], null);
  const pcTime = firstFiniteValue([
    packet.pcTimeMs,
    packet.pc_time_ms,
  ], null);
  const previousPacketTime = lastClock?.packetTimeMs ?? null;
  const previousPcTime = lastClock?.pcTimeMs ?? null;
  const baseClock = {
    packetTimeMs: packetTime ?? previousPacketTime,
    pcTimeMs: pcTime ?? previousPcTime,
  };

  if (packetTime !== null && packetTime >= 0) {
    if (previousPacketTime === null || packetTime > previousPacketTime) {
      return { ...baseClock, source: 'packet', timeMs: packetTime };
    }
  }

  if (pcTime !== null && pcTime >= 0) {
    if (previousPcTime === null || pcTime > previousPcTime) {
      return { ...baseClock, source: 'pc', timeMs: pcTime };
    }
  }

  const receivedTime = firstFiniteValue([packet.updatedAt, now], now);
  return {
    ...baseClock,
    source: 'received',
    timeMs: Math.max(0, receivedTime),
  };
}

function buildDesiredAttitude(roll, pitch, yaw, sequence = 'ZYX', now = Date.now()) {
  const inputRoll = finiteOrNull(roll) ?? 0;
  const inputPitch = finiteOrNull(pitch) ?? 0;
  const inputYaw = finiteOrNull(yaw) ?? 0;
  const targetRpySequence = normalizeEulerSequence(sequence, 'ZYX');
  const qd = eulerDegToQuat(inputRoll, inputPitch, inputYaw, targetRpySequence) || [1, 0, 0, 0];
  return {
    rollDeg: inputRoll,
    pitchDeg: inputPitch,
    yawDeg: inputYaw,
    inputRollDeg: inputRoll,
    inputPitchDeg: inputPitch,
    inputYawDeg: inputYaw,
    targetRpySequence,
    qd0: qd[0],
    qd1: qd[1],
    qd2: qd[2],
    qd3: qd[3],
    updatedAt: new Date(now).toISOString(),
    updatedAtMs: now,
    source: 'local_target_attitude_command',
  };
}

function patchPacketWithDesired(packet = {}, desired = null) {
  if (!desired) return packet;
  return {
    ...packet,
    latestDesiredAttitude: desired,
    desired_roll_deg: desired.rollDeg,
    desired_pitch_deg: desired.pitchDeg,
    desired_yaw_deg: desired.yawDeg,
    desiredRollDeg: desired.rollDeg,
    desiredPitchDeg: desired.pitchDeg,
    desiredYawDeg: desired.yawDeg,
    targetInputRollDeg: desired.inputRollDeg,
    targetInputPitchDeg: desired.inputPitchDeg,
    targetInputYawDeg: desired.inputYawDeg,
    targetRpySequence: desired.targetRpySequence,
    targetQd0: desired.qd0,
    targetQd1: desired.qd1,
    targetQd2: desired.qd2,
    targetQd3: desired.qd3,
  };
}

function hasIncomingEncoderData(encoder = {}) {
  return [
    'enc_x_deg', 'encoderXDeg', 'enc_y_deg', 'encoderYDeg', 'enc_z_deg', 'encoderZDeg',
    'enc_q0', 'encoderQ0', 'enc_q1', 'encoderQ1', 'enc_q2', 'encoderQ2', 'enc_q3', 'encoderQ3',
    'enc_timer_x', 'encoderTimerX', 'enc_timer_y', 'encoderTimerY', 'enc_timer_z', 'encoderTimerZ',
    'enc_age_x', 'encoderAgeX', 'enc_age_y', 'encoderAgeY', 'enc_age_z', 'encoderAgeZ',
  ].some((key) => Object.prototype.hasOwnProperty.call(encoder || {}, key))
    || Boolean(encoder?.encoder);
}

function encoderTimerDelta(timerX, timerY, timerZ) {
  const timers = [timerX, timerY, timerZ].map(finiteOrNull);
  if (!timers.every((value) => value !== null)) return null;
  return Math.max(...timers) - Math.min(...timers);
}

function normalizeEncoderStatus({
  explicitStatus = '',
  hasData,
  hasCompletePose,
  hasPartialQuaternion,
  hasInvalidQuaternion,
  timerX,
  timerY,
  timerZ,
  ageX,
  ageY,
  ageZ,
  updatedAt,
  now,
}) {
  if (!hasData) return 'NONE';
  if (updatedAt && now - updatedAt > ENCODER_AGE_FRESH_MS) return 'STALE';
  const ages = [ageX, ageY, ageZ].map(finiteOrNull).filter((value) => value !== null);
  if (ages.length > 0 && Math.max(...ages) > ENCODER_AGE_FRESH_MS) return 'STALE';

  const explicit = String(explicitStatus || '').trim().toUpperCase();
  if (['STALE', 'HOLD_LAST', 'MIXED', 'PARTIAL', 'INVALID'].includes(explicit)) return explicit;
  if (hasInvalidQuaternion) return 'INVALID';
  if (hasPartialQuaternion || !hasCompletePose) return 'PARTIAL';

  const delta = encoderTimerDelta(timerX, timerY, timerZ);
  if (delta !== null && delta > ENCODER_SYNC_THRESHOLD_MS) return 'MIXED';
  return 'LIVE';
}

function serialErrorMessage(err) {
  const message = String(err?.message || err || '').trim();
  if (!message) return 'Serial port open failed';
  if (/no port selected|user cancelled|user canceled|cancelled|canceled/i.test(message)) {
    return 'Serial port selection was cancelled.';
  }
  if (/already open|failed to open serial port|busy|access denied|denied|in use|networkerror/i.test(message)) {
    return PORT_BUSY_MESSAGE;
  }
  if (/not supported|navigator\.serial|web serial/i.test(message)) {
    return WEB_SERIAL_UNSUPPORTED_MESSAGE;
  }
  return message;
}

function makeEncoderFields(input = {}, fallback = {}, options = {}) {
  const useFallback = options.useFallback !== false;
  const now = finiteOrNull(options.now) ?? Date.now();
  const encoderEulerSequence = normalizeEulerSequence(
    options.encoderEulerSequence || input.encoderEulerSequence || input.encoder?.eulerSequence || fallback.encoderEulerSequence || fallback.encoder?.eulerSequence
  );
  const encoderAngleToQuatSequence = normalizeEulerSequence(
    options.encoderAngleToQuatSequence
      || input.encoderAngleToQuatSequence
      || input.encoder?.angleToQuatSequence
      || fallback.encoderAngleToQuatSequence
      || fallback.encoder?.angleToQuatSequence,
    DEFAULT_ENCODER_ANGLE_TO_QUAT_SEQUENCE
  );
  const encoderDisplaySigns = normalizeRpySigns({
    roll: options.encoderDisplayRollSign ?? input.encoderDisplayRollSign ?? input.encoder?.displayRollSign ?? fallback.encoderDisplayRollSign ?? fallback.encoder?.displayRollSign,
    pitch: options.encoderDisplayPitchSign ?? input.encoderDisplayPitchSign ?? input.encoder?.displayPitchSign ?? fallback.encoderDisplayPitchSign ?? fallback.encoder?.displayPitchSign,
    yaw: options.encoderDisplayYawSign ?? input.encoderDisplayYawSign ?? input.encoder?.displayYawSign ?? fallback.encoderDisplayYawSign ?? fallback.encoder?.displayYawSign,
  }, DEFAULT_ENCODER_DISPLAY_SIGNS);
  const fallbackValue = (snakeKey, camelKey, nestedKey, nestedAltKey = nestedKey) => (
    useFallback
      ? (fallback[snakeKey] ?? fallback[camelKey] ?? fallback.encoder?.[nestedKey] ?? fallback.encoder?.[nestedAltKey] ?? null)
      : null
  );

  const incomingX = firstFiniteValue([input.enc_x_deg, input.encoderXDeg, input.encoder?.x], null);
  const incomingY = firstFiniteValue([input.enc_y_deg, input.encoderYDeg, input.encoder?.y], null);
  const incomingZ = firstFiniteValue([input.enc_z_deg, input.encoderZDeg, input.encoder?.z], null);
  const encX = incomingX ?? fallbackValue('enc_x_deg', 'encoderXDeg', 'x');
  const encY = incomingY ?? fallbackValue('enc_y_deg', 'encoderYDeg', 'y');
  const encZ = incomingZ ?? fallbackValue('enc_z_deg', 'encoderZDeg', 'z');
  const timerX = firstFiniteValue([input.enc_timer_x, input.encoderTimerX, input.encoder?.timerX, input.encoder?.timer_x], fallbackValue('enc_timer_x', 'encoderTimerX', 'timerX', 'timer_x'));
  const timerY = firstFiniteValue([input.enc_timer_y, input.encoderTimerY, input.encoder?.timerY, input.encoder?.timer_y], fallbackValue('enc_timer_y', 'encoderTimerY', 'timerY', 'timer_y'));
  const timerZ = firstFiniteValue([input.enc_timer_z, input.encoderTimerZ, input.encoder?.timerZ, input.encoder?.timer_z], fallbackValue('enc_timer_z', 'encoderTimerZ', 'timerZ', 'timer_z'));
  const ageX = firstFiniteValue([input.enc_age_x, input.encoderAgeX, input.encoder?.ageX, input.encoder?.age_x], fallbackValue('enc_age_x', 'encoderAgeX', 'ageX', 'age_x'));
  const ageY = firstFiniteValue([input.enc_age_y, input.encoderAgeY, input.encoder?.ageY, input.encoder?.age_y], fallbackValue('enc_age_y', 'encoderAgeY', 'ageY', 'age_y'));
  const ageZ = firstFiniteValue([input.enc_age_z, input.encoderAgeZ, input.encoder?.ageZ, input.encoder?.age_z], fallbackValue('enc_age_z', 'encoderAgeZ', 'ageZ', 'age_z'));
  const updatedAt = firstFiniteValue([input.encoderUpdatedAt, input.encoder?.updatedAt], fallbackValue('encoderUpdatedAt', 'encoderUpdatedAt', 'updatedAt'));
  const rawQ0 = firstFiniteValue([input.enc_q0, input.encoderQ0, input.encoder?.q0], fallbackValue('enc_q0', 'encoderQ0', 'q0'));
  const rawQ1 = firstFiniteValue([input.enc_q1, input.encoderQ1, input.encoder?.q1], fallbackValue('enc_q1', 'encoderQ1', 'q1'));
  const rawQ2 = firstFiniteValue([input.enc_q2, input.encoderQ2, input.encoder?.q2], fallbackValue('enc_q2', 'encoderQ2', 'q2'));
  const rawQ3 = firstFiniteValue([input.enc_q3, input.encoderQ3, input.encoder?.q3], fallbackValue('enc_q3', 'encoderQ3', 'q3'));
  const rawQValues = [rawQ0, rawQ1, rawQ2, rawQ3];
  const hasAnyRawQ = rawQValues.some((value) => value !== null);
  const hasCompleteRawQ = rawQValues.every((value) => value !== null);
  const normalizedEncoderQ = hasCompleteRawQ
    ? normalizeQuaternion(rawQValues)
    : { ok: false, q: null };
  const hasPartialRawQ = hasAnyRawQ && !hasCompleteRawQ;
  const hasInvalidRawQ = hasCompleteRawQ && !normalizedEncoderQ.ok;
  const hasData = [encX, encY, encZ, rawQ0, rawQ1, rawQ2, rawQ3, timerX, timerY, timerZ, ageX, ageY, ageZ].some((value) => value !== null);
  const hasAllAxes = [encX, encY, encZ].every((value) => value !== null);
  const canUseLegacyAngles = !hasAnyRawQ && hasAllAxes;
  const hasRemoteQuaternion = Boolean(normalizedEncoderQ.ok);
  const heldAxes = [];
  if (useFallback && incomingX === null && encX !== null) heldAxes.push('X');
  if (useFallback && incomingY === null && encY !== null) heldAxes.push('Y');
  if (useFallback && incomingZ === null && encZ !== null) heldAxes.push('Z');
  const encoderStatus = normalizeEncoderStatus({
    explicitStatus: input.encoderStatus || input.encoder?.status || (useFallback ? (fallback.encoderStatus || fallback.encoder?.status) : ''),
    hasData,
    hasCompletePose: normalizedEncoderQ.ok || (canUseLegacyAngles && heldAxes.length === 0),
    hasPartialQuaternion: hasPartialRawQ,
    hasInvalidQuaternion: hasInvalidRawQ,
    timerX,
    timerY,
    timerZ,
    ageX,
    ageY,
    ageZ,
    updatedAt,
    now,
  });
  const computedQ = encoderStatus === 'LIVE' && canUseLegacyAngles && heldAxes.length === 0
    ? eulerDegToQuat(encX, encY, encZ, encoderAngleToQuatSequence)
    : null;
  const encoderQ = hasRemoteQuaternion ? normalizedEncoderQ.q : computedQ;
  const encQ0 = encoderQ ? encoderQ[0] : null;
  const encQ1 = encoderQ ? encoderQ[1] : null;
  const encQ2 = encoderQ ? encoderQ[2] : null;
  const encQ3 = encoderQ ? encoderQ[3] : null;
  const encoderEulerRaw = encoderQ ? quaternionToEulerDeg(encoderQ, encoderEulerSequence) : null;
  const encoderEuler = encoderEulerRaw ? applyEulerDisplaySigns(encoderEulerRaw, encoderDisplaySigns) : null;
  const hasValidQuaternion = Boolean(encoderQ);
  const usingRemoteQ = Boolean(encoderQ && hasRemoteQuaternion);
  const encoderQuatSource = usingRemoteQ
    ? 'remote-computed gimbal encoder quaternion'
    : (computedQ ? 'web-computed from legacy gimbal encoder angles' : '');
  let statusSource = '';
  if (hasData) {
    if (encoderStatus === 'LIVE' && computedQ) statusSource = 'web-computed from legacy gimbal encoder angles';
    else if (usingRemoteQ) statusSource = 'remote-computed gimbal encoder quaternion';
    else if (encoderStatus === 'PARTIAL') statusSource = 'partial gimbal encoder quaternion';
    else if (encoderStatus === 'INVALID') statusSource = 'invalid gimbal encoder quaternion';
    else if (encoderStatus === 'STALE') statusSource = 'stale gimbal encoder quaternion';
    else if (encoderStatus === 'MIXED') statusSource = 'mixed gimbal encoder timers';
    else statusSource = 'gimbal encoder reference';
  }
  const source = statusSource || input.encoderSource || input.encoder?.source || (useFallback ? (fallback.encoderSource || fallback.encoder?.source || '') : '');
  const encoderRpySource = encoderEuler
    ? (usingRemoteQ ? 'web-computed from remote encoder quaternion' : 'web-computed from legacy encoder angle quaternion')
    : '';

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
    enc_age_x: ageX,
    enc_age_y: ageY,
    enc_age_z: ageZ,
    encoderTimerX: timerX,
    encoderTimerY: timerY,
    encoderTimerZ: timerZ,
    encoderAgeX: ageX,
    encoderAgeY: ageY,
    encoderAgeZ: ageZ,
    encoderUpdatedAt: updatedAt,
    encoderSource: source,
    encoderStatus,
    encoderAngleToQuatSequence,
    encoderEulerSequence,
    encoderDisplayRollSign: encoderDisplaySigns.roll,
    encoderDisplayPitchSign: encoderDisplaySigns.pitch,
    encoderDisplayYawSign: encoderDisplaySigns.yaw,
    encoderQuatSource,
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
      ageX,
      ageY,
      ageZ,
      updatedAt,
      source,
      status: encoderStatus,
      angleToQuatSequence: encoderAngleToQuatSequence,
      eulerSequence: encoderEulerSequence,
      displayRollSign: encoderDisplaySigns.roll,
      displayPitchSign: encoderDisplaySigns.pitch,
      displayYawSign: encoderDisplaySigns.yaw,
      quatSource: encoderQuatSource,
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

function mergeEncoderIntoPacket(packet = {}, encoder = {}, options = {}) {
  const fields = makeEncoderFields(encoder, packet, options);
  return {
    ...packet,
    ...fields,
    encoder: {
      ...(packet.encoder || {}),
      ...fields.encoder,
    },
  };
}

function normalizeQuaternion(values) {
  let [q0, q1, q2, q3] = values.map(Number);
  const norm = Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);

  if (!Number.isFinite(norm) || norm < 0.5 || norm > 1.5) {
    return { ok: false, reason: `bad quaternion norm ${Number.isFinite(norm) ? norm.toFixed(4) : norm}` };
  }

  if (norm > 1e-9) {
    q0 /= norm;
    q1 /= norm;
    q2 /= norm;
    q3 /= norm;
  } else {
    q0 = 1;
    q1 = 0;
    q2 = 0;
    q3 = 0;
  }

  return {
    ok: true,
    q: [q0, q1, q2, q3],
    norm,
  };
}

function parseImuCsvLine(line) {
  const clean = cleanLine(line);
  if (!clean.startsWith('IMU,')) return null;

  const parts = clean.split(',').map((part) => part.trim());
  if (parts.length < 10) {
    return { ok: false, reason: `IMU field count ${parts.length} < 10`, cleanLine: clean };
  }

  const numberAt = (index, label, required = true) => {
    const value = Number(parts[index]);
    if (!Number.isFinite(value)) {
      if (required) throw new Error(`${label} is not numeric`);
      return undefined;
    }
    return value;
  };

  try {
    const q0 = numberAt(1, 'q0');
    const q1 = numberAt(2, 'q1');
    const q2 = numberAt(3, 'q2');
    const q3 = numberAt(4, 'q3');
    const roll = numberAt(5, 'roll');
    const pitch = numberAt(6, 'pitch');
    const yaw = numberAt(7, 'yaw');
    const timestamp = numberAt(8, 'timestamp');
    const seq = numberAt(9, 'seq');
    const qerrDeg = numberAt(10, 'qerr_deg', false);
    const wx = numberAt(11, 'wx', false);
    const wy = numberAt(12, 'wy', false);
    const wz = numberAt(13, 'wz', false);
    const RPM1 = numberAt(14, 'RPM1', false);
    const RPM2 = numberAt(15, 'RPM2', false);
    const RPM3 = numberAt(16, 'RPM3', false);
    const RPMcmd1 = numberAt(17, 'RPMcmd1', false);
    const RPMcmd2 = numberAt(18, 'RPMcmd2', false);
    const RPMcmd3 = numberAt(19, 'RPMcmd3', false);
    const PWM1 = numberAt(20, 'PWM1', false);
    const PWM2 = numberAt(21, 'PWM2', false);
    const PWM3 = numberAt(22, 'PWM3', false);
    const TbodycmdX = numberAt(23, 'Tbodycmd_x_Nm', false);
    const TbodycmdY = numberAt(24, 'Tbodycmd_y_Nm', false);
    const TbodycmdZ = numberAt(25, 'Tbodycmd_z_Nm', false);
    const Tmotor1 = numberAt(26, 'Tmotor1_Nm', false);
    const Tmotor2 = numberAt(27, 'Tmotor2_Nm', false);
    const Tmotor3 = numberAt(28, 'Tmotor3_Nm', false);

    return {
      ok: true,
      cleanLine: clean,
      raw: clean,
      rawPrefix: 'IMU',
      raw_prefix: 'IMU',
      sample_type: 'IMU',
      sampleType: 'IMU',
      source: 'Remote_ESPNOW_IMU',
      q: [q0, q1, q2, q3],
      roll_deg: roll,
      pitch_deg: pitch,
      yaw_deg: yaw,
      qerrDeg: Number.isFinite(qerrDeg) ? qerrDeg : undefined,
      qerr_deg: Number.isFinite(qerrDeg) ? qerrDeg : undefined,
      qerrSource: Number.isFinite(qerrDeg) ? 'satellite telemetry' : '',
      wx: Number.isFinite(wx) ? wx : undefined,
      wy: Number.isFinite(wy) ? wy : undefined,
      wz: Number.isFinite(wz) ? wz : undefined,
      angularRateSource: [wx, wy, wz].every(Number.isFinite) ? 'satellite body rate' : '',
      RPM1: Number.isFinite(RPM1) ? RPM1 : undefined,
      RPM2: Number.isFinite(RPM2) ? RPM2 : undefined,
      RPM3: Number.isFinite(RPM3) ? RPM3 : undefined,
      RPMcmd1: Number.isFinite(RPMcmd1) ? RPMcmd1 : undefined,
      RPMcmd2: Number.isFinite(RPMcmd2) ? RPMcmd2 : undefined,
      RPMcmd3: Number.isFinite(RPMcmd3) ? RPMcmd3 : undefined,
      PWM1: Number.isFinite(PWM1) ? PWM1 : undefined,
      PWM2: Number.isFinite(PWM2) ? PWM2 : undefined,
      PWM3: Number.isFinite(PWM3) ? PWM3 : undefined,
      Tbodycmd_x_Nm: Number.isFinite(TbodycmdX) ? TbodycmdX : undefined,
      Tbodycmd_y_Nm: Number.isFinite(TbodycmdY) ? TbodycmdY : undefined,
      Tbodycmd_z_Nm: Number.isFinite(TbodycmdZ) ? TbodycmdZ : undefined,
      Tmotor1_Nm: Number.isFinite(Tmotor1) ? Tmotor1 : undefined,
      Tmotor2_Nm: Number.isFinite(Tmotor2) ? Tmotor2 : undefined,
      Tmotor3_Nm: Number.isFinite(Tmotor3) ? Tmotor3 : undefined,
      control_mode: parts[29] ?? '',
      EBIMU_status: parts[30] ?? '',
      logging_status: parts[31] ?? '',
      ebimu_timestamp_ms: timestamp,
      timestamp,
      timestamp_us: timestamp,
      remote_timestamp: timestamp,
      remote_timestamp_us: timestamp,
      seq,
      rxCount: seq,
    };
  } catch (err) {
    return { ok: false, reason: err?.message || 'IMU CSV parse failed', cleanLine: clean };
  }
}

function parseTelCsvLine(line) {
  const clean = cleanLine(line);
  if (!clean.startsWith('TEL,')) return null;

  const parts = clean.split(',').map((part) => part.trim());

  // Supported formats:
  // 1) Compact TEL:
  //    TEL,q0,q1,q2,q3,qerr_deg,wx,wy,wz,RPM1,RPM2,RPM3,RPMcmd1,RPMcmd2,RPMcmd3,timestamp,seq,control_mode,EBIMU_status,logging_status
  // 2) Extended TEL with PWM / torque fields:
  //    TEL,q0,q1,q2,q3,qerr_deg,wx,wy,wz,RPM1,RPM2,RPM3,RPMcmd1,RPMcmd2,RPMcmd3,PWM1,PWM2,PWM3,Tbodycmd_x,Tbodycmd_y,Tbodycmd_z,Tmotor1,Tmotor2,Tmotor3,timestamp,seq,...
  if (parts.length < 20) {
    return { ok: false, reason: `TEL field count ${parts.length} < 20`, cleanLine: clean };
  }

  const numberAt = (index, label, required = true) => {
    const value = Number(parts[index]);
    if (!Number.isFinite(value)) {
      if (required) throw new Error(`${label} is not numeric`);
      return undefined;
    }
    return value;
  };

  try {
    const q0 = numberAt(1, 'q0');
    const q1 = numberAt(2, 'q1');
    const q2 = numberAt(3, 'q2');
    const q3 = numberAt(4, 'q3');
    const qerrDeg = numberAt(5, 'qerr_deg', false);
    const wx = numberAt(6, 'wx', false);
    const wy = numberAt(7, 'wy', false);
    const wz = numberAt(8, 'wz', false);
    const RPM1 = numberAt(9, 'RPM1', false);
    const RPM2 = numberAt(10, 'RPM2', false);
    const RPM3 = numberAt(11, 'RPM3', false);
    const RPMcmd1 = numberAt(12, 'RPMcmd1', false);
    const RPMcmd2 = numberAt(13, 'RPMcmd2', false);
    const RPMcmd3 = numberAt(14, 'RPMcmd3', false);

    const tokenNumber = (index) => parseOptionalNumberToken(parts[index]);
    const statusScore = (index) => [parts[index], parts[index + 1], parts[index + 2]]
      .filter((token) => token !== undefined && token !== '')
      .filter((token) => parseOptionalNumberToken(token) === null)
      .length;
    const hasPreTimestampExtendedFields = (
      parts.length >= 29
      && tokenNumber(24) !== null
      && tokenNumber(25) !== null
      && (tokenNumber(15) === null || tokenNumber(16) === null || statusScore(26) > statusScore(17))
    );
    const timestampIndex = hasPreTimestampExtendedFields ? 24 : 15;
    const seqIndex = hasPreTimestampExtendedFields ? 25 : 16;
    const statusIndex = hasPreTimestampExtendedFields ? 26 : 17;
    const postStatusExtendedStart = statusIndex + 3;
    const hasPostStatusExtendedFields = !hasPreTimestampExtendedFields && parts.length >= postStatusExtendedStart + 9;

    const extStart = hasPreTimestampExtendedFields ? 15 : (hasPostStatusExtendedFields ? postStatusExtendedStart : -1);
    const PWM1 = extStart >= 0 ? numberAt(extStart, 'PWM1', false) : undefined;
    const PWM2 = extStart >= 0 ? numberAt(extStart + 1, 'PWM2', false) : undefined;
    const PWM3 = extStart >= 0 ? numberAt(extStart + 2, 'PWM3', false) : undefined;
    const TbodycmdX = extStart >= 0 ? numberAt(extStart + 3, 'Tbodycmd_x_Nm', false) : undefined;
    const TbodycmdY = extStart >= 0 ? numberAt(extStart + 4, 'Tbodycmd_y_Nm', false) : undefined;
    const TbodycmdZ = extStart >= 0 ? numberAt(extStart + 5, 'Tbodycmd_z_Nm', false) : undefined;
    const Tmotor1 = extStart >= 0 ? numberAt(extStart + 6, 'Tmotor1_Nm', false) : undefined;
    const Tmotor2 = extStart >= 0 ? numberAt(extStart + 7, 'Tmotor2_Nm', false) : undefined;
    const Tmotor3 = extStart >= 0 ? numberAt(extStart + 8, 'Tmotor3_Nm', false) : undefined;
    const timestamp = numberAt(timestampIndex, 'timestamp', false);
    const seq = numberAt(seqIndex, 'seq', false);

    const commandType = parseOptionalNumberToken(parts[statusIndex]);
    const controlMode = commandType !== null
      ? `commandType:${commandType}`
      : (parts[statusIndex] ?? '');

    const packet = {
      ok: true,
      cleanLine: clean,
      raw: clean,
      rawPrefix: 'TEL',
      raw_prefix: 'TEL',
      sample_type: 'TEL',
      sampleType: 'TEL',
      source: 'Remote_ESPNOW_TEL',
      q: [q0, q1, q2, q3],
      qerrDeg,
      qerr_deg: qerrDeg,
      qerrSource: Number.isFinite(qerrDeg) ? 'satellite telemetry' : '',
      wx,
      wy,
      wz,
      angularRateSource: [wx, wy, wz].every(Number.isFinite) ? 'satellite body rate' : '',
      RPM1,
      RPM2,
      RPM3,
      RPMcmd1,
      RPMcmd2,
      RPMcmd3,
      PWM1,
      PWM2,
      PWM3,
      Tbodycmd_x_Nm: TbodycmdX,
      Tbodycmd_y_Nm: TbodycmdY,
      Tbodycmd_z_Nm: TbodycmdZ,
      Tmotor1_Nm: Tmotor1,
      Tmotor2_Nm: Tmotor2,
      Tmotor3_Nm: Tmotor3,
      commandType: commandType !== null ? commandType : undefined,
      command_type: commandType !== null ? commandType : undefined,
      ebimu_timestamp_ms: Number.isFinite(timestamp) ? timestamp : 0,
      timestamp: Number.isFinite(timestamp) ? timestamp : undefined,
      timestamp_us: Number.isFinite(timestamp) ? timestamp : undefined,
      remote_timestamp: Number.isFinite(timestamp) ? timestamp : undefined,
      remote_timestamp_us: Number.isFinite(timestamp) ? timestamp : undefined,
      seq: Number.isFinite(seq) ? seq : 0,
      rxCount: Number.isFinite(seq) ? seq : 0,
      control_mode: controlMode,
      EBIMU_status: parts[statusIndex + 1] ?? '',
      logging_status: parts[statusIndex + 2] ?? '',
    };

    const encoderStart = hasPostStatusExtendedFields ? postStatusExtendedStart + 9 : statusIndex + 3;
    if (parts.length > encoderStart) {
      const encoderValues = {
        enc_x_deg: parseOptionalNumberToken(parts[encoderStart]),
        enc_y_deg: parseOptionalNumberToken(parts[encoderStart + 1]),
        enc_z_deg: parseOptionalNumberToken(parts[encoderStart + 2]),
        encoderUpdatedAt: Date.now(),
        encoderSource: 'Gimbal Rotary Encoder from TEL packet',
      };
      if (parts.length > encoderStart + 3) {
        encoderValues.enc_q0 = parseOptionalNumberToken(parts[encoderStart + 3]);
        encoderValues.enc_q1 = parseOptionalNumberToken(parts[encoderStart + 4]);
        encoderValues.enc_q2 = parseOptionalNumberToken(parts[encoderStart + 5]);
        encoderValues.enc_q3 = parseOptionalNumberToken(parts[encoderStart + 6]);
      }
      if (parts.length > encoderStart + 7) {
        encoderValues.enc_timer_x = parseOptionalNumberToken(parts[encoderStart + 7]);
        encoderValues.enc_timer_y = parseOptionalNumberToken(parts[encoderStart + 8]);
        encoderValues.enc_timer_z = parseOptionalNumberToken(parts[encoderStart + 9]);
      }
      if (parts.length > encoderStart + 10) {
        encoderValues.encoderStatus = parts[encoderStart + 10] || '';
      }
      if ([encoderValues.enc_x_deg, encoderValues.enc_y_deg, encoderValues.enc_z_deg].some((value) => value !== null)) {
        Object.assign(packet, makeEncoderFields(encoderValues, {}, { useFallback: false }));
      }
    }

    return packet;
  } catch (err) {
    return { ok: false, reason: err?.message || 'TEL CSV parse failed', cleanLine: clean };
  }
}

function parseRemoteStatusLine(line) {
  const clean = cleanLine(line);
  const satMatch = clean.match(/^(\d+)\s*\/\s*sat=\[\s*([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s*\].*?rx=(\d+)/);
  if (!satMatch) return null;

  const timestamp = Number(satMatch[1]);
  const q0 = Number(satMatch[2]);
  const q1 = Number(satMatch[3]);
  const q2 = Number(satMatch[4]);
  const q3 = Number(satMatch[5]);
  const rxCount = Number(satMatch[6]);

  if ([timestamp, q0, q1, q2, q3, rxCount].some((value) => !Number.isFinite(value))) {
    return { ok: false, reason: 'remote status parse number error', cleanLine: clean };
  }

  const euler = quaternionToEulerDeg([q0, q1, q2, q3]);
  return {
    ok: true,
    cleanLine: clean,
    source: 'REMOTE_STATUS',
    q: [q0, q1, q2, q3],
    roll_deg: euler.roll,
    pitch_deg: euler.pitch,
    yaw_deg: euler.yaw,
    ebimu_timestamp_ms: timestamp,
    seq: rxCount,
    rxCount,
  };
}

function parseRxDebugLine(line) {
  const clean = cleanLine(line);
  if (!clean.startsWith('[RX]')) return null;

  const qMatch = clean.match(/q=\[\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\]/);
  const rpyMatch = clean.match(/RPY=\[\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\]/);
  const seqMatch = clean.match(/seq=(\d+)/);
  const tsMatch = clean.match(/ebimu_ts=(\d+)/);
  const rxMatch = clean.match(/rxCount=(\d+)/);

  if (!qMatch) {
    return { ok: false, reason: '[RX] line without q=[...]', cleanLine: clean };
  }

  const q = [Number(qMatch[1]), Number(qMatch[2]), Number(qMatch[3]), Number(qMatch[4])];
  if (q.some((value) => !Number.isFinite(value))) {
    return { ok: false, reason: '[RX] q contains non-numeric field', cleanLine: clean };
  }

  let euler = quaternionToEulerDeg(q);
  if (rpyMatch) {
    const r = Number(rpyMatch[1]);
    const p = Number(rpyMatch[2]);
    const y = Number(rpyMatch[3]);
    if ([r, p, y].every(Number.isFinite)) {
      euler = { roll: r, pitch: p, yaw: y };
    }
  }

  const seq = seqMatch ? Number(seqMatch[1]) : 0;
  const timestamp = tsMatch ? Number(tsMatch[1]) : 0;
  const rxCount = rxMatch ? Number(rxMatch[1]) : seq;

  return {
    ok: true,
    cleanLine: clean,
    source: 'RX_DEBUG',
    q,
    roll_deg: euler.roll,
    pitch_deg: euler.pitch,
    yaw_deg: euler.yaw,
    ebimu_timestamp_ms: timestamp,
    seq,
    rxCount,
  };
}

function parseRemoteEventLine(line) {
  const clean = cleanLine(line);
  const match = clean.match(/^(INFO|WARN|ERR|ACK|PONG)(?:,|\s|$)/i);
  if (!match) return null;
  const prefix = match[1].toUpperCase();
  return {
    ok: false,
    statusOnly: true,
    warning: prefix === 'WARN' || prefix === 'ERR',
    ignored: prefix !== 'WARN' && prefix !== 'ERR',
    reason: clean,
    cleanLine: clean,
    rawPrefix: prefix,
    raw_prefix: prefix,
    sample_type: prefix === 'ACK' ? 'COMMAND' : '',
    sampleType: prefix === 'ACK' ? 'COMMAND' : '',
  };
}

function parseEncCsvLine(line) {
  const clean = cleanLine(line);
  if (!clean.startsWith('ENC,')) return null;

  const parts = clean.split(',').map((part) => part.trim());
  if (parts.length < 4) {
    return { ok: false, reason: `ENC field count ${parts.length} < 4`, cleanLine: clean };
  }

  const optionalAt = (index) => parseOptionalNumberToken(parts[index]);
  const normalizeStatus = (status) => {
    const text = String(status || '').trim().toUpperCase();
    return ['NONE', 'PARTIAL', 'LIVE', 'STALE', 'MIXED', 'HOLD_LAST'].includes(text) ? text : '';
  };
  const axisFromToken = (token) => {
    const text = String(token || '').trim().toUpperCase();
    if (text === '1' || text === 'X') return 'x';
    if (text === '2' || text === 'Y') return 'y';
    if (text === '3' || text === 'Z') return 'z';
    return '';
  };

  try {
    const now = Date.now();
    const axis = axisFromToken(parts[1]);
    const encoderValues = {
      encoderUpdatedAt: Date.now(),
      encoderSource: 'Gimbal Rotary Encoder packet',
    };

    if (axis) {
      const angle = optionalAt(2);
      if (angle === null) throw new Error(`ENC ${axis.toUpperCase()} angle is not numeric`);
      if (axis === 'x') {
        encoderValues.enc_x_deg = angle;
        encoderValues.enc_timer_x = optionalAt(3);
        encoderValues.enc_age_x = optionalAt(4);
      } else if (axis === 'y') {
        encoderValues.enc_y_deg = angle;
        encoderValues.enc_timer_y = optionalAt(3);
        encoderValues.enc_age_y = optionalAt(4);
      } else if (axis === 'z') {
        encoderValues.enc_z_deg = angle;
        encoderValues.enc_timer_z = optionalAt(3);
        encoderValues.enc_age_z = optionalAt(4);
      }
      encoderValues.encoderSource = `Gimbal Rotary Encoder ${axis.toUpperCase()} packet`;
      if (parts.length > 4 && optionalAt(4) === null) encoderValues.encoderStatus = normalizeStatus(parts[4]);
      if (parts.length > 5) encoderValues.encoderStatus = normalizeStatus(parts[5]);
    } else if (parts.length === 11 && parts.slice(1, 11).every((_, index) => optionalAt(index + 1) !== null)) {
      encoderValues.enc_q0 = optionalAt(1);
      encoderValues.enc_q1 = optionalAt(2);
      encoderValues.enc_q2 = optionalAt(3);
      encoderValues.enc_q3 = optionalAt(4);
      encoderValues.enc_timer_x = optionalAt(5);
      encoderValues.enc_timer_y = optionalAt(6);
      encoderValues.enc_timer_z = optionalAt(7);
      encoderValues.enc_age_x = optionalAt(8);
      encoderValues.enc_age_y = optionalAt(9);
      encoderValues.enc_age_z = optionalAt(10);
      encoderValues.encoderSource = 'Gimbal rotary encoder reference';
      encoderValues.encoderQuatSource = 'remote-computed gimbal encoder quaternion';
      encoderValues.encoderQuaternionOnly = true;
    } else {
      encoderValues.enc_x_deg = optionalAt(1);
      encoderValues.enc_y_deg = optionalAt(2);
      encoderValues.enc_z_deg = optionalAt(3);
      encoderValues.encoderSource = 'Gimbal Rotary Encoder snapshot';
    }

    if (!axis && parts.length === 7) {
      encoderValues.enc_timer_x = optionalAt(4);
      encoderValues.enc_timer_y = optionalAt(5);
      encoderValues.enc_timer_z = optionalAt(6);
    } else if (!axis && parts.length === 10) {
      encoderValues.enc_timer_x = optionalAt(4);
      encoderValues.enc_timer_y = optionalAt(5);
      encoderValues.enc_timer_z = optionalAt(6);
      encoderValues.enc_age_x = optionalAt(7);
      encoderValues.enc_age_y = optionalAt(8);
      encoderValues.enc_age_z = optionalAt(9);
      encoderValues.encoderSource = 'Legacy gimbal encoder angle snapshot with timers and ages';
    } else if (!axis && (parts.length === 8 || parts.length >= 12)) {
      encoderValues.enc_q0 = optionalAt(4);
      encoderValues.enc_q1 = optionalAt(5);
      encoderValues.enc_q2 = optionalAt(6);
      encoderValues.enc_q3 = optionalAt(7);
      if (parts.length > 8) {
        encoderValues.enc_timer_x = optionalAt(8);
        encoderValues.enc_timer_y = optionalAt(9);
        encoderValues.enc_timer_z = optionalAt(10);
      }
      if (parts.length > 13) {
        encoderValues.enc_age_x = optionalAt(11);
        encoderValues.enc_age_y = optionalAt(12);
        encoderValues.enc_age_z = optionalAt(13);
      }
      if (parts.length > 14) {
        encoderValues.encoderStatus = normalizeStatus(parts[14]);
      } else if (parts.length > 11) {
        encoderValues.encoderStatus = normalizeStatus(parts[11]);
      }
    }

    const hasAxisValue = [encoderValues.enc_x_deg, encoderValues.enc_y_deg, encoderValues.enc_z_deg]
      .some((value) => value !== null);
    const hasQuaternionValue = [encoderValues.enc_q0, encoderValues.enc_q1, encoderValues.enc_q2, encoderValues.enc_q3]
      .some((value) => value !== null);
    if (!hasAxisValue && !hasQuaternionValue) throw new Error('ENC line has no numeric encoder axis or quaternion');

    return {
      ok: true,
      encoderOnly: true,
      encoderQuaternionOnly: Boolean(encoderValues.encoderQuaternionOnly),
      cleanLine: clean,
      raw: clean,
      rawPrefix: 'ENC',
      raw_prefix: 'ENC',
      sample_type: 'ENC',
      sampleType: 'ENC',
      source: 'ENC_CSV',
      ...makeEncoderFields({ ...encoderValues, encoderUpdatedAt: now }, {}, { useFallback: false, now }),
    };
  } catch (err) {
    return { ok: false, reason: err?.message || 'ENC CSV parse failed', cleanLine: clean };
  }
}

export function parseSerialLine(line) {
  const clean = cleanLine(line);
  if (!clean) return { ok: false, ignored: true, reason: 'empty line', cleanLine: '' };

  const parsers = [parseTelCsvLine, parseImuCsvLine, parseEncCsvLine, parseRemoteEventLine, parseRxDebugLine, parseRemoteStatusLine];

  for (const parser of parsers) {
    const parsed = parser(clean);
    if (parsed == null) continue;
    return parsed;
  }

  if (/^(# STAT|\[SERIAL\]|\[STAT\])/.test(clean)) {
    return { ok: false, warning: true, reason: clean, cleanLine: clean };
  }

  return { ok: false, ignored: true, reason: 'ignored non-IMU line', cleanLine: clean };
}

function makeInitialEncoder(encoderEulerSequence = 'ZYX', encoderAngleToQuatSequence = DEFAULT_ENCODER_ANGLE_TO_QUAT_SEQUENCE) {
  return makeEncoderFields({}, {}, { useFallback: false, encoderEulerSequence, encoderAngleToQuatSequence });
}

export default function useEsp32Serial(options = {}) {
  const imuEulerSequence = normalizeEulerSequence(options.imuEulerSequence);
  const encoderEulerSequence = normalizeEulerSequence(options.encoderEulerSequence);
  const encoderAngleToQuatSequence = normalizeEulerSequence(
    options.encoderAngleToQuatSequence,
    DEFAULT_ENCODER_ANGLE_TO_QUAT_SEQUENCE
  );
  const targetRpySequence = normalizeEulerSequence(options.targetRpySequence || 'ZYX', 'ZYX');
  const imuDisplaySigns = normalizeRpySigns({
    roll: options.imuDisplayRollSign,
    pitch: options.imuDisplayPitchSign,
    yaw: options.imuDisplayYawSign,
  });
  const encoderDisplaySigns = normalizeRpySigns({
    roll: options.encoderDisplayRollSign,
    pitch: options.encoderDisplayPitchSign,
    yaw: options.encoderDisplayYawSign,
  }, DEFAULT_ENCODER_DISPLAY_SIGNS);
  const bodyRateWzDisplaySign = normalizeSign(options.bodyRateWzDisplaySign, 1);
  const [isSupported] = useState(
    typeof navigator !== 'undefined' && typeof navigator.serial !== 'undefined'
  );
  const [isConnected, setIsConnected] = useState(false);
  const [baudRate, setBaudRate] = useState(BAUD_RATE);
  const [error, setError] = useState('');
  const [lastRawLine, setLastRawLine] = useState('');
  const [lastInvalidReason, setLastInvalidReason] = useState('');
  const [lastReceivedAt, setLastReceivedAt] = useState(null);
  const [latestPacket, setLatestPacket] = useState(DEFAULT_PACKET);
  const [latestCsvPacket, setLatestCsvPacket] = useState(null);
  const [latestDesiredAttitude, setLatestDesiredAttitude] = useState(null);
  const [csvLogVersion, setCsvLogVersion] = useState(0);
  const [recentPackets, setRecentPackets] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [validCount, setValidCount] = useState(0);
  const [invalidCount, setInvalidCount] = useState(0);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [warningCount, setWarningCount] = useState(0);
  const [encoderCount, setEncoderCount] = useState(0);
  const [inputHz, setInputHz] = useState(0);
  const [csvLoggedHz, setCsvLoggedHz] = useState(0);
  const [lastCommand, setLastCommand] = useState('');
  const [serialWriterReady, setSerialWriterReady] = useState(false);
  const [lastLocalWriteError, setLastLocalWriteError] = useState('');

  const portRef = useRef(null);
  const readerRef = useRef(null);
  const writerRef = useRef(null);
  const keepReadingRef = useRef(false);
  const decoderRef = useRef(new TextDecoder());
  const encoderRef = useRef(new TextEncoder());
  const bufferRef = useRef('');
  const prevQRef = useRef([1, 0, 0, 0]);
  const latestEncoderRef = useRef(makeInitialEncoder(encoderEulerSequence, encoderAngleToQuatSequence));
  const commandBusyRef = useRef(false);

  const latestPacketRef = useRef(DEFAULT_PACKET);
  const latestCsvPacketRef = useRef(null);
  const latestDesiredAttitudeRef = useRef(null);
  const csvLogQueueRef = useRef([]);
  const csvCaptureEnabledRef = useRef(false);
  const lastCsvSampleClockRef = useRef(null);
  const lastCsvUiStatsUpdateRef = useRef(0);
  const csvLoggedRateWindowRef = useRef([]);
  const recentPacketsRef = useRef([]);
  const chartDataRef = useRef([]);
  const countersRef = useRef({ valid: 0, invalid: 0, ignored: 0, warning: 0 });
  const lastRawLineRef = useRef('');
  const lastInvalidReasonRef = useRef('');
  const lastReceivedAtRef = useRef(null);
  const lastLocalWriteErrorRef = useRef('');
  const pendingUiFlushRef = useRef(false);
  const droppedBufferCountRef = useRef(0);
  const encoderCountRef = useRef(0);
  const inputRateWindowRef = useRef([]);

  const validRatio = useMemo(() => {
    const total = validCount + invalidCount;
    return total > 0 ? validCount / total : 0;
  }, [validCount, invalidCount]);

  const markPendingUiFlush = useCallback(() => {
    pendingUiFlushRef.current = true;
  }, []);

  const recordInputRate = useCallback((now = Date.now()) => {
    inputRateWindowRef.current = [
      ...inputRateWindowRef.current.filter((time) => now - time <= 1000),
      now,
    ];
  }, []);

  const pushCsvLogPacket = useCallback((packet) => {
    if (!csvCaptureEnabledRef.current || !packet) return false;
    const sampleType = detectCsvSampleType(packet);
    if (sampleType !== 'TEL' && sampleType !== 'IMU' && sampleType !== 'ENC') return false;

    const now = Date.now();
    const nextClock = resolveCsvSampleClock(packet, lastCsvSampleClockRef.current, now);
    const csvPacket = {
      ...packet,
      logged_at_ms: now,
      loggedAtMs: now,
      logged_at_iso: new Date(now).toISOString(),
      csvSampleTimeMs: nextClock.timeMs,
      csvSampleClock: nextClock.source,
      sample_type: packet.sample_type || packet.sampleType || sampleType,
      sampleType: packet.sampleType || packet.sample_type || sampleType,
    };
    lastCsvSampleClockRef.current = { ...nextClock, loggedAtMs: now };
    latestCsvPacketRef.current = csvPacket;
    csvLogQueueRef.current.push(csvPacket);
    if (csvLogQueueRef.current.length > MAX_CSV_LOG_QUEUE) {
      csvLogQueueRef.current.splice(0, csvLogQueueRef.current.length - MAX_CSV_LOG_QUEUE);
    }
    csvLoggedRateWindowRef.current = [
      ...csvLoggedRateWindowRef.current.filter((time) => now - time <= 1000),
      now,
    ];
    return true;
  }, []);

  const applyLatestDesiredAttitude = useCallback((desired) => {
    if (!desired) return null;
    latestDesiredAttitudeRef.current = desired;
    latestPacketRef.current = patchPacketWithDesired(latestPacketRef.current || DEFAULT_PACKET, desired);
    if (latestCsvPacketRef.current) {
      latestCsvPacketRef.current = patchPacketWithDesired(latestCsvPacketRef.current, desired);
    }
    recentPacketsRef.current = recentPacketsRef.current.map((packet, index) => (
      index === 0 ? patchPacketWithDesired(packet, desired) : packet
    ));
    setLatestDesiredAttitude(desired);
    markPendingUiFlush();
    return desired;
  }, [markPendingUiFlush]);

  const recordTargetAttitudeCommand = useCallback((roll, pitch, yaw, line = '') => {
    const desired = buildDesiredAttitude(roll, pitch, yaw, targetRpySequence);
    applyLatestDesiredAttitude(desired);
    return desired;
  }, [applyLatestDesiredAttitude, targetRpySequence]);

  const drainCsvLogSamples = useCallback(() => {
    const samples = csvLogQueueRef.current;
    csvLogQueueRef.current = [];
    return samples;
  }, []);

  const startCsvLogCapture = useCallback(() => {
    csvLogQueueRef.current = [];
    latestCsvPacketRef.current = null;
    lastCsvSampleClockRef.current = null;
    lastCsvUiStatsUpdateRef.current = 0;
    csvLoggedRateWindowRef.current = [];
    csvCaptureEnabledRef.current = true;
    setLatestCsvPacket(null);
    setCsvLoggedHz(0);
    setCsvLogVersion((version) => version + 1);
  }, []);

  const stopCsvLogCapture = useCallback(() => {
    csvCaptureEnabledRef.current = false;
    const samples = drainCsvLogSamples();
    lastCsvSampleClockRef.current = null;
    lastCsvUiStatsUpdateRef.current = 0;
    csvLoggedRateWindowRef.current = [];
    setCsvLoggedHz(0);
    return samples;
  }, [drainCsvLogSamples]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      csvLoggedRateWindowRef.current = csvLoggedRateWindowRef.current.filter((time) => now - time <= 1000);
      const shouldUpdateCsvStats = now - lastCsvUiStatsUpdateRef.current >= CSV_UI_STATS_INTERVAL_MS;
      if (shouldUpdateCsvStats) {
        lastCsvUiStatsUpdateRef.current = now;
        setCsvLoggedHz((prev) => {
          const next = csvCaptureEnabledRef.current ? csvLoggedRateWindowRef.current.length : 0;
          return prev === next ? prev : next;
        });
      }

      if (!pendingUiFlushRef.current) return;
      pendingUiFlushRef.current = false;

      setLatestPacket(latestPacketRef.current);
      setLatestCsvPacket(latestCsvPacketRef.current);
      if (shouldUpdateCsvStats && csvLogQueueRef.current.length > 0) {
        setCsvLogVersion((version) => version + 1);
      }
      setRecentPackets([...recentPacketsRef.current]);
      setChartData([...chartDataRef.current]);
      setValidCount(countersRef.current.valid);
      setInvalidCount(countersRef.current.invalid);
      setIgnoredCount(countersRef.current.ignored);
      setWarningCount(countersRef.current.warning);
      setEncoderCount(encoderCountRef.current);
      inputRateWindowRef.current = inputRateWindowRef.current.filter((time) => now - time <= 1000);
      setInputHz(inputRateWindowRef.current.length);
      setLastRawLine(lastRawLineRef.current);
      setLastInvalidReason(lastInvalidReasonRef.current);
      setLastReceivedAt(lastReceivedAtRef.current);
    }, UI_FLUSH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  const registerValidPacketRefOnly = useCallback((parsed) => {
    if (parsed.encoderOnly) {
      const now = parsed.encoderUpdatedAt || Date.now();
      recordInputRate(now);
      const encoderFields = makeEncoderFields(
        { ...parsed, encoderUpdatedAt: now, encoderSource: parsed.encoderSource || 'Gimbal rotary encoder reference' },
        latestEncoderRef.current,
        {
          useFallback: !parsed.encoderQuaternionOnly,
          now,
          encoderEulerSequence,
          encoderAngleToQuatSequence,
          encoderDisplayRollSign: encoderDisplaySigns.roll,
          encoderDisplayPitchSign: encoderDisplaySigns.pitch,
          encoderDisplayYawSign: encoderDisplaySigns.yaw,
        }
      );
      latestEncoderRef.current = encoderFields;
      encoderCountRef.current += 1;
      countersRef.current.valid += 1;
      const encoderLogFields = makeEncoderFields(
        { ...parsed, encoderUpdatedAt: now, encoderSource: parsed.encoderSource || 'Gimbal rotary encoder reference' },
        {},
        {
          useFallback: false,
          now,
          encoderEulerSequence,
          encoderAngleToQuatSequence,
          encoderDisplayRollSign: encoderDisplaySigns.roll,
          encoderDisplayPitchSign: encoderDisplaySigns.pitch,
          encoderDisplayYawSign: encoderDisplaySigns.yaw,
        }
      );
      pushCsvLogPacket(patchPacketWithDesired({
        ...encoderLogFields,
        ok: true,
        encoderOnly: true,
        source: 'ENC_CSV',
        sourceLabel: encoderLogFields.encoderSource || parsed.encoderSource || 'Gimbal Rotary Encoder',
        sample_type: 'ENC',
        sampleType: 'ENC',
        rawPrefix: 'ENC',
        raw_prefix: 'ENC',
        raw: parsed.cleanLine || parsed.raw || '',
        cleanLine: parsed.cleanLine || parsed.raw || '',
        pc_time_ms: parsed.pc_time_ms ?? parsed.pcTimeMs ?? '',
        pcTimeMs: parsed.pcTimeMs ?? parsed.pc_time_ms ?? '',
        timestamp: Number.isFinite(parsed.timestamp) ? parsed.timestamp : undefined,
        seq: Number.isFinite(parsed.seq) ? parsed.seq : undefined,
        updatedAt: now,
      }, latestDesiredAttitudeRef.current));

      const currentPacket = latestPacketRef.current || DEFAULT_PACKET;
      latestPacketRef.current = mergeEncoderIntoPacket({
        ...DEFAULT_PACKET,
        ...currentPacket,
        source: currentPacket.source && currentPacket.source !== 'none' ? currentPacket.source : 'admin-web-serial',
        sourceLabel: currentPacket.sourceLabel || 'Admin Web Serial Bridge',
        pc_time_ms: currentPacket.pc_time_ms || currentPacket.pcTimeMs || now,
        raw: parsed.cleanLine || currentPacket.raw || '',
        updatedAt: now,
      }, encoderFields, {
        useFallback: false,
        now,
        encoderEulerSequence,
        encoderAngleToQuatSequence,
        encoderDisplayRollSign: encoderDisplaySigns.roll,
        encoderDisplayPitchSign: encoderDisplaySigns.pitch,
        encoderDisplayYawSign: encoderDisplaySigns.yaw,
      });

      recentPacketsRef.current = [latestPacketRef.current, ...recentPacketsRef.current.slice(1)].slice(0, MAX_RECENT_PACKETS);
      const chartPoint = {
        time: new Date(now).toLocaleTimeString('ko-KR', { hour12: false, minute: '2-digit', second: '2-digit' }),
        roll: latestPacketRef.current.roll_deg,
        pitch: latestPacketRef.current.pitch_deg,
        yaw: latestPacketRef.current.yaw_deg,
        encX: encoderFields.enc_x_deg,
        encY: encoderFields.enc_y_deg,
        encZ: encoderFields.enc_z_deg,
        encoderRoll: encoderFields.encoderHasQuaternion ? encoderFields.encoderRollDeg : null,
        encoderPitch: encoderFields.encoderHasQuaternion ? encoderFields.encoderPitchDeg : null,
        encoderYaw: encoderFields.encoderHasQuaternion ? encoderFields.encoderYawDeg : null,
      };
      chartDataRef.current = [...chartDataRef.current, chartPoint].slice(-MAX_CHART_POINTS);

      lastRawLineRef.current = parsed.cleanLine || '';
      lastReceivedAtRef.current = now;
      lastInvalidReasonRef.current = '';
      markPendingUiFlush();
      return;
    }

    const normalized = normalizeQuaternion(parsed.q);
    if (!normalized.ok) {
      countersRef.current.warning += 1;
      lastInvalidReasonRef.current = normalized.reason;
      lastRawLineRef.current = parsed.cleanLine || '';
      markPendingUiFlush();
      return;
    }

    let q = normalized.q;
    const prevQ = prevQRef.current;
    const dot = prevQ[0] * q[0] + prevQ[1] * q[1] + prevQ[2] * q[2] + prevQ[3] * q[3];
    if (dot < 0) q = q.map((value) => -value);
    prevQRef.current = q;

    const euler = quaternionToEulerDeg(q, imuEulerSequence) || { roll: 0, pitch: 0, yaw: 0 };
    const now = Date.now();
    recordInputRate(now);
    const encoderFields = hasIncomingEncoderData(parsed)
      ? makeEncoderFields({
          ...parsed,
          encoderUpdatedAt: parsed.encoderUpdatedAt || now,
          encoderSource: parsed.encoderSource || 'telemetry packet',
        }, {}, {
          useFallback: false,
          now,
          encoderEulerSequence,
          encoderAngleToQuatSequence,
          encoderDisplayRollSign: encoderDisplaySigns.roll,
          encoderDisplayPitchSign: encoderDisplaySigns.pitch,
          encoderDisplayYawSign: encoderDisplaySigns.yaw,
        })
      : makeEncoderFields(latestEncoderRef.current, {}, {
          useFallback: false,
          now,
          encoderEulerSequence,
          encoderAngleToQuatSequence,
          encoderDisplayRollSign: encoderDisplaySigns.roll,
          encoderDisplayPitchSign: encoderDisplaySigns.pitch,
          encoderDisplayYawSign: encoderDisplaySigns.yaw,
        });
    const packet = {
      source: parsed.source || 'serial',
      pc_time_ms: now,
      q0: q[0],
      q1: q[1],
      q2: q[2],
      q3: q[3],
      q,
      usedQuaternion: true,
      norm: normalized.norm,
      roll_deg: euler.roll,
      pitch_deg: euler.pitch,
      yaw_deg: euler.yaw,
      rollSource: 'computed_from_quaternion',
      imuEulerSequence,
      rpySource: `quaternion ${imuEulerSequence}`,
      remoteRollDeg: Number.isFinite(parsed.roll_deg) ? parsed.roll_deg : undefined,
      remotePitchDeg: Number.isFinite(parsed.pitch_deg) ? parsed.pitch_deg : undefined,
      remoteYawDeg: Number.isFinite(parsed.yaw_deg) ? parsed.yaw_deg : undefined,
      qerr_deg: Number.isFinite(parsed.qerr_deg) ? parsed.qerr_deg : undefined,
      qerrDeg: Number.isFinite(parsed.qerrDeg) ? parsed.qerrDeg : undefined,
      qerrSource: parsed.qerrSource || '',
      wx: Number.isFinite(parsed.wx) ? parsed.wx : undefined,
      wy: Number.isFinite(parsed.wy) ? parsed.wy : undefined,
      wz: Number.isFinite(parsed.wz) ? parsed.wz : undefined,
      angularRateSource: parsed.angularRateSource || '',
      RPM1: Number.isFinite(parsed.RPM1) ? parsed.RPM1 : undefined,
      RPM2: Number.isFinite(parsed.RPM2) ? parsed.RPM2 : undefined,
      RPM3: Number.isFinite(parsed.RPM3) ? parsed.RPM3 : undefined,
      RPMcmd1: Number.isFinite(parsed.RPMcmd1) ? parsed.RPMcmd1 : undefined,
      RPMcmd2: Number.isFinite(parsed.RPMcmd2) ? parsed.RPMcmd2 : undefined,
      RPMcmd3: Number.isFinite(parsed.RPMcmd3) ? parsed.RPMcmd3 : undefined,
      PWM1: Number.isFinite(parsed.PWM1) ? parsed.PWM1 : undefined,
      PWM2: Number.isFinite(parsed.PWM2) ? parsed.PWM2 : undefined,
      PWM3: Number.isFinite(parsed.PWM3) ? parsed.PWM3 : undefined,
      Tbodycmd_x_Nm: Number.isFinite(parsed.Tbodycmd_x_Nm) ? parsed.Tbodycmd_x_Nm : undefined,
      Tbodycmd_y_Nm: Number.isFinite(parsed.Tbodycmd_y_Nm) ? parsed.Tbodycmd_y_Nm : undefined,
      Tbodycmd_z_Nm: Number.isFinite(parsed.Tbodycmd_z_Nm) ? parsed.Tbodycmd_z_Nm : undefined,
      Tmotor1_Nm: Number.isFinite(parsed.Tmotor1_Nm) ? parsed.Tmotor1_Nm : undefined,
      Tmotor2_Nm: Number.isFinite(parsed.Tmotor2_Nm) ? parsed.Tmotor2_Nm : undefined,
      Tmotor3_Nm: Number.isFinite(parsed.Tmotor3_Nm) ? parsed.Tmotor3_Nm : undefined,
      commandType: Number.isFinite(parsed.commandType) ? parsed.commandType : undefined,
      command_type: Number.isFinite(parsed.command_type) ? parsed.command_type : undefined,
      control_mode: parsed.control_mode ?? '',
      EBIMU_status: parsed.EBIMU_status ?? '',
      logging_status: parsed.logging_status ?? '',
      ebimu_timestamp_ms: Number.isFinite(parsed.ebimu_timestamp_ms) ? parsed.ebimu_timestamp_ms : 0,
      timestamp: Number.isFinite(parsed.timestamp) ? parsed.timestamp : parsed.ebimu_timestamp_ms,
      timestamp_us: Number.isFinite(parsed.timestamp_us) ? parsed.timestamp_us : parsed.remote_timestamp_us,
      remote_timestamp: Number.isFinite(parsed.remote_timestamp) ? parsed.remote_timestamp : parsed.ebimu_timestamp_ms,
      remote_timestamp_us: Number.isFinite(parsed.remote_timestamp_us) ? parsed.remote_timestamp_us : parsed.timestamp_us,
      seq: Number.isFinite(parsed.seq) ? parsed.seq : 0,
      rxCount: Number.isFinite(parsed.rxCount) ? parsed.rxCount : 0,
      ...encoderFields,
      raw: parsed.cleanLine || '',
      updatedAt: now,
    };

    packet.rollDeg = packet.roll_deg;
    packet.pitchDeg = packet.pitch_deg;
    packet.yawDeg = packet.yaw_deg;
    packet.ebimuTimestampMs = packet.ebimu_timestamp_ms;
    if (hasIncomingEncoderData(parsed)) {
      latestEncoderRef.current = makeEncoderFields(packet, {}, {
        useFallback: false,
        now,
        encoderEulerSequence,
        encoderAngleToQuatSequence,
        encoderDisplayRollSign: encoderDisplaySigns.roll,
        encoderDisplayPitchSign: encoderDisplaySigns.pitch,
        encoderDisplayYawSign: encoderDisplaySigns.yaw,
      });
    } else {
      latestEncoderRef.current = encoderFields;
    }

    const normalizedPacket = normalizeLivePacket(packet, 'admin-web-serial', {
      desiredAttitude: latestDesiredAttitudeRef.current,
      imuEulerSequence,
      encoderEulerSequence,
      encoderAngleToQuatSequence,
      imuDisplayRollSign: imuDisplaySigns.roll,
      imuDisplayPitchSign: imuDisplaySigns.pitch,
      imuDisplayYawSign: imuDisplaySigns.yaw,
      encoderDisplayRollSign: encoderDisplaySigns.roll,
      encoderDisplayPitchSign: encoderDisplaySigns.pitch,
      encoderDisplayYawSign: encoderDisplaySigns.yaw,
      bodyRateWzDisplaySign,
      now,
    }) || packet;
    const commonPacket = patchPacketWithDesired({
      ...packet,
      ...normalizedPacket,
      source: 'admin-web-serial',
      sourceLabel: 'Admin Web Serial Bridge',
      enc_x_deg: normalizedPacket.enc_x_deg,
      enc_y_deg: normalizedPacket.enc_y_deg,
      enc_z_deg: normalizedPacket.enc_z_deg,
      enc_q0: normalizedPacket.enc_q0,
      enc_q1: normalizedPacket.enc_q1,
      enc_q2: normalizedPacket.enc_q2,
      enc_q3: normalizedPacket.enc_q3,
      enc_age_x: normalizedPacket.enc_age_x,
      enc_age_y: normalizedPacket.enc_age_y,
      enc_age_z: normalizedPacket.enc_age_z,
      enc_timer_x: normalizedPacket.enc_timer_x,
      enc_timer_y: normalizedPacket.enc_timer_y,
      enc_timer_z: normalizedPacket.enc_timer_z,
      encoderXDeg: normalizedPacket.encoderXDeg,
      encoderYDeg: normalizedPacket.encoderYDeg,
      encoderZDeg: normalizedPacket.encoderZDeg,
      encoderQ0: normalizedPacket.encoderQ0,
      encoderQ1: normalizedPacket.encoderQ1,
      encoderQ2: normalizedPacket.encoderQ2,
      encoderQ3: normalizedPacket.encoderQ3,
      encoderTimerX: normalizedPacket.encoderTimerX,
      encoderTimerY: normalizedPacket.encoderTimerY,
      encoderTimerZ: normalizedPacket.encoderTimerZ,
      encoderAgeX: normalizedPacket.encoderAgeX,
      encoderAgeY: normalizedPacket.encoderAgeY,
      encoderAgeZ: normalizedPacket.encoderAgeZ,
      encoderUpdatedAt: normalizedPacket.encoderUpdatedAt,
      encoderSource: normalizedPacket.encoderSource,
      encoderStatus: normalizedPacket.encoderStatus,
      encoderAngleToQuatSequence: normalizedPacket.encoderAngleToQuatSequence,
      encoderEulerSequence: normalizedPacket.encoderEulerSequence,
      encoderRollDeg: normalizedPacket.encoderRollDeg,
      encoderPitchDeg: normalizedPacket.encoderPitchDeg,
      encoderYawDeg: normalizedPacket.encoderYawDeg,
      encoderQuatSource: normalizedPacket.encoderQuatSource,
      encoderRpySource: normalizedPacket.encoderRpySource,
      encoder: normalizedPacket.encoder,
      raw: packet.raw,
      rawPrefix: parsed.rawPrefix || parsed.raw_prefix || (parsed.source === 'Remote_ESPNOW_IMU' ? 'IMU' : 'TEL'),
      raw_prefix: parsed.raw_prefix || parsed.rawPrefix || (parsed.source === 'Remote_ESPNOW_IMU' ? 'IMU' : 'TEL'),
      sample_type: parsed.sample_type || parsed.sampleType || (parsed.source === 'Remote_ESPNOW_IMU' ? 'IMU' : 'TEL'),
      sampleType: parsed.sampleType || parsed.sample_type || (parsed.source === 'Remote_ESPNOW_IMU' ? 'IMU' : 'TEL'),
      updatedAt: now,
    }, latestDesiredAttitudeRef.current);

    latestPacketRef.current = commonPacket;
    pushCsvLogPacket(commonPacket);
    lastReceivedAtRef.current = now;
    lastRawLineRef.current = commonPacket.raw;
    lastInvalidReasonRef.current = '';
    countersRef.current.valid += 1;

    recentPacketsRef.current = [commonPacket, ...recentPacketsRef.current].slice(0, MAX_RECENT_PACKETS);

      const chartPoint = {
        time: new Date(now).toLocaleTimeString('ko-KR', { hour12: false, minute: '2-digit', second: '2-digit' }),
        roll: commonPacket.roll_deg,
        pitch: commonPacket.pitch_deg,
        yaw: commonPacket.yaw_deg,
        encX: commonPacket.enc_x_deg ?? commonPacket.encoderXDeg,
        encY: commonPacket.enc_y_deg ?? commonPacket.encoderYDeg,
        encZ: commonPacket.enc_z_deg ?? commonPacket.encoderZDeg,
        encoderRoll: commonPacket.encoderHasQuaternion ? commonPacket.encoderRollDeg : null,
        encoderPitch: commonPacket.encoderHasQuaternion ? commonPacket.encoderPitchDeg : null,
        encoderYaw: commonPacket.encoderHasQuaternion ? commonPacket.encoderYawDeg : null,
      };
    chartDataRef.current = [...chartDataRef.current, chartPoint].slice(-MAX_CHART_POINTS);

    if (typeof window !== 'undefined') {
      window.__CUBLI_SERIAL_PACKET = commonPacket;
    }

    markPendingUiFlush();
  }, [
    bodyRateWzDisplaySign,
    encoderDisplaySigns.pitch,
    encoderDisplaySigns.roll,
    encoderDisplaySigns.yaw,
    encoderAngleToQuatSequence,
    encoderEulerSequence,
    imuDisplaySigns.pitch,
    imuDisplaySigns.roll,
    imuDisplaySigns.yaw,
    imuEulerSequence,
    markPendingUiFlush,
    pushCsvLogPacket,
    recordInputRate,
  ]);

  const registerInvalidLineRefOnly = useCallback((parsed) => {
    if (parsed.warning) {
      countersRef.current.warning += 1;
      lastRawLineRef.current = parsed.cleanLine || cleanLine(parsed.raw || '');
      lastInvalidReasonRef.current = parsed.reason || 'remote status line';
      markPendingUiFlush();
      return;
    }

    if (parsed.ignored) {
      countersRef.current.ignored += 1;
      lastRawLineRef.current = parsed.cleanLine || cleanLine(parsed.raw || '');
      lastInvalidReasonRef.current = parsed.reason || 'ignored non-telemetry line';
      markPendingUiFlush();
      // 무시되는 ACK/INFO/WARN 라인까지 화면에 계속 반영하면 read loop가 느려진다.
      // raw line은 valid IMU/ENC 또는 실제 parse error가 있을 때만 갱신한다.
      return;
    }

    countersRef.current.invalid += 1;
    lastRawLineRef.current = parsed.cleanLine || cleanLine(parsed.raw || '');
    lastInvalidReasonRef.current = parsed.reason || 'parse failed';
    markPendingUiFlush();
  }, [markPendingUiFlush]);

  const handleLine = useCallback((line) => {
    const parsed = parseSerialLine(line);
    if (parsed.ok) registerValidPacketRefOnly(parsed);
    else registerInvalidLineRefOnly(parsed);
  }, [registerInvalidLineRefOnly, registerValidPacketRefOnly]);

  const processChunk = useCallback((text) => {
    bufferRef.current += text;

    if (bufferRef.current.length > MAX_BUFFER_LENGTH) {
      const lastNewline = bufferRef.current.lastIndexOf('\n');
      if (lastNewline >= 0) {
        bufferRef.current = bufferRef.current.slice(lastNewline + 1);
      } else {
        bufferRef.current = bufferRef.current.slice(-1024);
      }
      droppedBufferCountRef.current += 1;
      countersRef.current.warning += 1;
      lastInvalidReasonRef.current = `local line buffer trimmed ${droppedBufferCountRef.current}x`;
      markPendingUiFlush();
    }

    let newlineIndex;
    // split()으로 긴 배열을 매 chunk마다 만드는 것보다 하나씩 잘라 처리하는 편이 더 가볍다.
    while ((newlineIndex = bufferRef.current.search(/\r?\n/)) >= 0) {
      const line = bufferRef.current.slice(0, newlineIndex);
      const nextStart = bufferRef.current[newlineIndex] === '\r' && bufferRef.current[newlineIndex + 1] === '\n'
        ? newlineIndex + 2
        : newlineIndex + 1;
      bufferRef.current = bufferRef.current.slice(nextStart);

      const trimmed = line.trim();
      if (trimmed) handleLine(trimmed);
    }
  }, [handleLine, markPendingUiFlush]);

  const readLoop = useCallback(async () => {
    if (!portRef.current) return;

    keepReadingRef.current = true;

    // Web Serial read errors such as "Buffer overrun" can be non-fatal.
    // Chrome's recommended pattern is to release the reader and reacquire a new
    // reader while port.readable is still available, instead of stopping forever.
    while (keepReadingRef.current && portRef.current?.readable) {
      const reader = portRef.current.readable.getReader();
      readerRef.current = reader;

      try {
        while (keepReadingRef.current) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            processChunk(decoderRef.current.decode(value, { stream: true }));
          }
        }
      } catch (err) {
        if (!keepReadingRef.current) break;

        const msg = err?.message || 'Serial read error';
        const isRecoverable = /buffer overrun|break condition|framing error|parity error/i.test(msg);

        if (isRecoverable) {
          countersRef.current.warning += 1;
          lastInvalidReasonRef.current = `${msg} - reader recovered`;
          markPendingUiFlush();
          // Do not set fatal error or disconnect. Release the reader below,
          // wait briefly, and reacquire the new readable stream.
          await new Promise((resolve) => setTimeout(resolve, 25));
        } else {
          setError(serialErrorMessage(msg));
          break;
        }
      } finally {
        try { reader.releaseLock(); } catch (_) {}
        if (readerRef.current === reader) readerRef.current = null;
      }

      // If the stream ended normally because of disconnect/cancel, leave loop.
      if (!keepReadingRef.current) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }, [markPendingUiFlush, processChunk]);

  const releaseWriter = useCallback(() => {
    try { writerRef.current?.releaseLock?.(); } catch (_) {}
    writerRef.current = null;
    setSerialWriterReady(false);
  }, []);

  const prepareWriter = useCallback(() => {
    const port = portRef.current;
    if (!port?.writable) {
      setSerialWriterReady(false);
      return false;
    }
    if (writerRef.current) {
      setSerialWriterReady(true);
      return true;
    }
    try {
      writerRef.current = port.writable.getWriter();
      setSerialWriterReady(true);
      setLastLocalWriteError('');
      return true;
    } catch (err) {
      const message = serialErrorMessage(err) || 'Serial writer is not ready.';
      setLastLocalWriteError(message);
      setError(message);
      setSerialWriterReady(false);
      return false;
    }
  }, []);

  const closeCurrentPort = useCallback(async () => {
    keepReadingRef.current = false;

    try { if (readerRef.current) await readerRef.current.cancel(); } catch (_) {}
    try { readerRef.current?.releaseLock?.(); } catch (_) {}
    releaseWriter();

    try {
      if (portRef.current) await portRef.current.close();
    } catch (_) {
      // A stale browser-side port can already be closed or busy. Connect will
      // report the actionable OS-level COM handle error if one remains.
    } finally {
      portRef.current = null;
      readerRef.current = null;
      setIsConnected(false);
      setSerialWriterReady(false);
    }
  }, [releaseWriter]);

  const connect = useCallback(async () => {
    if (!isSupported) {
      setError(WEB_SERIAL_UNSUPPORTED_MESSAGE);
      return false;
    }

    try {
      await closeCurrentPort();
      setError('');
      bufferRef.current = '';
      lastInvalidReasonRef.current = '';
      lastRawLineRef.current = '';
      lastReceivedAtRef.current = null;
      markPendingUiFlush();
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: BAUD_RATE });

      portRef.current = port;
      prepareWriter();
      setBaudRate(BAUD_RATE);
      setIsConnected(true);
      lastInvalidReasonRef.current = 'Port opened, waiting for telemetry... No IMU/TEL/ENC data yet';
      markPendingUiFlush();
      readLoop();
      return true;
    } catch (err) {
      setError(serialErrorMessage(err));
      await closeCurrentPort();
      setIsConnected(false);
      setSerialWriterReady(false);
      return false;
    }
  }, [closeCurrentPort, isSupported, markPendingUiFlush, prepareWriter, readLoop]);

  const disconnect = useCallback(async () => {
    try {
      await closeCurrentPort();
    } catch (err) {
      setError(serialErrorMessage(err) || 'Serial disconnect failed');
    }
  }, [closeCurrentPort]);

  const sendLine = useCallback(async (line) => {
    if (!portRef.current?.writable || !isConnected) {
      const message = 'Serial receiver is not connected.';
      setError(message);
      lastLocalWriteErrorRef.current = message;
      setLastLocalWriteError(message);
      return false;
    }

    if (!writerRef.current && !prepareWriter()) {
      const message = lastLocalWriteError || 'Serial writer is not ready.';
      setError(message);
      lastLocalWriteErrorRef.current = message;
      setLastLocalWriteError(message);
      return false;
    }

    if (commandBusyRef.current) {
      const message = 'Command send is already in progress. Try again shortly.';
      setError(message);
      lastLocalWriteErrorRef.current = message;
      setLastLocalWriteError(message);
      return false;
    }

    commandBusyRef.current = true;
    try {
      const normalizedLine = String(line).trim();
      if (!normalizedLine) {
        lastLocalWriteErrorRef.current = 'Command line is empty.';
        setLastLocalWriteError('Command line is empty.');
        return false;
      }
      await writerRef.current.write(encoderRef.current.encode(`${normalizedLine}\n`));
      setLastCommand(normalizedLine);
      lastRawLineRef.current = `TX: ${normalizedLine}`;
      lastInvalidReasonRef.current = '';
      markPendingUiFlush();
      setError('');
      lastLocalWriteErrorRef.current = '';
      setLastLocalWriteError('');
      return true;
    } catch (err) {
      const message = serialErrorMessage(err) || 'command send failed';
      setError(message);
      lastLocalWriteErrorRef.current = message;
      setLastLocalWriteError(message);
      releaseWriter();
      return false;
    } finally {
      commandBusyRef.current = false;
    }
  }, [isConnected, lastLocalWriteError, markPendingUiFlush, prepareWriter, releaseWriter]);

  const sendCommand = useCallback((command) => {
    const body = String(command || '').trim();
    if (!body) return Promise.resolve(false);

    if (body.toUpperCase() === 'TARE') return sendLine('TARE');
    if (body.toUpperCase() === 'STOP') return sendLine('STOP');
    if (body.toUpperCase() === 'START') return sendLine('START');
    return sendLine(body);
  }, [sendLine]);

  const sendControllerCommand = useCallback((commandType, target1 = 0, target2 = 0, target3 = 0) => {
    const type = Number(commandType);
    const v1 = Number(target1) || 0;
    const v2 = Number(target2) || 0;
    const v3 = Number(target3) || 0;
    const line = `${type} ${v1} ${v2} ${v3}`;
    if (type === 1) recordTargetAttitudeCommand(v1, v2, v3, line);
    return sendLine(line);
  }, [recordTargetAttitudeCommand, sendLine]);

  const sendTare = useCallback(() => sendControllerCommand(2, 0, 0, 0), [sendControllerCommand]);
  const sendStop = useCallback(() => sendControllerCommand(0, 0, 0, 0), [sendControllerCommand]);
  const sendTarget = useCallback((roll, pitch, yaw) => sendControllerCommand(1, roll, pitch, yaw), [sendControllerCommand]);

  const clearStats = useCallback(() => {
    bufferRef.current = '';
    prevQRef.current = [1, 0, 0, 0];
    latestEncoderRef.current = makeInitialEncoder(encoderEulerSequence, encoderAngleToQuatSequence);
    latestPacketRef.current = DEFAULT_PACKET;
    latestCsvPacketRef.current = null;
    latestDesiredAttitudeRef.current = null;
    csvLogQueueRef.current = [];
    csvCaptureEnabledRef.current = false;
    lastCsvSampleClockRef.current = null;
    lastCsvUiStatsUpdateRef.current = 0;
    csvLoggedRateWindowRef.current = [];
    recentPacketsRef.current = [];
    chartDataRef.current = [];
    countersRef.current = { valid: 0, invalid: 0, ignored: 0, warning: 0 };
    lastRawLineRef.current = '';
    lastInvalidReasonRef.current = '';
    lastReceivedAtRef.current = null;
    pendingUiFlushRef.current = true;
    droppedBufferCountRef.current = 0;
    encoderCountRef.current = 0;
    inputRateWindowRef.current = [];

    setLastRawLine('');
    setLastInvalidReason('');
    setLastReceivedAt(null);
    setLatestPacket(DEFAULT_PACKET);
    setLatestCsvPacket(null);
    setLatestDesiredAttitude(null);
    setCsvLogVersion(0);
    setRecentPackets([]);
    setChartData([]);
    setValidCount(0);
    setInvalidCount(0);
    setIgnoredCount(0);
    setWarningCount(0);
    setEncoderCount(0);
    setInputHz(0);
    setCsvLoggedHz(0);
    setLastCommand('');
    lastLocalWriteErrorRef.current = '';
    setLastLocalWriteError('');
  }, [encoderAngleToQuatSequence, encoderEulerSequence]);

  useEffect(() => {
    return () => {
      keepReadingRef.current = false;
      try { readerRef.current?.cancel(); } catch (_) {}
      try { writerRef.current?.releaseLock?.(); } catch (_) {}
      try { portRef.current?.close(); } catch (_) {}
    };
  }, []);

  return {
    // 최신 packet을 React state 갱신 주기와 분리해서 3D render loop가 직접 읽을 수 있게 한다.
    // 이 ref는 packet이 들어오는 즉시 바뀌므로, 3D 자세는 UI flush(100ms)에 묶이지 않는다.
    latestPacketRef,
    latestCsvPacketRef,
    isSupported,
    isConnected,
    baudRate,
    error,
    lastRawLine,
    lastInvalidReason,
    lastReceivedAt,
    latestPacket,
    latestCsvPacket,
    latestDesiredAttitude,
    csvLogVersion,
    csvMode: 'Save every valid Serial sample',
    csvUiStatsIntervalMs: CSV_UI_STATS_INTERVAL_MS,
    csvLoggedHz,
    recentPackets,
    chartData,
    validCount,
    invalidCount,
    ignoredCount,
    warningCount,
    encoderCount,
    inputHz,
    validRatio,
    lastCommand,
    serialWriterReady,
    lastLocalWriteError,
    getLastLocalWriteError: () => lastLocalWriteErrorRef.current,
    connect,
    disconnect,
    sendLine,
    sendCommand,
    sendControllerCommand,
    sendTare,
    sendStop,
    sendTarget,
    clearStats,
    drainCsvLogSamples,
    startCsvLogCapture,
    stopCsvLogCapture,
  };
}
