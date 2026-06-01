import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, Alert, Badge, Button, Col, Form, Row } from 'react-bootstrap';
import {
  CSV_LOG_NOTE,
  DEFAULT_CSV_LOG_COLUMNS,
  appendCsvLogSample,
  csvRowFromPacket,
  detectSampleType,
  finalizeCsvLogRows,
} from './csvLogUtils';
import TelemetryDataView from './TelemetryDataView';

const CSV_COLUMNS = DEFAULT_CSV_LOG_COLUMNS;

const EBIMU_COMMANDS = {
  MAG_MODE: 1,
  GYRO_DPS: 2,
  ACCEL_G: 3,
  ACCEL_FACTOR: 4,
  DEFAULT: 9,
  START: 10,
  STOP: 11,
};

const MAG_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: 'On', value: 1 },
  { label: 'Auto', value: 2 },
];

const GYRO_OPTIONS = [250, 500, 1000, 2000];
const ACCEL_OPTIONS = [2, 4, 8, 16];
const FILTER_PRESETS = [1, 5, 10, 20, 50];
const ATTITUDE_GAIN_DEFAULTS = {
  kp: { x: '0.040', y: '0.040', z: '0.040' },
  kd: { x: '0.080', y: '0.080', z: '0.080' },
};
const ATTITUDE_GAIN_MIN = 0;
const ATTITUDE_GAIN_MAX = 10;
const ATTITUDE_GAIN_STEP = 0.001;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatNumber(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toFixed(digits);
}

function formatDateTime(ms) {
  if (!ms) return '-';
  const date = new Date(ms);
  return date.toLocaleTimeString('ko-KR', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + `.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatCsvFileTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function formatSourceLabel(source) {
  const normalized = String(source || '').replace(/_/g, ' ').toLowerCase();
  if (normalized === 'satellite telemetry') return 'satellite telemetry';
  if (normalized === 'satellite gyro' || normalized === 'satellite body rate') return 'satellite body rate';
  if (normalized === 'computed fallback') return 'computed fallback';
  if (normalized === 'computed from quaternion' || normalized === 'computed quaternion difference') return 'computed from quaternion';
  if (normalized === 'estimated') return 'estimated';
  return source || '-';
}

function formatStatusToken(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function encoderNumber(packet, snakeKey, camelKey, nestedKey) {
  const value = packet?.[snakeKey] ?? packet?.[camelKey] ?? packet?.encoder?.[nestedKey];
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function encoderText(packet, key, nestedKey, fallback = '') {
  return String(packet?.[key] ?? packet?.encoder?.[nestedKey] ?? fallback ?? '').trim();
}

function getEncoderSnapshot(packet = {}, now = Date.now()) {
  const x = encoderNumber(packet, 'enc_x_deg', 'encoderXDeg', 'x');
  const y = encoderNumber(packet, 'enc_y_deg', 'encoderYDeg', 'y');
  const z = encoderNumber(packet, 'enc_z_deg', 'encoderZDeg', 'z');
  const q0 = encoderNumber(packet, 'enc_q0', 'encoderQ0', 'q0');
  const q1 = encoderNumber(packet, 'enc_q1', 'encoderQ1', 'q1');
  const q2 = encoderNumber(packet, 'enc_q2', 'encoderQ2', 'q2');
  const q3 = encoderNumber(packet, 'enc_q3', 'encoderQ3', 'q3');
  const timerX = encoderNumber(packet, 'enc_timer_x', 'encoderTimerX', 'timerX');
  const timerY = encoderNumber(packet, 'enc_timer_y', 'encoderTimerY', 'timerY');
  const timerZ = encoderNumber(packet, 'enc_timer_z', 'encoderTimerZ', 'timerZ');
  const ageX = encoderNumber(packet, 'enc_age_x', 'encoderAgeX', 'ageX');
  const ageY = encoderNumber(packet, 'enc_age_y', 'encoderAgeY', 'ageY');
  const ageZ = encoderNumber(packet, 'enc_age_z', 'encoderAgeZ', 'ageZ');
  const updatedAt = encoderNumber(packet, 'encoderUpdatedAt', 'encoderUpdatedAt', 'updatedAt');
  const rollDeg = encoderNumber(packet, 'encoderRollDeg', 'encoderRollDeg', 'rollDeg');
  const pitchDeg = encoderNumber(packet, 'encoderPitchDeg', 'encoderPitchDeg', 'pitchDeg');
  const yawDeg = encoderNumber(packet, 'encoderYawDeg', 'encoderYawDeg', 'yawDeg');
  const rawYawDeg = encoderNumber(packet, 'encoderRawYawDeg', 'encoderRawYawDeg', 'rawYawDeg');
  const displayYawSign = encoderNumber(packet, 'encoderDisplayYawSign', 'encoderDisplayYawSign', 'displayYawSign');
  const source = encoderText(packet, 'encoderSource', 'source');
  const angleToQuatSequence = encoderText(packet, 'encoderAngleToQuatSequence', 'angleToQuatSequence', 'ZYX') || 'ZYX';
  const eulerSequence = encoderText(packet, 'encoderEulerSequence', 'eulerSequence', 'ZYX') || 'ZYX';
  const quatSource = encoderText(packet, 'encoderQuatSource', 'quatSource');
  const rpySource = encoderText(packet, 'encoderRpySource', 'rpySource');
  const explicitStatus = encoderText(packet, 'encoderStatus', 'status').toUpperCase();
  const hasValues = [x, y, z, q0, q1, q2, q3, timerX, timerY, timerZ].some((value) => value !== null);
  const hasQuaternion = [q0, q1, q2, q3].every((value) => value !== null);
  const ageMs = hasValues && updatedAt ? Math.max(0, now - updatedAt) : null;
  const timerDelta = [timerX, timerY, timerZ].every((value) => value !== null) ? Math.max(timerX, timerY, timerZ) - Math.min(timerX, timerY, timerZ) : null;
  const status = explicitStatus || (!hasValues ? 'NONE' : (ageMs !== null && ageMs > 300 ? 'STALE' : (!hasQuaternion ? 'PARTIAL' : (timerDelta !== null && timerDelta > 100 ? 'MIXED' : 'LIVE'))));
  return {
    x,
    y,
    z,
    q0,
    q1,
    q2,
    q3,
    timerX,
    timerY,
    timerZ,
    ageX,
    ageY,
    ageZ,
    rollDeg,
    pitchDeg,
    yawDeg,
    updatedAt,
    ageMs,
    source,
    angleToQuatSequence,
    eulerSequence,
    quatSource,
    rpySource,
    hasQuaternion,
    rawYawDeg,
    displayYawSign,
    status,
  };
}

function buildEncoderRows(packet = {}) {
  const encoder = getEncoderSnapshot(packet);
  const rows = [
    { label: 'Status', value: encoder.status },
    { label: 'Gimbal encoder angle fields', value: [encoder.x, encoder.y, encoder.z].some((value) => value !== null) ? 'legacy ENC format' : 'unavailable in current ENC format' },
    { label: 'Remote Encoder Quaternion', value: encoder.hasQuaternion ? 'available' : 'unavailable' },
    { label: 'Encoder q0', value: encoder.q0 !== null ? formatNumber(encoder.q0, 5) : '-' },
    { label: 'Encoder q1', value: encoder.q1 !== null ? formatNumber(encoder.q1, 5) : '-' },
    { label: 'Encoder q2', value: encoder.q2 !== null ? formatNumber(encoder.q2, 5) : '-' },
    { label: 'Encoder q3', value: encoder.q3 !== null ? formatNumber(encoder.q3, 5) : '-' },
  ];
  rows.push(
    { label: `Gimbal Encoder RPY [${encoder.eulerSequence}]`, value: encoder.hasQuaternion ? 'available' : 'unavailable' },
    { label: 'Encoder Roll', value: encoder.rollDeg !== null ? `${formatNumber(encoder.rollDeg, 2)} deg` : 'unavailable' },
    { label: 'Encoder Pitch', value: encoder.pitchDeg !== null ? `${formatNumber(encoder.pitchDeg, 2)} deg` : 'unavailable' },
    { label: 'Encoder Yaw', value: encoder.yawDeg !== null ? `${formatNumber(encoder.yawDeg, 2)} deg` : 'unavailable' },
    { label: 'Encoder Raw Yaw', value: encoder.rawYawDeg !== null ? `${formatNumber(encoder.rawYawDeg, 2)} deg` : '-' },
    { label: 'Quaternion source', value: encoder.quatSource || '-' },
    { label: 'RPY source', value: encoder.rpySource || '-' },
  );
  if ([encoder.timerX, encoder.timerY, encoder.timerZ].some((value) => value !== null)) {
    rows.push(
      { label: 'Gimbal Encoder timer X', value: encoder.timerX !== null ? formatNumber(encoder.timerX, 0) : '-' },
      { label: 'Gimbal Encoder timer Y', value: encoder.timerY !== null ? formatNumber(encoder.timerY, 0) : '-' },
      { label: 'Gimbal Encoder timer Z', value: encoder.timerZ !== null ? formatNumber(encoder.timerZ, 0) : '-' },
    );
  }
  if ([encoder.ageX, encoder.ageY, encoder.ageZ].some((value) => value !== null)) {
    rows.push(
      { label: 'Gimbal Encoder age X', value: encoder.ageX !== null ? `${formatNumber(encoder.ageX, 0)} ms` : '-' },
      { label: 'Gimbal Encoder age Y', value: encoder.ageY !== null ? `${formatNumber(encoder.ageY, 0)} ms` : '-' },
      { label: 'Gimbal Encoder age Z', value: encoder.ageZ !== null ? `${formatNumber(encoder.ageZ, 0)} ms` : '-' },
    );
  }
  rows.push(
    { label: 'Source', value: encoder.source || '-' },
    { label: 'Updated', value: formatDateTime(encoder.updatedAt) },
    { label: 'Computed age', value: encoder.ageMs !== null ? `${formatNumber(encoder.ageMs, 0)} ms` : '-' },
  );
  return rows;
}

function parseGainValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < ATTITUDE_GAIN_MIN || number > ATTITUDE_GAIN_MAX) return null;
  return number;
}

function formatGainValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : '0.000';
}

function readGainTriplet(values = {}) {
  const x = parseGainValue(values.x);
  const y = parseGainValue(values.y);
  const z = parseGainValue(values.z);
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

function gainLine(prefix, values) {
  return `${prefix},${formatGainValue(values.x)},${formatGainValue(values.y)},${formatGainValue(values.z)}`;
}

function packetToCsvRow(packet) {
  return csvRowFromPacket(packet, CSV_COLUMNS);
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function summarizeCsvRows(rows = [], startedAt = null) {
  const summary = { total: rows.length, telemetry: 0, imu: 0, tel: 0, enc: 0, rateHz: 0 };
  rows.forEach((row) => {
    const type = detectSampleType(row);
    if (type === 'TEL') {
      summary.tel += 1;
      summary.telemetry += 1;
    } else if (type === 'IMU') {
      summary.imu += 1;
      summary.telemetry += 1;
    } else if (type === 'ENC') {
      summary.enc += 1;
    }
  });
  const elapsedMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
  summary.rateHz = elapsedMs > 0 ? summary.total / (elapsedMs / 1000) : 0;
  return summary;
}

function filterCsvRows(rows = [], kind = 'combined') {
  if (kind === 'telemetry') return rows.filter((row) => ['TEL', 'IMU'].includes(detectSampleType(row)));
  if (kind === 'encoder') return rows.filter((row) => detectSampleType(row) === 'ENC');
  return rows;
}

function ValueGrid({ title, rows }) {
  return (
    <div className="serial-value-card rounded p-2">
      <div className="serial-section-title mb-2">{title}</div>
      {rows.map((row) => (
        <div key={row.label} className="serial-value-row d-flex justify-content-between gap-2">
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function CommandButton({ label, onClick, disabled }) {
  return (
    <Button
      variant="outline-light"
      className="serial-command-button simple-command-button"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="serial-command-label">{label}</span>
    </Button>
  );
}

function CommandGroup({ children }) {
  return <div className="serial-command-grid compact-command-grid">{children}</div>;
}

function CommandAccordionItem({ eventKey, title, children }) {
  return (
    <Accordion.Item eventKey={eventKey} className="command-accordion-item">
      <Accordion.Header>{title}</Accordion.Header>
      <Accordion.Body>{children}</Accordion.Body>
    </Accordion.Item>
  );
}

export default function SerialPanel({ serial, useSerialImu, setUseSerialImu, onCommandEvent, isAdmin = false }) {
  const [targetRoll, setTargetRoll] = useState(0);
  const [targetPitch, setTargetPitch] = useState(0);
  const [targetYaw, setTargetYaw] = useState(0);
  const [accFactor, setAccFactor] = useState(10);
  const [kpGain, setKpGain] = useState(ATTITUDE_GAIN_DEFAULTS.kp);
  const [kdGain, setKdGain] = useState(ATTITUDE_GAIN_DEFAULTS.kd);
  const [gainStatus, setGainStatus] = useState('');
  const [showMonitor, setShowMonitor] = useState(false);
  const [csvLogging, setCsvLogging] = useState(false);
  const [csvStartedAt, setCsvStartedAt] = useState(null);
  const [csvSampleCount, setCsvSampleCount] = useState(0);
  const [csvElapsedMs, setCsvElapsedMs] = useState(0);
  const [csvStats, setCsvStats] = useState(() => summarizeCsvRows([]));
  const logRef = useRef([]);
  const seenCsvPacketKeysRef = useRef(new Set());
  const nextCsvLogIndexRef = useRef(0);
  const csvStartedAtRef = useRef(null);

  const latest = useMemo(() => serial.latestPacket || {}, [serial.latestPacket]);
  const latestCsvPacket = useMemo(() => serial.latestCsvPacket || serial.latestPacket || {}, [serial.latestCsvPacket, serial.latestPacket]);
  const csvLogVersion = serial.csvLogVersion || 0;
  const drainCsvLogSamples = serial.drainCsvLogSamples;
  const csvLoggedHz = serial.csvLoggedHz || 0;
  const waitingForTelemetry = Boolean(serial.isConnected && !serial.lastReceivedAt);
  const stale = serial.lastReceivedAt ? Date.now() - serial.lastReceivedAt > 500 : false;
  const statusVariant = !serial.isConnected ? 'secondary' : waitingForTelemetry ? 'info' : stale ? 'warning' : 'success';
  const statusText = !serial.isConnected ? 'DISCONNECTED' : waitingForTelemetry ? 'WAITING' : stale ? 'STALE' : 'LIVE';
  const adminLocked = !isAdmin;
  const commandDisabled = adminLocked || !serial.isConnected;
  const showDirectCommandPanel = false;
  const parserNote = String(serial.lastInvalidReason || '').startsWith('Port opened')
    ? ''
    : serial.lastInvalidReason;
  const kpValues = readGainTriplet(kpGain);
  const kdValues = readGainTriplet(kdGain);
  const gainInputInvalid = !kpValues || !kdValues;

  const emitCommandEvent = React.useCallback((eventType, label, detail = {}) => {
    if (!onCommandEvent) return;
    onCommandEvent({
      source: 'admin-web-serial',
      eventType,
      label,
      detail,
    });
  }, [onCommandEvent]);

  const appendCsvSamples = React.useCallback((samples) => {
    const sampleList = Array.isArray(samples) ? samples : [samples];
    let appendedAny = false;
    sampleList.forEach((sample) => {
      if (!sample?.updatedAt && !sample?.raw && !sample?.cleanLine) return;
      const appended = appendCsvLogSample(logRef, seenCsvPacketKeysRef, sample, {
        nextLogIndexRef: nextCsvLogIndexRef,
      });
      appendedAny = appendedAny || appended;
    });
    if (appendedAny) {
      const nextStats = summarizeCsvRows(logRef.current, csvStartedAtRef.current);
      setCsvSampleCount(nextStats.total);
      setCsvStats(nextStats);
    }
    return appendedAny;
  }, []);

  useEffect(() => {
    if (!csvLogging) return;
    const samples = typeof drainCsvLogSamples === 'function'
      ? drainCsvLogSamples()
      : [latestCsvPacket];
    appendCsvSamples(samples);
  }, [appendCsvSamples, csvLogging, csvLogVersion, drainCsvLogSamples, latestCsvPacket]);

  useEffect(() => {
    if (!csvLogging || !csvStartedAt) return undefined;
    const timer = window.setInterval(() => {
      setCsvElapsedMs(Date.now() - csvStartedAt);
      setCsvStats(summarizeCsvRows(logRef.current, csvStartedAtRef.current));
    }, 500);
    return () => window.clearInterval(timer);
  }, [csvLogging, csvStartedAt]);

  const sendController = (type, v1 = 0, v2 = 0, v3 = 0, meta = {}) => {
    const commandType = Number(type) || 0;
    const target1 = Number(v1) || 0;
    const target2 = Number(v2) || 0;
    const target3 = Number(v3) || 0;

    emitCommandEvent(meta.eventType || 'COMMAND', meta.label || 'Controller Command', {
      commandType,
      target1,
      target2,
      target3,
      ...(meta.detail || {}),
    });

    if (serial.sendControllerCommand) return serial.sendControllerCommand(commandType, target1, target2, target3);
    if (serial.sendCommand) return serial.sendCommand(`${commandType} ${target1} ${target2} ${target3}`);
    return Promise.resolve(false);
  };

  const sendEbimuRuntime = (cmdId, value = 0, label = 'EBIMU Command') => sendController(50, cmdId, value, 0, {
    eventType: 'EBIMU_COMMAND',
    label,
    detail: { cmdId, value },
  });

  const applyDefaultImuSetting = async () => {
    await sendEbimuRuntime(EBIMU_COMMANDS.DEFAULT, 0, 'EBIMU Default Setup');
    await delay(80);
    await sendEbimuRuntime(EBIMU_COMMANDS.MAG_MODE, 0, 'Default IMU Magnetometer Off');
    await delay(80);
    await sendEbimuRuntime(EBIMU_COMMANDS.GYRO_DPS, 500, 'Default IMU Gyro 500 dps');
  };

  const sendTare = () => sendController(2, 0, 0, 0, {
    eventType: 'TARE',
    label: 'Set Zero / Tare',
  });

  const sendStop = () => sendController(0, 0, 0, 0, {
    eventType: 'STOP',
    label: 'Stop Control',
  });

  const sendTarget = () => sendController(1, targetRoll, targetPitch, targetYaw, {
    eventType: 'TARGET_ATTITUDE',
    label: 'Send Target Attitude',
    detail: { roll: Number(targetRoll) || 0, pitch: Number(targetPitch) || 0, yaw: Number(targetYaw) || 0 },
  });

  const updateKpGain = (axis, value) => {
    setKpGain((prev) => ({ ...prev, [axis]: value }));
    setGainStatus('');
  };

  const updateKdGain = (axis, value) => {
    setKdGain((prev) => ({ ...prev, [axis]: value }));
    setGainStatus('');
  };

  const resetAttitudeGains = () => {
    setKpGain(ATTITUDE_GAIN_DEFAULTS.kp);
    setKdGain(ATTITUDE_GAIN_DEFAULTS.kd);
    setGainStatus('Defaults restored locally. Press Send to apply them to the Remote.');
  };

  const sendRawGainLine = async (line) => {
    if (serial.sendLine) return serial.sendLine(line);
    if (serial.sendCommand) return serial.sendCommand(line);
    return false;
  };

  const sendAttitudeKp = async ({ announce = true } = {}) => {
    const values = readGainTriplet(kpGain);
    if (!values) {
      setGainStatus('Kp gains must be finite numbers from 0.000 to 10.000.');
      return false;
    }
    const line = gainLine('KP', values);
    if (announce) {
      emitCommandEvent('ATT_GAIN_KP', 'Attitude Kp', {
        kpx: values.x,
        kpy: values.y,
        kpz: values.z,
        serialLine: line,
      });
    }
    const ok = await sendRawGainLine(line);
    setGainStatus(ok ? `Sent ${line}` : 'Failed to send Attitude Kp.');
    return ok;
  };

  const sendAttitudeKd = async ({ announce = true } = {}) => {
    const values = readGainTriplet(kdGain);
    if (!values) {
      setGainStatus('Kd gains must be finite numbers from 0.000 to 10.000.');
      return false;
    }
    const line = gainLine('KD', values);
    if (announce) {
      emitCommandEvent('ATT_GAIN_KD', 'Attitude Kd', {
        kdx: values.x,
        kdy: values.y,
        kdz: values.z,
        serialLine: line,
      });
    }
    const ok = await sendRawGainLine(line);
    setGainStatus(ok ? `Sent ${line}` : 'Failed to send Attitude Kd.');
    return ok;
  };

  const sendAttitudeGains = async () => {
    const kp = readGainTriplet(kpGain);
    const kd = readGainTriplet(kdGain);
    if (!kp || !kd) {
      setGainStatus('All P/D gains must be finite numbers from 0.000 to 10.000.');
      return;
    }
    emitCommandEvent('ATT_GAIN_PD', 'Attitude P+D Gain', {
      kpx: kp.x,
      kpy: kp.y,
      kpz: kp.z,
      kdx: kd.x,
      kdy: kd.y,
      kdz: kd.z,
      serialLines: [gainLine('KP', kp), gainLine('KD', kd)],
    });
    const kpOk = await sendAttitudeKp({ announce: false });
    if (!kpOk) return;
    const kdOk = await sendAttitudeKd({ announce: false });
    setGainStatus(kdOk ? 'Sent Attitude Kp and Kd.' : 'Attitude Kp sent, but Kd failed.');
  };

  const quaternionRows = useMemo(() => [
    { label: 'q0 / qw', value: formatNumber(latest.q0, 6) },
    { label: 'q1 / qx', value: formatNumber(latest.q1, 6) },
    { label: 'q2 / qy', value: formatNumber(latest.q2, 6) },
    { label: 'q3 / qz', value: formatNumber(latest.q3, 6) },
    { label: 'norm', value: formatNumber(latest.norm, 6) },
  ], [latest]);

  const attitudeRows = useMemo(() => [
    { label: 'Roll', value: `${formatNumber(latest.roll_deg, 2)}°` },
    { label: 'Pitch', value: `${formatNumber(latest.pitch_deg, 2)}°` },
    { label: 'Yaw', value: `${formatNumber(latest.yaw_deg, 2)}°` },
  ], [latest]);

  const displayAttitudeRows = useMemo(() => {
    if (!attitudeRows) return [];
    return [
      { label: 'Roll', value: `${formatNumber(latest.roll_deg, 2)} deg` },
      { label: 'Pitch', value: `${formatNumber(latest.pitch_deg, 2)} deg` },
      { label: 'Yaw', value: `${formatNumber(latest.yaw_deg, 2)} deg` },
      { label: 'Raw Yaw', value: latest.rawYawDeg != null ? `${formatNumber(latest.rawYawDeg, 2)} deg` : '-' },
      { label: 'Sequence', value: latest.imuEulerSequence || 'ZYX' },
      { label: 'Source', value: 'IMU/TEL quaternion' },
    ];
  }, [attitudeRows, latest]);

  const qerrRows = useMemo(() => [
    { label: 'qerr_deg', value: latest.qerr_deg != null || latest.qerrDeg != null ? `${formatNumber(latest.qerr_deg ?? latest.qerrDeg, 2)} deg` : '-' },
    { label: 'qerr source', value: formatSourceLabel(latest.qerrSource) },
  ], [latest]);

  const rateRows = useMemo(() => [
    { label: 'wx (rad/s)', value: latest.wx != null ? formatNumber(latest.wx, 4) : '-' },
    { label: 'wy (rad/s)', value: latest.wy != null ? formatNumber(latest.wy, 4) : '-' },
    { label: 'wz raw (rad/s)', value: latest.wzRaw != null || latest.wz != null ? formatNumber(latest.wzRaw ?? latest.wz, 4) : '-' },
    { label: 'wz display (rad/s)', value: latest.wzDisplay != null ? formatNumber(latest.wzDisplay, 4) : '-' },
    { label: 'source', value: formatSourceLabel(latest.angularRateSource) },
  ], [latest]);

  const wheelRows = useMemo(() => [
    { label: 'RPM1', value: formatNumber(latest.RPM1, 1) },
    { label: 'RPMcmd1', value: formatNumber(latest.RPMcmd1, 1) },
    { label: 'RPM2', value: formatNumber(latest.RPM2, 1) },
    { label: 'RPMcmd2', value: formatNumber(latest.RPMcmd2, 1) },
    { label: 'RPM3', value: formatNumber(latest.RPM3, 1) },
    { label: 'RPMcmd3', value: formatNumber(latest.RPMcmd3, 1) },
  ], [latest]);

  const telemetryStatusRows = useMemo(() => [
    { label: 'commandType', value: formatStatusToken(latest.commandType ?? latest.command_type) },
    { label: 'control_mode', value: formatStatusToken(latest.control_mode) },
    { label: 'EBIMU_status', value: formatStatusToken(latest.EBIMU_status) },
    { label: 'logging_status', value: formatStatusToken(latest.logging_status) },
  ], [latest]);

  const encoderRows = useMemo(() => buildEncoderRows(latest), [latest]);

  const statusRows = useMemo(() => [
    { label: 'Source', value: latest.sourceLabel || 'Admin Web Serial Bridge' },
    { label: 'Baudrate', value: `${serial.baudRate} bps` },
    { label: 'Timestamp', value: `${formatNumber(latest.ebimu_timestamp_ms, 0)}` },
    { label: 'Seq / RX', value: `${formatNumber(latest.seq, 0)} / ${formatNumber(latest.rxCount, 0)}` },
    { label: 'Valid / Invalid', value: `${serial.validCount} / ${serial.invalidCount}` },
    { label: 'Gimbal encoder packets', value: `${serial.encoderCount || 0}` },
    { label: 'Ignored', value: `${serial.ignoredCount ?? 0}` },
    { label: 'Warning', value: `${serial.warningCount || 0}` },
    { label: 'Last RX', value: formatDateTime(serial.lastReceivedAt) },
    { label: 'Last command', value: serial.lastCommand || '-' },
    { label: 'Writer ready', value: serial.serialWriterReady ? 'yes' : 'no' },
  ], [latest, serial]);

  const startCsvLogging = () => {
    logRef.current = [];
    seenCsvPacketKeysRef.current = new Set();
    nextCsvLogIndexRef.current = 0;
    if (typeof serial.startCsvLogCapture === 'function') {
      serial.startCsvLogCapture();
    } else if (typeof drainCsvLogSamples === 'function') {
      drainCsvLogSamples();
    }
    const startedAt = Date.now();
    csvStartedAtRef.current = startedAt;
    setCsvStartedAt(startedAt);
    setCsvElapsedMs(0);
    setCsvSampleCount(0);
    setCsvStats(summarizeCsvRows([], startedAt));
    setCsvLogging(true);
  };

  const flushCsvSamples = () => {
    const finalSamples = typeof serial.stopCsvLogCapture === 'function'
      ? serial.stopCsvLogCapture()
      : (typeof drainCsvLogSamples === 'function' ? drainCsvLogSamples() : []);
    appendCsvSamples(finalSamples);
    const nextStats = summarizeCsvRows(logRef.current, csvStartedAtRef.current);
    setCsvSampleCount(nextStats.total);
    setCsvStats(nextStats);
    return nextStats.total;
  };

  const stopCsvLogging = () => {
    flushCsvSamples();
    setCsvLogging(false);
  };

  const downloadCsv = (kind = 'combined') => {
    if (csvLogging) {
      flushCsvSamples();
      setCsvLogging(false);
    } else if (typeof drainCsvLogSamples === 'function') {
      appendCsvSamples(drainCsvLogSamples());
    }
    if (logRef.current.length === 0) {
      setCsvSampleCount(0);
      setCsvStats(summarizeCsvRows([]));
      setCsvElapsedMs(0);
      setCsvStartedAt(null);
      csvStartedAtRef.current = null;
      alert('No Web Serial data was logged in this CSV session.');
      return;
    }
    const filteredRows = filterCsvRows(logRef.current, kind);
    if (filteredRows.length === 0) {
      alert(`No ${kind} rows were logged in this CSV session.`);
      return;
    }
    const sortedRows = finalizeCsvLogRows(filteredRows);
    const csv = [CSV_COLUMNS.join(','), ...sortedRows.map(packetToCsvRow)].join('\n');
    const suffix = kind === 'combined' ? 'combined' : kind;
    downloadTextFile(`cubli_${suffix}_log_${formatCsvFileTimestamp()}.csv`, `${csv}\n`);
  };

  return (
    <div className="serial-panel pt-2">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3 className="h6 fw-bold text-uppercase m-0" style={{ color: '#aaa', letterSpacing: '0.08em' }}>
          Admin Web Serial
        </h3>
        <Badge bg={statusVariant}>{statusText}</Badge>
      </div>

      {adminLocked ? (
        <Alert variant="secondary" className="py-2">
          Viewer mode: monitoring only. Web Serial connection and command controls are available only in Admin mode.
        </Alert>
      ) : null}

      {isAdmin ? (
      <div className="serial-control-card rounded p-3 mb-3">
        <div className="d-grid gap-2">
          {serial.isConnected ? (
            <Button variant="outline-danger" onClick={serial.disconnect} disabled={adminLocked}>Disconnect Receiver</Button>
          ) : (
            <Button variant="outline-info" onClick={serial.connect} disabled={adminLocked || !serial.isSupported}>Connect Receiver</Button>
          )}

          <Form.Check
            type="switch"
            id="use-controller-serial-source"
            label="Use as Admin Direct Bridge source"
            checked={useSerialImu}
            onChange={(event) => setUseSerialImu(event.target.checked)}
            disabled={adminLocked || !serial.isConnected}
          />
        </div>

        {serial.error ? <Alert variant="danger" className="mt-3 mb-0 py-2">{serial.error}</Alert> : null}
        {!serial.isSupported ? (
          <Alert variant="warning" className="mt-3 mb-0 py-2">
            Web Serial is supported only on Chrome/Edge desktop over HTTPS or localhost
          </Alert>
        ) : null}
        {serial.isConnected && !serial.lastReceivedAt ? (
          <Alert variant="info" className="mt-3 mb-0 py-2">
            Port opened, waiting for telemetry... No IMU/TEL/ENC data yet
          </Alert>
        ) : null}
      </div>
      ) : null}

      {isAdmin && showDirectCommandPanel ? (
      <div className="serial-control-card rounded p-3 mb-3">
        <div className="serial-section-title mb-3">Commands</div>
        <Accordion defaultActiveKey="control" flush alwaysOpen className="command-accordion">
          <CommandAccordionItem eventKey="control" title="Control">
            <CommandGroup>
              <CommandButton label="Set Zero / Tare" onClick={sendTare} disabled={commandDisabled} />
              <CommandButton label="Stop Control" onClick={sendStop} disabled={commandDisabled} />
            </CommandGroup>
          </CommandAccordionItem>

          <CommandAccordionItem eventKey="target" title="Target Attitude">
            <Row className="g-2 align-items-end">
              <Col xs={4}>
                <Form.Label className="serial-mini-label">Roll</Form.Label>
                <Form.Control size="sm" type="number" value={targetRoll} onChange={(e) => setTargetRoll(e.target.value)} />
              </Col>
              <Col xs={4}>
                <Form.Label className="serial-mini-label">Pitch</Form.Label>
                <Form.Control size="sm" type="number" value={targetPitch} onChange={(e) => setTargetPitch(e.target.value)} />
              </Col>
              <Col xs={4}>
                <Form.Label className="serial-mini-label">Yaw</Form.Label>
                <Form.Control size="sm" type="number" value={targetYaw} onChange={(e) => setTargetYaw(e.target.value)} />
              </Col>
              <Col xs={12}>
                <Button variant="outline-light" className="w-100" disabled={commandDisabled} onClick={sendTarget}>
                  Send Target Attitude
                </Button>
              </Col>
            </Row>
          </CommandAccordionItem>

          <CommandAccordionItem eventKey="attitude-gain" title="Attitude PID Gain">
            <div className="serial-subsection-title mb-2">P Gain</div>
            <Row className="g-2 align-items-end mb-3">
              <Col xs={4}>
                <Form.Label className="serial-mini-label">Kp X</Form.Label>
                <Form.Control size="sm" type="number" min={ATTITUDE_GAIN_MIN} max={ATTITUDE_GAIN_MAX} step={ATTITUDE_GAIN_STEP} value={kpGain.x} onChange={(e) => updateKpGain('x', e.target.value)} isInvalid={parseGainValue(kpGain.x) === null} />
              </Col>
              <Col xs={4}>
                <Form.Label className="serial-mini-label">Kp Y</Form.Label>
                <Form.Control size="sm" type="number" min={ATTITUDE_GAIN_MIN} max={ATTITUDE_GAIN_MAX} step={ATTITUDE_GAIN_STEP} value={kpGain.y} onChange={(e) => updateKpGain('y', e.target.value)} isInvalid={parseGainValue(kpGain.y) === null} />
              </Col>
              <Col xs={4}>
                <Form.Label className="serial-mini-label">Kp Z</Form.Label>
                <Form.Control size="sm" type="number" min={ATTITUDE_GAIN_MIN} max={ATTITUDE_GAIN_MAX} step={ATTITUDE_GAIN_STEP} value={kpGain.z} onChange={(e) => updateKpGain('z', e.target.value)} isInvalid={parseGainValue(kpGain.z) === null} />
              </Col>
            </Row>

            <div className="serial-subsection-title mb-2">D Gain</div>
            <Row className="g-2 align-items-end mb-3">
              <Col xs={4}>
                <Form.Label className="serial-mini-label">Kd X</Form.Label>
                <Form.Control size="sm" type="number" min={ATTITUDE_GAIN_MIN} max={ATTITUDE_GAIN_MAX} step={ATTITUDE_GAIN_STEP} value={kdGain.x} onChange={(e) => updateKdGain('x', e.target.value)} isInvalid={parseGainValue(kdGain.x) === null} />
              </Col>
              <Col xs={4}>
                <Form.Label className="serial-mini-label">Kd Y</Form.Label>
                <Form.Control size="sm" type="number" min={ATTITUDE_GAIN_MIN} max={ATTITUDE_GAIN_MAX} step={ATTITUDE_GAIN_STEP} value={kdGain.y} onChange={(e) => updateKdGain('y', e.target.value)} isInvalid={parseGainValue(kdGain.y) === null} />
              </Col>
              <Col xs={4}>
                <Form.Label className="serial-mini-label">Kd Z</Form.Label>
                <Form.Control size="sm" type="number" min={ATTITUDE_GAIN_MIN} max={ATTITUDE_GAIN_MAX} step={ATTITUDE_GAIN_STEP} value={kdGain.z} onChange={(e) => updateKdGain('z', e.target.value)} isInvalid={parseGainValue(kdGain.z) === null} />
              </Col>
            </Row>

            {gainInputInvalid ? (
              <Alert variant="warning" className="py-2">
                Gains must be finite numbers from 0.000 to 10.000.
              </Alert>
            ) : null}
            {gainStatus ? <div className="server-small-note mb-2">{gainStatus}</div> : null}

            <CommandGroup>
              <CommandButton label="Send Kp" onClick={() => sendAttitudeKp()} disabled={commandDisabled || !kpValues} />
              <CommandButton label="Send Kd" onClick={() => sendAttitudeKd()} disabled={commandDisabled || !kdValues} />
              <CommandButton label="Send Kp + Kd" onClick={sendAttitudeGains} disabled={commandDisabled || gainInputInvalid} />
              <CommandButton label="Reset to Default" onClick={resetAttitudeGains} disabled={adminLocked} />
            </CommandGroup>
          </CommandAccordionItem>

          <CommandAccordionItem eventKey="stream" title="EBIMU Stream">
            <div className="mb-3">
              <ValueGrid
                title="Default IMU Setting"
                rows={[
                  { label: 'Magnetometer', value: 'OFF' },
                  { label: 'Gyro Range', value: '500 dps' },
                ]}
              />
              <div className="server-small-note mt-2">
                Default is selected from current Cubli experiment stability.
              </div>
            </div>
            <CommandGroup>
              <CommandButton label="Apply Default Setting" onClick={applyDefaultImuSetting} disabled={commandDisabled} />
              <CommandButton label="EBIMU Start" onClick={() => sendEbimuRuntime(EBIMU_COMMANDS.START, 0, 'EBIMU Start')} disabled={commandDisabled} />
              <CommandButton label="EBIMU Stop" onClick={() => sendEbimuRuntime(EBIMU_COMMANDS.STOP, 0, 'EBIMU Stop')} disabled={commandDisabled} />
            </CommandGroup>
          </CommandAccordionItem>

          <CommandAccordionItem eventKey="mag" title="Magnetometer">
            <CommandGroup>
              {MAG_OPTIONS.map((item) => (
                <CommandButton key={item.label} label={`Mag ${item.label}`} onClick={() => sendEbimuRuntime(EBIMU_COMMANDS.MAG_MODE, item.value, `Mag ${item.label}`)} disabled={commandDisabled} />
              ))}
            </CommandGroup>
          </CommandAccordionItem>

          <CommandAccordionItem eventKey="gyro" title="Gyro Range">
            <CommandGroup>
              {GYRO_OPTIONS.map((value) => (
                <CommandButton key={value} label={`${value} dps`} onClick={() => sendEbimuRuntime(EBIMU_COMMANDS.GYRO_DPS, value, `${value} dps`)} disabled={commandDisabled} />
              ))}
            </CommandGroup>
          </CommandAccordionItem>

          <CommandAccordionItem eventKey="accel" title="Accelerometer">
            <div className="serial-subsection-title mb-2">Range</div>
            <CommandGroup>
              {ACCEL_OPTIONS.map((value) => (
                <CommandButton key={value} label={`${value} g`} onClick={() => sendEbimuRuntime(EBIMU_COMMANDS.ACCEL_G, value, `${value} g`)} disabled={commandDisabled} />
              ))}
            </CommandGroup>

            <div className="serial-subsection-title mt-3 mb-2">Filter Factor</div>
            <Row className="g-2 align-items-end mb-2">
              <Col xs={7}>
                <Form.Control size="sm" type="number" min="1" max="50" value={accFactor} onChange={(e) => setAccFactor(e.target.value)} />
              </Col>
              <Col xs={5}>
                <Button variant="outline-light" className="w-100" disabled={commandDisabled} onClick={() => sendEbimuRuntime(EBIMU_COMMANDS.ACCEL_FACTOR, Number(accFactor) || 10, 'Accel Filter Factor')}>
                  Apply
                </Button>
              </Col>
            </Row>
            <CommandGroup>
              {FILTER_PRESETS.map((value) => (
                <CommandButton key={value} label={`${value}`} onClick={() => sendEbimuRuntime(EBIMU_COMMANDS.ACCEL_FACTOR, value, `Filter Factor ${value}`)} disabled={commandDisabled} />
              ))}
            </CommandGroup>
          </CommandAccordionItem>

          <CommandAccordionItem eventKey="receiver" title="Receiver Info">
            <CommandGroup>
              <CommandButton label="Status" onClick={() => { emitCommandEvent('RECEIVER_INFO', 'Status'); serial.sendCommand?.('STATUS?'); }} disabled={commandDisabled} />
              <CommandButton label="MAC Info" onClick={() => { emitCommandEvent('RECEIVER_INFO', 'MAC Info'); serial.sendCommand?.('MAC?'); }} disabled={commandDisabled} />
              <CommandButton label="Clear Stats" onClick={() => { emitCommandEvent('CLEAR_STATS', 'Clear Serial Stats'); serial.clearStats(); }} disabled={adminLocked} />
            </CommandGroup>
          </CommandAccordionItem>
        </Accordion>
      </div>
      ) : null}

      <TelemetryDataView
        latest={latest}
        status={{
          ...serial,
          latestPacket: latest,
          lastCommand: serial.lastCommand,
        }}
        isAdmin={isAdmin}
        storageKey="cubliAdminSerialDataView"
      />

      <div className="serial-control-card rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
            <div>
              <div className="serial-section-title">CSV Logging</div>
              <div className="server-small-note">CSV mode: Save every valid Serial sample</div>
              <div className="server-small-note">Estimated logging rate: {formatNumber(csvLoggedHz || csvStats.rateHz, 1)} Hz</div>
              <div className="server-small-note">{CSV_LOG_NOTE}</div>
            </div>
            <Badge bg={csvLogging ? 'success' : 'secondary'}>{csvSampleCount}</Badge>
        </div>
        <div className="server-small-note mb-2">
          Elapsed {formatDuration(csvElapsedMs)} / total {csvStats.total} / TEL+IMU {csvStats.telemetry} / ENC {csvStats.enc}
        </div>
        <Row className="g-2">
          <Col xs={6} md={3}>
            <Button variant="outline-info" className="w-100" onClick={startCsvLogging} disabled={csvLogging}>
              Start CSV Logging
            </Button>
          </Col>
          <Col xs={6} md={3}>
            <Button variant="outline-warning" className="w-100" onClick={stopCsvLogging} disabled={!csvLogging}>
              Stop Logging
            </Button>
          </Col>
          <Col xs={12} md={2}>
            <Button variant="outline-light" className="w-100" onClick={() => downloadCsv('combined')} disabled={!csvLogging && csvSampleCount === 0}>
              Download Combined CSV
            </Button>
          </Col>
          <Col xs={6} md={2}>
            <Button variant="outline-light" className="w-100" onClick={() => downloadCsv('telemetry')} disabled={!csvLogging && csvStats.telemetry === 0}>
              Download Telemetry CSV
            </Button>
          </Col>
          <Col xs={6} md={2}>
            <Button variant="outline-light" className="w-100" onClick={() => downloadCsv('encoder')} disabled={!csvLogging && csvStats.enc === 0}>
              Download Encoder CSV
            </Button>
          </Col>
        </Row>
      </div>

      <div className="serial-control-card rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="serial-section-title">Monitor</div>
          <Form.Check type="switch" id="show-serial-monitor" label="Show" checked={showMonitor} onChange={(e) => setShowMonitor(e.target.checked)} />
        </div>
        {showMonitor ? <div className="serial-note-visible text-break">Last raw line: {serial.lastRawLine || '-'}</div> : null}
      </div>

      {parserNote ? <Alert variant="warning" className="py-2">Parser note: {parserNote}</Alert> : null}
    </div>
  );
}
