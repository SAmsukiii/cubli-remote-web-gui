export const CSV_LOG_METADATA_COLUMNS = [
  'log_index',
  'logged_at_ms',
  'sample_type',
  'packet_key',
  'raw_prefix',
];

export const CSV_LOG_NOTE = 'CSV is sorted by telemetry timestamp when available. ENC-only rows are stored as encoder reference updates.';

const TELEMETRY_SAMPLE_TYPES = new Set(['TEL', 'IMU']);
const VALID_SAMPLE_TYPES = new Set(['TEL', 'IMU', 'ENC', 'COMMAND']);

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

function firstFinite(values, fallback = null) {
  for (const value of values) {
    const number = finiteNumber(value, null);
    if (number !== null) return number;
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

export function makePacketKey(packet = {}, sampleType = detectSampleType(packet), rawPrefix = detectRawPrefix(packet)) {
  const explicit = String(packet.packet_key || packet.packetKey || '').trim();
  if (explicit) return explicit;

  const seq = firstPresent([packet.seq, packet.packetCount, packet.rxCount], '');
  const timestamp = firstPresent([packet.timestamp, packet.ebimu_timestamp_ms, packet.ebimuTimestampMs], '');
  const raw = packet.raw || packet.cleanLine || '';

  if (sampleType === 'ENC') {
    const axisKey = encoderAxisKey(packet);
    if (axisKey) return `ENC:${axisKey}`;
    return `ENC:${simpleHash(raw || JSON.stringify(packet))}`;
  }

  const key = `${sampleType}:${seq ?? ''}:${timestamp ?? ''}:${rawPrefix || ''}`;
  if (seq !== '' || timestamp !== '') return key;
  return `${key}:${firstPresent([packet.pc_time_ms, packet.pcTimeMs, packet.updatedAt, packet.publishedAt], '')}:${simpleHash(raw)}`;
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

export function prepareCsvLogEntry(packet = {}, options = {}) {
  const loggedAtMs = finiteNumber(options.loggedAtMs, Date.now());
  const sampleType = detectSampleType(packet);
  const rawPrefix = detectRawPrefix(packet) || sampleType;
  const packetKey = makePacketKey(packet, sampleType, rawPrefix);
  const metadata = {
    log_index: finiteNumber(options.logIndex, 0),
    logged_at_ms: loggedAtMs,
    sample_type: sampleType,
    sampleType,
    packet_key: packetKey,
    packetKey,
    raw_prefix: rawPrefix,
    rawPrefix,
  };
  if (sampleType === 'ENC') return encoderOnlyPacket(packet, metadata);
  return {
    ...packet,
    ...metadata,
  };
}

export function appendCsvLogSample(logRef, seenKeysRef, packet, options = {}) {
  if (!packet) return false;
  const nextIndexRef = options.nextLogIndexRef;
  const logIndex = finiteNumber(options.logIndex, nextIndexRef?.current ?? 0);
  const entry = prepareCsvLogEntry(packet, {
    logIndex,
    loggedAtMs: Date.now(),
  });
  const key = entry.packet_key;
  if (key && seenKeysRef?.current?.has(key)) return false;
  if (key && seenKeysRef?.current) seenKeysRef.current.add(key);
  logRef.current = [...(logRef.current || []), entry];
  if (nextIndexRef) nextIndexRef.current = logIndex + 1;
  return true;
}

function sampleSortGroup(row = {}) {
  const type = detectSampleType(row);
  if (type === 'TEL') return 0;
  if (type === 'IMU') return 1;
  if (type === 'ENC') return 2;
  return 3;
}

function sortValue(row = {}) {
  const type = detectSampleType(row);
  if (TELEMETRY_SAMPLE_TYPES.has(type)) {
    const timestamp = firstFinite([row.timestamp, row.ebimu_timestamp_ms, row.ebimuTimestampMs], null);
    if (timestamp !== null) return [0, timestamp];
    const seq = firstFinite([row.seq, row.packetCount, row.rxCount], null);
    if (seq !== null) return [1, seq];
  }
  if (type === 'ENC') {
    const timestamp = firstFinite([row.timestamp, row.ebimu_timestamp_ms, row.ebimuTimestampMs], null);
    if (timestamp !== null) return [0, timestamp];
    const timer = firstFinite([row.enc_timer_x, row.encoderTimerX, row.enc_timer_y, row.encoderTimerY, row.enc_timer_z, row.encoderTimerZ], null);
    if (timer !== null) return [1, timer];
  }
  const pcTime = firstFinite([row.pc_time_ms, row.pcTimeMs, row.publishedAt, row.serverReceivedAtMs], null);
  if (pcTime !== null) return [2, pcTime];
  return [3, firstFinite([row.logged_at_ms, row.updatedAt, row.log_index], 0)];
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

  unique.sort((a, b) => {
    const groupDelta = sampleSortGroup(a) - sampleSortGroup(b);
    if (groupDelta !== 0) return groupDelta;
    const [priorityA, valueA] = sortValue(a);
    const [priorityB, valueB] = sortValue(b);
    if (priorityA !== priorityB) return priorityA - priorityB;
    if (valueA !== valueB) return valueA - valueB;
    return finiteNumber(a.log_index, 0) - finiteNumber(b.log_index, 0);
  });

  return unique.map((row, index) => ({
    ...row,
    log_index: index,
  }));
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
  }) : packet;
  const timeValue = firstPresent([
    source.publishedAt,
    source.serverReceivedAtMs,
    source.updatedAt,
    source.pc_time_ms,
    source.pcTimeMs,
    source.logged_at_ms,
  ], '');

  return {
    ...source,
    log_index: source.log_index ?? source.logIndex ?? '',
    logged_at_ms: source.logged_at_ms ?? source.loggedAtMs ?? '',
    sample_type: sampleType,
    packet_key: source.packet_key ?? source.packetKey ?? makePacketKey(source, sampleType, rawPrefix),
    raw_prefix: rawPrefix,
    time_local: isoTimeFromValue(timeValue),
    pc_time_ms: source.pc_time_ms ?? source.pcTimeMs ?? '',
    published_at: source.publishedAt ?? source.serverReceivedAtMs ?? '',
    source_label: source.sourceLabel ?? source.source_label ?? '',
    imu_euler_sequence: source.imuEulerSequence ?? '',
    rpy_source: source.rpySource ?? '',
    raw_roll_deg: source.rawRollDeg,
    raw_pitch_deg: source.rawPitchDeg,
    raw_yaw_deg: source.rawYawDeg,
    roll_deg: source.roll_deg ?? source.Roll_deg ?? source.rollDeg,
    pitch_deg: source.pitch_deg ?? source.Pitch_deg ?? source.pitchDeg,
    yaw_deg: source.yaw_deg ?? source.Yaw_deg ?? source.yawDeg,
    imu_display_roll_sign: source.imuDisplayRollSign,
    imu_display_pitch_sign: source.imuDisplayPitchSign,
    imu_display_yaw_sign: source.imuDisplayYawSign,
    Roll_deg: source.Roll_deg ?? source.roll_deg ?? source.rollDeg,
    Pitch_deg: source.Pitch_deg ?? source.pitch_deg ?? source.pitchDeg,
    Yaw_deg: source.Yaw_deg ?? source.yaw_deg ?? source.yawDeg,
    qerr_deg: source.qerr_deg ?? source.qerrDeg,
    qerr_source: source.qerrSource,
    angular_rate_source: source.angularRateSource,
    wz_raw: source.wzRaw ?? source.wz_raw ?? source.wz,
    wz_display: source.wzDisplay ?? source.wz_display,
    body_rate_wz_display_sign: source.bodyRateWzDisplaySign,
    timestamp: source.timestamp ?? source.ebimu_timestamp_ms ?? source.ebimuTimestampMs,
    seq: source.seq,
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
