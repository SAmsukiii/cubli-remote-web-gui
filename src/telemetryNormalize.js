const SOURCE_LABELS = {
  'server-serial': 'Server Remote Serial',
  'admin-web-serial': 'Admin Web Serial Bridge',
  'legacy-web-serial': 'Admin Web Serial Bridge',
  ble: 'Admin BLE',
  phone: 'Admin Phone Sensor',
};
export const EULER_SEQUENCES = Object.freeze(['ZYX', 'XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY']);
const DEFAULT_EULER_SEQUENCE = 'ZYX';
export const DEFAULT_ENCODER_ANGLE_TO_QUAT_SEQUENCE = 'ZYX';
export const DEFAULT_ENCODER_FRESH_MS = 300;
export const DEFAULT_ENCODER_TIMER_SPREAD_MS = 100;
export const ENCODER_ALIGNMENT_MAX_AGE_MS = 500;
export const ENCODER_ALIGNMENT_SOURCE = 'pwa-latest-encoder-cache';
const DEFAULT_ENCODER_SYNC_MS = DEFAULT_ENCODER_TIMER_SPREAD_MS;
export const DEFAULT_RPY_DISPLAY_SIGNS = Object.freeze({ roll: 1, pitch: 1, yaw: 1 });
export const DEFAULT_ENCODER_DISPLAY_SIGNS = Object.freeze({ roll: 1, pitch: 1, yaw: 1 });
export const DEFAULT_BODY_RATE_WZ_DISPLAY_SIGN = 1;

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

function sourceKey(source) {
  const text = String(source || '').toLowerCase();
  if (text === 'server-serial' || text.includes('server')) return 'server-serial';
  if (text === 'admin-web-serial' || text === 'legacy-web-serial' || text.includes('web-serial') || text === 'serial') return 'admin-web-serial';
  if (text.includes('ble')) return 'ble';
  if (text.includes('phone')) return 'phone';
  return source || 'unknown';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeEulerSequence(sequence, fallback = DEFAULT_EULER_SEQUENCE) {
  const text = String(sequence || '').trim().toUpperCase();
  return EULER_SEQUENCES.includes(text) ? text : fallback;
}

export function normalizeSign(value, fallback = 1) {
  const number = Number(value);
  if (number === -1) return -1;
  if (number === 1) return 1;
  return fallback === -1 ? -1 : 1;
}

export function normalizeRpySigns(source = {}, fallback = DEFAULT_RPY_DISPLAY_SIGNS) {
  return {
    roll: normalizeSign(source.roll ?? source.rollSign, fallback.roll),
    pitch: normalizeSign(source.pitch ?? source.pitchSign, fallback.pitch),
    yaw: normalizeSign(source.yaw ?? source.yawSign, fallback.yaw),
  };
}

export function normalizeImuDisplaySigns(source = {}) {
  const signs = normalizeRpySigns(source, DEFAULT_RPY_DISPLAY_SIGNS);
  return { ...signs, yaw: DEFAULT_RPY_DISPLAY_SIGNS.yaw };
}

export function signsLabel(signs = DEFAULT_RPY_DISPLAY_SIGNS) {
  const safeSigns = normalizeRpySigns(signs);
  return `[${safeSigns.roll > 0 ? '+' : '-'},${safeSigns.pitch > 0 ? '+' : '-'},${safeSigns.yaw > 0 ? '+' : '-'}]`;
}

export function applyEulerDisplaySigns(euler = {}, signs = DEFAULT_RPY_DISPLAY_SIGNS) {
  const safeSigns = normalizeRpySigns(signs);
  return {
    roll: finiteNumber(euler.roll, null) === null ? null : euler.roll * safeSigns.roll,
    pitch: finiteNumber(euler.pitch, null) === null ? null : euler.pitch * safeSigns.pitch,
    yaw: finiteNumber(euler.yaw, null) === null ? null : euler.yaw * safeSigns.yaw,
    sequence: euler.sequence,
  };
}

export function normalizeQuaternion(input) {
  const raw = Array.isArray(input) && input.length === 4 ? input : null;
  if (!raw) return { ok: false, reason: 'quaternion missing', q: null, norm: null };

  const values = raw.map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    return { ok: false, reason: 'quaternion contains non-finite value', q: null, norm: null };
  }

  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm < 0.5 || norm > 1.5) {
    return { ok: false, reason: `quaternion norm out of range: ${norm}`, q: null, norm };
  }

  if (norm < 1e-9) {
    return { ok: false, reason: 'quaternion norm is zero', q: null, norm };
  }

  return {
    ok: true,
    q: values.map((value) => value / norm),
    norm,
    normalized: Math.abs(norm - 1) > 1e-4,
  };
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

export function quaternionToEulerDeg(q, sequence = DEFAULT_EULER_SEQUENCE) {
  const normalized = normalizeQuaternion(q);
  if (!normalized.ok) return null;
  const order = normalizeEulerSequence(sequence);
  const { m11, m12, m13, m21, m22, m23, m31, m32, m33 } = quaternionToMatrixElements(normalized.q);
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

export function eulerDegToQuat(rollDeg, pitchDeg, yawDeg, sequence = DEFAULT_EULER_SEQUENCE) {
  const roll = finiteNumber(rollDeg);
  const pitch = finiteNumber(pitchDeg);
  const yaw = finiteNumber(yawDeg);
  if ([roll, pitch, yaw].some((value) => value === null)) return null;

  const order = normalizeEulerSequence(sequence);
  const x = roll * Math.PI / 180;
  const y = pitch * Math.PI / 180;
  const z = yaw * Math.PI / 180;

  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  let q = null;

  switch (order) {
    case 'XYZ':
      q = [
        c1 * c2 * c3 - s1 * s2 * s3,
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3,
      ];
      break;
    case 'YXZ':
      q = [
        c1 * c2 * c3 + s1 * s2 * s3,
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 - s1 * s2 * c3,
      ];
      break;
    case 'ZXY':
      q = [
        c1 * c2 * c3 - s1 * s2 * s3,
        s1 * c2 * c3 - c1 * s2 * s3,
        c1 * s2 * c3 + s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3,
      ];
      break;
    case 'YZX':
      q = [
        c1 * c2 * c3 - s1 * s2 * s3,
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 + s1 * c2 * s3,
        c1 * c2 * s3 - s1 * s2 * c3,
      ];
      break;
    case 'XZY':
      q = [
        c1 * c2 * c3 + s1 * s2 * s3,
        s1 * c2 * c3 - c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3,
      ];
      break;
    case 'ZYX':
    default:
      q = [
        c1 * c2 * c3 + s1 * s2 * s3,
        s1 * c2 * c3 - c1 * s2 * s3,
        c1 * s2 * c3 + s1 * c2 * s3,
        c1 * c2 * s3 - s1 * s2 * c3,
      ];
      break;
  }

  const normalized = normalizeQuaternion(q);

  return normalized.ok ? normalized.q : null;
}

export function eulerDegToQuaternion(rollDeg, pitchDeg, yawDeg, sequence = DEFAULT_EULER_SEQUENCE) {
  return eulerDegToQuat(rollDeg, pitchDeg, yawDeg, sequence);
}

export function eulerDegToQuatZYX(rollDeg, pitchDeg, yawDeg) {
  return eulerDegToQuat(rollDeg, pitchDeg, yawDeg, 'ZYX');
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

export function computeQerrDeg(qCurrent, desiredAttitude) {
  const current = normalizeQuaternion(qCurrent);
  const desiredQuat = Array.isArray(desiredAttitude)
    ? desiredAttitude
    : [desiredAttitude?.qd0 ?? desiredAttitude?.targetQd0, desiredAttitude?.qd1 ?? desiredAttitude?.targetQd1, desiredAttitude?.qd2 ?? desiredAttitude?.targetQd2, desiredAttitude?.qd3 ?? desiredAttitude?.targetQd3].every((value) => finiteNumber(value, null) !== null)
      ? [desiredAttitude.qd0 ?? desiredAttitude.targetQd0, desiredAttitude.qd1 ?? desiredAttitude.targetQd1, desiredAttitude.qd2 ?? desiredAttitude.targetQd2, desiredAttitude.qd3 ?? desiredAttitude.targetQd3]
    : eulerDegToQuatZYX(
        desiredAttitude?.rollDeg ?? desiredAttitude?.desiredRollDeg ?? desiredAttitude?.desired_roll_deg ?? desiredAttitude?.roll,
        desiredAttitude?.pitchDeg ?? desiredAttitude?.desiredPitchDeg ?? desiredAttitude?.desired_pitch_deg ?? desiredAttitude?.pitch,
        desiredAttitude?.yawDeg ?? desiredAttitude?.desiredYawDeg ?? desiredAttitude?.desired_yaw_deg ?? desiredAttitude?.yaw
      );
  const desired = normalizeQuaternion(desiredQuat);
  if (!current.ok || !desired.ok) return null;
  const dot = clamp(Math.abs(quatDot(current.q, desired.q)), -1, 1);
  const angleDeg = 2 * Math.acos(dot) * 180 / Math.PI;
  return Number.isFinite(angleDeg) ? angleDeg : null;
}

export function estimateAngularRateFromQuat(prevPacket, currentPacket) {
  if (!prevPacket || !currentPacket) return { valid: false, reason: 'not enough samples' };
  const prevTime = firstFinite([prevPacket.pcTimeMs, prevPacket.pc_time_ms, prevPacket.updatedAt, prevPacket.publishedAt], null);
  const nowTime = firstFinite([currentPacket.pcTimeMs, currentPacket.pc_time_ms, currentPacket.updatedAt, currentPacket.publishedAt], null);
  const dt = (nowTime - prevTime) / 1000;
  if (!Number.isFinite(dt) || dt < 0.005 || dt > 1.0) {
    return { valid: false, reason: 'sample dt outside estimate range' };
  }

  const prevQ = normalizeQuaternion(prevPacket.q || [prevPacket.q0, prevPacket.q1, prevPacket.q2, prevPacket.q3]);
  let nowQ = normalizeQuaternion(currentPacket.q || [currentPacket.q0, currentPacket.q1, currentPacket.q2, currentPacket.q3]);
  if (!prevQ.ok || !nowQ.ok) return { valid: false, reason: 'invalid quaternion' };

  let qNow = nowQ.q;
  if (quatDot(prevQ.q, qNow) < 0) qNow = qNow.map((value) => -value);

  let delta = normalizeQuaternion(quatMultiply(qNow, quatConjugate(prevQ.q)));
  if (!delta.ok) return { valid: false, reason: 'invalid delta quaternion' };
  let dq = delta.q;
  if (dq[0] < 0) dq = dq.map((value) => -value);

  const angle = 2 * Math.acos(clamp(dq[0], -1, 1));
  let omegaRad = [0, 0, 0];
  if (angle > 1e-7) {
    const sinHalf = Math.sin(angle / 2);
    if (Math.abs(sinHalf) > 1e-9) {
      omegaRad = [dq[1], dq[2], dq[3]].map((axis) => axis / sinHalf * angle / dt);
    }
  }

  if (omegaRad.some((value) => !Number.isFinite(value))) {
    return { valid: false, reason: 'non-finite angular rate estimate' };
  }

  return {
    valid: true,
    wx: omegaRad[0],
    wy: omegaRad[1],
    wz: omegaRad[2],
    dt,
  };
}

export function hasWheelTelemetry(packet) {
  return ['RPM1', 'RPM2', 'RPM3', 'RPMcmd1', 'RPMcmd2', 'RPMcmd3']
    .some((key) => finiteNumber(packet?.[key], null) !== null);
}

export function hasDebugTelemetry(packet) {
  return [
    'PWM1', 'PWM2', 'PWM3',
    'Tbodycmd_x_Nm', 'Tbodycmd_y_Nm', 'Tbodycmd_z_Nm',
    'Tmotor1_Nm', 'Tmotor2_Nm', 'Tmotor3_Nm',
  ].some((key) => finiteNumber(packet?.[key], null) !== null);
}

function telemetryNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstTelemetryNumber(values, fallback = null) {
  for (const value of values) {
    const number = telemetryNumber(value);
    if (number !== null) return number;
  }
  return fallback;
}

function encoderAlignmentBaseFields(packet = {}, options = {}) {
  const encoder = packet.encoder || {};
  const now = finiteNumber(options.now, Date.now());
  const encoderUpdatedAt = firstTelemetryNumber([
    options.encoderReceivedAtMs,
    packet.latestEncoderReceivedAtMs,
    packet.encoderReceivedAtMs,
    packet.encoderUpdatedAt,
    packet.encoder?.updatedAt,
    packet.lastEncoderPacketAt,
  ], null);
  const encAgeMs = encoderUpdatedAt !== null ? Math.max(0, now - encoderUpdatedAt) : null;
  const satRaw = [
    firstTelemetryNumber([packet.sat_q0, packet.q0, packet.q?.[0]], null),
    firstTelemetryNumber([packet.sat_q1, packet.q1, packet.q?.[1]], null),
    firstTelemetryNumber([packet.sat_q2, packet.q2, packet.q?.[2]], null),
    firstTelemetryNumber([packet.sat_q3, packet.q3, packet.q?.[3]], null),
  ];
  const satAvailable = packet.hasTelemetryAttitude !== false
    && satRaw.every((value) => value !== null);
  const encRaw = [
    firstTelemetryNumber([packet.enc_q0_raw, packet.encoderQ0Raw, encoder.q0Raw, packet.enc_q0, packet.encoderQ0, encoder.q0], null),
    firstTelemetryNumber([packet.enc_q1_raw, packet.encoderQ1Raw, encoder.q1Raw, packet.enc_q1, packet.encoderQ1, encoder.q1], null),
    firstTelemetryNumber([packet.enc_q2_raw, packet.encoderQ2Raw, encoder.q2Raw, packet.enc_q2, packet.encoderQ2, encoder.q2], null),
    firstTelemetryNumber([packet.enc_q3_raw, packet.encoderQ3Raw, encoder.q3Raw, packet.enc_q3, packet.encoderQ3, encoder.q3], null),
  ];
  const satTimestampUs = firstTelemetryNumber([
    packet.timestamp_us,
    packet.remote_timestamp_us,
    packet.timestamp,
    packet.ebimu_timestamp_ms,
    packet.ebimuTimestampMs,
  ], null);
  const satSeq = firstTelemetryNumber([packet.seq, packet.rxCount, packet.packetCount], null);

  return {
    satRaw,
    encRaw,
    encAgeMs,
    satAvailable,
    now,
    encoderUpdatedAt,
    satSeq,
    satTimestampUs,
    base: {
      sat_q0: satRaw[0],
      sat_q1: satRaw[1],
      sat_q2: satRaw[2],
      sat_q3: satRaw[3],
      enc_q0_raw: encRaw[0],
      enc_q1_raw: encRaw[1],
      enc_q2_raw: encRaw[2],
      enc_q3_raw: encRaw[3],
      enc_age_ms: encAgeMs,
      encAgeMs: encAgeMs,
      encoder_alignment_source: ENCODER_ALIGNMENT_SOURCE,
      encoderAlignmentSource: ENCODER_ALIGNMENT_SOURCE,
      encoder_alignment_updated_at_ms: now,
      encoderAlignmentUpdatedAtMs: now,
      encoder_alignment_sat_seq: satSeq,
      encoderAlignmentSatSeq: satSeq,
      encoder_alignment_sat_timestamp_us: satTimestampUs,
      encoderAlignmentSatTimestampUs: satTimestampUs,
    },
  };
}

function invalidEncoderAlignmentFields(packet = {}, options = {}) {
  const { base } = encoderAlignmentBaseFields(packet, options);
  return {
    ...base,
    enc_q0_aligned: null,
    enc_q1_aligned: null,
    enc_q2_aligned: null,
    enc_q3_aligned: null,
    encoderQ0Aligned: null,
    encoderQ1Aligned: null,
    encoderQ2Aligned: null,
    encoderQ3Aligned: null,
    dot_raw: null,
    dotRaw: null,
    dot_abs: null,
    dotAbs: null,
    theta_err_deg: null,
    thetaErrDeg: null,
    enc_valid: 0,
    encValid: 0,
    encoderAlignmentValid: false,
    enc_roll_raw_deg: firstTelemetryNumber([packet.enc_roll_raw_deg, packet.encoder_roll_deg, packet.encoderRollDeg, packet.encoder?.rollDeg], null),
    enc_pitch_raw_deg: firstTelemetryNumber([packet.enc_pitch_raw_deg, packet.encoder_pitch_deg, packet.encoderPitchDeg, packet.encoder?.pitchDeg], null),
    enc_yaw_raw_deg: firstTelemetryNumber([packet.enc_yaw_raw_deg, packet.encoder_yaw_deg, packet.encoderYawDeg, packet.encoder?.yawDeg], null),
    enc_roll_aligned_deg: null,
    enc_pitch_aligned_deg: null,
    enc_yaw_aligned_deg: null,
    encoderRollAlignedDeg: null,
    encoderPitchAlignedDeg: null,
    encoderYawAlignedDeg: null,
  };
}

export function computeEncoderAlignmentFields(packet = {}, options = {}) {
  const { satRaw, encRaw, encAgeMs, satAvailable, now, satSeq, satTimestampUs, base } = encoderAlignmentBaseFields(packet, options);
  const maxAgeMs = finiteNumber(options.encoderAlignmentMaxAgeMs, ENCODER_ALIGNMENT_MAX_AGE_MS);
  const sat = normalizeQuaternion(satRaw);
  const enc = normalizeQuaternion(encRaw);

  if (!satAvailable || !sat.ok || !enc.ok || encAgeMs === null || encAgeMs > maxAgeMs) {
    return invalidEncoderAlignmentFields(packet, options);
  }

  const dotRaw = sat.q[0] * enc.q[0] + sat.q[1] * enc.q[1] + sat.q[2] * enc.q[2] + sat.q[3] * enc.q[3];
  if (!Number.isFinite(dotRaw)) return invalidEncoderAlignmentFields(packet, options);

  const encAligned = dotRaw < 0 ? enc.q.map((value) => -value) : [...enc.q];
  const dotAbs = Math.min(1, Math.max(0, Math.abs(dotRaw)));
  const thetaErrDeg = 2 * Math.acos(dotAbs) * 180 / Math.PI;
  if (!Number.isFinite(thetaErrDeg)) return invalidEncoderAlignmentFields(packet, options);

  const encoderEulerSequence = normalizeEulerSequence(
    options.encoderEulerSequence || packet.encoderEulerSequence || packet.encoder?.eulerSequence
  );
  const encoderDisplaySigns = normalizeRpySigns({
    roll: options.encoderDisplayRollSign ?? packet.encoderDisplayRollSign ?? packet.encoder?.displayRollSign,
    pitch: options.encoderDisplayPitchSign ?? packet.encoderDisplayPitchSign ?? packet.encoder?.displayPitchSign,
    yaw: options.encoderDisplayYawSign ?? packet.encoderDisplayYawSign ?? packet.encoder?.displayYawSign,
  }, DEFAULT_ENCODER_DISPLAY_SIGNS);
  const alignedEulerRaw = quaternionToEulerDeg(encAligned, encoderEulerSequence);
  const alignedEuler = alignedEulerRaw ? applyEulerDisplaySigns(alignedEulerRaw, encoderDisplaySigns) : null;

  return {
    ...base,
    enc_q0_aligned: encAligned[0],
    enc_q1_aligned: encAligned[1],
    enc_q2_aligned: encAligned[2],
    enc_q3_aligned: encAligned[3],
    encoderQ0Aligned: encAligned[0],
    encoderQ1Aligned: encAligned[1],
    encoderQ2Aligned: encAligned[2],
    encoderQ3Aligned: encAligned[3],
    dot_raw: dotRaw,
    dotRaw,
    dot_abs: dotAbs,
    dotAbs,
    theta_err_deg: thetaErrDeg,
    thetaErrDeg,
    enc_valid: 1,
    encValid: 1,
    encoderAlignmentValid: true,
    enc_roll_raw_deg: firstTelemetryNumber([packet.enc_roll_raw_deg, packet.encoder_roll_deg, packet.encoderRollDeg, packet.encoder?.rollDeg], null),
    enc_pitch_raw_deg: firstTelemetryNumber([packet.enc_pitch_raw_deg, packet.encoder_pitch_deg, packet.encoderPitchDeg, packet.encoder?.pitchDeg], null),
    enc_yaw_raw_deg: firstTelemetryNumber([packet.enc_yaw_raw_deg, packet.encoder_yaw_deg, packet.encoderYawDeg, packet.encoder?.yawDeg], null),
    enc_roll_aligned_deg: alignedEuler?.roll ?? null,
    enc_pitch_aligned_deg: alignedEuler?.pitch ?? null,
    enc_yaw_aligned_deg: alignedEuler?.yaw ?? null,
    encoderRollAlignedDeg: alignedEuler?.roll ?? null,
    encoderPitchAlignedDeg: alignedEuler?.pitch ?? null,
    encoderYawAlignedDeg: alignedEuler?.yaw ?? null,
    encoder_alignment_source: ENCODER_ALIGNMENT_SOURCE,
    encoderAlignmentSource: ENCODER_ALIGNMENT_SOURCE,
    encoder_alignment_updated_at_ms: now,
    encoderAlignmentUpdatedAtMs: now,
    encoder_alignment_sat_seq: satSeq,
    encoderAlignmentSatSeq: satSeq,
    encoder_alignment_sat_timestamp_us: satTimestampUs,
    encoderAlignmentSatTimestampUs: satTimestampUs,
  };
}

export function attachEncoderAlignment(packet = {}, options = {}) {
  const alignment = computeEncoderAlignmentFields(packet, options);
  return {
    ...packet,
    ...alignment,
    encoder: {
      ...(packet.encoder || {}),
      q0Raw: alignment.enc_q0_raw,
      q1Raw: alignment.enc_q1_raw,
      q2Raw: alignment.enc_q2_raw,
      q3Raw: alignment.enc_q3_raw,
      q0Aligned: alignment.enc_q0_aligned,
      q1Aligned: alignment.enc_q1_aligned,
      q2Aligned: alignment.enc_q2_aligned,
      q3Aligned: alignment.enc_q3_aligned,
      rollRawDeg: alignment.enc_roll_raw_deg,
      pitchRawDeg: alignment.enc_pitch_raw_deg,
      yawRawDeg: alignment.enc_yaw_raw_deg,
      rollAlignedDeg: alignment.enc_roll_aligned_deg,
      pitchAlignedDeg: alignment.enc_pitch_aligned_deg,
      yawAlignedDeg: alignment.enc_yaw_aligned_deg,
      dotRaw: alignment.dot_raw,
      dotAbs: alignment.dot_abs,
      thetaErrDeg: alignment.theta_err_deg,
      alignmentSource: alignment.encoder_alignment_source,
      alignmentUpdatedAtMs: alignment.encoder_alignment_updated_at_ms,
      alignmentSatSeq: alignment.encoder_alignment_sat_seq,
      alignmentSatTimestampUs: alignment.encoder_alignment_sat_timestamp_us,
      alignmentValid: Boolean(alignment.enc_valid),
      alignmentAgeMs: alignment.enc_age_ms,
    },
  };
}

function encoderTimerDelta(timerX, timerY, timerZ) {
  const timers = [timerX, timerY, timerZ].map((value) => telemetryNumber(value));
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
  freshMs,
  syncMs,
}) {
  if (!hasData) return 'NONE';
  if (updatedAt && now - updatedAt > freshMs) return 'STALE';
  const ages = [ageX, ageY, ageZ].map((value) => telemetryNumber(value)).filter((value) => value !== null);
  if (ages.length > 0 && Math.max(...ages) > freshMs) return 'STALE';

  const explicit = String(explicitStatus || '').trim().toUpperCase();
  if (['STALE', 'HOLD_LAST', 'MIXED', 'PARTIAL', 'INVALID'].includes(explicit)) return explicit;
  if (hasInvalidQuaternion) return 'INVALID';
  if (hasPartialQuaternion || !hasCompletePose) return 'PARTIAL';

  const delta = encoderTimerDelta(timerX, timerY, timerZ);
  if (delta !== null && delta > syncMs) return 'MIXED';
  return 'LIVE';
}

function normalizeEncoderTelemetry(packet = {}, options = {}) {
  const nested = packet?.encoder || {};
  const now = finiteNumber(options.now, Date.now());
  const freshMs = finiteNumber(options.encoderFreshMs, DEFAULT_ENCODER_FRESH_MS);
  const syncMs = finiteNumber(
    options.encoderTimerSpreadMs ?? options.encoderSyncMs,
    DEFAULT_ENCODER_SYNC_MS
  );
  const encoderEulerSequence = normalizeEulerSequence(
    options.encoderEulerSequence || packet.encoderEulerSequence || nested.eulerSequence
  );
  const encoderAngleToQuatSequence = normalizeEulerSequence(
    options.encoderAngleToQuatSequence
      || packet.encoderAngleToQuatSequence
      || nested.angleToQuatSequence
      || nested.angleSequence,
    DEFAULT_ENCODER_ANGLE_TO_QUAT_SEQUENCE
  );
  const encoderDisplaySigns = normalizeRpySigns({
    roll: options.encoderDisplayRollSign ?? packet.encoderDisplayRollSign ?? nested.displayRollSign,
    pitch: options.encoderDisplayPitchSign ?? packet.encoderDisplayPitchSign ?? nested.displayPitchSign,
    yaw: options.encoderDisplayYawSign ?? packet.encoderDisplayYawSign ?? nested.displayYawSign,
  }, DEFAULT_ENCODER_DISPLAY_SIGNS);
  const encX = firstTelemetryNumber([packet.enc_x_deg, packet.encoderXDeg, nested.x], null);
  const encY = firstTelemetryNumber([packet.enc_y_deg, packet.encoderYDeg, nested.y], null);
  const encZ = firstTelemetryNumber([packet.enc_z_deg, packet.encoderZDeg, nested.z], null);
  const timerX = firstTelemetryNumber([packet.enc_timer_x, packet.encoderTimerX, nested.timerX, nested.timer_x], null);
  const timerY = firstTelemetryNumber([packet.enc_timer_y, packet.encoderTimerY, nested.timerY, nested.timer_y], null);
  const timerZ = firstTelemetryNumber([packet.enc_timer_z, packet.encoderTimerZ, nested.timerZ, nested.timer_z], null);
  const ageX = firstTelemetryNumber([packet.enc_age_x, packet.encoderAgeX, nested.ageX, nested.age_x], null);
  const ageY = firstTelemetryNumber([packet.enc_age_y, packet.encoderAgeY, nested.ageY, nested.age_y], null);
  const ageZ = firstTelemetryNumber([packet.enc_age_z, packet.encoderAgeZ, nested.ageZ, nested.age_z], null);
  const rawEncoderUpdatedAt = firstTelemetryNumber([packet.encoderUpdatedAt, nested.updatedAt], null);
  const rawQ0 = firstTelemetryNumber([packet.enc_q0, packet.encoderQ0, nested.q0], null);
  const rawQ1 = firstTelemetryNumber([packet.enc_q1, packet.encoderQ1, nested.q1], null);
  const rawQ2 = firstTelemetryNumber([packet.enc_q2, packet.encoderQ2, nested.q2], null);
  const rawQ3 = firstTelemetryNumber([packet.enc_q3, packet.encoderQ3, nested.q3], null);
  const rawQValues = [rawQ0, rawQ1, rawQ2, rawQ3];
  const hasAnyRawQ = rawQValues.some((value) => value !== null);
  const hasCompleteRawQ = rawQValues.every((value) => value !== null);
  const normalizedRawQ = hasCompleteRawQ
    ? normalizeQuaternion(rawQValues)
    : { ok: false, q: null };
  const hasPartialRawQ = hasAnyRawQ && !hasCompleteRawQ;
  const hasInvalidRawQ = hasCompleteRawQ && !normalizedRawQ.ok;
  const hasEncoderData = [encX, encY, encZ, rawQ0, rawQ1, rawQ2, rawQ3, timerX, timerY, timerZ, ageX, ageY, ageZ]
    .some((value) => value !== null);
  const encoderUpdatedAt = rawEncoderUpdatedAt ?? (hasEncoderData ? now : null);
  const hasAllAxes = [encX, encY, encZ].every((value) => value !== null);
  const canUseLegacyAngles = !hasAnyRawQ && hasAllAxes;
  const hasRemoteQuaternion = Boolean(normalizedRawQ.ok);
  const encoderStatus = normalizeEncoderStatus({
    explicitStatus: packet.encoderStatus || nested.status,
    hasData: hasEncoderData,
    hasCompletePose: normalizedRawQ.ok || canUseLegacyAngles,
    hasPartialQuaternion: hasPartialRawQ,
    hasInvalidQuaternion: hasInvalidRawQ,
    timerX,
    timerY,
    timerZ,
    ageX,
    ageY,
    ageZ,
    updatedAt: encoderUpdatedAt,
    now,
    freshMs,
    syncMs,
  });
  const computedQ = encoderStatus === 'LIVE' && canUseLegacyAngles
    ? eulerDegToQuat(encX, encY, encZ, encoderAngleToQuatSequence)
    : null;
  const encoderQ = hasRemoteQuaternion ? normalizedRawQ.q : computedQ;
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
  if (hasEncoderData) {
    if (encoderStatus === 'LIVE' && computedQ) statusSource = 'web-computed from legacy gimbal encoder angles';
    else if (usingRemoteQ) statusSource = 'remote-computed gimbal encoder quaternion';
    else if (encoderStatus === 'PARTIAL') statusSource = 'partial gimbal encoder quaternion';
    else if (encoderStatus === 'INVALID') statusSource = 'invalid gimbal encoder quaternion';
    else if (encoderStatus === 'STALE') statusSource = 'stale gimbal encoder quaternion';
    else if (encoderStatus === 'MIXED') statusSource = 'mixed gimbal encoder timers';
    else statusSource = 'gimbal encoder reference';
  }
  const encoderSource = statusSource || packet.encoderSource || nested.source || '';
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
    enc_q0_raw: rawQ0,
    enc_q1_raw: rawQ1,
    enc_q2_raw: rawQ2,
    enc_q3_raw: rawQ3,
    encoderQ0: encQ0,
    encoderQ1: encQ1,
    encoderQ2: encQ2,
    encoderQ3: encQ3,
    encoderQ0Raw: rawQ0,
    encoderQ1Raw: rawQ1,
    encoderQ2Raw: rawQ2,
    encoderQ3Raw: rawQ3,
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
    encoderUpdatedAt,
    encoderSource,
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
      q0Raw: rawQ0,
      q1Raw: rawQ1,
      q2Raw: rawQ2,
      q3Raw: rawQ3,
      timerX,
      timerY,
      timerZ,
      ageX,
      ageY,
      ageZ,
      updatedAt: encoderUpdatedAt,
      source: encoderSource,
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

export function normalizeLivePacket(packet, source = 'unknown', options = {}) {
  if (!packet || typeof packet !== 'object') return null;

  const resolvedSource = sourceKey(source || packet.source);
  const sourceLabel = packet.sourceLabel || SOURCE_LABELS[resolvedSource] || String(resolvedSource);
  const imuEulerSequence = normalizeEulerSequence(options.imuEulerSequence || packet.imuEulerSequence);
  const encoderEulerSequence = normalizeEulerSequence(options.encoderEulerSequence || packet.encoderEulerSequence);
  const encoderAngleToQuatSequence = normalizeEulerSequence(
    options.encoderAngleToQuatSequence || packet.encoderAngleToQuatSequence,
    DEFAULT_ENCODER_ANGLE_TO_QUAT_SEQUENCE
  );
  const imuDisplaySigns = normalizeImuDisplaySigns({
    roll: options.imuDisplayRollSign ?? packet.imuDisplayRollSign,
    pitch: options.imuDisplayPitchSign ?? packet.imuDisplayPitchSign,
    yaw: options.imuDisplayYawSign ?? packet.imuDisplayYawSign,
  });
  const encoderDisplaySigns = normalizeRpySigns({
    roll: options.encoderDisplayRollSign ?? packet.encoderDisplayRollSign ?? packet.encoder?.displayRollSign,
    pitch: options.encoderDisplayPitchSign ?? packet.encoderDisplayPitchSign ?? packet.encoder?.displayPitchSign,
    yaw: options.encoderDisplayYawSign ?? packet.encoderDisplayYawSign ?? packet.encoder?.displayYawSign,
  }, DEFAULT_ENCODER_DISPLAY_SIGNS);
  const bodyRateWzDisplaySign = normalizeSign(
    options.bodyRateWzDisplaySign ?? packet.bodyRateWzDisplaySign,
    DEFAULT_BODY_RATE_WZ_DISPLAY_SIGN
  );
  const encoderTelemetry = normalizeEncoderTelemetry(packet, {
    now: options.now,
    encoderEulerSequence,
    encoderAngleToQuatSequence,
    encoderFreshMs: options.encoderFreshMs,
    encoderTimerSpreadMs: options.encoderTimerSpreadMs,
    encoderDisplayRollSign: encoderDisplaySigns.roll,
    encoderDisplayPitchSign: encoderDisplaySigns.pitch,
    encoderDisplayYawSign: encoderDisplaySigns.yaw,
  });
  const rawQ = Array.isArray(packet.q) && packet.q.length === 4
    ? packet.q
    : [packet.q0, packet.q1, packet.q2, packet.q3];
  const normalized = normalizeQuaternion(rawQ);
  if (!normalized.ok) {
    return {
      ok: false,
      invalid: true,
      invalidReason: normalized.reason,
      source: resolvedSource,
      sourceLabel,
      raw: typeof packet.raw === 'string' ? packet.raw : '',
    };
  }

  const now = finiteNumber(options.now, Date.now());
  const pcTimeMs = firstFinite([packet.pcTimeMs, packet.pc_time_ms, packet.updatedAt, packet.timestamp], now);
  const publishedAt = firstFinite([options.publishedAt, packet.publishedAt], now);
  const q = normalized.q;
  const rawEuler = quaternionToEulerDeg(q, imuEulerSequence) || {};
  const euler = applyEulerDisplaySigns(rawEuler, imuDisplaySigns);

  const desired = options.desiredAttitude || packet.latestDesiredAttitude || packet.desiredAttitude || packet;
  const desiredRoll = firstFinite([desired.desired_roll_deg, desired.desiredRollDeg, desired.rollDeg, desired.roll], null);
  const desiredPitch = firstFinite([desired.desired_pitch_deg, desired.desiredPitchDeg, desired.pitchDeg, desired.pitch], null);
  const desiredYaw = firstFinite([desired.desired_yaw_deg, desired.desiredYawDeg, desired.yawDeg, desired.yaw], null);
  const hasDesired = [desiredRoll, desiredPitch, desiredYaw].every((value) => value !== null);

  const telemetryQerr = firstFinite([packet.qerr_deg, packet.qerrDeg, packet.qerrTelemetryDeg], null);
  const computedQerr = telemetryQerr === null && hasDesired
    ? computeQerrDeg(q, { rollDeg: desiredRoll, pitchDeg: desiredPitch, yawDeg: desiredYaw })
    : null;
  const qerr = telemetryQerr !== null ? telemetryQerr : computedQerr;
  const qerrSource = telemetryQerr !== null
    ? (packet.qerrSource || 'satellite telemetry')
    : (computedQerr !== null ? 'computed fallback' : '');

  const wxTelemetry = finiteNumber(packet.wxTelemetry ?? packet.wx, null);
  const wyTelemetry = finiteNumber(packet.wyTelemetry ?? packet.wy, null);
  const wzTelemetry = finiteNumber(packet.wzTelemetry ?? packet.wz, null);
  const incomingRateSource = String(packet.angularRateSource || '').toLowerCase();
  const hasTelemetryRate = [wxTelemetry, wyTelemetry, wzTelemetry].every((value) => value !== null)
    && !incomingRateSource.includes('computed')
    && !incomingRateSource.includes('estimated');
  const rateEstimate = hasTelemetryRate
    ? { valid: false }
    : estimateAngularRateFromQuat(options.prevPacket, { ...packet, q, pcTimeMs });
  const wx = hasTelemetryRate ? wxTelemetry : (rateEstimate.valid ? rateEstimate.wx : null);
  const wy = hasTelemetryRate ? wyTelemetry : (rateEstimate.valid ? rateEstimate.wy : null);
  const wz = hasTelemetryRate ? wzTelemetry : (rateEstimate.valid ? rateEstimate.wz : null);
  const wzDisplay = wz === null ? null : wz * bodyRateWzDisplaySign;
  const angularRateSource = hasTelemetryRate
    ? (packet.angularRateSource || 'satellite body rate')
    : (rateEstimate.valid ? 'computed from quaternion' : '');
  const rawText = typeof packet.raw === 'string' ? packet.raw.trim() : '';
  const rawToken = rawText ? String(rawText.split(/[,\s]+/)[0] || '').trim().toUpperCase() : '';
  const rawPrefix = String(packet.rawPrefix || packet.raw_prefix || rawToken || '').trim().toUpperCase();
  const sampleType = String(
    packet.sample_type || packet.sampleType
      || (rawPrefix === 'IMU' ? 'IMU' : rawPrefix === 'ENC' ? 'ENC' : 'TEL')
  ).trim().toUpperCase();

  const common = {
    ok: true,
    pcTimeMs,
    pc_time_ms: pcTimeMs,
    publishedAt,
    updatedAt: pcTimeMs,
    source: resolvedSource,
    sourceLabel,
    sample_type: sampleType,
    sampleType,
    hasTelemetryAttitude: sampleType !== 'ENC' || Boolean(packet.hasTelemetryAttitude || packet.lastTelemetryAt),
    lastTelemetryAt: firstFinite([packet.lastTelemetryAt], sampleType !== 'ENC' ? now : null),
    rawPrefix,
    raw_prefix: rawPrefix,

    q0: q[0],
    q1: q[1],
    q2: q[2],
    q3: q[3],
    q,
    norm: normalized.norm,

    Roll_deg: euler.roll ?? null,
    Pitch_deg: euler.pitch ?? null,
    Yaw_deg: euler.yaw ?? null,
    rawRollDeg: rawEuler.roll ?? null,
    rawPitchDeg: rawEuler.pitch ?? null,
    rawYawDeg: rawEuler.yaw ?? null,
    rollDeg: euler.roll ?? null,
    pitchDeg: euler.pitch ?? null,
    yawDeg: euler.yaw ?? null,
    roll_deg: euler.roll ?? null,
    pitch_deg: euler.pitch ?? null,
    yaw_deg: euler.yaw ?? null,
    imuEulerSequence,
    imuDisplayRollSign: imuDisplaySigns.roll,
    imuDisplayPitchSign: imuDisplaySigns.pitch,
    imuDisplayYawSign: imuDisplaySigns.yaw,
    rpySource: `IMU/TEL quaternion ${imuEulerSequence}`,
    attitudeSource: resolvedSource === 'phone' ? 'phone_sensor' : 'computed_from_quaternion',
    remoteRollDeg: firstFinite([packet.remoteRollDeg, packet.Roll_deg, packet.rollDeg, packet.roll_deg, packet.roll], null),
    remotePitchDeg: firstFinite([packet.remotePitchDeg, packet.Pitch_deg, packet.pitchDeg, packet.pitch_deg, packet.pitch], null),
    remoteYawDeg: firstFinite([packet.remoteYawDeg, packet.Yaw_deg, packet.yawDeg, packet.yaw_deg, packet.yaw], null),

    desired_roll_deg: hasDesired ? desiredRoll : null,
    desired_pitch_deg: hasDesired ? desiredPitch : null,
    desired_yaw_deg: hasDesired ? desiredYaw : null,
    desiredRollDeg: hasDesired ? desiredRoll : null,
    desiredPitchDeg: hasDesired ? desiredPitch : null,
    desiredYawDeg: hasDesired ? desiredYaw : null,
    targetInputRollDeg: firstFinite([desired.inputRollDeg, desired.inputRoll], null),
    targetInputPitchDeg: firstFinite([desired.inputPitchDeg, desired.inputPitch], null),
    targetInputYawDeg: firstFinite([desired.inputYawDeg, desired.inputYaw], null),
    targetRpySequence: desired.targetRpySequence || desired.targetSequence || '',
    targetQd0: finiteNumber(desired.qd0 ?? desired.targetQd0, null),
    targetQd1: finiteNumber(desired.qd1 ?? desired.targetQd1, null),
    targetQd2: finiteNumber(desired.qd2 ?? desired.targetQd2, null),
    targetQd3: finiteNumber(desired.qd3 ?? desired.targetQd3, null),

    qerr_deg: qerr,
    qerrDeg: qerr,
    qerrSource,

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

    commandType: finiteNumber(packet.commandType ?? packet.command_type, null),
    command_type: finiteNumber(packet.command_type ?? packet.commandType, null),
    control_mode: packet.control_mode ?? '',
    EBIMU_status: packet.EBIMU_status ?? '',
    logging_status: packet.logging_status ?? '',

    timestamp: firstFinite([packet.timestamp, packet.ebimu_timestamp_ms, packet.ebimuTimestampMs], null),
    timestamp_us: firstFinite([packet.timestamp_us, packet.remote_timestamp_us, packet.timestamp], null),
    remote_timestamp: firstFinite([packet.remote_timestamp, packet.timestamp, packet.ebimu_timestamp_ms, packet.ebimuTimestampMs], null),
    remote_timestamp_us: firstFinite([packet.remote_timestamp_us, packet.timestamp_us, packet.timestamp], null),
    seq: firstFinite([packet.seq, packet.packetCount, packet.rxCount], null),
    rxCount: firstFinite([packet.rxCount, packet.packetCount, packet.seq], null),

    raw: typeof packet.raw === 'string' ? packet.raw : '',
    lastCommandKey: packet.lastCommandKey || options.lastCommandKey || '',
    lastCommandLabel: packet.lastCommandLabel || options.lastCommandLabel || '',
    lastCommandAt: packet.lastCommandAt || options.lastCommandAt || null,

    publisherClientId: packet.publisherClientId || options.publisherClientId || '',
    publisherRole: packet.publisherRole || options.publisherRole || '',

    ...encoderTelemetry,
  };

  const aligned = attachEncoderAlignment(common, {
    now,
    encoderEulerSequence,
    encoderDisplayRollSign: encoderDisplaySigns.roll,
    encoderDisplayPitchSign: encoderDisplaySigns.pitch,
    encoderDisplayYawSign: encoderDisplaySigns.yaw,
    encoderAlignmentMaxAgeMs: options.encoderAlignmentMaxAgeMs,
  });
  aligned.hasWheelTelemetry = hasWheelTelemetry(aligned);
  aligned.hasDebugTelemetry = hasDebugTelemetry(aligned);
  return aligned;
}

export { SOURCE_LABELS };
