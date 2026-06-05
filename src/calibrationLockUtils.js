export const CALIBRATION_LOCK_STATES = Object.freeze({
  IDLE: 'IDLE',
  SENDING: 'SENDING',
  WAITING_STABLE_TEL: 'WAITING_STABLE_TEL',
  WAITING_STABLE_ENC: 'WAITING_STABLE_ENC',
  COMPLETE: 'COMPLETE',
  TIMEOUT: 'TIMEOUT',
  ERROR: 'ERROR',
});

export const SAFE_DURING_CALIBRATION_COMMANDS = Object.freeze(new Set([
  'stop',
  'emergencyStop',
  'wheelRpmStop',
]));

const TEL_PROFILE = Object.freeze({ waitFor: 'tel', minWaitMs: 450, timeoutMs: 3000 });
const FULL_PROFILE = Object.freeze({ waitFor: 'tel', minWaitMs: 3000, timeoutMs: 10000 });
const ENC_PROFILE = Object.freeze({ waitFor: 'enc', minWaitMs: 650, timeoutMs: 3000 });
const EBIMU_PROFILE = Object.freeze({ waitFor: 'tel', minWaitMs: 1200, timeoutMs: 5000 });

export const CALIBRATION_COMMAND_PROFILES = Object.freeze({
  tare: { ...TEL_PROFILE, label: 'Set Zero / Tare' },
  cubliInitialize: { ...FULL_PROFILE, label: 'Cubli Initialize' },
  encoderInitialize: { ...ENC_PROFILE, label: 'Gimbal Encoder Initialize' },
  encoderTare: { ...ENC_PROFILE, label: 'Gimbal Encoder Zero' },
  ebimuDefault: { ...EBIMU_PROFILE, label: 'Apply EBIMU Default Settings' },
  ebimuStart: { ...EBIMU_PROFILE, label: 'EBIMU Start' },
  ebimuStop: { ...EBIMU_PROFILE, label: 'EBIMU Stop' },
  magOff: { ...EBIMU_PROFILE, label: 'Mag Off' },
  magOn: { ...EBIMU_PROFILE, label: 'Mag On' },
  magAuto: { ...EBIMU_PROFILE, label: 'Mag Auto' },
  gyro250: { ...EBIMU_PROFILE, label: 'Gyro 250 dps' },
  gyro500: { ...EBIMU_PROFILE, label: 'Gyro 500 dps' },
  gyro1000: { ...EBIMU_PROFILE, label: 'Gyro 1000 dps' },
  gyro2000: { ...EBIMU_PROFILE, label: 'Gyro 2000 dps' },
  acc2g: { ...EBIMU_PROFILE, label: 'Accel 2 g' },
  acc4g: { ...EBIMU_PROFILE, label: 'Accel 4 g' },
  acc8g: { ...EBIMU_PROFILE, label: 'Accel 8 g' },
  acc16g: { ...EBIMU_PROFILE, label: 'Accel 16 g' },
  accFactor: { ...EBIMU_PROFILE, label: 'Accel Filter Factor' },
});

export function finiteCalibrationNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function firstFinite(values, fallback = null) {
  for (const value of values) {
    const number = finiteCalibrationNumber(value, null);
    if (number !== null) return number;
  }
  return fallback;
}

function quaternionNorm(values) {
  const q = values.map((value) => finiteCalibrationNumber(value, null));
  if (!q.every((value) => value !== null)) return null;
  const norm = Math.sqrt(q.reduce((sum, value) => sum + value * value, 0));
  return Number.isFinite(norm) ? norm : null;
}

export function isQuaternionNormStable(norm) {
  return Number.isFinite(norm) && norm >= 0.8 && norm <= 1.2;
}

export function readAttitudeOrder(packet = {}) {
  return {
    seq: firstFinite([packet.seq, packet.rxCount, packet.packetCount], null),
    timestamp: firstFinite([packet.timestamp, packet.ebimu_timestamp_ms, packet.ebimuTimestampMs], null),
    pcTimeMs: firstFinite([packet.pcTimeMs, packet.pc_time_ms, packet.updatedAt, packet.publishedAt], null),
  };
}

export function readEncoderOrder(packet = {}) {
  const encoder = packet.encoder || {};
  return {
    updatedAt: firstFinite([packet.encoderUpdatedAt, encoder.updatedAt, packet.updatedAt, packet.publishedAt], null),
    timerX: firstFinite([packet.enc_timer_x, packet.encoderTimerX, encoder.timerX, encoder.timer_x], null),
    timerY: firstFinite([packet.enc_timer_y, packet.encoderTimerY, encoder.timerY, encoder.timer_y], null),
    timerZ: firstFinite([packet.enc_timer_z, packet.encoderTimerZ, encoder.timerZ, encoder.timer_z], null),
  };
}

export function readTelemetrySnapshot(packet = {}) {
  const attitude = readAttitudeOrder(packet);
  const encoder = readEncoderOrder(packet);
  return {
    capturedAt: Date.now(),
    attitude,
    encoder,
  };
}

export function classifyCommandKey(commandKey = '') {
  const key = String(commandKey || '').trim();
  return {
    commandKey: key,
    isSafe: SAFE_DURING_CALIBRATION_COMMANDS.has(key),
    isCalibration: Boolean(CALIBRATION_COMMAND_PROFILES[key]),
    profile: CALIBRATION_COMMAND_PROFILES[key] || null,
  };
}

export function commandLineToCalibrationKey(line = '') {
  const raw = String(line || '').trim();
  const upper = raw.toUpperCase();
  if (!upper) return '';
  if (upper === 'TARE') return 'tare';
  if (upper === 'STOP') return 'stop';
  if (upper === 'RPMSTOP' || upper === 'TESTSTOP') return 'wheelRpmStop';
  if (upper === 'EBIMU_DEFAULT') return 'ebimuDefault';
  if (upper === 'EBIMU_START') return 'ebimuStart';
  if (upper === 'EBIMU_STOP') return 'ebimuStop';
  if (upper === 'MAG_OFF') return 'magOff';
  if (upper === 'MAG_ON') return 'magOn';
  if (upper === 'MAG_AUTO') return 'magAuto';
  if (upper === 'GYRO_250') return 'gyro250';
  if (upper === 'GYRO_500') return 'gyro500';
  if (upper === 'GYRO_1000') return 'gyro1000';
  if (upper === 'GYRO_2000') return 'gyro2000';
  if (upper === 'ACC_2G') return 'acc2g';
  if (upper === 'ACC_4G') return 'acc4g';
  if (upper === 'ACC_8G') return 'acc8g';
  if (upper === 'ACC_16G') return 'acc16g';
  if (/^ACCF\s*,/.test(upper)) return 'accFactor';
  if (/^(RPM|RPMALL)\s*,/.test(upper)) return 'wheelRpmAll';

  const parts = upper.split(/[,\s]+/).filter(Boolean);
  const type = Number(parts[0]);
  if (type === 0) return 'stop';
  if (type === 1) return 'targetAttitude';
  if (type === 2) return 'tare';
  if (type === 60) return 'attitudeKp';
  if (type === 61) return 'attitudeKd';
  if (type === 50) {
    const cmdId = Number(parts[1]);
    const value = Number(parts[2]);
    if (cmdId === 1) {
      if (value === 0) return 'magOff';
      if (value === 1) return 'magOn';
      if (value === 2) return 'magAuto';
    }
    if (cmdId === 2) return `gyro${Number.isFinite(value) ? value : ''}`;
    if (cmdId === 3) return `acc${Number.isFinite(value) ? value : ''}g`;
    if (cmdId === 4) return 'accFactor';
    if (cmdId === 9) return 'ebimuDefault';
    if (cmdId === 10) return 'ebimuStart';
    if (cmdId === 11) return 'ebimuStop';
  }
  return '';
}

function attitudeProgressed(current = {}, baseline = {}) {
  if (current.seq !== null && baseline.seq !== null && current.seq > baseline.seq) return true;
  if (current.timestamp !== null && baseline.timestamp !== null && current.timestamp > baseline.timestamp) return true;
  if (current.pcTimeMs !== null && baseline.pcTimeMs !== null && current.pcTimeMs > baseline.pcTimeMs) return true;
  return baseline.seq === null && baseline.timestamp === null && current.pcTimeMs !== null;
}

function encoderProgressed(current = {}, baseline = {}) {
  if (current.updatedAt !== null && baseline.updatedAt !== null && current.updatedAt > baseline.updatedAt) return true;
  if (current.timerX !== null && baseline.timerX !== null && current.timerX !== baseline.timerX) return true;
  if (current.timerY !== null && baseline.timerY !== null && current.timerY !== baseline.timerY) return true;
  if (current.timerZ !== null && baseline.timerZ !== null && current.timerZ !== baseline.timerZ) return true;
  return baseline.updatedAt === null && current.updatedAt !== null;
}

export function hasStableAttitudeTelemetry(packet = {}, baseline = {}) {
  const norm = quaternionNorm([packet.q0, packet.q1, packet.q2, packet.q3]);
  const order = readAttitudeOrder(packet);
  return {
    ok: isQuaternionNormStable(norm) && attitudeProgressed(order, baseline.attitude || {}),
    norm,
    order,
  };
}

export function hasStableEncoderTelemetry(packet = {}, baseline = {}) {
  const encoder = packet.encoder || {};
  const norm = quaternionNorm([
    packet.enc_q0 ?? packet.encoderQ0 ?? encoder.q0,
    packet.enc_q1 ?? packet.encoderQ1 ?? encoder.q1,
    packet.enc_q2 ?? packet.encoderQ2 ?? encoder.q2,
    packet.enc_q3 ?? packet.encoderQ3 ?? encoder.q3,
  ]);
  const order = readEncoderOrder(packet);
  return {
    ok: isQuaternionNormStable(norm) && encoderProgressed(order, baseline.encoder || {}),
    norm,
    order,
  };
}

export function makeCalibrationLock(commandKey, label = '', baselinePacket = {}, now = Date.now()) {
  const info = classifyCommandKey(commandKey);
  if (!info.isCalibration) return null;
  const profile = info.profile;
  const state = profile.waitFor === 'enc'
    ? CALIBRATION_LOCK_STATES.WAITING_STABLE_ENC
    : CALIBRATION_LOCK_STATES.WAITING_STABLE_TEL;
  return {
    busy: true,
    state,
    commandKey: info.commandKey,
    label: label || profile.label || info.commandKey,
    waitFor: profile.waitFor,
    startedAt: now,
    timeoutAt: now + profile.timeoutMs,
    minWaitUntil: now + profile.minWaitMs,
    timeoutMs: profile.timeoutMs,
    minWaitMs: profile.minWaitMs,
    completedAt: null,
    error: '',
    message: profile.waitFor === 'enc'
      ? 'Waiting for stable encoder telemetry...'
      : 'Waiting for stable IMU telemetry...',
    baseline: readTelemetrySnapshot(baselinePacket),
  };
}

export function updateCalibrationLock(lock, packet = {}, now = Date.now()) {
  if (!lock?.busy) return lock || { busy: false, state: CALIBRATION_LOCK_STATES.IDLE };
  if (now >= lock.timeoutAt) {
    return {
      ...lock,
      busy: false,
      state: CALIBRATION_LOCK_STATES.TIMEOUT,
      completedAt: now,
      error: lock.waitFor === 'enc'
        ? 'Gimbal zero timeout: ENC telemetry not stable'
        : 'Calibration timeout: IMU telemetry not stable',
      message: 'Calibration timeout',
    };
  }
  if (now < lock.minWaitUntil) {
    return {
      ...lock,
      message: lock.waitFor === 'enc'
        ? 'Waiting for stable encoder telemetry...'
        : 'Waiting for stable IMU telemetry...',
    };
  }
  const stable = lock.waitFor === 'enc'
    ? hasStableEncoderTelemetry(packet, lock.baseline)
    : hasStableAttitudeTelemetry(packet, lock.baseline);
  if (!stable.ok) {
    return {
      ...lock,
      message: lock.waitFor === 'enc'
        ? 'Waiting for stable encoder telemetry...'
        : 'Waiting for stable IMU telemetry...',
    };
  }
  return {
    ...lock,
    busy: false,
    state: CALIBRATION_LOCK_STATES.COMPLETE,
    completedAt: now,
    error: '',
    message: `${lock.label || 'Calibration'} complete`,
  };
}

export function isCommandBlockedByCalibration(lock, commandKey) {
  if (!lock?.busy) return false;
  const info = classifyCommandKey(commandKey);
  return !info.isSafe;
}

export function calibrationLockReason(lock) {
  if (!lock?.busy) return '';
  return 'Calibration in progress. Wait for stable telemetry, then try again.';
}
