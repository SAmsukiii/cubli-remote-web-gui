import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, Alert, Badge, Button, Col, Form, Row } from 'react-bootstrap';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  CSV_LOG_NOTE,
  DEFAULT_CSV_LOG_COLUMNS,
  appendCsvLogSample,
  csvRowFromPacket,
  detectSampleType,
  finalizeCsvLogRows,
} from './csvLogUtils';
import { eulerDegToQuat, normalizeEulerSequence } from './telemetryNormalize';
import TelemetryDataView from './TelemetryDataView';

const MAG_OPTIONS = [
  { label: 'Mag Off', commandKey: 'magOff' },
  { label: 'Mag On', commandKey: 'magOn' },
  { label: 'Mag Auto', commandKey: 'magAuto' },
];

const GYRO_OPTIONS = [
  { label: '250 dps', commandKey: 'gyro250' },
  { label: '500 dps', commandKey: 'gyro500' },
  { label: '1000 dps', commandKey: 'gyro1000' },
  { label: '2000 dps', commandKey: 'gyro2000' },
];
const ACCEL_OPTIONS = [
  { label: '2 g', commandKey: 'acc2g' },
  { label: '4 g', commandKey: 'acc4g' },
  { label: '8 g', commandKey: 'acc8g' },
  { label: '16 g', commandKey: 'acc16g' },
];
const FILTER_PRESETS = [1, 5, 10, 20, 50];
const DEFAULT_WEB_APP_URL = 'https://cubli-remote-web-gui-920k.onrender.com/';
const EULER_SEQUENCE_OPTIONS = ['ZYX', 'XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY'];
const ATTITUDE_GAIN_DEFAULTS = {
  kp: { x: '0.040', y: '0.040', z: '0.040' },
  kd: { x: '0.080', y: '0.080', z: '0.080' },
};
const ATTITUDE_GAIN_MIN = 0;
const ATTITUDE_GAIN_MAX = 10;
const ATTITUDE_GAIN_STEP = 0.001;
const WHEEL_RPM_COMMAND_MAX = 2500;
const WHEEL_RPM_MIN = -WHEEL_RPM_COMMAND_MAX;
const WHEEL_RPM_MAX = WHEEL_RPM_COMMAND_MAX;
const WHEEL_RPM_STEP = 10;
const LOG_COLUMNS = DEFAULT_CSV_LOG_COLUMNS;
const EMPTY_OBJECT = Object.freeze({});
const COMMAND_FEEDBACK_CLEAR_MS = 2600;

function formatDateTime(msOrIso) {
  if (!msOrIso) return '-';
  const date = typeof msOrIso === 'number' ? new Date(msOrIso) : new Date(msOrIso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('ko-KR', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + `.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function formatNumber(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toFixed(digits);
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '-';
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(Math.floor(value % 1000)).padStart(3, '0')}`;
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

function formatCommandParams(params) {
  if (!params || typeof params !== 'object') return '-';
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return '-';
  return entries.map(([key, value]) => `${key}=${value}`).join(', ');
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

function readGainTriplet(values = {}) {
  const x = parseGainValue(values.x);
  const y = parseGainValue(values.y);
  const z = parseGainValue(values.z);
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

function parseWheelRpmValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < WHEEL_RPM_MIN || number > WHEEL_RPM_MAX) return null;
  return Math.round(number);
}

function readWheelRpmTriplet(values = {}) {
  const x = parseWheelRpmValue(values.x);
  const y = parseWheelRpmValue(values.y);
  const z = parseWheelRpmValue(values.z);
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

function signedNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function buildTargetPreview(values = {}, sequence = 'ZYX') {
  const inputRoll = Number(values.roll) || 0;
  const inputPitch = Number(values.pitch) || 0;
  const inputYaw = Number(values.yaw) || 0;
  const safeSequence = normalizeEulerSequence(sequence, 'ZYX');
  const commandRoll = signedNumber(inputRoll);
  const commandPitch = signedNumber(inputPitch);
  const commandYaw = signedNumber(inputYaw);
  const qd = eulerDegToQuat(commandRoll, commandPitch, commandYaw, safeSequence) || [1, 0, 0, 0];
  return {
    inputRoll,
    inputPitch,
    inputYaw,
    commandRoll,
    commandPitch,
    commandYaw,
    sequence: safeSequence,
    qd,
  };
}

function statusVariant(status) {
  if (status === 'connected') return 'success';
  if (status === 'testing') return 'info';
  if (status === 'error') return 'danger';
  return 'secondary';
}

function roleVariant(role) {
  if (role === 'admin') return 'primary';
  if (role === 'controller') return 'success';
  return 'secondary';
}

function shortClientId(clientId = '') {
  const text = String(clientId || '').trim();
  return text ? text.slice(0, 8) : '-';
}

function shortSessionId(sessionId = '') {
  const text = String(sessionId || '').trim();
  return text ? text.slice(-12) : '-';
}

function formatAgeMs(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '-';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
}

function formatFixedMs(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '---- ms';
  return `${String(Math.round(value)).padStart(4, '0')} ms`;
}

function publisherLabel(publisher = {}) {
  const safePublisher = publisher || {};
  const name = String(safePublisher.displayName || safePublisher.publisherName || '').trim();
  const idShort = safePublisher.clientIdShort || shortClientId(safePublisher.clientId);
  if (name && idShort && idShort !== '-') return `${name} (${idShort})`;
  return name || idShort || '-';
}

function clientDisplayName(client = {}) {
  const safeClient = client || {};
  return String(safeClient?.displayName || safeClient?.clientName || '').trim();
}

function clientLabel(client = {}) {
  const safeClient = client || {};
  const fallbackId = shortClientId(safeClient?.clientId);
  return clientDisplayName(safeClient) || (fallbackId === '-' ? 'Unknown' : fallbackId);
}

function getWebAppUrl() {
  if (typeof window !== 'undefined') {
    const hostname = String(window.location.hostname || '').toLowerCase();
    if (hostname === 'onrender.com' || hostname.endsWith('.onrender.com')) {
      return `${window.location.origin.replace(/\/+$/, '')}/`;
    }
  }
  return DEFAULT_WEB_APP_URL;
}

function getWebAppDisplayUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return String(url || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

function findClient(access = {}, clientId = '') {
  const safeAccess = access || {};
  const targetClientId = String(clientId || '').trim();
  if (!targetClientId) return null;
  const clients = Array.isArray(safeAccess?.clients) ? safeAccess.clients.filter(Boolean) : [];
  return clients.find((client) => client?.clientId === targetClientId) || null;
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

function packetToCsvRow(packet) {
  return csvRowFromPacket(packet, LOG_COLUMNS);
}

function filterCsvRows(rows = [], kind = 'telemetry') {
  if (kind === 'telemetry') return rows.filter((row) => ['TEL', 'IMU'].includes(detectSampleType(row)));
  if (kind === 'encoder') return rows.filter((row) => detectSampleType(row) === 'ENC');
  return [];
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

function ValueRow({ label, value }) {
  return (
    <div className="serial-value-row d-flex justify-content-between gap-2">
      <span style={{ minWidth: 0 }}>{label}</span>
      <strong style={{ minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word', textAlign: 'right' }}>{value}</strong>
    </div>
  );
}

function ValueGrid({ title, rows }) {
  return (
    <div className="serial-value-card rounded p-2">
      <div className="serial-section-title mb-2">{title}</div>
      {rows.map((row) => <ValueRow key={row.label} label={row.label} value={row.value} />)}
    </div>
  );
}

function WheelSpeedChart({ title, data, rpmKey, commandKey }) {
  const hasData = Array.isArray(data) && data.some((row) => row[rpmKey] != null || row[commandKey] != null);
  return (
    <div className="serial-value-card rounded p-2">
      <div className="serial-section-title mb-2">{title}</div>
      <div style={{ width: '100%', minHeight: 180, height: 180 }}>
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#26313a" strokeDasharray="3 3" />
              <XAxis dataKey="sample" tick={{ fill: '#adb5bd', fontSize: 11 }} />
              <YAxis tick={{ fill: '#adb5bd', fontSize: 11 }} width={44} />
              <Tooltip contentStyle={{ background: '#111418', border: '1px solid #2a3138', color: '#f8fafc' }} />
              <Line type="monotone" dataKey={rpmKey} stroke="#4dabf7" strokeWidth={2} dot={false} isAnimationActive={false} name={rpmKey} />
              <Line type="monotone" dataKey={commandKey} stroke="#ffd43b" strokeWidth={2} dot={false} isAnimationActive={false} name={commandKey} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="server-small-note d-flex align-items-center h-100">No plot data yet</div>
        )}
      </div>
    </div>
  );
}

function LiveTelemetryChart({ title, data, lines, yLabel = '' }) {
  const hasData = Array.isArray(data) && data.some((row) =>
    lines.some((line) => row[line.key] !== null && row[line.key] !== undefined)
  );

  return (
    <div className="serial-value-card rounded p-2">
      <div className="d-flex justify-content-between align-items-center mb-2 gap-2">
        <div className="serial-section-title">{title}</div>
        {yLabel ? <div className="server-small-note">{yLabel}</div> : null}
      </div>
      <div style={{ width: '100%', minHeight: 220, height: 220 }}>
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#26313a" strokeDasharray="3 3" />
              <XAxis dataKey="sample" tick={{ fill: '#adb5bd', fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#adb5bd', fontSize: 11 }} width={48} />
              <Tooltip contentStyle={{ background: '#111418', border: '1px solid #2a3138', color: '#f8fafc' }} />
              <Legend wrapperStyle={{ color: '#dbe4ea', fontSize: 12 }} />
              {lines.map((line) => (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  stroke={line.stroke}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                  name={line.name || line.key}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="server-small-note d-flex align-items-center h-100">
            No plot data yet. Start Admin Web Serial Bridge sharing and wait for live packets.
          </div>
        )}
      </div>
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

function commandFeedbackMessage(status, reason = '') {
  if (status === 'success') return '송신 완료!';
  const cleanReason = String(reason || '').trim() || 'unknown error';
  return `송신 실패: ${cleanReason}`;
}

function CommandFeedback({ feedback }) {
  const status = feedback?.status || '';
  return (
    <div
      className={`command-feedback ${status ? `command-feedback-${status}` : 'command-feedback-empty'}`}
      aria-live="polite"
    >
      {feedback?.message || ''}
    </div>
  );
}

function CommandAccordionItem({ eventKey, title, children }) {
  return (
    <Accordion.Item eventKey={eventKey} className="command-accordion-item">
      <Accordion.Header>{title}</Accordion.Header>
      <Accordion.Body>{children}</Accordion.Body>
    </Accordion.Item>
  );
}

function IdentitySection({ serverSync, role, onChangeDisplayName }) {
  const safeServerSync = serverSync || {};
  const displayName = String(safeServerSync?.displayName || safeServerSync?.clientName || '').trim() || 'Unnamed';
  const roleText = String(role || 'viewer').toUpperCase();

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="d-flex justify-content-between align-items-start gap-2">
        <div className="text-break">
          <div className="serial-section-title">You are</div>
          <div className="fs-6 fw-bold">{displayName} / {roleText}</div>
        </div>
        <div className="d-grid gap-2">
          <Badge bg={roleVariant(role)}>{roleText}</Badge>
          <Button variant="outline-info" size="sm" onClick={onChangeDisplayName} disabled={!onChangeDisplayName}>
            Change Name
          </Button>
        </div>
      </div>
    </div>
  );
}

function AdminLoginSection({ serverSync, role }) {
  const safeServerSync = serverSync || {};
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [adminId, setAdminId] = useState('');
  const [password, setPassword] = useState('');
  const isAdmin = role === 'admin';
  const roleText = String(role || 'viewer');

  const handleLogin = async () => {
    const ok = await safeServerSync.loginAdmin?.({ adminId, password });
    if (ok) {
      setPassword('');
      setShowLoginForm(false);
    }
  };

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
        <div>
          <div className="serial-section-title">Login</div>
        </div>
        <Badge bg={roleVariant(roleText)}>{roleText.toUpperCase()}</Badge>
      </div>

      <div className="d-grid gap-2">
        {isAdmin ? (
          <Button variant="outline-warning" onClick={safeServerSync.logoutAdmin}>
            Logout Admin
          </Button>
        ) : (
          <Button variant="outline-light" onClick={() => setShowLoginForm((value) => !value)}>
            {showLoginForm ? 'Hide Admin Login' : 'Admin Login'}
          </Button>
        )}
      </div>

      {!isAdmin && showLoginForm ? (
        <div className="mt-3">
          <Row className="g-2 align-items-end">
            <Col xs={12} md={5}>
              <Form.Label className="serial-mini-label">Admin ID</Form.Label>
              <Form.Control
                size="sm"
                value={adminId}
                onChange={(event) => setAdminId(event.target.value)}
                autoComplete="username"
              />
            </Col>
            <Col xs={12} md={5}>
              <Form.Label className="serial-mini-label">Admin PW</Form.Label>
              <Form.Control
                size="sm"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </Col>
            <Col xs={12} md={2}>
              <Button variant="outline-info" className="w-100" onClick={handleLogin} disabled={!adminId || !password}>
                Login
              </Button>
            </Col>
          </Row>
          {safeServerSync.lastError ? <Alert variant="danger" className="mt-3 mb-0 py-2">{safeServerSync.lastError}</Alert> : null}
        </div>
      ) : null}
    </div>
  );
}

function ServerConnectionSection({ serverSync }) {
  const safeServerSync = serverSync || {};
  const webAppUrl = getWebAppUrl();
  const webAppDisplayUrl = getWebAppDisplayUrl(webAppUrl);
  const copyWebAppLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(webAppUrl).catch(() => {});
    }
  };
  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="serial-section-title mb-2">Connection</div>
      <div className="serial-value-card rounded p-2 mb-3">
        <div className="serial-value-row d-flex justify-content-between gap-2 align-items-start">
          <span>Web App</span>
          <strong style={{ minWidth: 0, textAlign: 'right', overflowWrap: 'anywhere', wordBreak: 'break-all', fontSize: '0.78rem' }}>
            {webAppDisplayUrl}
          </strong>
        </div>
        <div className="d-flex gap-2 mt-2 flex-wrap">
          <Button variant="outline-info" size="sm" href={webAppUrl} target="_blank" rel="noreferrer">
            Open
          </Button>
          <Button variant="outline-light" size="sm" onClick={copyWebAppLink}>
            Copy
          </Button>
        </div>
      </div>
      <Form.Group className="mb-3">
        <Form.Label className="serial-mini-label">Server URL</Form.Label>
        <Form.Control
          size="sm"
          type="text"
          value={safeServerSync.serverUrl || ''}
          onChange={(event) => safeServerSync.setServerUrl?.(event.target.value)}
          placeholder="Server URL"
        />
      </Form.Group>

      <div className="d-grid gap-2">
        <Button variant="outline-info" onClick={safeServerSync.testConnection} disabled={safeServerSync.connectionStatus === 'testing'}>
          Test Connection
        </Button>
      </div>

      {safeServerSync.lastError ? <Alert variant="danger" className="mt-3 mb-0 py-2">{safeServerSync.lastError}</Alert> : null}
    </div>
  );
}

function RoleNotice({ role }) {
  if (role === 'controller') {
    return <Alert variant="success" className="py-2">Controller mode: command permission granted by Admin.</Alert>;
  }
  if (role === 'viewer') {
    return (
      <Alert variant="secondary" className="py-2">
        Viewer mode: monitoring only. Command panel appears only when Admin grants control permission.
      </Alert>
    );
  }
  return null;
}

function RpyConventionSection({ serverSync }) {
  const safeServerSync = serverSync || {};
  const imuSequence = safeServerSync.imuEulerSequence || 'ZYX';
  const encoderSequence = safeServerSync.encoderEulerSequence || 'ZYX';
  const encoderAngleSequence = safeServerSync.encoderAngleToQuatSequence || 'ZYX';

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="serial-section-title mb-2">RPY Display Convention</div>
      <div className="server-small-note mb-3">
        RPY is display-only. 3D rendering still uses quaternion. Changing sequence changes displayed Euler angles only.
      </div>
      <Row className="g-2">
        <Col xs={12} md={6}>
          <Form.Label className="serial-mini-label">IMU RPY Sequence</Form.Label>
          <Form.Select
            size="sm"
            value={imuSequence}
            onChange={(event) => safeServerSync.setImuEulerSequence?.(event.target.value)}
          >
            {EULER_SEQUENCE_OPTIONS.map((sequence) => (
              <option key={sequence} value={sequence}>{sequence}</option>
            ))}
          </Form.Select>
        </Col>
        <Col xs={12} md={6}>
          <Form.Label className="serial-mini-label">Gimbal Encoder RPY Sequence</Form.Label>
          <Form.Select
            size="sm"
            value={encoderSequence}
            onChange={(event) => safeServerSync.setEncoderEulerSequence?.(event.target.value)}
          >
            {EULER_SEQUENCE_OPTIONS.map((sequence) => (
              <option key={sequence} value={sequence}>{sequence}</option>
            ))}
          </Form.Select>
        </Col>
      </Row>
      <div className="server-small-note mt-2">
        Current RPY [{imuSequence}] · Source: IMU/TEL quaternion · 3D source: quaternion q0~q3 · Encoder source: Gimbal rotary encoder [{encoderSequence}].
      </div>
      <div className="serial-subsection-title mt-3 mb-2">Gimbal Encoder Reference Convention</div>
      <div className="server-small-note mb-2">
        This converts gimbal rotary encoder X/Y/Z angles into a reference quaternion. It does not change IMU attitude rendering.
      </div>
      <Row className="g-2">
        <Col xs={12} md={6}>
          <Form.Label className="serial-mini-label">Sequence</Form.Label>
          <Form.Select
            size="sm"
            value={encoderAngleSequence}
            onChange={(event) => safeServerSync.setEncoderAngleToQuatSequence?.(event.target.value)}
          >
            {EULER_SEQUENCE_OPTIONS.map((sequence) => (
              <option key={sequence} value={sequence}>{sequence}</option>
            ))}
          </Form.Select>
        </Col>
      </Row>
    </div>
  );
}

const VISUAL_MIRROR_LABELS = {
  current: 'Current',
  mirrorX: 'Mirror X',
  mirrorY: 'Mirror Y',
  mirrorZ: 'Mirror Z',
  mirrorXY: 'Mirror XY',
  mirrorXZ: 'Mirror XZ',
  mirrorYZ: 'Mirror YZ',
  mirrorXYZ: 'Mirror XYZ',
};

function mirrorLabel(value) {
  return VISUAL_MIRROR_LABELS[value] || 'Current';
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function VisualSettingsSummary({ serverSync }) {
  const safeServerSync = serverSync || {};
  const settings = safeServerSync.visualSettings || {};
  const wheelMirrors = ['X', 'Y', 'Z']
    .filter((axis) => settings[`wheelMirror${axis}`])
    .join(', ') || 'None';
  const rows = [
    { label: 'Shared by server', value: 'Admin visual settings' },
    { label: 'Wheel mirror', value: wheelMirrors },
    { label: 'Reference frame arrows', value: mirrorLabel(settings.referenceFrameMirror) },
    { label: 'Cubli body frame arrows', value: mirrorLabel(settings.bodyFrameMirror) },
    { label: 'Cubli vertical flip', value: yesNo(settings.flipCubliVertical) },
    { label: 'Frame helpers', value: yesNo(settings.showFrameHelpers) },
    { label: 'Body axis length', value: settings.bodyAxisLength != null ? Math.round(settings.bodyAxisLength) : '-' },
    { label: 'Updated by', value: settings.updatedBy || '-' },
    { label: 'Updated at', value: formatDateTime(settings.updatedAt) },
  ];

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <ValueGrid title="Visual Settings" rows={rows} />
      <div className="server-small-note mt-2">
        Rendering-only transform. Telemetry q0~q3, RPY calculation, RPM, and commands are unchanged.
      </div>
    </div>
  );
}

function AdminManagementPanel({ serverSync, serial, status, access, role, controllerClientId, commandOwner }) {
  const [emergencyFeedback, setEmergencyFeedback] = useState(null);
  const emergencyFeedbackTimerRef = useRef(null);

  useEffect(() => () => {
    if (emergencyFeedbackTimerRef.current) window.clearTimeout(emergencyFeedbackTimerRef.current);
  }, []);

  const showEmergencyFeedback = (status, reason = '') => {
    const feedback = { status, message: commandFeedbackMessage(status, reason), at: Date.now() };
    setEmergencyFeedback(feedback);
    if (emergencyFeedbackTimerRef.current) window.clearTimeout(emergencyFeedbackTimerRef.current);
    emergencyFeedbackTimerRef.current = window.setTimeout(() => {
      setEmergencyFeedback((current) => (current?.at === feedback.at ? null : current));
    }, COMMAND_FEEDBACK_CLEAR_MS);
  };

  if (role !== 'admin') return null;

  const safeServerSync = serverSync || {};
  const safeSerial = serial || {};
  const safeStatus = status || {};
  const safeAccess = access || {};
  const clients = Array.isArray(safeAccess?.clients) ? safeAccess.clients.filter(Boolean) : [];
  const connectedClients = clients.filter((client) => client?.connected);
  const connectedViewers = connectedClients.filter((client) => !client?.isAdmin && client?.clientId !== safeServerSync?.clientId);
  const controllerClient = findClient(safeAccess, controllerClientId);
  const controllerName = safeAccess.controllerDisplayName || safeAccess.controllerClientName || clientDisplayName(controllerClient) || '';
  const controllerValue = controllerClientId
    ? `${controllerName || shortClientId(controllerClientId)} (${shortClientId(controllerClientId)})`
    : '-';
  const activePublisher = safeStatus.activePublisher
    || safeServerSync.activePublisher
    || safeAccess.activePublisher
    || safeStatus.bridge?.activePublisher
    || null;
  const activePublisherStatus = safeStatus.activePublisherStatus
    || safeServerSync.activePublisherStatus
    || safeAccess.activePublisherStatus
    || safeStatus.bridge?.activePublisherStatus
    || activePublisher?.status
    || 'NONE';
  const heartbeatAgeMs = safeStatus.activePublisherHeartbeatAgeMs
    ?? safeServerSync.activePublisherHeartbeatAgeMs
    ?? safeAccess.activePublisherHeartbeatAgeMs
    ?? safeStatus.bridge?.activePublisherHeartbeatAgeMs
    ?? activePublisher?.heartbeatAgeMs
    ?? null;
  const publishSession = safeStatus.publishSessionId
    || safeServerSync.publishSessionId
    || activePublisher?.sessionId
    || activePublisher?.sessionIdShort
    || '';
  const myName = String(safeServerSync?.displayName || safeServerSync?.clientName || safeAccess?.displayName || safeAccess?.clientName || '').trim()
    || shortClientId(safeServerSync?.clientId)
    || 'Unnamed';
  const bridgeLive = Boolean(safeStatus.bridge?.adminBridgeLive);

  const adminCommandFailureReason = () => {
    if (!bridgeLive) return 'Admin bridge is not publishing';
    return safeSerial.getLastCommandRequestError?.()
      || safeStatus.lastError
      || safeSerial.status?.lastError
      || 'server command queue request failed';
  };

  const handleAdminEmergencyStop = async () => {
    try {
      const ok = await safeSerial.sendEmergencyStop?.();
      if (ok) showEmergencyFeedback('success');
      else showEmergencyFeedback('error', adminCommandFailureReason());
      return Boolean(ok);
    } catch (error) {
      showEmergencyFeedback('error', error?.message || adminCommandFailureReason());
      return false;
    }
  };

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="serial-section-title mb-3">Admin Management</div>

      <div className="serial-value-card rounded p-2 mb-3">
        <ValueRow label="My role" value="Admin" />
        <ValueRow label="My name" value={`${myName} (me)`} />
        <ValueRow label="My clientId" value={shortClientId(safeServerSync.clientId)} />
        <ValueRow label="Current controller" value={controllerValue} />
        <ValueRow label="Command owner" value={commandOwner} />
        <ValueRow label="Active publisher" value={activePublisherStatus === 'NONE' ? 'NONE' : publisherLabel(activePublisher)} />
        <ValueRow label="Publisher heartbeat age" value={formatAgeMs(heartbeatAgeMs)} />
        <ValueRow label="Publisher status" value={activePublisherStatus} />
        <ValueRow label="Publish session" value={shortSessionId(publishSession)} />
        <ValueRow label="Connected clients" value={safeAccess.connectedClientCount ?? connectedClients.length} />
      </div>

      <Alert variant="warning" className="py-2">
        Use only when another Admin bridge is stale or interfering.
      </Alert>

      <Button
        variant="outline-danger"
        className="w-100 mb-3 fw-bold"
        onClick={safeSerial.forceTakeOverPublisher || safeServerSync.forceTakeOverPublisher}
        disabled={!safeSerial.forceTakeOverPublisher && !safeServerSync.forceTakeOverPublisher}
      >
        Force Take Over Publisher
      </Button>

      <Button
        variant="danger"
        size="lg"
        className="w-100 mb-3 fw-bold"
        onClick={handleAdminEmergencyStop}
        disabled={!bridgeLive}
      >
        Emergency Stop
      </Button>
      <CommandFeedback feedback={emergencyFeedback} />

      <Accordion className="command-accordion" flush>
        <Accordion.Item eventKey="clients" className="command-accordion-item">
          <Accordion.Header>Client List / Viewer List</Accordion.Header>
          <Accordion.Body>
            {connectedViewers.length === 0 ? (
              <div className="server-small-note mb-2">No viewers connected.</div>
            ) : null}

            <div className="d-grid gap-2">
              {connectedClients.map((client, index) => {
                const effectiveRole = String(client?.effectiveRole || client?.role || 'viewer').toLowerCase();
                const isMe = client?.clientId === safeServerSync?.clientId || Boolean(client?.isMe);
                const canGrant = !isMe && !client?.isAdmin && effectiveRole !== 'controller' && Boolean(client?.connected && client?.clientId);
                const canRevoke = !isMe && Boolean(client?.isController);
                const name = clientLabel(client);
                const idShort = shortClientId(client?.clientId);
                const statusText = client?.connected ? 'connected' : 'stale';

                return (
                  <div key={client?.clientId || `client-${index}`} className="serial-value-card rounded p-2">
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div className="text-break">
                        <strong className="d-block fs-6">{name}{isMe ? ' (me)' : ''}</strong>
                        <div className="server-small-note">clientId: {idShort}</div>
                        <div className="d-flex flex-wrap align-items-center gap-1 mt-1">
                          <Badge bg={roleVariant(effectiveRole)}>{effectiveRole}</Badge>
                          <Badge bg={client?.connected ? 'success' : 'secondary'}>{statusText}</Badge>
                          <span className="server-small-note">lastSeen {formatDateTime(client?.lastSeen || client?.lastSeenAt)}</span>
                        </div>
                        {client?.source || client?.page ? (
                          <div className="server-small-note">source: {client?.source || '-'} | page: {client?.page || '-'}</div>
                        ) : null}
                      </div>
                      {!client?.isAdmin ? (
                        <div className="d-grid gap-1">
                          {canRevoke ? (
                            <Button variant="outline-warning" size="sm" onClick={safeSerial.revokeControl}>
                              Revoke Control from {name}
                            </Button>
                          ) : (
                            <Button variant="outline-info" size="sm" onClick={() => safeSerial.grantControl?.(client?.clientId)} disabled={!canGrant}>
                              Grant Control to {name}
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>

      <Row className="g-2 mt-3">
        <Col xs={6}>
          <Button variant="outline-warning" className="w-100" onClick={safeSerial.revokeControl} disabled={!controllerClientId}>
            Revoke Control
          </Button>
        </Col>
        <Col xs={6}>
          <Button variant="outline-secondary" className="w-100" onClick={safeSerial.resetAccessState}>
            Reset Server State
          </Button>
        </Col>
      </Row>

      {safeStatus.lastError ? <Alert variant="danger" className="mt-3 mb-0 py-2 text-break">{safeStatus.lastError}</Alert> : null}
    </div>
  );
}

function CommandSection({ serial, status, role, controllerClientId, isController, localSerial }) {
  const safeSerial = serial || {};
  const safeStatus = status || {};
  const safeLocalSerial = localSerial || {};
  const [targetRoll, setTargetRoll] = useState(0);
  const [targetPitch, setTargetPitch] = useState(0);
  const [targetYaw, setTargetYaw] = useState(0);
  const [accFactor, setAccFactor] = useState(10);
  const [kpGain, setKpGain] = useState(ATTITUDE_GAIN_DEFAULTS.kp);
  const [kdGain, setKdGain] = useState(ATTITUDE_GAIN_DEFAULTS.kd);
  const [gainStatus, setGainStatus] = useState('');
  const [rpmCommand, setRpmCommand] = useState({ x: '0', y: '0', z: '0' });
  const [rpmStatus, setRpmStatus] = useState('');
  const [localCommand, setLocalCommand] = useState('');
  const [lastCommandFeedbackByCategory, setLastCommandFeedbackByCategory] = useState({});
  const commandFeedbackTimersRef = useRef({});

  const isAdmin = role === 'admin';
  const canViewCommand = isAdmin || isController;
  const bridge = safeStatus.bridge || safeSerial.bridge || {};
  const bridgeLive = Boolean(bridge.adminBridgeLive);
  const canSendCommand = bridgeLive && (isController || (isAdmin && !controllerClientId));
  const adminDelegated = isAdmin && controllerClientId;
  const lastBridgeCommand = bridge.lastBridgeCommand || safeStatus.lastBridgeCommand || safeSerial.lastBridgeCommand || null;
  const commandWaiting = lastBridgeCommand && (lastBridgeCommand.status === 'pending' || lastBridgeCommand.status === 'dispatching');
  const kpValues = readGainTriplet(kpGain);
  const kdValues = readGainTriplet(kdGain);
  const gainInputInvalid = !kpValues || !kdValues;
  const rpmValues = readWheelRpmTriplet(rpmCommand);
  const rpmInputInvalid = !rpmValues;
  const targetSequence = normalizeEulerSequence(safeSerial.targetRpySequence, 'ZYX');
  const targetPreview = buildTargetPreview(
    { roll: targetRoll, pitch: targetPitch, yaw: targetYaw },
    targetSequence
  );
  const latestPacket = safeStatus.latestPacket || safeStatus.latestSharedPacket || {};
  const currentRawYaw = latestPacket.rawYawDeg ?? latestPacket.yawRawDeg ?? latestPacket.remoteYawDeg;
  const qdPreviewText = targetPreview.qd.map((value) => formatNumber(value, 6)).join(', ');
  const localWriterReady = Boolean(safeLocalSerial.serialWriterReady);
  const localSerialConnected = Boolean(safeLocalSerial.isConnected);
  const canSendLocalCommand = isAdmin && localSerialConnected && localWriterReady && typeof safeLocalSerial.sendLine === 'function';
  const lastRemoteAckErr = /^(ACK|ERR|ERROR|OK|WARN|PONG)(?:,|\s|$)/i.test(String(safeLocalSerial.lastRawLine || ''))
    ? safeLocalSerial.lastRawLine
    : '-';

  useEffect(() => () => {
    Object.values(commandFeedbackTimersRef.current).forEach((timer) => window.clearTimeout(timer));
  }, []);

  if (!canViewCommand) return null;

  const showCommandFeedback = (category, status, reason = '') => {
    const feedback = { status, message: commandFeedbackMessage(status, reason), at: Date.now() };
    setLastCommandFeedbackByCategory((prev) => ({ ...prev, [category]: feedback }));
    if (commandFeedbackTimersRef.current[category]) {
      window.clearTimeout(commandFeedbackTimersRef.current[category]);
    }
    commandFeedbackTimersRef.current[category] = window.setTimeout(() => {
      setLastCommandFeedbackByCategory((prev) => {
        if (prev[category]?.at !== feedback.at) return prev;
        const next = { ...prev };
        delete next[category];
        return next;
      });
      delete commandFeedbackTimersRef.current[category];
    }, COMMAND_FEEDBACK_CLEAR_MS);
  };

  const serverCommandFailureReason = () => {
    if (!bridgeLive) return 'Admin bridge is not publishing';
    if (adminDelegated) return 'control assigned to another user';
    if (!canSendCommand) return 'server command queue is not available';
    return safeSerial.getLastCommandRequestError?.()
      || safeStatus.lastError
      || safeSerial.status?.lastError
      || 'server command queue request failed';
  };

  const localCommandFailureReason = (fallback = 'writer not ready') => {
    if (!localSerialConnected) return 'Serial receiver is not connected';
    if (!localWriterReady) return 'writer not ready';
    return safeLocalSerial.getLastLocalWriteError?.()
      || safeLocalSerial.lastLocalWriteError
      || safeLocalSerial.error
      || fallback;
  };

  const runCommandWithFeedback = async (category, action, reasonGetter = serverCommandFailureReason) => {
    try {
      const ok = await action?.();
      if (ok) showCommandFeedback(category, 'success');
      else showCommandFeedback(category, 'error', reasonGetter());
      return Boolean(ok);
    } catch (error) {
      showCommandFeedback(category, 'error', error?.message || reasonGetter());
      return false;
    }
  };

  const sendShortcut = (commandKey, label, params = {}) => safeSerial.sendEbimuShortcut?.(commandKey, label, params);
  const sendAccFactor = (value) => safeSerial.sendAccFactor?.(Number(value) || 10);
  const sendLocalLines = async (lines, label = 'Local command') => {
    const normalizedLines = (Array.isArray(lines) ? lines : [lines])
      .map((line) => String(line || '').trim())
      .filter(Boolean);
    if (!canSendLocalCommand) {
      showCommandFeedback('localDirect', 'error', localCommandFailureReason());
      return false;
    }
    if (normalizedLines.length === 0) {
      showCommandFeedback('localDirect', 'error', 'command line is empty');
      return false;
    }
    for (const line of normalizedLines) {
      const ok = await safeLocalSerial.sendLine(line);
      if (!ok) {
        const reason = localCommandFailureReason(`Failed to send ${line}.`);
        showCommandFeedback('localDirect', 'error', reason);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    showCommandFeedback('localDirect', 'success');
    return true;
  };
  const sendLocalInput = async () => {
    const ok = await sendLocalLines(localCommand, 'Direct Web Serial command');
    if (ok) setLocalCommand('');
  };
  const applyDefaultImuSetting = async () => {
    const setupOk = await sendShortcut('ebimuDefault', 'EBIMU Default Setup');
    if (!setupOk) return false;
    const magOk = await sendShortcut('magOff', 'Default IMU Magnetometer Off');
    if (!magOk) return false;
    return Boolean(await sendShortcut('gyro500', 'Default IMU Gyro 500 dps'));
  };
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
  const sendAttitudeKp = async () => {
    const values = readGainTriplet(kpGain);
    if (!values) {
      setGainStatus('Kp gains must be finite numbers from 0.000 to 10.000.');
      return false;
    }
    const ok = await safeSerial.sendAttitudeKp?.(values.x, values.y, values.z);
    setGainStatus(ok ? 'Queued Attitude Kp for Admin Web Serial Bridge.' : 'Failed to queue Attitude Kp.');
    return Boolean(ok);
  };
  const sendAttitudeKd = async () => {
    const values = readGainTriplet(kdGain);
    if (!values) {
      setGainStatus('Kd gains must be finite numbers from 0.000 to 10.000.');
      return false;
    }
    const ok = await safeSerial.sendAttitudeKd?.(values.x, values.y, values.z);
    setGainStatus(ok ? 'Queued Attitude Kd for Admin Web Serial Bridge.' : 'Failed to queue Attitude Kd.');
    return Boolean(ok);
  };
  const sendAttitudeGains = async () => {
    const kp = readGainTriplet(kpGain);
    const kd = readGainTriplet(kdGain);
    if (!kp || !kd) {
      setGainStatus('All P/D gains must be finite numbers from 0.000 to 10.000.');
      return;
    }
    const kpOk = await safeSerial.sendAttitudeKp?.(kp.x, kp.y, kp.z);
    if (!kpOk) {
      setGainStatus('Failed to queue Attitude Kp. Kd was not sent.');
      return;
    }
    const kdOk = await safeSerial.sendAttitudeKd?.(kd.x, kd.y, kd.z);
    setGainStatus(kdOk ? 'Queued Attitude Kp and Kd for Admin Web Serial Bridge.' : 'Attitude Kp queued, but Kd failed.');
    return Boolean(kdOk);
  };
  const updateRpmCommand = (axis, value) => {
    setRpmCommand((prev) => ({ ...prev, [axis]: value }));
    setRpmStatus('');
  };
  const sendWheelRpmAxis = async (axis) => {
    const rpm = parseWheelRpmValue(rpmCommand[axis]);
    if (rpm === null) {
      setRpmStatus(`Wheel RPM must be between ${WHEEL_RPM_MIN} and ${WHEEL_RPM_MAX}.`);
      return false;
    }
    const methodName = axis === 'x' ? 'sendWheelRpmX' : (axis === 'y' ? 'sendWheelRpmY' : 'sendWheelRpmZ');
    const ok = await safeSerial[methodName]?.(rpm);
    setRpmStatus(ok ? `Queued Wheel RPM ${axis.toUpperCase()} (${rpm}) for Admin Web Serial Bridge.` : `Failed to queue Wheel RPM ${axis.toUpperCase()}.`);
    return Boolean(ok);
  };
  const sendWheelRpmAll = async () => {
    const values = readWheelRpmTriplet(rpmCommand);
    if (!values) {
      setRpmStatus(`Wheel RPM must be between ${WHEEL_RPM_MIN} and ${WHEEL_RPM_MAX}.`);
      return false;
    }
    const ok = await safeSerial.sendWheelRpmAll?.(values.x, values.y, values.z);
    setRpmStatus(ok ? `Queued Wheel RPM All (${values.x}, ${values.y}, ${values.z}) for Admin Web Serial Bridge.` : 'Failed to queue Wheel RPM All.');
    return Boolean(ok);
  };
  const stopWheelRpmTest = async () => {
    const ok = await safeSerial.sendWheelRpmStop?.();
    setRpmStatus(ok ? 'Queued Stop RPM Test for Admin Web Serial Bridge.' : 'Failed to queue Stop RPM Test.');
    return Boolean(ok);
  };

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="serial-section-title mb-1">Command</div>
      <div className="server-small-note mb-3">
        Commands are queued on the server and relayed by the Admin Web Serial Bridge.
      </div>
      {adminDelegated ? (
        <Alert variant="warning" className="py-2">
          Control is currently assigned to another user. Revoke control to operate as Admin.
        </Alert>
      ) : null}
      {!bridgeLive ? (
        <Alert variant="secondary" className="py-2">
          Admin bridge is not publishing. Waiting for Admin Web Serial Bridge.
        </Alert>
      ) : null}
      {commandWaiting ? (
        <Alert variant="info" className="py-2">
          Waiting for Admin bridge to relay command...
        </Alert>
      ) : null}

      <Accordion defaultActiveKey="control" flush alwaysOpen className="command-accordion">
        <CommandAccordionItem eventKey="control" title="Control">
          <div className="server-small-note mb-2">
            Initialize commands currently use the firmware TARE line until firmware-specific init commands are added.
          </div>
          <div className="server-small-note mb-2">
            Mode: Server Command Queue. Controller/Admin commands are queued on the server and relayed by the Admin bridge.
          </div>
          <CommandGroup>
            <CommandButton label="Cubli Initialize" onClick={() => runCommandWithFeedback('serverQueue', () => safeSerial.sendCubliInitialize?.())} disabled={!canSendCommand} />
            <CommandButton label="Gimbal Encoder Initialize" onClick={() => runCommandWithFeedback('serverQueue', () => safeSerial.sendEncoderInitialize?.())} disabled={!canSendCommand} />
            <CommandButton label="Set Zero / Tare" onClick={() => runCommandWithFeedback('serverQueue', () => safeSerial.sendTare?.())} disabled={!canSendCommand} />
            <CommandButton label="Stop" onClick={() => runCommandWithFeedback('serverQueue', () => safeSerial.sendStop?.())} disabled={!canSendCommand} />
            <CommandButton label="Emergency Stop" onClick={() => runCommandWithFeedback('serverQueue', () => safeSerial.sendEmergencyStop?.())} disabled={!canSendCommand} />
          </CommandGroup>
          <CommandFeedback feedback={lastCommandFeedbackByCategory.serverQueue} />
        </CommandAccordionItem>

        {isAdmin ? (
          <CommandAccordionItem eventKey="local-direct" title="Local Web Serial Command">
            <div className="server-small-note mb-3">
              Admin-only. Sends command directly to the connected Remote MCU without using the server command queue.
            </div>
            <ValueGrid
              title="Local Writer"
              rows={[
                { label: 'Web Serial connected', value: localSerialConnected ? 'yes' : 'no' },
                { label: 'serialWriterReady', value: localWriterReady ? 'yes' : 'no' },
                { label: 'Last TX', value: safeLocalSerial.lastCommand || '-' },
                { label: 'Last local write error', value: safeLocalSerial.lastLocalWriteError || '-' },
                { label: 'Last ACK/ERR from Remote', value: lastRemoteAckErr },
              ]}
            />
            <Row className="g-2 align-items-end mt-3">
              <Col xs={12} md={8}>
                <Form.Label className="serial-mini-label">Direct command</Form.Label>
                <Form.Control
                  size="sm"
                  type="text"
                  value={localCommand}
                  onChange={(event) => {
                    setLocalCommand(event.target.value);
                  }}
                  placeholder="CMD,0 or RPMALL,0,0,0"
                  disabled={!localSerialConnected}
                />
              </Col>
              <Col xs={12} md={4}>
                <Button variant="outline-info" className="w-100" onClick={sendLocalInput} disabled={!canSendLocalCommand || !String(localCommand || '').trim()}>
                  Send
                </Button>
              </Col>
            </Row>
            <div className="serial-subsection-title mt-3 mb-2">Quick Direct Commands</div>
            <CommandGroup>
              <CommandButton label="Cubli Initialize" onClick={() => sendLocalLines(['TARE', 'MAG_OFF', 'GYRO_500'], 'Cubli Initialize')} disabled={!canSendLocalCommand} />
              <CommandButton label="Encoder Initialize" onClick={() => sendLocalLines('TARE', 'Encoder Initialize')} disabled={!canSendLocalCommand} />
              <CommandButton label="Stop / RPM Stop" onClick={() => sendLocalLines(['STOP', 'RPMSTOP'], 'Stop / RPM Stop')} disabled={!canSendLocalCommand} />
              <CommandButton label="Apply Default IMU Setting" onClick={() => sendLocalLines(['EBIMU_DEFAULT', 'MAG_OFF', 'GYRO_500'], 'Default IMU Setting')} disabled={!canSendLocalCommand} />
            </CommandGroup>
            <CommandFeedback feedback={lastCommandFeedbackByCategory.localDirect} />
          </CommandAccordionItem>
        ) : null}

        <CommandAccordionItem eventKey="target" title="Target Attitude">
          <div className="serial-subsection-title mb-2">Target RPY Command Convention</div>
          <Row className="g-2 align-items-end mb-3">
            <Col xs={12} md={6}>
              <Form.Label className="serial-mini-label">Target Rotation Sequence</Form.Label>
              <Form.Select size="sm" value={targetSequence} onChange={(event) => safeSerial.setTargetRpySequence?.(event.target.value)}>
                {EULER_SEQUENCE_OPTIONS.map((sequence) => (
                  <option key={sequence} value={sequence}>{sequence}</option>
                ))}
              </Form.Select>
            </Col>
            <Col xs={12} md={6}>
              <Button variant="outline-light" className="w-100" onClick={safeSerial.resetTargetCommandConvention}>
                Reset Target Command Convention
              </Button>
            </Col>
          </Row>
          <div className="server-small-note mb-2">
            Enter signed target angles directly. Example: Yaw = -10 deg sends a negative yaw target. Rotation sequence only changes how target quaternion is generated.
          </div>
          <div className="server-small-note mb-2">
            Target command uses: {targetPreview.sequence}. Display RPY sequence does not affect target command.
          </div>
          <Row className="g-2 align-items-end">
            <Col xs={4}>
              <Form.Label className="serial-mini-label">Roll</Form.Label>
              <Form.Control size="sm" type="number" value={targetRoll} onChange={(event) => setTargetRoll(event.target.value)} />
            </Col>
            <Col xs={4}>
              <Form.Label className="serial-mini-label">Pitch</Form.Label>
              <Form.Control size="sm" type="number" value={targetPitch} onChange={(event) => setTargetPitch(event.target.value)} />
            </Col>
            <Col xs={4}>
              <Form.Label className="serial-mini-label">Yaw</Form.Label>
              <Form.Control size="sm" type="number" value={targetYaw} onChange={(event) => setTargetYaw(event.target.value)} />
            </Col>
            <Col xs={12}>
              <Button
                variant="outline-light"
                className="w-100"
                disabled={!canSendCommand}
                onClick={() => runCommandWithFeedback('targetAttitude', () => safeSerial.sendTarget?.(Number(targetRoll) || 0, Number(targetPitch) || 0, Number(targetYaw) || 0))}
              >
                Send Target Attitude
              </Button>
            </Col>
          </Row>
          <CommandFeedback feedback={lastCommandFeedbackByCategory.targetAttitude} />
          <div className="serial-value-card rounded p-2 mt-3">
            <div className="serial-section-title mb-2">qd preview</div>
            <ValueRow label="Target roll command" value={`${formatNumber(targetPreview.commandRoll, 2)} deg`} />
            <ValueRow label="Target pitch command" value={`${formatNumber(targetPreview.commandPitch, 2)} deg`} />
            <ValueRow label="Target yaw command" value={`${formatNumber(targetPreview.commandYaw, 2)} deg`} />
            <ValueRow label="qd0" value={formatNumber(targetPreview.qd[0], 6)} />
            <ValueRow label="qd1" value={formatNumber(targetPreview.qd[1], 6)} />
            <ValueRow label="qd2" value={formatNumber(targetPreview.qd[2], 6)} />
            <ValueRow label="qd3" value={formatNumber(targetPreview.qd[3], 6)} />
          </div>
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="wheel-rpm" title="Wheel RPM Command">
          <div className="server-small-note mb-2">
            Reaction wheel motor speed command. Gimbal rotary encoder data is displayed separately.
          </div>
          <Row className="g-2 align-items-end mb-3">
            {[
              ['x', 'RPM X'],
              ['y', 'RPM Y'],
              ['z', 'RPM Z'],
            ].map(([axis, label]) => (
              <Col xs={4} key={axis}>
                <Form.Label className="serial-mini-label">{label}</Form.Label>
                <Form.Control
                  size="sm"
                  type="number"
                  min={WHEEL_RPM_MIN}
                  max={WHEEL_RPM_MAX}
                  step={WHEEL_RPM_STEP}
                  value={rpmCommand[axis]}
                  onChange={(event) => updateRpmCommand(axis, event.target.value)}
                  isInvalid={parseWheelRpmValue(rpmCommand[axis]) === null}
                />
              </Col>
            ))}
          </Row>
          {rpmInputInvalid ? (
            <Alert variant="warning" className="py-2">
              RPM command is limited to +/-{WHEEL_RPM_COMMAND_MAX}.
            </Alert>
          ) : null}
          {rpmStatus ? <div className="server-small-note mb-2">{rpmStatus}</div> : null}
          <CommandGroup>
            <CommandButton label="Send RPM X" onClick={() => runCommandWithFeedback('wheelRpm', () => sendWheelRpmAxis('x'))} disabled={!canSendCommand || parseWheelRpmValue(rpmCommand.x) === null} />
            <CommandButton label="Send RPM Y" onClick={() => runCommandWithFeedback('wheelRpm', () => sendWheelRpmAxis('y'))} disabled={!canSendCommand || parseWheelRpmValue(rpmCommand.y) === null} />
            <CommandButton label="Send RPM Z" onClick={() => runCommandWithFeedback('wheelRpm', () => sendWheelRpmAxis('z'))} disabled={!canSendCommand || parseWheelRpmValue(rpmCommand.z) === null} />
            <CommandButton label="Send All RPM" onClick={() => runCommandWithFeedback('wheelRpm', sendWheelRpmAll)} disabled={!canSendCommand || !rpmValues} />
            <CommandButton label="Stop RPM Test" onClick={() => runCommandWithFeedback('wheelRpm', stopWheelRpmTest)} disabled={!canSendCommand} />
          </CommandGroup>
          <CommandFeedback feedback={lastCommandFeedbackByCategory.wheelRpm} />
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="attitude-gain" title="Attitude PID Gain">
          <div className="serial-subsection-title mb-2">P Gain</div>
          <Row className="g-2 align-items-end mb-3">
            <Col xs={4}>
              <Form.Label className="serial-mini-label">Kp X</Form.Label>
              <Form.Control size="sm" type="number" min={ATTITUDE_GAIN_MIN} max={ATTITUDE_GAIN_MAX} step={ATTITUDE_GAIN_STEP} value={kpGain.x} onChange={(event) => updateKpGain('x', event.target.value)} isInvalid={parseGainValue(kpGain.x) === null} />
            </Col>
            <Col xs={4}>
              <Form.Label className="serial-mini-label">Kp Y</Form.Label>
              <Form.Control size="sm" type="number" min={ATTITUDE_GAIN_MIN} max={ATTITUDE_GAIN_MAX} step={ATTITUDE_GAIN_STEP} value={kpGain.y} onChange={(event) => updateKpGain('y', event.target.value)} isInvalid={parseGainValue(kpGain.y) === null} />
            </Col>
            <Col xs={4}>
              <Form.Label className="serial-mini-label">Kp Z</Form.Label>
              <Form.Control size="sm" type="number" min={ATTITUDE_GAIN_MIN} max={ATTITUDE_GAIN_MAX} step={ATTITUDE_GAIN_STEP} value={kpGain.z} onChange={(event) => updateKpGain('z', event.target.value)} isInvalid={parseGainValue(kpGain.z) === null} />
            </Col>
          </Row>

          <div className="serial-subsection-title mb-2">D Gain</div>
          <Row className="g-2 align-items-end mb-3">
            <Col xs={4}>
              <Form.Label className="serial-mini-label">Kd X</Form.Label>
              <Form.Control size="sm" type="number" min={ATTITUDE_GAIN_MIN} max={ATTITUDE_GAIN_MAX} step={ATTITUDE_GAIN_STEP} value={kdGain.x} onChange={(event) => updateKdGain('x', event.target.value)} isInvalid={parseGainValue(kdGain.x) === null} />
            </Col>
            <Col xs={4}>
              <Form.Label className="serial-mini-label">Kd Y</Form.Label>
              <Form.Control size="sm" type="number" min={ATTITUDE_GAIN_MIN} max={ATTITUDE_GAIN_MAX} step={ATTITUDE_GAIN_STEP} value={kdGain.y} onChange={(event) => updateKdGain('y', event.target.value)} isInvalid={parseGainValue(kdGain.y) === null} />
            </Col>
            <Col xs={4}>
              <Form.Label className="serial-mini-label">Kd Z</Form.Label>
              <Form.Control size="sm" type="number" min={ATTITUDE_GAIN_MIN} max={ATTITUDE_GAIN_MAX} step={ATTITUDE_GAIN_STEP} value={kdGain.z} onChange={(event) => updateKdGain('z', event.target.value)} isInvalid={parseGainValue(kdGain.z) === null} />
            </Col>
          </Row>

          {gainInputInvalid ? (
            <Alert variant="warning" className="py-2">
              Gains must be finite numbers from 0.000 to 10.000.
            </Alert>
          ) : null}
          {gainStatus ? <div className="server-small-note mb-2">{gainStatus}</div> : null}

          <CommandGroup>
            <CommandButton label="Send Kp" onClick={() => runCommandWithFeedback('attitudeGain', sendAttitudeKp)} disabled={!canSendCommand || !kpValues} />
            <CommandButton label="Send Kd" onClick={() => runCommandWithFeedback('attitudeGain', sendAttitudeKd)} disabled={!canSendCommand || !kdValues} />
            <CommandButton label="Send Kp + Kd" onClick={() => runCommandWithFeedback('attitudeGain', sendAttitudeGains)} disabled={!canSendCommand || gainInputInvalid} />
            <CommandButton label="Reset to Default" onClick={resetAttitudeGains} disabled={false} />
          </CommandGroup>
          <CommandFeedback feedback={lastCommandFeedbackByCategory.attitudeGain} />
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="stream" title="EBIMU Stream">
          <div className="serial-value-card rounded p-2 mb-3">
            <div className="serial-section-title mb-2">Default IMU Setting</div>
            <ValueRow label="Magnetometer" value="OFF" />
            <ValueRow label="Gyro Range" value="500 dps" />
            <div className="server-small-note mt-2">
              Default is selected from current Cubli experiment stability.
            </div>
          </div>
          <CommandGroup>
            <CommandButton label="Apply Default Setting" onClick={() => runCommandWithFeedback('ebimuStream', applyDefaultImuSetting)} disabled={!canSendCommand} />
            <CommandButton label="EBIMU Start" onClick={() => runCommandWithFeedback('ebimuStream', () => sendShortcut('ebimuStart', 'EBIMU Start'))} disabled={!canSendCommand} />
            <CommandButton label="EBIMU Stop" onClick={() => runCommandWithFeedback('ebimuStream', () => sendShortcut('ebimuStop', 'EBIMU Stop'))} disabled={!canSendCommand} />
          </CommandGroup>
          <CommandFeedback feedback={lastCommandFeedbackByCategory.ebimuStream} />
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="mag" title="Magnetometer">
          <CommandGroup>
            {MAG_OPTIONS.map((item) => (
              <CommandButton key={item.commandKey} label={item.label} onClick={() => runCommandWithFeedback('magnetometer', () => sendShortcut(item.commandKey, item.label))} disabled={!canSendCommand} />
            ))}
          </CommandGroup>
          <CommandFeedback feedback={lastCommandFeedbackByCategory.magnetometer} />
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="gyro" title="Gyro Range">
          <CommandGroup>
            {GYRO_OPTIONS.map((item) => (
              <CommandButton key={item.commandKey} label={item.label} onClick={() => runCommandWithFeedback('gyroRange', () => sendShortcut(item.commandKey, item.label))} disabled={!canSendCommand} />
            ))}
          </CommandGroup>
          <CommandFeedback feedback={lastCommandFeedbackByCategory.gyroRange} />
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="accel" title="Accelerometer">
          <div className="serial-subsection-title mb-2">Range</div>
          <CommandGroup>
            {ACCEL_OPTIONS.map((item) => (
              <CommandButton key={item.commandKey} label={item.label} onClick={() => runCommandWithFeedback('accelerometer', () => sendShortcut(item.commandKey, item.label))} disabled={!canSendCommand} />
            ))}
          </CommandGroup>

          <div className="serial-subsection-title mt-3 mb-2">Filter Factor</div>
          <Row className="g-2 align-items-end mb-2">
            <Col xs={7}>
              <Form.Control size="sm" type="number" min="1" max="50" value={accFactor} onChange={(event) => setAccFactor(event.target.value)} />
            </Col>
            <Col xs={5}>
              <Button variant="outline-light" className="w-100" disabled={!canSendCommand} onClick={() => runCommandWithFeedback('accelerometer', () => sendAccFactor(accFactor))}>
                Apply
              </Button>
            </Col>
          </Row>
          <CommandGroup>
            {FILTER_PRESETS.map((value) => (
              <CommandButton key={value} label={`${value}`} onClick={() => runCommandWithFeedback('accelerometer', () => sendAccFactor(value))} disabled={!canSendCommand} />
            ))}
          </CommandGroup>
          <CommandFeedback feedback={lastCommandFeedbackByCategory.accelerometer} />
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="receiver" title="Receiver Info">
          <CommandGroup>
            <CommandButton label="Status" onClick={() => runCommandWithFeedback('receiverInfo', () => safeSerial.sendStatus?.())} disabled={!canSendCommand} />
            <CommandButton label="MAC Info" onClick={() => runCommandWithFeedback('receiverInfo', () => safeSerial.sendMacInfo?.())} disabled={!canSendCommand} />
            <CommandButton label="Refresh Status" onClick={safeSerial.refreshStatus} disabled={false} />
          </CommandGroup>
          <CommandFeedback feedback={lastCommandFeedbackByCategory.receiverInfo} />
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="source-diagnostic" title="RPY / Quaternion Source">
          <ValueGrid
            title="RPY / Quaternion Source"
            rows={[
              { label: 'Current RPY sequence', value: latestPacket.imuEulerSequence || safeSerial.targetRpySequence || 'ZYX' },
              { label: 'Source', value: 'IMU/TEL quaternion' },
              { label: '3D source', value: 'quaternion q0~q3' },
              { label: 'Encoder source', value: latestPacket.encoderSource || 'Gimbal rotary encoder' },
              { label: 'Current yaw from quaternion', value: currentRawYaw != null ? `${formatNumber(currentRawYaw, 2)} deg` : '-' },
              { label: 'Target input yaw', value: `${formatNumber(targetPreview.inputYaw, 2)} deg` },
              { label: 'Target yaw command', value: `${formatNumber(targetPreview.commandYaw, 2)} deg` },
              { label: 'qd preview', value: qdPreviewText },
            ]}
          />
        </CommandAccordionItem>
      </Accordion>
    </div>
  );
}

function MonitoringSection({ status, isActive = true, isAdmin = false }) {
  const safeStatus = status ?? EMPTY_OBJECT;
  const latest = useMemo(() => safeStatus.latestPacket || {}, [safeStatus.latestPacket]);
  const lastCommandInfo = useMemo(() => safeStatus.lastCommandInfo || {}, [safeStatus.lastCommandInfo]);
  const latestDesired = useMemo(() => safeStatus.latestDesiredAttitude || {}, [safeStatus.latestDesiredAttitude]);
  const [showLivePlot, setShowLivePlot] = useState(true);
  const [showWheelGraphs, setShowWheelGraphs] = useState(false);
  const [showDebugTelemetry, setShowDebugTelemetry] = useState(false);

  const sharedRows = useMemo(() => [
    { label: 'Shared Live Data', value: safeStatus.liveStatus || (latest?.publishedAt ? 'LIVE' : 'NONE') },
    { label: 'Published source', value: latest.sourceLabel || latest.source || '-' },
    { label: 'Publisher', value: latest.publisherDisplayName || safeStatus.publisherDisplayName || (latest.source === 'server-serial' ? 'server' : '-') },
    { label: 'latestSharedPacket age', value: safeStatus.latestSharedPacketAgeMs != null ? formatAgeMs(safeStatus.latestSharedPacketAgeMs) : '-' },
    { label: 'Active publisher status', value: safeStatus.activePublisherStatus || safeStatus.activePublisher?.status || 'NONE' },
    { label: 'Last publish time', value: formatDateTime(latest.publishedAt || safeStatus.publishedAt) },
  ], [latest, safeStatus.activePublisher, safeStatus.activePublisherStatus, safeStatus.latestSharedPacketAgeMs, safeStatus.liveStatus, safeStatus.publishedAt, safeStatus.publisherDisplayName]);

  const quaternionRows = useMemo(() => [
    { label: 'q0 / qw', value: formatNumber(latest.q0, 6) },
    { label: 'q1 / qx', value: formatNumber(latest.q1, 6) },
    { label: 'q2 / qy', value: formatNumber(latest.q2, 6) },
    { label: 'q3 / qz', value: formatNumber(latest.q3, 6) },
    { label: 'norm', value: formatNumber(latest.norm, 6) },
  ], [latest]);

  const rpyRows = useMemo(() => [
    { label: 'Roll', value: `${formatNumber(latest.roll_deg ?? latest.rollDeg, 2)} deg` },
    { label: 'Pitch', value: `${formatNumber(latest.pitch_deg ?? latest.pitchDeg, 2)} deg` },
    { label: 'Yaw', value: `${formatNumber(latest.yaw_deg ?? latest.yawDeg, 2)} deg` },
    { label: 'Raw Yaw', value: latest.rawYawDeg != null ? `${formatNumber(latest.rawYawDeg, 2)} deg` : '-' },
    { label: 'Sequence', value: latest.imuEulerSequence || 'ZYX' },
    { label: 'Source', value: 'IMU/TEL quaternion' },
  ], [latest]);

  const commandStateRows = useMemo(() => [
    { label: 'desired_roll_deg', value: formatNumber(latest.desired_roll_deg ?? latest.desiredRollDeg ?? latestDesired.rollDeg, 2) },
    { label: 'desired_pitch_deg', value: formatNumber(latest.desired_pitch_deg ?? latest.desiredPitchDeg ?? latestDesired.pitchDeg, 2) },
    { label: 'desired_yaw_deg', value: formatNumber(latest.desired_yaw_deg ?? latest.desiredYawDeg ?? latestDesired.yawDeg, 2) },
  ], [latest, latestDesired]);

  const qerrRows = useMemo(() => [
    { label: 'qerr_deg', value: latest.qerrComputed || latest.qerr_deg != null || latest.qerrDeg != null ? `${formatNumber(latest.qerr_deg ?? latest.qerrDeg, 2)} deg` : '-' },
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

  const statusRows = useMemo(() => [
    { label: 'commandType', value: formatStatusToken(latest.commandType ?? latest.command_type) },
    { label: 'control_mode', value: formatStatusToken(latest.control_mode) },
    { label: 'EBIMU_status', value: formatStatusToken(latest.EBIMU_status) },
    { label: 'logging_status', value: formatStatusToken(latest.logging_status) },
  ], [latest]);

  const encoderRows = useMemo(() => buildEncoderRows(latest), [latest]);

  const frameRows = useMemo(() => [
    { label: `Current RPY [${latest.imuEulerSequence || 'ZYX'}]`, value: 'Display-only Euler angles' },
    { label: 'Source', value: 'IMU/TEL quaternion' },
    { label: '3D source', value: 'quaternion q0~q3' },
    { label: 'Encoder source', value: latest.encoderSource || 'Gimbal rotary encoder' },
    { label: 'Visual frame setting', value: 'Shared server rendering transform' },
  ], [latest]);

  const debugRows = useMemo(() => [
    { label: 'PWM1', value: formatNumber(latest.PWM1, 1) },
    { label: 'PWM2', value: formatNumber(latest.PWM2, 1) },
    { label: 'PWM3', value: formatNumber(latest.PWM3, 1) },
    { label: 'Tbodycmd_x_Nm', value: formatNumber(latest.Tbodycmd_x_Nm, 5) },
    { label: 'Tbodycmd_y_Nm', value: formatNumber(latest.Tbodycmd_y_Nm, 5) },
    { label: 'Tbodycmd_z_Nm', value: formatNumber(latest.Tbodycmd_z_Nm, 5) },
    { label: 'Tmotor1_Nm', value: formatNumber(latest.Tmotor1_Nm, 5) },
    { label: 'Tmotor2_Nm', value: formatNumber(latest.Tmotor2_Nm, 5) },
    { label: 'Tmotor3_Nm', value: formatNumber(latest.Tmotor3_Nm, 5) },
  ], [latest]);

  const wheelGraphData = useMemo(() => {
    const rows = Array.isArray(safeStatus.chartData) ? safeStatus.chartData.slice(-120) : [];
    return rows.map((row, index) => ({
      sample: index + 1,
      RPM1: Number.isFinite(Number(row.RPM1)) ? Number(row.RPM1) : null,
      RPM2: Number.isFinite(Number(row.RPM2)) ? Number(row.RPM2) : null,
      RPM3: Number.isFinite(Number(row.RPM3)) ? Number(row.RPM3) : null,
      RPMcmd1: Number.isFinite(Number(row.RPMcmd1)) ? Number(row.RPMcmd1) : null,
      RPMcmd2: Number.isFinite(Number(row.RPMcmd2)) ? Number(row.RPMcmd2) : null,
      RPMcmd3: Number.isFinite(Number(row.RPMcmd3)) ? Number(row.RPMcmd3) : null,
    }));
  }, [safeStatus.chartData]);

  const livePlotData = useMemo(() => {
    const rows = Array.isArray(safeStatus.chartData) ? safeStatus.chartData.slice(-240) : [];
    return rows.map((row, index) => {
      const n = (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
      };
      return {
        sample: index + 1,
        roll: n(row.roll),
        pitch: n(row.pitch),
        yaw: n(row.yaw),
        qerr: n(row.qerr),
        wx: n(row.wx),
        wy: n(row.wy),
        wz: n(row.wz),
        RPM1: n(row.RPM1),
        RPM2: n(row.RPM2),
        RPM3: n(row.RPM3),
        RPMcmd1: n(row.RPMcmd1),
        RPMcmd2: n(row.RPMcmd2),
        RPMcmd3: n(row.RPMcmd3),
        encoderRoll: n(row.encoderRoll ?? row.encoderRollDeg),
        encoderPitch: n(row.encoderPitch ?? row.encoderPitchDeg),
        encoderYaw: n(row.encoderYaw ?? row.encoderYawDeg),
      };
    });
  }, [safeStatus.chartData]);

  const smoothedRows = useMemo(() => [
    { label: 'Roll (display computed)', value: `${formatNumber(latest.rollSmoothedDeg, 2)} deg` },
    { label: 'Pitch (display computed)', value: `${formatNumber(latest.pitchSmoothedDeg, 2)} deg` },
    { label: 'Yaw (display computed)', value: `${formatNumber(latest.yawSmoothedDeg, 2)} deg` },
  ], [latest]);

  const receiverRows = useMemo(() => [
    { label: 'Source', value: latest.sourceLabel || latest.source || '-' },
    { label: 'Baudrate', value: safeStatus.baudRate ? `${safeStatus.baudRate} bps` : '-' },
    { label: 'Remote timestamp', value: formatNumber(latest.ebimu_timestamp_ms ?? latest.timestamp, 0) },
    { label: 'Seq / RX', value: `${formatNumber(latest.seq, 0)} / ${formatNumber(latest.rxCount, 0)}` },
    { label: 'Valid / Invalid', value: `${safeStatus.validCount || 0} / ${safeStatus.invalidCount || 0}` },
    { label: 'Ignored', value: safeStatus.ignoredCount || 0 },
    { label: 'Warning', value: safeStatus.warningCount || 0 },
    { label: 'Last RX', value: formatDateTime(safeStatus.lastReceivedAt) },
    { label: 'Last command', value: safeStatus.lastCommand || '-' },
  ], [latest, safeStatus]);

  const timeCommandRows = useMemo(() => {
    const rows = [
      { label: 'Server time', value: formatDateTime(latest.serverReceivedAt || latest.serverReceivedAtMs || latest.pcTimeMs || latest.pc_time_ms) },
      { label: 'Session elapsed', value: formatDuration(latest.sessionElapsedMs ?? safeStatus.sessionElapsedMs) },
      { label: 'Remote timestamp', value: formatNumber(latest.ebimu_timestamp_ms ?? latest.timestamp, 0) },
      { label: 'seq', value: formatNumber(latest.seq, 0) },
      { label: 'Last command', value: latest.lastCommandLabel || lastCommandInfo.label || '-' },
      { label: 'Detail', value: formatCommandParams(latest.lastCommandParams || lastCommandInfo.params) },
    ];
    if (isAdmin) {
      rows.push(
        { label: 'Command key', value: latest.lastCommandKey || lastCommandInfo.commandKey || '-' },
        { label: 'Sent line', value: latest.lastCommandLineSent || lastCommandInfo.serialLineSent || '-' },
        { label: 'By', value: latest.lastCommandByClientId || lastCommandInfo.clientId || '-' },
        { label: 'Allowed', value: typeof (latest.lastCommandAllowed ?? lastCommandInfo.allowed) === 'boolean' ? String(latest.lastCommandAllowed ?? lastCommandInfo.allowed) : '-' },
        { label: 'Reason', value: latest.lastCommandDenied ? (lastCommandInfo.reason || 'denied') : (lastCommandInfo.reason || '-') },
      );
    }
    rows.push({ label: 'Last command time', value: formatDateTime(latest.lastCommandAt || lastCommandInfo.at) });
    return rows;
  }, [isAdmin, latest, lastCommandInfo, safeStatus.sessionElapsedMs]);

  const hasWheelGraphData = wheelGraphData.some((row) => (
    row.RPM1 != null || row.RPM2 != null || row.RPM3 != null ||
    row.RPMcmd1 != null || row.RPMcmd2 != null || row.RPMcmd3 != null
  ));
  const hasSharedLiveData = Boolean(latest?.publishedAt || latest?.updatedAt);

  return (
    <>
      {!hasSharedLiveData ? (
        <Alert variant="secondary" className="py-2 mb-3">
          No shared live data yet.
        </Alert>
      ) : null}
      <Row className="g-2 mb-3">
        <Col xs={12}><ValueGrid title="Shared Live Data" rows={sharedRows} /></Col>
      </Row>

      <TelemetryDataView
        latest={latest}
        status={safeStatus}
        isAdmin={isAdmin}
        storageKey="cubliSharedTelemetryDataView"
      />

      <div className="serial-control-card rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="serial-section-title">Wheel Speed Graph</div>
          <Form.Check type="switch" id="show-wheel-speed-graphs" label="Show" checked={showWheelGraphs} onChange={(event) => setShowWheelGraphs(event.target.checked)} />
        </div>
        {showWheelGraphs && isActive ? (
          hasWheelGraphData ? (
            <Row className="g-2">
              <Col xs={12} xl={4}><WheelSpeedChart title="RPM1 vs RPMcmd1" data={wheelGraphData} rpmKey="RPM1" commandKey="RPMcmd1" /></Col>
              <Col xs={12} xl={4}><WheelSpeedChart title="RPM2 vs RPMcmd2" data={wheelGraphData} rpmKey="RPM2" commandKey="RPMcmd2" /></Col>
              <Col xs={12} xl={4}><WheelSpeedChart title="RPM3 vs RPMcmd3" data={wheelGraphData} rpmKey="RPM3" commandKey="RPMcmd3" /></Col>
            </Row>
          ) : (
            <Alert variant="secondary" className="py-2 mb-0">
              Wheel telemetry is not available from current packet.
            </Alert>
          )
        ) : null}
      </div>

      {isAdmin ? (
        <div className="serial-control-card rounded p-3 mb-3">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div className="serial-section-title">Debug Telemetry</div>
            <Form.Check type="switch" id="show-debug-telemetry" label="Show" checked={showDebugTelemetry} onChange={(event) => setShowDebugTelemetry(event.target.checked)} />
          </div>
          {showDebugTelemetry ? <ValueGrid title="PWM / Torque Telemetry" rows={debugRows} /> : null}
        </div>
      ) : null}

      <div className="serial-control-card rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div>
            <div className="serial-section-title">Live Plot</div>
            <div className="server-small-note">Recent shared packets from Admin Web Serial Bridge.</div>
          </div>
          <Form.Check type="switch" id="show-server-live-plot" label="Show" checked={showLivePlot} onChange={(event) => setShowLivePlot(event.target.checked)} />
        </div>
        {showLivePlot && isActive ? (
          <Row className="g-2">
            <Col xs={12} xl={6}>
              <LiveTelemetryChart
                title={`Current RPY [${latest.imuEulerSequence || 'ZYX'}]`}
                data={livePlotData}
                yLabel="deg"
                lines={[
                  { key: 'roll', name: 'Roll', stroke: '#4dabf7' },
                  { key: 'pitch', name: 'Pitch', stroke: '#ffd43b' },
                  { key: 'yaw', name: 'Yaw', stroke: '#ff8787' },
                ]}
              />
            </Col>
            <Col xs={12} xl={6}>
              <LiveTelemetryChart
                title={`Gimbal Encoder RPY [${latest.encoderEulerSequence || 'ZYX'}]`}
                data={livePlotData}
                yLabel="deg"
                lines={[
                  { key: 'encoderRoll', name: 'Gimbal Encoder Roll', stroke: '#63e6be' },
                  { key: 'encoderPitch', name: 'Gimbal Encoder Pitch', stroke: '#ffd43b' },
                  { key: 'encoderYaw', name: 'Gimbal Encoder Yaw', stroke: '#ff8787' },
                ]}
              />
            </Col>
            <Col xs={12} xl={6}>
              <LiveTelemetryChart
                title="Attitude Error / Body Rate"
                data={livePlotData}
                yLabel="deg, rad/s"
                lines={[
                  { key: 'qerr', name: 'qerr', stroke: '#b197fc' },
                  { key: 'wx', name: 'wx', stroke: '#4dabf7' },
                  { key: 'wy', name: 'wy', stroke: '#51cf66' },
                  { key: 'wz', name: 'wz', stroke: '#ff922b' },
                ]}
              />
            </Col>
            <Col xs={12}>
              <LiveTelemetryChart
                title="Wheel RPM / Command RPM"
                data={livePlotData}
                yLabel="RPM"
                lines={[
                  { key: 'RPM1', name: 'RPM1', stroke: '#4dabf7' },
                  { key: 'RPMcmd1', name: 'RPMcmd1', stroke: '#74c0fc' },
                  { key: 'RPM2', name: 'RPM2', stroke: '#51cf66' },
                  { key: 'RPMcmd2', name: 'RPMcmd2', stroke: '#8ce99a' },
                  { key: 'RPM3', name: 'RPM3', stroke: '#ff8787' },
                  { key: 'RPMcmd3', name: 'RPMcmd3', stroke: '#ffa8a8' },
                ]}
              />
            </Col>
          </Row>
        ) : null}
      </div>
      {isAdmin ? (
        <div className="serial-control-card rounded p-3 mb-3">
          <div className="serial-section-title mb-1">Raw Monitor</div>
          <div className="server-small-note">Raw monitor is admin-local only to reduce bandwidth. Use the Admin Web Serial panel.</div>
        </div>
      ) : null}
    </>
  );
}

function DataLoggingSection({ latestPacket }) {
  const [csvLogging, setCsvLogging] = useState(false);
  const [csvStartedAt, setCsvStartedAt] = useState(null);
  const [csvSampleCount, setCsvSampleCount] = useState(0);
  const [csvElapsedMs, setCsvElapsedMs] = useState(0);
  const [csvStats, setCsvStats] = useState(() => summarizeCsvRows([]));
  const logRef = useRef([]);
  const seenCsvPacketKeysRef = useRef(new Set());
  const nextCsvLogIndexRef = useRef(0);
  const csvStartedAtRef = useRef(null);

  useEffect(() => {
    if (!csvLogging) return;
    if (!latestPacket?.publishedAt && !latestPacket?.updatedAt && !latestPacket?.raw) return;
    const packetTime = Number(latestPacket?.publishedAt ?? latestPacket?.updatedAt);
    if (csvStartedAtRef.current && Number.isFinite(packetTime) && packetTime < csvStartedAtRef.current) return;
    const appended = appendCsvLogSample(logRef, seenCsvPacketKeysRef, latestPacket, {
      nextLogIndexRef: nextCsvLogIndexRef,
    });
    if (appended) {
      const nextStats = summarizeCsvRows(logRef.current, csvStartedAtRef.current);
      setCsvSampleCount(nextStats.total);
      setCsvStats(nextStats);
    }
  }, [csvLogging, latestPacket]);

  useEffect(() => {
    if (!csvLogging || !csvStartedAt) return undefined;
    const timer = window.setInterval(() => {
      setCsvElapsedMs(Date.now() - csvStartedAt);
      setCsvStats(summarizeCsvRows(logRef.current, csvStartedAtRef.current));
    }, 500);
    return () => window.clearInterval(timer);
  }, [csvLogging, csvStartedAt]);

  const startCsvLogging = () => {
    logRef.current = [];
    seenCsvPacketKeysRef.current = new Set();
    nextCsvLogIndexRef.current = 0;
    const startedAt = Date.now();
    csvStartedAtRef.current = startedAt;
    setCsvStartedAt(startedAt);
    setCsvElapsedMs(0);
    setCsvSampleCount(0);
    setCsvStats(summarizeCsvRows([], startedAt));
    setCsvLogging(true);
  };

  const downloadCsv = (kind = 'telemetry') => {
    if (csvLogging) setCsvLogging(false);
    if (logRef.current.length === 0) {
      setCsvSampleCount(0);
      setCsvStats(summarizeCsvRows([]));
      setCsvElapsedMs(0);
      setCsvStartedAt(null);
      csvStartedAtRef.current = null;
      alert('No shared live data was logged in this CSV session.');
      return;
    }
    const filteredRows = filterCsvRows(logRef.current, kind);
    if (filteredRows.length === 0) {
      alert(`No ${kind} rows were logged in this CSV session.`);
      return;
    }
    const sortedRows = finalizeCsvLogRows(filteredRows);
    const csv = [LOG_COLUMNS.join(','), ...sortedRows.map(packetToCsvRow)].join('\n');
    downloadTextFile(`cubli_shared_${kind}_${formatCsvFileTimestamp()}.csv`, `${csv}\n`);
  };

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="d-flex justify-content-between align-items-center mb-2">
          <div>
            <div className="serial-section-title">CSV Logging</div>
            <div className="server-small-note">CSV mode: Save every valid Serial sample</div>
            <div className="server-small-note">{CSV_LOG_NOTE}</div>
          </div>
        <Badge bg={csvLogging ? 'success' : 'secondary'}>{csvSampleCount}</Badge>
      </div>
      <div className="csv-logging-stat-grid mb-3">
        <div><span>Logged total samples</span><strong>{csvStats.total}</strong></div>
        <div><span>Logged TEL/IMU samples</span><strong>{csvStats.telemetry}</strong></div>
        <div><span>Logged ENC samples</span><strong>{csvStats.enc}</strong></div>
        <div><span>Estimated logging rate</span><strong>{formatNumber(csvStats.rateHz, 1)} Hz</strong></div>
      </div>
      <div className="server-small-note mb-2">Elapsed {formatDuration(csvElapsedMs)}</div>
      <Row className="g-2 justify-content-center">
        <Col xs={12}>
          <Button variant="outline-info" className="w-100" onClick={startCsvLogging} disabled={csvLogging}>
            Start CSV Logging
          </Button>
        </Col>
        <Col xs={12} md={6}>
          <Button variant="outline-light" className="w-100" onClick={() => downloadCsv('telemetry')} disabled={!csvLogging && csvStats.telemetry === 0}>
            Stop & Download Telemetry CSV
          </Button>
        </Col>
        <Col xs={12} md={6}>
          <Button variant="outline-light" className="w-100" onClick={() => downloadCsv('encoder')} disabled={!csvLogging && csvStats.enc === 0}>
            Stop & Download Encoder CSV
          </Button>
        </Col>
      </Row>
    </div>
  );
}

function ReceiverInfoSection({ serverSync, localSerial, isAdmin, webSerialConnected }) {
  const safeServerSync = serverSync || {};
  const safeStatus = safeServerSync.serverSerial?.status || {};
  const [isOpen, setIsOpen] = useState(false);
  const bridgeEnabled = Boolean(safeServerSync.bridgeEnabled);
  const activePublisher = safeServerSync.activePublisher
    || safeStatus.activePublisher
    || safeStatus.bridge?.activePublisher
    || null;
  const activePublisherStatus = safeServerSync.activePublisherStatus
    || safeStatus.activePublisherStatus
    || safeStatus.bridge?.activePublisherStatus
    || activePublisher?.status
    || 'NONE';
  const heartbeatAgeMs = safeServerSync.activePublisherHeartbeatAgeMs
    ?? safeStatus.activePublisherHeartbeatAgeMs
    ?? safeStatus.bridge?.activePublisherHeartbeatAgeMs
    ?? activePublisher?.heartbeatAgeMs
    ?? null;
  const latestPacketAgeMs = safeServerSync.latestSharedPacketAgeMs
    ?? safeStatus.latestSharedPacketAgeMs
    ?? null;
  const pendingCount = safeStatus.bridge?.pendingCount
    ?? safeServerSync.serverSerial?.bridge?.pendingCount
    ?? 0;
  const publishSession = safeServerSync.publishSessionId
    || safeStatus.publishSessionId
    || activePublisher?.sessionId
    || '';
  const summaryPublisher = activePublisherStatus === 'NONE'
    ? 'NONE'
    : publisherLabel(activePublisher);
  const summaryStatus = activePublisherStatus || 'NONE';
  const line = (label, value) => `${label.padEnd(24)}: ${value}`;
  const lines = [
    line('Active publisher', activePublisherStatus === 'NONE' ? 'NONE' : (activePublisher?.displayName || activePublisher?.publisherName || publisherLabel(activePublisher))),
    line('Client ID short', shortClientId(activePublisher?.clientId || activePublisher?.publisherClientId || '')),
    line('Status', summaryStatus),
    line('Heartbeat age', formatFixedMs(heartbeatAgeMs)),
    line('Bridge', bridgeEnabled ? 'ON' : 'OFF'),
    line('Web Serial', webSerialConnected ? 'connected' : 'not connected'),
  ];

  if (isAdmin) {
    lines.push(
      line('Session ID short', shortSessionId(publishSession)),
      line('Writer ready', localSerial?.serialWriterReady ? 'yes' : 'no'),
      line('Pending commands', pendingCount),
      line('Dropped wrong publisher', safeServerSync.droppedWrongPublisherCount ?? safeStatus.droppedWrongPublisherCount ?? 0),
      line('Dropped wrong session', safeServerSync.droppedWrongSessionCount ?? safeStatus.droppedWrongSessionCount ?? 0),
      line('Dropped out-of-order', safeServerSync.droppedOutOfOrderCount ?? safeStatus.droppedOutOfOrderCount ?? 0),
      line('Latest packet age', formatFixedMs(latestPacketAgeMs))
    );
  }

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="d-flex justify-content-between align-items-start gap-3">
        <div style={{ minWidth: 0 }}>
          <div className="server-small-note">
            Active publisher: {summaryPublisher} / {summaryStatus}
          </div>
          <div className="server-small-note">
            Bridge {bridgeEnabled ? 'ON' : 'OFF'} · Web Serial {webSerialConnected ? 'connected' : 'not connected'}
          </div>
        </div>
        <Button
          type="button"
          variant="outline-secondary"
          size="sm"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-controls="receiver-info-details"
        >
          Receiver Info
        </Button>
      </div>

      {isOpen ? (
        <pre id="receiver-info-details" className="receiver-info-text mt-3 mb-0">
{lines.join('\n')}
        </pre>
      ) : null}
    </div>
  );
}

function ServerSharingSection({ serverSync, isAdmin, webSerialConnected }) {
  const safeServerSync = serverSync || {};
  const bridgeEnabled = Boolean(safeServerSync.bridgeEnabled);
  const activePublisher = safeServerSync.activePublisher || safeServerSync.serverSerial?.status?.activePublisher || null;
  const activePublisherStatus = safeServerSync.activePublisherStatus
    || safeServerSync.serverSerial?.status?.activePublisherStatus
    || activePublisher?.status
    || 'NONE';
  if (!isAdmin) return null;

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="d-flex justify-content-between align-items-start gap-3">
        <div style={{ minWidth: 0 }}>
          <div className="serial-section-title">Server Sharing</div>
          <div className="server-small-note">
            Share Admin Web Serial data with Viewer and Controller clients.
          </div>
          <div className="server-small-note">
            Active publisher: {activePublisherStatus === 'NONE' ? 'NONE' : publisherLabel(activePublisher)} / {activePublisherStatus}
          </div>
          <div className="server-small-note">
            Bridge {bridgeEnabled ? 'ON' : 'OFF'} · Web Serial {webSerialConnected ? 'connected' : 'not connected'}
          </div>
        </div>
        <Form.Check
          type="switch"
          id="server-sharing-enabled"
          label={bridgeEnabled ? 'Sharing ON' : 'Enable Server Sharing'}
          checked={bridgeEnabled}
          onChange={(event) => safeServerSync.setBridgeEnabled?.(event.target.checked)}
        />
      </div>
      {safeServerSync.lastPublishError === 'ACTIVE_PUBLISHER_CONFLICT' ? (
        <Alert variant="warning" className="py-2 mt-3 mb-0">
          Active publisher conflict. Server Sharing was not started.
        </Alert>
      ) : null}
    </div>
  );
}

function LiveRateSettingsSection({ serverSync, isAdmin, webSerialInputHz = null }) {
  const safeServerSync = serverSync || {};
  const options = Array.isArray(safeServerSync.liveRateOptions) && safeServerSync.liveRateOptions.length
    ? safeServerSync.liveRateOptions
    : [10, 15, 30, 50];
  const publishHz = safeServerSync.serverPublishHz || 30;
  const receiveHz = safeServerSync.viewerReceiveHz || 30;
  const selectedHz = isAdmin ? publishHz : receiveHz;
  const activePublisher = safeServerSync.activePublisher || safeServerSync.serverSerial?.status?.activePublisher || null;
  const activePublisherStatus = safeServerSync.activePublisherStatus
    || safeServerSync.serverSerial?.status?.activePublisherStatus
    || activePublisher?.status
    || 'NONE';
  const rows = isAdmin ? [
    { label: 'Web Serial input Hz', value: `${formatNumber(webSerialInputHz ?? safeServerSync.webSerialInputHz, 1)} Hz` },
    { label: 'Publish target Hz', value: `${publishHz} Hz` },
    { label: 'Actual publish Hz', value: `${formatNumber(safeServerSync.actualPublishHz, 1)} Hz` },
    { label: 'Publish latency', value: safeServerSync.publishLatencyMs != null ? `${formatNumber(safeServerSync.publishLatencyMs, 0)} ms` : '-' },
    { label: 'Publish count', value: safeServerSync.publishCount ?? 0 },
    { label: 'Failed publish count', value: safeServerSync.publishFailedCount ?? 0 },
    { label: 'Skipped/dropped publish', value: `${safeServerSync.skippedPublishCount ?? 0} / ${safeServerSync.droppedPublishCount ?? 0}` },
    { label: 'Dropped wrong publisher', value: safeServerSync.droppedWrongPublisherCount ?? safeServerSync.serverSerial?.status?.droppedWrongPublisherCount ?? 0 },
    { label: 'Dropped wrong session', value: safeServerSync.droppedWrongSessionCount ?? safeServerSync.serverSerial?.status?.droppedWrongSessionCount ?? 0 },
    { label: 'Dropped out-of-order', value: safeServerSync.droppedOutOfOrderCount ?? safeServerSync.serverSerial?.status?.droppedOutOfOrderCount ?? 0 },
    { label: 'Active publisher status', value: activePublisherStatus },
  ] : [
    { label: 'Viewer target Hz', value: `${receiveHz} Hz` },
    { label: 'Actual receive Hz', value: `${formatNumber(safeServerSync.actualReceiveHz, 1)} Hz` },
    { label: 'latestSharedPacket age', value: safeServerSync.latestSharedPacketAgeMs != null ? `${Math.round(safeServerSync.latestSharedPacketAgeMs)} ms` : '-' },
    { label: 'server-to-viewer latency estimate', value: safeServerSync.serverToViewerLatencyMs != null ? `${Math.round(safeServerSync.serverToViewerLatencyMs)} ms` : '-' },
    { label: 'Data status', value: safeServerSync.liveDataStatus || 'NONE' },
    { label: 'dropped out-of-order', value: safeServerSync.droppedOutOfOrderCount ?? 0 },
    { label: 'dropped wrong publisher', value: safeServerSync.droppedWrongPublisherCount ?? 0 },
    { label: 'Skipped receive polls', value: safeServerSync.skippedReceiveCount ?? 0 },
  ];

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="serial-section-title mb-2">Live Rate Settings</div>
      <div className="server-small-note mb-3">
        Live telemetry rate only. Debug, client list, and raw monitor stay low-rate.
      </div>
      <Row className="g-2 align-items-end mb-3">
        <Col xs={12} md={6}>
          <Form.Label className="serial-mini-label">{isAdmin ? 'Server Publish Rate' : 'Viewer Receive Rate'}</Form.Label>
          <Form.Select
            size="sm"
            value={selectedHz}
            onChange={(event) => {
              if (isAdmin) safeServerSync.setServerPublishHz?.(event.target.value);
              else safeServerSync.setViewerReceiveHz?.(event.target.value);
            }}
          >
            {options.map((value) => (
              <option key={value} value={value}>{value} Hz</option>
            ))}
          </Form.Select>
        </Col>
        <Col xs={12} md={6}>
          <Badge bg={safeServerSync.liveDataStatus === 'LIVE' ? 'success' : safeServerSync.liveDataStatus === 'SLOW' ? 'warning' : 'secondary'}>
            {safeServerSync.liveDataStatus || 'NONE'}
          </Badge>
        </Col>
      </Row>
      {Number(selectedHz) === 50 ? (
        <Alert variant="warning" className="py-2">
          High rate can consume Render bandwidth quickly.
        </Alert>
      ) : null}
      <ValueGrid title={isAdmin ? 'Publish Status' : 'Receive Status'} rows={rows} />
    </div>
  );
}

function WebSerialBridgeDebugSection({ serverSync, status, isAdmin, webSerialConnected, webSerialLatestPacketUpdatedAt }) {
  const safeServerSync = serverSync || {};
  const safeStatus = status || {};
  const [isOpen, setIsOpen] = useState(false);
  const latestSharedPacketAgeMs = safeServerSync.latestSharedPacketAgeMs ?? safeStatus.latestSharedPacketAgeMs;
  const bridgeEnabled = Boolean(safeServerSync.bridgeEnabled);
  if (!isAdmin) return null;

  const rows = [
    { label: 'Current serverUrl', value: safeServerSync.serverUrl || '-' },
    { label: 'Publish endpoint full URL', value: safeServerSync.publishEndpointUrl || '-' },
    { label: 'Last publish HTTP status', value: safeServerSync.lastPublishHttpStatus ?? '-' },
    { label: 'Last publish time', value: formatDateTime(safeServerSync.lastPublishAt) },
    { label: 'Last publish error message', value: safeServerSync.lastPublishError || '-' },
    { label: 'Publish session', value: shortSessionId(safeServerSync.publishSessionId || safeStatus.publishSessionId) },
    { label: 'Publish count', value: safeServerSync.publishCount ?? 0 },
    { label: 'Failed publish count', value: safeServerSync.publishFailedCount ?? 0 },
    { label: 'Dropped wrong publisher', value: safeServerSync.droppedWrongPublisherCount ?? safeStatus.droppedWrongPublisherCount ?? 0 },
    { label: 'Dropped wrong session', value: safeServerSync.droppedWrongSessionCount ?? safeStatus.droppedWrongSessionCount ?? 0 },
    { label: 'Dropped out-of-order', value: safeServerSync.droppedOutOfOrderCount ?? safeStatus.droppedOutOfOrderCount ?? 0 },
    { label: 'latestSharedPacket age', value: latestSharedPacketAgeMs != null ? `${Math.round(latestSharedPacketAgeMs)} ms` : '-' },
    { label: 'bridgeEnabled', value: bridgeEnabled ? 'true' : 'false' },
    { label: 'Active publisher status', value: safeServerSync.activePublisherStatus || safeStatus.activePublisherStatus || 'NONE' },
    { label: 'Web Serial connected', value: webSerialConnected ? 'yes' : 'no' },
    { label: 'serial.latestPacket.updatedAt', value: formatDateTime(webSerialLatestPacketUpdatedAt) },
  ];

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="d-flex justify-content-between align-items-center gap-3">
        <div style={{ minWidth: 0 }}>
          <div className="serial-section-title">Bridge Publish Debug</div>
          <div className="server-small-note">
            Admin Web Serial publish diagnostics are hidden during normal demos.
          </div>
        </div>
        <Button
          type="button"
          variant="outline-secondary"
          size="sm"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-controls="bridge-publish-debug-details"
        >
          {isOpen ? 'Hide' : 'Show'}
        </Button>
      </div>

      {isOpen ? (
        <div id="bridge-publish-debug-details" className="mt-3">
          <div className="server-small-note mb-2">
            Admin Web Serial data must publish to the Node server endpoint, not the React dev server.
          </div>
          <ValueGrid title="Publish Status" rows={rows} />

          {safeServerSync.lastPublishError ? (
            <Alert variant={safeServerSync.lastPublishHttpStatus === 404 ? 'danger' : 'warning'} className="py-2 mt-3 mb-0 text-break">
              {safeServerSync.lastPublishError}
            </Alert>
          ) : null}
          {safeServerSync.publishBackoffUntil && Date.now() < safeServerSync.publishBackoffUntil ? (
            <Alert variant="warning" className="py-2 mt-3 mb-0">
              Publish is in temporary backoff after repeated 404 responses. Local Web Serial and 3D rendering continue.
            </Alert>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function ServerPanel({ serverSync, localSerial = null, webSerialConnected = false, webSerialLatestPacketUpdatedAt = null, webSerialInputHz = null, onChangeDisplayName = null, isActive = true }) {
  const safeServerSync = serverSync || {};
  const serial = safeServerSync.serverSerial || {};
  const status = serial.status || {};
  const access = status.access || {};
  const role = String(safeServerSync.role || access.myEffectiveRole || access.role || 'viewer').toLowerCase();
  const isAdmin = role === 'admin';
  const controllerClientId = access.controllerClientId || '';
  const isController = role === 'controller' || (controllerClientId && controllerClientId === safeServerSync.clientId);
  const controllerClient = findClient(access, controllerClientId);
  const controllerName = access.controllerDisplayName || access.controllerClientName || clientDisplayName(controllerClient);
  const commandOwner = access.commandOwner || (controllerClientId ? `Control assigned to: ${controllerName || shortClientId(controllerClientId)}` : 'Admin has control');
  const connectionStatus = safeServerSync.connectionStatus || 'disconnected';
  const latestPacketForCsvLogging = status.latestPacket
    || status.latestSharedPacket
    || safeServerSync.latestPacket
    || safeServerSync.latestSharedPacket
    || null;

  return (
    <div className="server-panel serial-panel pt-2">
      <div className="d-flex justify-content-between align-items-center mb-3 gap-2">
        <h3 className="h6 fw-bold text-uppercase m-0" style={{ color: '#aaa', letterSpacing: '0.08em' }}>
          Server
        </h3>
        <Badge bg={statusVariant(connectionStatus)}>{connectionStatus.toUpperCase()}</Badge>
      </div>

      <IdentitySection serverSync={safeServerSync} role={isController ? 'controller' : role} onChangeDisplayName={onChangeDisplayName} />
      <AdminLoginSection serverSync={safeServerSync} role={role} />
      <ServerConnectionSection serverSync={safeServerSync} />
      <DataLoggingSection latestPacket={latestPacketForCsvLogging} />
      <RoleNotice role={isController ? 'controller' : role} />
      <RpyConventionSection serverSync={safeServerSync} />
      <VisualSettingsSummary serverSync={safeServerSync} />
      <ServerSharingSection
        serverSync={safeServerSync}
        isAdmin={isAdmin}
        webSerialConnected={webSerialConnected}
      />
      <ReceiverInfoSection
        serverSync={safeServerSync}
        localSerial={localSerial}
        isAdmin={isAdmin}
        webSerialConnected={webSerialConnected}
      />
      <LiveRateSettingsSection serverSync={safeServerSync} isAdmin={isAdmin} webSerialInputHz={webSerialInputHz} />
      {isAdmin ? (
        <WebSerialBridgeDebugSection
          serverSync={safeServerSync}
          status={status}
          isAdmin={isAdmin}
          webSerialConnected={webSerialConnected}
          webSerialLatestPacketUpdatedAt={webSerialLatestPacketUpdatedAt}
        />
      ) : null}

      {isAdmin ? (
        <AdminManagementPanel
          serverSync={safeServerSync}
          serial={serial}
          status={status}
          access={access}
          role={role}
          controllerClientId={controllerClientId}
          commandOwner={commandOwner}
        />
      ) : null}

      <CommandSection
        serial={serial}
        status={status}
        role={role}
        controllerClientId={controllerClientId}
        isController={Boolean(isController)}
        localSerial={localSerial}
      />

      <MonitoringSection status={status} isActive={isActive} isAdmin={isAdmin} />
    </div>
  );
}
