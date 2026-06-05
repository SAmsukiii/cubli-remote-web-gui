export const CSV_LOG_METADATA_COLUMNS = [
  'log_index',
  'logged_at_ms',
  'logged_at_iso',
  'plot_time_ms',
  'sample_type',
  'packet_key',
  'raw_prefix',
  'remote_timestamp',
  'remote_timestamp_us',
  'seq',
];

export const DEFAULT_CSV_LOG_COLUMNS = [
  ...CSV_LOG_METADATA_COLUMNS,
  'source',
  'source_label',
  'imu_euler_sequence',
  'rpy_source',
  'imu_q0',
  'imu_q1',
  'imu_q2',
  'imu_q3',
  'norm',
  'imu_roll_deg',
  'imu_pitch_deg',
  'imu_yaw_deg',
  'desired_roll_deg',
  'desired_pitch_deg',
  'desired_yaw_deg',
  'qerr_deg',
  'qerr_source',
  'wx',
  'wy',
  'wz',
  'wz_raw',
  'wz_display',
  'body_rate_wz_display_sign',
  'angular_rate_source',
  'RPM1',
  'RPM2',
  'RPM3',
  'RPMcmd1',
  'RPMcmd2',
  'RPMcmd3',
  'PWM1',
  'PWM2',
  'PWM3',
  'Tbodycmd_x_Nm',
  'Tbodycmd_y_Nm',
  'Tbodycmd_z_Nm',
  'Tmotor1_Nm',
  'Tmotor2_Nm',
  'Tmotor3_Nm',
  'commandType',
  'control_mode',
  'EBIMU_status',
  'logging_status',
  'enc_q0',
  'enc_q1',
  'enc_q2',
  'enc_q3',
  'encoder_roll_deg',
  'encoder_pitch_deg',
  'encoder_yaw_deg',
  'encoder_angle_to_quat_sequence',
  'encoder_euler_sequence',
  'encoder_quat_source',
  'encoder_rpy_source',
  'encoder_status',
  'enc_timer_x',
  'enc_timer_y',
  'enc_timer_z',
  'enc_age_x',
  'enc_age_y',
  'enc_age_z',
  'encoder_source',
  'encoder_updated_at',
  'enc_x_deg',
  'enc_y_deg',
  'enc_z_deg',
];

export const CSV_LOG_NOTE = 'CSV mode: save every valid Serial sample as one raw long-format event row. TEL/IMU and ENC stay independent, sorted by plot_time_ms.';

const TELEMETRY_SAMPLE_TYPES = new Set(['TEL', 'IMU']);
const VALID_SAMPLE_TYPES = new Set(['TEL', 'IMU', 'ENC']);

const ENCODER_PACKET_FIELD_KEYS = Object.freeze([
  'enc_x_deg',
  'enc_y_deg',
  'enc_z_deg',
  'encoderXDeg',
  'encoderYDeg',
  'encoderZDeg',
  'enc_q0',
  'enc_q1',
  'enc_q2',
  'enc_q3',
  'encoderQ0',
  'encoderQ1',
  'encoderQ2',
  'encoderQ3',
  'encoderRollDeg',
  'encoderPitchDeg',
  'encoderYawDeg',
  'encoderRawRollDeg',
  'encoderRawPitchDeg',
  'encoderRawYawDeg',
  'encoderDisplayRollSign',
  'encoderDisplayPitchSign',
  'encoderDisplayYawSign',
  'encoderAngleToQuatSequence',
  'encoderEulerSequence',
  'encoderQuatSource',
  'encoderRpySource',
  'encoderStatus',
  'encoderSource',
  'encoderHasQuaternion',
  'encoderFresh',
  'enc_timer_x',
  'enc_timer_y',
  'enc_timer_z',
  'encoderTimerX',
  'encoderTimerY',
  'encoderTimerZ',
  'enc_age_x',
  'enc_age_y',
  'enc_age_z',
  'encoderAgeX',
  'encoderAgeY',
  'encoderAgeZ',
  'encoderUpdatedAt',
  'encoder',
  'encoderOnly',
  'encoderOnlyUpdate',
  'lastEncoderPacketAt',
]);

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function firstPresent(values, fallback = '') {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return fallback;
}

function normalizeToken(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_ -]/g, '');
}

function rawPrefixFromRaw(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const token = text.split(/[,\s]+/)[0];
  return normalizeToken(token);
}

export function detectRawPrefix(packet = {}) {
  const explicit = normalizeToken(packet.raw_prefix || packet.rawPrefix);
  if (explicit) return explicit;
  const rawPrefix = rawPrefixFromRaw(packet.raw || packet.cleanLine || packet.line);
  if (rawPrefix) return rawPrefix;
  const source = String(packet.source || packet.sourceLabel || '').toUpperCase();
  if (source.includes('ENC')) return 'ENC';
  if (source.includes('TEL')) return 'TEL';
  if (source.includes('IMU')) return 'IMU';
  if (source.includes('COMMAND')) return 'COMMAND';
  return '';
}

export function detectSampleType(packet = {}) {
  const explicit = normalizeToken(packet.sample_type || packet.sampleType);
  if (VALID_SAMPLE_TYPES.has(explicit)) return explicit;

  const rawPrefix = detectRawPrefix(packet);
  if (rawPrefix === 'TEL') return 'TEL';
  if (rawPrefix === 'IMU') return 'IMU';
  if (rawPrefix === 'ENC') return 'ENC';
  if (rawPrefix === 'CMD' || rawPrefix === 'COMMAND') return 'COMMAND';

  const source = String(packet.source || packet.sourceLabel || '').toUpperCase();
  if (source.includes('ENC')) return 'ENC';
  if (source.includes('IMU')) return 'IMU';
  if (source.includes('TEL')) return 'TEL';
  if (source.includes('COMMAND')) return 'COMMAND';

  const hasQuaternion = [packet.q0, packet.q1, packet.q2, packet.q3].every((value) => finiteNumber(value, null) !== null)
    || (Array.isArray(packet.q) && packet.q.length === 4);
  return hasQuaternion ? 'TEL' : 'COMMAND';
}

export function isTelemetryCsvSample(packet = {}) {
  return TELEMETRY_SAMPLE_TYPES.has(detectSampleType(packet));
}

export function isEncoderOnlyCsvSample(packet = {}) {
  return detectSampleType(packet) === 'ENC';
}

function simpleHash(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function encoderAxisKey(packet = {}) {
  const axes = [
    ['x', packet.enc_x_deg ?? packet.encoderXDeg ?? packet.encoder?.x, packet.enc_timer_x ?? packet.encoderTimerX ?? packet.encoder?.timerX ?? packet.encoder?.timer_x],
    ['y', packet.enc_y_deg ?? packet.encoderYDeg ?? packet.encoder?.y, packet.enc_timer_y ?? packet.encoderTimerY ?? packet.encoder?.timerY ?? packet.encoder?.timer_y],
    ['z', packet.enc_z_deg ?? packet.encoderZDeg ?? packet.encoder?.z, packet.enc_timer_z ?? packet.encoderTimerZ ?? packet.encoder?.timerZ ?? packet.encoder?.timer_z],
  ];
  const axisRows = axes
    .map(([axis, angle, timer]) => {
      const angleNumber = finiteNumber(angle, null);
      const timerNumber = finiteNumber(timer, null);
      if (angleNumber === null && timerNumber === null) return '';
      return `${axis}:${timerNumber ?? ''}:${angleNumber ?? ''}`;
    })
    .filter(Boolean);
  return axisRows.join('|');
}

function encoderQuaternionKey(packet = {}) {
  const encoder = packet.encoder || {};
  const qValues = [
    packet.enc_q0 ?? packet.encoderQ0 ?? encoder.q0,
    packet.enc_q1 ?? packet.encoderQ1 ?? encoder.q1,
    packet.enc_q2 ?? packet.encoderQ2 ?? encoder.q2,
    packet.enc_q3 ?? packet.encoderQ3 ?? encoder.q3,
  ].map((value) => finiteNumber(value, null));
  const timerValues = [
    packet.enc_timer_x ?? packet.encoderTimerX ?? encoder.timerX ?? encoder.timer_x,
    packet.enc_timer_y ?? packet.encoderTimerY ?? encoder.timerY ?? encoder.timer_y,
    packet.enc_timer_z ?? packet.encoderTimerZ ?? encoder.timerZ ?? encoder.timer_z,
  ].map((value) => finiteNumber(value, null));
  const hasQ = qValues.some((value) => value !== null);
  const hasTimer = timerValues.some((value) => value !== null);
  if (!hasQ && !hasTimer) return '';
  if (!hasTimer || timerValues.every((value) => value === null || value === 0)) return '';
  return `q:${qValues.map((value) => value ?? '').join(':')}|t:${timerValues.map((value) => value ?? '').join(':')}`;
}

function fallbackPacketKey(packet = {}, sampleType = detectSampleType(packet), rawPrefix = detectRawPrefix(packet)) {
  const raw = packet.raw || packet.cleanLine || '';
  const loggedAt = firstPresent([packet.logged_at_ms, packet.loggedAtMs, packet.updatedAt, packet.publishedAt], '');
  const logIndex = firstPresent([packet.log_index, packet.logIndex], '');
  return `${sampleType}:${rawPrefix || ''}:fallback:${loggedAt}:${simpleHash(raw || JSON.stringify(packet))}:${loggedAt === '' ? logIndex : ''}`;
}

export function makePacketKey(packet = {}, sampleType = detectSampleType(packet), rawPrefix = detectRawPrefix(packet)) {
  const explicit = String(packet.packet_key || packet.packetKey || '').trim();
  if (explicit) return explicit;

  const seq = firstPresent([packet.seq, packet.packetCount, packet.rxCount], '');
  const timestamp = firstPresent([packet.timestamp, packet.ebimu_timestamp_ms, packet.ebimuTimestampMs], '');

  if (sampleType === 'ENC') {
    const quaternionKey = encoderQuaternionKey(packet);
    if (quaternionKey) return `ENC:${quaternionKey}`;
    const axisKey = encoderAxisKey(packet);
    const hasNonZeroTimer = [
      packet.enc_timer_x ?? packet.encoderTimerX ?? packet.encoder?.timerX ?? packet.encoder?.timer_x,
      packet.enc_timer_y ?? packet.encoderTimerY ?? packet.encoder?.timerY ?? packet.encoder?.timer_y,
      packet.enc_timer_z ?? packet.encoderTimerZ ?? packet.encoder?.timerZ ?? packet.encoder?.timer_z,
    ].some((value) => {
      const number = finiteNumber(value, null);
      return number !== null && number !== 0;
    });
    if (axisKey && hasNonZeroTimer) return `ENC:${axisKey}`;
    return fallbackPacketKey(packet, sampleType, rawPrefix);
  }

  const key = `${sampleType}:${seq ?? ''}:${timestamp ?? ''}:${rawPrefix || ''}`;
  const meaningfulSeq = seq !== '' && finiteNumber(seq, null) !== 0;
  const meaningfulTimestamp = timestamp !== '' && finiteNumber(timestamp, null) !== 0;
  if (meaningfulSeq || meaningfulTimestamp) return key;
  return fallbackPacketKey(packet, sampleType, rawPrefix);
}

function encoderOnlyPacket(packet = {}, metadata = {}) {
  const encoder = packet.encoder || {};
  return {
    ...metadata,
    source: packet.source || 'ENC_CSV',
    sourceLabel: packet.sourceLabel || packet.source_label || packet.encoderSource || encoder.source || 'Gimbal Rotary Encoder',
    source_label: packet.source_label || packet.sourceLabel || packet.encoderSource || encoder.source || 'Gimbal Rotary Encoder',
    pc_time_ms: packet.pc_time_ms ?? packet.pcTimeMs ?? '',
    pcTimeMs: packet.pcTimeMs ?? packet.pc_time_ms ?? '',
    publishedAt: packet.publishedAt ?? packet.serverReceivedAtMs ?? '',
    serverReceivedAt: packet.serverReceivedAt || '',
    serverReceivedAtMs: packet.serverReceivedAtMs ?? '',
    timestamp: packet.timestamp ?? packet.ebimu_timestamp_ms ?? packet.ebimuTimestampMs ?? '',
    seq: packet.seq ?? '',
    enc_x_deg: packet.enc_x_deg ?? packet.encoderXDeg ?? encoder.x ?? '',
    enc_y_deg: packet.enc_y_deg ?? packet.encoderYDeg ?? encoder.y ?? '',
    enc_z_deg: packet.enc_z_deg ?? packet.encoderZDeg ?? encoder.z ?? '',
    encoderXDeg: packet.encoderXDeg ?? packet.enc_x_deg ?? encoder.x ?? '',
    encoderYDeg: packet.encoderYDeg ?? packet.enc_y_deg ?? encoder.y ?? '',
    encoderZDeg: packet.encoderZDeg ?? packet.enc_z_deg ?? encoder.z ?? '',
    enc_timer_x: packet.enc_timer_x ?? packet.encoderTimerX ?? encoder.timerX ?? encoder.timer_x ?? '',
    enc_timer_y: packet.enc_timer_y ?? packet.encoderTimerY ?? encoder.timerY ?? encoder.timer_y ?? '',
    enc_timer_z: packet.enc_timer_z ?? packet.encoderTimerZ ?? encoder.timerZ ?? encoder.timer_z ?? '',
    enc_age_x: packet.enc_age_x ?? packet.encoderAgeX ?? encoder.ageX ?? encoder.age_x ?? '',
    enc_age_y: packet.enc_age_y ?? packet.encoderAgeY ?? encoder.ageY ?? encoder.age_y ?? '',
    enc_age_z: packet.enc_age_z ?? packet.encoderAgeZ ?? encoder.ageZ ?? encoder.age_z ?? '',
    enc_q0: packet.enc_q0 ?? packet.encoderQ0 ?? encoder.q0 ?? '',
    enc_q1: packet.enc_q1 ?? packet.encoderQ1 ?? encoder.q1 ?? '',
    enc_q2: packet.enc_q2 ?? packet.encoderQ2 ?? encoder.q2 ?? '',
    enc_q3: packet.enc_q3 ?? packet.encoderQ3 ?? encoder.q3 ?? '',
    encoderQ0: packet.encoderQ0 ?? packet.enc_q0 ?? encoder.q0 ?? '',
    encoderQ1: packet.encoderQ1 ?? packet.enc_q1 ?? encoder.q1 ?? '',
    encoderQ2: packet.encoderQ2 ?? packet.enc_q2 ?? encoder.q2 ?? '',
    encoderQ3: packet.encoderQ3 ?? packet.enc_q3 ?? encoder.q3 ?? '',
    encoderTimerX: packet.encoderTimerX ?? packet.enc_timer_x ?? encoder.timerX ?? encoder.timer_x ?? '',
    encoderTimerY: packet.encoderTimerY ?? packet.enc_timer_y ?? encoder.timerY ?? encoder.timer_y ?? '',
    encoderTimerZ: packet.encoderTimerZ ?? packet.enc_timer_z ?? encoder.timerZ ?? encoder.timer_z ?? '',
    encoderAgeX: packet.encoderAgeX ?? packet.enc_age_x ?? encoder.ageX ?? encoder.age_x ?? '',
    encoderAgeY: packet.encoderAgeY ?? packet.enc_age_y ?? encoder.ageY ?? encoder.age_y ?? '',
    encoderAgeZ: packet.encoderAgeZ ?? packet.enc_age_z ?? encoder.ageZ ?? encoder.age_z ?? '',
    encoderRollDeg: packet.encoderRollDeg ?? encoder.rollDeg ?? '',
    encoderPitchDeg: packet.encoderPitchDeg ?? encoder.pitchDeg ?? '',
    encoderYawDeg: packet.encoderYawDeg ?? encoder.yawDeg ?? '',
    encoderRawRollDeg: packet.encoderRawRollDeg ?? encoder.rawRollDeg ?? '',
    encoderRawPitchDeg: packet.encoderRawPitchDeg ?? encoder.rawPitchDeg ?? '',
    encoderRawYawDeg: packet.encoderRawYawDeg ?? encoder.rawYawDeg ?? '',
    encoderAngleToQuatSequence: packet.encoderAngleToQuatSequence ?? encoder.angleToQuatSequence ?? '',
    encoderQuatSource: packet.encoderQuatSource ?? encoder.quatSource ?? '',
    encoderStatus: packet.encoderStatus ?? encoder.status ?? '',
    encoderSource: packet.encoderSource || encoder.source || 'Gimbal Rotary Encoder packet',
    encoderUpdatedAt: packet.encoderUpdatedAt ?? encoder.updatedAt ?? '',
    raw: packet.raw || packet.cleanLine || '',
    cleanLine: packet.cleanLine || packet.raw || '',
    updatedAt: packet.updatedAt ?? '',
    encoder: {
      x: packet.enc_x_deg ?? packet.encoderXDeg ?? encoder.x ?? '',
      y: packet.enc_y_deg ?? packet.encoderYDeg ?? encoder.y ?? '',
      z: packet.enc_z_deg ?? packet.encoderZDeg ?? encoder.z ?? '',
      timerX: packet.enc_timer_x ?? packet.encoderTimerX ?? encoder.timerX ?? encoder.timer_x ?? '',
      timerY: packet.enc_timer_y ?? packet.encoderTimerY ?? encoder.timerY ?? encoder.timer_y ?? '',
      timerZ: packet.enc_timer_z ?? packet.encoderTimerZ ?? encoder.timerZ ?? encoder.timer_z ?? '',
      ageX: packet.enc_age_x ?? packet.encoderAgeX ?? encoder.ageX ?? encoder.age_x ?? '',
      ageY: packet.enc_age_y ?? packet.encoderAgeY ?? encoder.ageY ?? encoder.age_y ?? '',
      ageZ: packet.enc_age_z ?? packet.encoderAgeZ ?? encoder.ageZ ?? encoder.age_z ?? '',
      q0: packet.enc_q0 ?? packet.encoderQ0 ?? encoder.q0 ?? '',
      q1: packet.enc_q1 ?? packet.encoderQ1 ?? encoder.q1 ?? '',
      q2: packet.enc_q2 ?? packet.encoderQ2 ?? encoder.q2 ?? '',
      q3: packet.enc_q3 ?? packet.encoderQ3 ?? encoder.q3 ?? '',
      angleToQuatSequence: packet.encoderAngleToQuatSequence ?? encoder.angleToQuatSequence ?? '',
      quatSource: packet.encoderQuatSource ?? encoder.quatSource ?? '',
      status: packet.encoderStatus ?? encoder.status ?? '',
      source: packet.encoderSource || encoder.source || 'Gimbal Rotary Encoder packet',
      updatedAt: packet.encoderUpdatedAt ?? encoder.updatedAt ?? '',
    },
  };
}

function telemetryOnlyPacket(packet = {}, metadata = {}) {
  const next = {
    ...packet,
    ...metadata,
  };
  ENCODER_PACKET_FIELD_KEYS.forEach((key) => {
    delete next[key];
  });
  return next;
}

export function prepareCsvLogEntry(packet = {}, options = {}) {
  const loggedAtMs = finiteNumber(options.loggedAtMs, Date.now());
  const sampleType = detectSampleType(packet);
  const rawPrefix = detectRawPrefix(packet) || sampleType;
  const packetKey = makePacketKey(packet, sampleType, rawPrefix);
  const metadata = {
    log_index: finiteNumber(options.logIndex, 0),
    logged_at_ms: loggedAtMs,
    loggedAtMs,
    logged_at_iso: packet.logged_at_iso || packet.loggedAtIso || isoTimeFromValue(loggedAtMs),
    plot_time_ms: finiteNumber(packet.plot_time_ms ?? packet.plotTimeMs, null),
    sample_type: sampleType,
    sampleType,
    packet_key: packetKey,
    packetKey,
    raw_prefix: rawPrefix,
    rawPrefix,
  };
  if (sampleType === 'ENC') return encoderOnlyPacket(packet, metadata);
  return telemetryOnlyPacket(packet, metadata);
}

export function appendCsvLogSample(logRef, seenKeysRef, packet, options = {}) {
  if (!packet) return false;
  const sampleType = detectSampleType(packet);
  if (!VALID_SAMPLE_TYPES.has(sampleType)) return false;
  const nextIndexRef = options.nextLogIndexRef;
  const logIndex = finiteNumber(options.logIndex, nextIndexRef?.current ?? 0);
  const entry = prepareCsvLogEntry(packet, {
    logIndex,
    loggedAtMs: packet.logged_at_ms ?? packet.loggedAtMs ?? Date.now(),
  });
  const key = entry.packet_key;
  if (key && seenKeysRef?.current?.has(key)) return false;
  if (key && seenKeysRef?.current) seenKeysRef.current.add(key);
  if (!Array.isArray(logRef.current)) logRef.current = [];
  logRef.current.push(entry);
  if (nextIndexRef) nextIndexRef.current = logIndex + 1;
  return true;
}

export function finalizeCsvLogRows(rows = []) {
  const unique = [];
  const seen = new Set();
  rows.forEach((row, index) => {
    const prepared = row?.packet_key
      ? row
      : prepareCsvLogEntry(row, { logIndex: index, loggedAtMs: row?.logged_at_ms ?? Date.now() });
    const key = makePacketKey(prepared);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    unique.push({ ...prepared, packet_key: key, packetKey: key });
  });

  const loggedTimes = unique
    .map((row) => finiteNumber(row.logged_at_ms ?? row.loggedAtMs, null))
    .filter((value) => value !== null);
  const logStartMs = loggedTimes.length > 0 ? Math.min(...loggedTimes) : Date.now();

  const withPlotTimes = unique.map((row, index) => {
    const loggedAtMs = finiteNumber(row.logged_at_ms ?? row.loggedAtMs, logStartMs + index);
    const rawPlotTime = finiteNumber(row.plot_time_ms ?? row.plotTimeMs, null);
    const plotTimeMs = rawPlotTime !== null ? rawPlotTime : Math.max(0, loggedAtMs - logStartMs);
    return {
      ...row,
      log_index: finiteNumber(row.log_index, index),
      logged_at_ms: loggedAtMs,
      logged_at_iso: row.logged_at_iso || row.loggedAtIso || isoTimeFromValue(loggedAtMs),
      plot_time_ms: plotTimeMs,
    };
  });

  withPlotTimes.sort((a, b) => {
    const plotA = finiteNumber(a.plot_time_ms, 0);
    const plotB = finiteNumber(b.plot_time_ms, 0);
    if (plotA !== plotB) return plotA - plotB;
    return finiteNumber(a.log_index, 0) - finiteNumber(b.log_index, 0);
  });

  let lastPlotTime = 0;
  return withPlotTimes.map((row, index) => {
    const plotTime = Math.max(lastPlotTime, finiteNumber(row.plot_time_ms, lastPlotTime));
    lastPlotTime = plotTime;
    return {
      ...row,
      log_index: index,
      plot_time_ms: plotTime,
    };
  });
}

function isoTimeFromValue(value) {
  if (!value) return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? date.toISOString() : '';
}

export function normalizeCsvPacketForColumns(packet = {}) {
  const sampleType = detectSampleType(packet);
  const rawPrefix = detectRawPrefix(packet) || sampleType;
  const source = sampleType === 'ENC' ? encoderOnlyPacket(packet, {
    log_index: packet.log_index ?? packet.logIndex ?? '',
    logged_at_ms: packet.logged_at_ms ?? packet.loggedAtMs ?? '',
    sample_type: sampleType,
    sampleType,
    packet_key: makePacketKey(packet, sampleType, rawPrefix),
    packetKey: makePacketKey(packet, sampleType, rawPrefix),
    raw_prefix: rawPrefix,
    rawPrefix,
  }) : telemetryOnlyPacket(packet);
  const desired = source.latestDesiredAttitude || source.desiredAttitude || {};

  return {
    ...source,
    log_index: source.log_index ?? source.logIndex ?? '',
    logged_at_ms: source.logged_at_ms ?? source.loggedAtMs ?? '',
    logged_at_iso: source.logged_at_iso || source.loggedAtIso || isoTimeFromValue(source.logged_at_ms ?? source.loggedAtMs),
    plot_time_ms: source.plot_time_ms ?? source.plotTimeMs ?? '',
    sample_type: sampleType,
    packet_key: source.packet_key ?? source.packetKey ?? makePacketKey(source, sampleType, rawPrefix),
    raw_prefix: rawPrefix,
    pc_time_ms: source.pc_time_ms ?? source.pcTimeMs ?? '',
    published_at: source.publishedAt ?? source.serverReceivedAtMs ?? '',
    source_label: source.sourceLabel ?? source.source_label ?? '',
    imu_euler_sequence: source.imuEulerSequence ?? '',
    rpy_source: source.rpySource ?? '',
    imu_q0: source.q0 ?? source.q?.[0],
    imu_q1: source.q1 ?? source.q?.[1],
    imu_q2: source.q2 ?? source.q?.[2],
    imu_q3: source.q3 ?? source.q?.[3],
    imu_roll_deg: source.roll_deg ?? source.rollDeg ?? source.Roll_deg,
    imu_pitch_deg: source.pitch_deg ?? source.pitchDeg ?? source.Pitch_deg,
    imu_yaw_deg: source.yaw_deg ?? source.yawDeg ?? source.Yaw_deg,
    desired_roll_deg: source.desired_roll_deg ?? source.desiredRollDeg ?? desired.rollDeg ?? desired.desiredRollDeg ?? desired.desired_roll_deg,
    desired_pitch_deg: source.desired_pitch_deg ?? source.desiredPitchDeg ?? desired.pitchDeg ?? desired.desiredPitchDeg ?? desired.desired_pitch_deg,
    desired_yaw_deg: source.desired_yaw_deg ?? source.desiredYawDeg ?? desired.yawDeg ?? desired.desiredYawDeg ?? desired.desired_yaw_deg,
    imu_display_roll_sign: source.imuDisplayRollSign,
    imu_display_pitch_sign: source.imuDisplayPitchSign,
    imu_display_yaw_sign: source.imuDisplayYawSign,
    qerr_deg: source.qerr_deg ?? source.qerrDeg,
    qerr_source: source.qerrSource,
    angular_rate_source: source.angularRateSource,
    wz_raw: source.wzRaw ?? source.wz_raw ?? source.wz,
    wz_display: source.wzDisplay ?? source.wz_display,
    body_rate_wz_display_sign: source.bodyRateWzDisplaySign,
    remote_timestamp: source.remote_timestamp ?? source.timestamp ?? source.ebimu_timestamp_ms ?? source.ebimuTimestampMs,
    remote_timestamp_us: source.remote_timestamp_us ?? source.timestamp_us ?? source.timestamp,
    timestamp: source.timestamp ?? source.ebimu_timestamp_ms ?? source.ebimuTimestampMs,
    timestamp_us: source.timestamp_us ?? source.remote_timestamp_us ?? source.timestamp,
    seq: source.seq,
    commandType: source.commandType ?? source.command_type,
    enc_x_deg: source.enc_x_deg ?? source.encoderXDeg ?? source.encoder?.x,
    enc_y_deg: source.enc_y_deg ?? source.encoderYDeg ?? source.encoder?.y,
    enc_z_deg: source.enc_z_deg ?? source.encoderZDeg ?? source.encoder?.z,
    enc_q0: source.enc_q0 ?? source.encoderQ0 ?? source.encoder?.q0,
    enc_q1: source.enc_q1 ?? source.encoderQ1 ?? source.encoder?.q1,
    enc_q2: source.enc_q2 ?? source.encoderQ2 ?? source.encoder?.q2,
    enc_q3: source.enc_q3 ?? source.encoderQ3 ?? source.encoder?.q3,
    encoder_roll_deg: source.encoderRollDeg ?? source.encoder?.rollDeg,
    encoder_pitch_deg: source.encoderPitchDeg ?? source.encoder?.pitchDeg,
    encoder_yaw_deg: source.encoderYawDeg ?? source.encoder?.yawDeg,
    encoder_raw_roll_deg: source.encoderRawRollDeg ?? source.encoder?.rawRollDeg,
    encoder_raw_pitch_deg: source.encoderRawPitchDeg ?? source.encoder?.rawPitchDeg,
    encoder_raw_yaw_deg: source.encoderRawYawDeg ?? source.encoder?.rawYawDeg,
    encoder_display_roll_sign: source.encoderDisplayRollSign ?? source.encoder?.displayRollSign,
    encoder_display_pitch_sign: source.encoderDisplayPitchSign ?? source.encoder?.displayPitchSign,
    encoder_display_yaw_sign: source.encoderDisplayYawSign ?? source.encoder?.displayYawSign,
    encoder_angle_to_quat_sequence: source.encoderAngleToQuatSequence ?? source.encoder?.angleToQuatSequence,
    encoder_euler_sequence: source.encoderEulerSequence ?? source.encoder?.eulerSequence,
    encoder_quat_source: source.encoderQuatSource ?? source.encoder?.quatSource,
    encoder_rpy_source: source.encoderRpySource ?? source.encoder?.rpySource,
    encoder_status: source.encoderStatus ?? source.encoder?.status,
    enc_timer_x: source.enc_timer_x ?? source.encoderTimerX ?? source.encoder?.timerX ?? source.encoder?.timer_x,
    enc_timer_y: source.enc_timer_y ?? source.encoderTimerY ?? source.encoder?.timerY ?? source.encoder?.timer_y,
    enc_timer_z: source.enc_timer_z ?? source.encoderTimerZ ?? source.encoder?.timerZ ?? source.encoder?.timer_z,
    enc_age_x: source.enc_age_x ?? source.encoderAgeX ?? source.encoder?.ageX ?? source.encoder?.age_x,
    enc_age_y: source.enc_age_y ?? source.encoderAgeY ?? source.encoder?.ageY ?? source.encoder?.age_y,
    enc_age_z: source.enc_age_z ?? source.encoderAgeZ ?? source.encoder?.ageZ ?? source.encoder?.age_z,
    encoder_source: source.encoderSource || source.encoder?.source,
    encoder_updated_at: source.encoderUpdatedAt ?? source.encoder?.updatedAt,
    raw: source.raw || '',
  };
}

export function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvRowFromPacket(packet, columns) {
  const row = normalizeCsvPacketForColumns(packet);
  return columns.map((column) => csvEscape(row[column])).join(',');
}
