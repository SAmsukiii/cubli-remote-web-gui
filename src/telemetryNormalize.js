const SOURCE_LABELS = {
  'server-serial': 'Server Remote Serial',
  'admin-web-serial': 'Admin Web Serial Bridge',
  'legacy-web-serial': 'Admin Web Serial Bridge',
  ble: 'Admin BLE',
  phone: 'Admin Phone Sensor',
};

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

export function quaternionToEulerDeg(q) {
  const normalized = normalizeQuaternion(q);
  if (!normalized.ok) return null;
  const [w, x, y, z] = normalized.q;

  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinrCosp, cosrCosp) * 180 / Math.PI;

  const sinp = clamp(2 * (w * y - z * x), -1, 1);
  const pitch = Math.asin(sinp) * 180 / Math.PI;

  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(sinyCosp, cosyCosp) * 180 / Math.PI;

  if (![roll, pitch, yaw].every(Number.isFinite)) return null;
  return { roll, pitch, yaw };
}

export function eulerDegToQuatZYX(rollDeg, pitchDeg, yawDeg) {
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

  const normalized = normalizeQuaternion([
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
  ]);

  return normalized.ok ? normalized.q : null;
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

function normalizeEncoderTelemetry(packet = {}) {
  const nested = packet?.encoder || {};
  const encX = firstTelemetryNumber([packet.enc_x_deg, packet.encoderXDeg, nested.x], null);
  const encY = firstTelemetryNumber([packet.enc_y_deg, packet.encoderYDeg, nested.y], null);
  const encZ = firstTelemetryNumber([packet.enc_z_deg, packet.encoderZDeg, nested.z], null);
  const encQ0 = firstTelemetryNumber([packet.enc_q0, packet.encoderQ0, nested.q0], null);
  const encQ1 = firstTelemetryNumber([packet.enc_q1, packet.encoderQ1, nested.q1], null);
  const encQ2 = firstTelemetryNumber([packet.enc_q2, packet.encoderQ2, nested.q2], null);
  const encQ3 = firstTelemetryNumber([packet.enc_q3, packet.encoderQ3, nested.q3], null);
  const timerX = firstTelemetryNumber([packet.enc_timer_x, packet.encoderTimerX, nested.timerX, nested.timer_x], null);
  const timerY = firstTelemetryNumber([packet.enc_timer_y, packet.encoderTimerY, nested.timerY, nested.timer_y], null);
  const timerZ = firstTelemetryNumber([packet.enc_timer_z, packet.encoderTimerZ, nested.timerZ, nested.timer_z], null);
  const encoderUpdatedAt = firstTelemetryNumber([packet.encoderUpdatedAt, nested.updatedAt], null);
  const hasEncoderData = [encX, encY, encZ, encQ0, encQ1, encQ2, encQ3, timerX, timerY, timerZ]
    .some((value) => value !== null);
  const encoderSource = packet.encoderSource || nested.source || (hasEncoderData ? 'encoder packet' : '');

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
    },
  };
}

export function normalizeLivePacket(packet, source = 'unknown', options = {}) {
  if (!packet || typeof packet !== 'object') return null;

  const resolvedSource = sourceKey(source || packet.source);
  const sourceLabel = packet.sourceLabel || SOURCE_LABELS[resolvedSource] || String(resolvedSource);
  const encoderTelemetry = normalizeEncoderTelemetry(packet);
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
  const euler = quaternionToEulerDeg(q) || {};

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
  const angularRateSource = hasTelemetryRate
    ? (packet.angularRateSource || 'satellite body rate')
    : (rateEstimate.valid ? 'computed from quaternion' : '');

  const common = {
    ok: true,
    pcTimeMs,
    pc_time_ms: pcTimeMs,
    publishedAt,
    updatedAt: pcTimeMs,
    source: resolvedSource,
    sourceLabel,

    q0: q[0],
    q1: q[1],
    q2: q[2],
    q3: q[3],
    q,
    norm: normalized.norm,

    Roll_deg: euler.roll ?? null,
    Pitch_deg: euler.pitch ?? null,
    Yaw_deg: euler.yaw ?? null,
    rollDeg: euler.roll ?? null,
    pitchDeg: euler.pitch ?? null,
    yawDeg: euler.yaw ?? null,
    roll_deg: euler.roll ?? null,
    pitch_deg: euler.pitch ?? null,
    yaw_deg: euler.yaw ?? null,
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

    qerr_deg: qerr,
    qerrDeg: qerr,
    qerrSource,

    wx,
    wy,
    wz,
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

  common.hasWheelTelemetry = hasWheelTelemetry(common);
  common.hasDebugTelemetry = hasDebugTelemetry(common);
  return common;
}

export { SOURCE_LABELS };
