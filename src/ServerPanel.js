import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, Alert, Badge, Button, Col, Form, Row } from 'react-bootstrap';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

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
const WEB_APP_URL = 'https://cubli-remote-web-gui.onrender.com';
const EULER_SEQUENCE_OPTIONS = ['ZYX', 'XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY'];
const ATTITUDE_GAIN_DEFAULTS = {
  kp: { x: '0.040', y: '0.040', z: '0.040' },
  kd: { x: '0.080', y: '0.080', z: '0.080' },
};
const ATTITUDE_GAIN_MIN = 0;
const ATTITUDE_GAIN_MAX = 10;
const ATTITUDE_GAIN_STEP = 0.001;
const LOG_COLUMNS = [
  'pc_time_ms', 'published_at', 'source', 'source_label',
  'imu_euler_sequence', 'rpy_source',
  'q0', 'q1', 'q2', 'q3', 'norm',
  'Roll_deg', 'Pitch_deg', 'Yaw_deg',
  'desired_roll_deg', 'desired_pitch_deg', 'desired_yaw_deg',
  'qerr_deg',
  'qerr_source',
  'wx', 'wy', 'wz', 'angular_rate_source',
  'RPM1', 'RPM2', 'RPM3', 'RPMcmd1', 'RPMcmd2', 'RPMcmd3',
  'PWM1', 'PWM2', 'PWM3',
  'Tbodycmd_x_Nm', 'Tbodycmd_y_Nm', 'Tbodycmd_z_Nm',
  'Tmotor1_Nm', 'Tmotor2_Nm', 'Tmotor3_Nm',
  'control_mode', 'EBIMU_status', 'logging_status',
  'timestamp', 'seq',
  'enc_x_deg', 'enc_y_deg', 'enc_z_deg',
  'enc_q0', 'enc_q1', 'enc_q2', 'enc_q3',
  'encoder_roll_deg', 'encoder_pitch_deg', 'encoder_yaw_deg',
  'encoder_euler_sequence', 'encoder_rpy_source', 'encoder_status',
  'enc_timer_x', 'enc_timer_y', 'enc_timer_z',
  'encoder_source', 'encoder_updated_at',
  'lastCommandKey', 'lastCommandLabel',
  'raw',
];
const EMPTY_OBJECT = Object.freeze({});

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
  const updatedAt = encoderNumber(packet, 'encoderUpdatedAt', 'encoderUpdatedAt', 'updatedAt');
  const rollDeg = encoderNumber(packet, 'encoderRollDeg', 'encoderRollDeg', 'rollDeg');
  const pitchDeg = encoderNumber(packet, 'encoderPitchDeg', 'encoderPitchDeg', 'pitchDeg');
  const yawDeg = encoderNumber(packet, 'encoderYawDeg', 'encoderYawDeg', 'yawDeg');
  const source = encoderText(packet, 'encoderSource', 'source');
  const eulerSequence = encoderText(packet, 'encoderEulerSequence', 'eulerSequence', 'ZYX') || 'ZYX';
  const rpySource = encoderText(packet, 'encoderRpySource', 'rpySource');
  const explicitStatus = encoderText(packet, 'encoderStatus', 'status').toUpperCase();
  const hasValues = [x, y, z, q0, q1, q2, q3, timerX, timerY, timerZ].some((value) => value !== null);
  const hasAllAxes = [x, y, z].every((value) => value !== null);
  const hasQuaternion = [q0, q1, q2, q3].every((value) => value !== null);
  const ageMs = hasValues && updatedAt ? Math.max(0, now - updatedAt) : null;
  const status = explicitStatus || (!hasValues ? 'NONE' : (ageMs !== null && ageMs > 1000 ? 'STALE' : (hasAllAxes && hasQuaternion ? 'LIVE' : 'PARTIAL')));
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
    rollDeg,
    pitchDeg,
    yawDeg,
    updatedAt,
    ageMs,
    source,
    eulerSequence,
    rpySource,
    hasQuaternion,
    status,
  };
}

function buildEncoderRows(packet = {}) {
  const encoder = getEncoderSnapshot(packet);
  const rows = [
    { label: 'Encoder status', value: encoder.status },
    { label: 'Encoder X [deg]', value: encoder.x !== null ? formatNumber(encoder.x, 2) : '-' },
    { label: 'Encoder Y [deg]', value: encoder.y !== null ? formatNumber(encoder.y, 2) : '-' },
    { label: 'Encoder Z [deg]', value: encoder.z !== null ? formatNumber(encoder.z, 2) : '-' },
  ];
  if ([encoder.q0, encoder.q1, encoder.q2, encoder.q3].some((value) => value !== null)) {
    rows.push(
      { label: 'Encoder q0', value: encoder.q0 !== null ? formatNumber(encoder.q0, 5) : '-' },
      { label: 'Encoder q1', value: encoder.q1 !== null ? formatNumber(encoder.q1, 5) : '-' },
      { label: 'Encoder q2', value: encoder.q2 !== null ? formatNumber(encoder.q2, 5) : '-' },
      { label: 'Encoder q3', value: encoder.q3 !== null ? formatNumber(encoder.q3, 5) : '-' },
    );
  }
  rows.push(
    { label: `Encoder RPY [${encoder.eulerSequence}]`, value: encoder.hasQuaternion ? 'available' : 'unavailable' },
    { label: 'Encoder Roll', value: encoder.rollDeg !== null ? `${formatNumber(encoder.rollDeg, 2)} deg` : '-' },
    { label: 'Encoder Pitch', value: encoder.pitchDeg !== null ? `${formatNumber(encoder.pitchDeg, 2)} deg` : '-' },
    { label: 'Encoder Yaw', value: encoder.yawDeg !== null ? `${formatNumber(encoder.yawDeg, 2)} deg` : '-' },
    { label: 'Encoder RPY source', value: encoder.rpySource || '-' },
  );
  if ([encoder.timerX, encoder.timerY, encoder.timerZ].some((value) => value !== null)) {
    rows.push(
      { label: 'Encoder timer X', value: encoder.timerX !== null ? formatNumber(encoder.timerX, 0) : '-' },
      { label: 'Encoder timer Y', value: encoder.timerY !== null ? formatNumber(encoder.timerY, 0) : '-' },
      { label: 'Encoder timer Z', value: encoder.timerZ !== null ? formatNumber(encoder.timerZ, 0) : '-' },
    );
  }
  rows.push(
    { label: 'Encoder source', value: encoder.source || '-' },
    { label: 'Encoder updated', value: formatDateTime(encoder.updatedAt) },
    { label: 'Encoder age', value: encoder.ageMs !== null ? `${formatNumber(encoder.ageMs, 0)} ms` : '-' },
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

function clientDisplayName(client = {}) {
  const safeClient = client || {};
  return String(safeClient?.displayName || safeClient?.clientName || '').trim();
}

function clientLabel(client = {}) {
  const safeClient = client || {};
  const fallbackId = shortClientId(safeClient?.clientId);
  return clientDisplayName(safeClient) || (fallbackId === '-' ? 'Unknown' : fallbackId);
}

function findClient(access = {}, clientId = '') {
  const safeAccess = access || {};
  const targetClientId = String(clientId || '').trim();
  if (!targetClientId) return null;
  const clients = Array.isArray(safeAccess?.clients) ? safeAccess.clients.filter(Boolean) : [];
  return clients.find((client) => client?.clientId === targetClientId) || null;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
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

function normalizePacketForLog(packet) {
  const source = packet || {};
  return {
    pc_time_ms: source.pc_time_ms ?? source.pcTimeMs ?? source.updatedAt ?? Date.now(),
    published_at: source.publishedAt ?? source.serverReceivedAt ?? source.serverReceivedAtMs ?? '',
    source: source.source || 'server-serial',
    source_label: source.sourceLabel || '',
    imu_euler_sequence: source.imuEulerSequence || '',
    rpy_source: source.rpySource || '',
    q0: source.q0,
    q1: source.q1,
    q2: source.q2,
    q3: source.q3,
    norm: source.norm,
    Roll_deg: source.Roll_deg ?? source.roll_deg ?? source.rollDeg,
    Pitch_deg: source.Pitch_deg ?? source.pitch_deg ?? source.pitchDeg,
    Yaw_deg: source.Yaw_deg ?? source.yaw_deg ?? source.yawDeg,
    desired_roll_deg: source.desired_roll_deg ?? source.desiredRollDeg,
    desired_pitch_deg: source.desired_pitch_deg ?? source.desiredPitchDeg,
    desired_yaw_deg: source.desired_yaw_deg ?? source.desiredYawDeg,
    qerr_deg: source.qerr_deg ?? source.qerrDeg,
    qerr_source: source.qerrSource,
    wx: source.wx,
    wy: source.wy,
    wz: source.wz,
    angular_rate_source: source.angularRateSource,
    RPM1: source.RPM1,
    RPM2: source.RPM2,
    RPM3: source.RPM3,
    RPMcmd1: source.RPMcmd1,
    RPMcmd2: source.RPMcmd2,
    RPMcmd3: source.RPMcmd3,
    PWM1: source.PWM1,
    PWM2: source.PWM2,
    PWM3: source.PWM3,
    Tbodycmd_x_Nm: source.Tbodycmd_x_Nm,
    Tbodycmd_y_Nm: source.Tbodycmd_y_Nm,
    Tbodycmd_z_Nm: source.Tbodycmd_z_Nm,
    Tmotor1_Nm: source.Tmotor1_Nm,
    Tmotor2_Nm: source.Tmotor2_Nm,
    Tmotor3_Nm: source.Tmotor3_Nm,
    control_mode: source.control_mode,
    EBIMU_status: source.EBIMU_status,
    logging_status: source.logging_status,
    timestamp: source.timestamp ?? source.ebimu_timestamp_ms,
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
    encoder_euler_sequence: source.encoderEulerSequence ?? source.encoder?.eulerSequence,
    encoder_rpy_source: source.encoderRpySource ?? source.encoder?.rpySource,
    encoder_status: source.encoderStatus ?? source.encoder?.status,
    enc_timer_x: source.enc_timer_x ?? source.encoderTimerX ?? source.encoder?.timerX ?? source.encoder?.timer_x,
    enc_timer_y: source.enc_timer_y ?? source.encoderTimerY ?? source.encoder?.timerY ?? source.encoder?.timer_y,
    enc_timer_z: source.enc_timer_z ?? source.encoderTimerZ ?? source.encoder?.timerZ ?? source.encoder?.timer_z,
    encoder_source: source.encoderSource || source.encoder?.source,
    encoder_updated_at: source.encoderUpdatedAt ?? source.encoder?.updatedAt,
    lastCommandKey: source.lastCommandKey,
    lastCommandLabel: source.lastCommandLabel,
    raw: source.raw || '',
  };
}

function packetToCsvRow(packet) {
  const row = normalizePacketForLog(packet);
  return LOG_COLUMNS.map((column) => csvEscape(row[column])).join(',');
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
          <div className="server-small-note">clientId: {shortClientId(safeServerSync?.clientId)}</div>
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
          <div className="server-small-note text-break">Client ID: {safeServerSync?.clientId || '-'}</div>
          <div className="server-small-note">Admin credentials are configured on server. Default and legacy Admin logins are accepted.</div>
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
  const copyWebAppLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(WEB_APP_URL).catch(() => {});
    }
  };
  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="serial-section-title mb-2">Connection</div>
      <div className="serial-value-card rounded p-2 mb-3">
        <ValueRow label="Web App Link" value={WEB_APP_URL} />
        <div className="d-flex gap-2 mt-2">
          <Button variant="outline-info" size="sm" href={WEB_APP_URL} target="_blank" rel="noreferrer">
            Open Web App
          </Button>
          <Button variant="outline-light" size="sm" onClick={copyWebAppLink}>
            Copy Link
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
          placeholder="http://localhost:5050"
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
          <Form.Label className="serial-mini-label">Encoder RPY Sequence</Form.Label>
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
    </div>
  );
}

function AdminManagementPanel({ serverSync, serial, status, access, role, controllerClientId, commandOwner }) {
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
  const myName = String(safeServerSync?.displayName || safeServerSync?.clientName || safeAccess?.displayName || safeAccess?.clientName || '').trim()
    || shortClientId(safeServerSync?.clientId)
    || 'Unnamed';

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="serial-section-title mb-3">Admin Management</div>

      <div className="serial-value-card rounded p-2 mb-3">
        <ValueRow label="My role" value="Admin" />
        <ValueRow label="My name" value={`${myName} (me)`} />
        <ValueRow label="My clientId" value={shortClientId(safeServerSync.clientId)} />
        <ValueRow label="Current controller" value={controllerValue} />
        <ValueRow label="Command owner" value={commandOwner} />
        <ValueRow label="Connected clients" value={safeAccess.connectedClientCount ?? connectedClients.length} />
      </div>

      <Button
        variant="danger"
        size="lg"
        className="w-100 mb-3 fw-bold"
        onClick={safeSerial.sendEmergencyStop}
        disabled={!safeStatus.bridge?.adminBridgeLive}
      >
        Emergency Stop
      </Button>

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

function CommandSection({ serial, status, role, controllerClientId, isController }) {
  const safeSerial = serial || {};
  const safeStatus = status || {};
  const [targetRoll, setTargetRoll] = useState(0);
  const [targetPitch, setTargetPitch] = useState(0);
  const [targetYaw, setTargetYaw] = useState(0);
  const [accFactor, setAccFactor] = useState(10);
  const [kpGain, setKpGain] = useState(ATTITUDE_GAIN_DEFAULTS.kp);
  const [kdGain, setKdGain] = useState(ATTITUDE_GAIN_DEFAULTS.kd);
  const [gainStatus, setGainStatus] = useState('');

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

  if (!canViewCommand) return null;

  const sendShortcut = (commandKey, label, params = {}) => safeSerial.sendEbimuShortcut?.(commandKey, label, params);
  const sendAccFactor = (value) => safeSerial.sendAccFactor?.(Number(value) || 10);
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
          <CommandGroup>
            <CommandButton label="Cubli Initialize" onClick={safeSerial.sendCubliInitialize} disabled={!canSendCommand} />
            <CommandButton label="Encoder Initialize" onClick={safeSerial.sendEncoderInitialize} disabled={!canSendCommand} />
            <CommandButton label="Set Zero / Tare" onClick={safeSerial.sendTare} disabled={!canSendCommand} />
            <CommandButton label="Stop" onClick={safeSerial.sendStop} disabled={!canSendCommand} />
            <CommandButton label="Emergency Stop" onClick={safeSerial.sendEmergencyStop} disabled={!canSendCommand} />
          </CommandGroup>
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="target" title="Target Attitude">
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
                onClick={() => safeSerial.sendTarget?.(Number(targetRoll) || 0, Number(targetPitch) || 0, Number(targetYaw) || 0)}
              >
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
            <CommandButton label="Send Kp" onClick={sendAttitudeKp} disabled={!canSendCommand || !kpValues} />
            <CommandButton label="Send Kd" onClick={sendAttitudeKd} disabled={!canSendCommand || !kdValues} />
            <CommandButton label="Send Kp + Kd" onClick={sendAttitudeGains} disabled={!canSendCommand || gainInputInvalid} />
            <CommandButton label="Reset to Default" onClick={resetAttitudeGains} disabled={false} />
          </CommandGroup>
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="stream" title="EBIMU Stream">
          <CommandGroup>
            <CommandButton label="EBIMU Default Setup" onClick={() => sendShortcut('ebimuDefault', 'EBIMU Default Setup')} disabled={!canSendCommand} />
            <CommandButton label="EBIMU Start" onClick={() => sendShortcut('ebimuStart', 'EBIMU Start')} disabled={!canSendCommand} />
            <CommandButton label="EBIMU Stop" onClick={() => sendShortcut('ebimuStop', 'EBIMU Stop')} disabled={!canSendCommand} />
          </CommandGroup>
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="mag" title="Magnetometer">
          <CommandGroup>
            {MAG_OPTIONS.map((item) => (
              <CommandButton key={item.commandKey} label={item.label} onClick={() => sendShortcut(item.commandKey, item.label)} disabled={!canSendCommand} />
            ))}
          </CommandGroup>
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="gyro" title="Gyro Range">
          <CommandGroup>
            {GYRO_OPTIONS.map((item) => (
              <CommandButton key={item.commandKey} label={item.label} onClick={() => sendShortcut(item.commandKey, item.label)} disabled={!canSendCommand} />
            ))}
          </CommandGroup>
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="accel" title="Accelerometer">
          <div className="serial-subsection-title mb-2">Range</div>
          <CommandGroup>
            {ACCEL_OPTIONS.map((item) => (
              <CommandButton key={item.commandKey} label={item.label} onClick={() => sendShortcut(item.commandKey, item.label)} disabled={!canSendCommand} />
            ))}
          </CommandGroup>

          <div className="serial-subsection-title mt-3 mb-2">Filter Factor</div>
          <Row className="g-2 align-items-end mb-2">
            <Col xs={7}>
              <Form.Control size="sm" type="number" min="1" max="50" value={accFactor} onChange={(event) => setAccFactor(event.target.value)} />
            </Col>
            <Col xs={5}>
              <Button variant="outline-light" className="w-100" disabled={!canSendCommand} onClick={() => sendAccFactor(accFactor)}>
                Apply
              </Button>
            </Col>
          </Row>
          <CommandGroup>
            {FILTER_PRESETS.map((value) => (
              <CommandButton key={value} label={`${value}`} onClick={() => sendAccFactor(value)} disabled={!canSendCommand} />
            ))}
          </CommandGroup>
        </CommandAccordionItem>

        <CommandAccordionItem eventKey="receiver" title="Receiver Info">
          <CommandGroup>
            <CommandButton label="Status" onClick={safeSerial.sendStatus} disabled={!canSendCommand} />
            <CommandButton label="MAC Info" onClick={safeSerial.sendMacInfo} disabled={!canSendCommand} />
            <CommandButton label="Refresh Status" onClick={safeSerial.refreshStatus} disabled={false} />
          </CommandGroup>
        </CommandAccordionItem>
      </Accordion>
    </div>
  );
}

function MonitoringSection({ status, isActive = true }) {
  const safeStatus = status ?? EMPTY_OBJECT;
  const latest = useMemo(() => safeStatus.latestPacket || {}, [safeStatus.latestPacket]);
  const lastCommandInfo = useMemo(() => safeStatus.lastCommandInfo || {}, [safeStatus.lastCommandInfo]);
  const latestDesired = useMemo(() => safeStatus.latestDesiredAttitude || {}, [safeStatus.latestDesiredAttitude]);
  const [showRawMonitor, setShowRawMonitor] = useState(false);
  const [showLivePlot, setShowLivePlot] = useState(true);
  const [showWheelGraphs, setShowWheelGraphs] = useState(false);
  const [showDebugTelemetry, setShowDebugTelemetry] = useState(false);

  const sharedRows = useMemo(() => [
    { label: 'Shared Live Data', value: safeStatus.liveStatus || (latest?.publishedAt ? 'LIVE' : 'NONE') },
    { label: 'Published source', value: latest.sourceLabel || latest.source || '-' },
    { label: 'Publisher', value: latest.publisherDisplayName || safeStatus.publisherDisplayName || latest.publisherClientId || safeStatus.publisherClientId || (latest.source === 'server-serial' ? 'server' : '-') },
    { label: 'Last publish time', value: formatDateTime(latest.publishedAt || safeStatus.publishedAt) },
  ], [latest, safeStatus.liveStatus, safeStatus.publishedAt, safeStatus.publisherClientId, safeStatus.publisherDisplayName]);

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
    { label: 'Sequence', value: latest.imuEulerSequence || 'ZYX' },
    { label: 'Source', value: latest.rpySource || `quaternion ${latest.imuEulerSequence || 'ZYX'}` },
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
    { label: 'wz (rad/s)', value: latest.wz != null ? formatNumber(latest.wz, 4) : '-' },
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
    { label: 'control_mode', value: formatStatusToken(latest.control_mode) },
    { label: 'EBIMU_status', value: formatStatusToken(latest.EBIMU_status) },
    { label: 'logging_status', value: formatStatusToken(latest.logging_status) },
  ], [latest]);

  const encoderRows = useMemo(() => buildEncoderRows(latest), [latest]);

  const frameRows = useMemo(() => [
    { label: 'Attitude quaternion source', value: latest.attitudeSource || latest.sourceLabel || latest.source || '-' },
    { label: 'Current RPY source', value: latest.rpySource || `quaternion ${latest.imuEulerSequence || 'ZYX'}` },
    { label: 'Encoder RPY source', value: latest.encoderRpySource || '-' },
    { label: '3D rendering', value: 'quaternion' },
    { label: 'Frame convention', value: 'current Cubli display mapping' },
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
        encX: n(row.encX ?? row.enc_x_deg ?? row.encoderXDeg),
        encY: n(row.encY ?? row.enc_y_deg ?? row.encoderYDeg),
        encZ: n(row.encZ ?? row.enc_z_deg ?? row.encoderZDeg),
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

  const timeCommandRows = useMemo(() => [
    { label: 'Server time', value: formatDateTime(latest.serverReceivedAt || latest.serverReceivedAtMs || latest.pcTimeMs || latest.pc_time_ms) },
    { label: 'Session elapsed', value: formatDuration(latest.sessionElapsedMs ?? safeStatus.sessionElapsedMs) },
    { label: 'Remote timestamp', value: formatNumber(latest.ebimu_timestamp_ms ?? latest.timestamp, 0) },
    { label: 'seq', value: formatNumber(latest.seq, 0) },
    { label: 'Last command', value: latest.lastCommandLabel || lastCommandInfo.label || '-' },
    { label: 'Command key', value: latest.lastCommandKey || lastCommandInfo.commandKey || '-' },
    { label: 'Detail', value: formatCommandParams(latest.lastCommandParams || lastCommandInfo.params) },
    { label: 'Sent line', value: latest.lastCommandLineSent || lastCommandInfo.serialLineSent || '-' },
    { label: 'By', value: latest.lastCommandByClientId || lastCommandInfo.clientId || '-' },
    { label: 'Allowed', value: typeof (latest.lastCommandAllowed ?? lastCommandInfo.allowed) === 'boolean' ? String(latest.lastCommandAllowed ?? lastCommandInfo.allowed) : '-' },
    { label: 'Reason', value: latest.lastCommandDenied ? (lastCommandInfo.reason || 'denied') : (lastCommandInfo.reason || '-') },
    { label: 'Last command time', value: formatDateTime(latest.lastCommandAt || lastCommandInfo.at) },
  ], [latest, lastCommandInfo, safeStatus.sessionElapsedMs]);

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
        <Col xs={12} xl={6}><ValueGrid title="IMU Quaternion" rows={quaternionRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title={`Current RPY [${latest.imuEulerSequence || 'ZYX'}]`} rows={rpyRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Desired RPY (last command)" rows={commandStateRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Attitude Error" rows={qerrRows} /></Col>
        <Col xs={12} xl={6}>
          <ValueGrid title="Angular Rate" rows={rateRows} />
          {formatSourceLabel(latest.angularRateSource) === 'satellite body rate' ? (
            <div className="server-small-note mt-1">Satellite body angular rate telemetry, units rad/s.</div>
          ) : (
            <div className="server-small-note mt-1">Estimated from quaternion difference, units rad/s.</div>
          )}
        </Col>
        <Col xs={12} xl={6}><ValueGrid title="Reaction Wheel Speed" rows={wheelRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Encoder Reference" rows={encoderRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Direction / Frame" rows={frameRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Status" rows={statusRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Smoothed RPY (computed display)" rows={smoothedRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Time / Command" rows={timeCommandRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Serial Receiver" rows={receiverRows} /></Col>
      </Row>

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

      <div className="serial-control-card rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="serial-section-title">Debug Telemetry</div>
          <Form.Check type="switch" id="show-debug-telemetry" label="Show" checked={showDebugTelemetry} onChange={(event) => setShowDebugTelemetry(event.target.checked)} />
        </div>
        {showDebugTelemetry ? <ValueGrid title="PWM / Torque Telemetry" rows={debugRows} /> : null}
      </div>

      <div className="serial-control-card rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div>
            <div className="serial-section-title">Live Plot</div>
            <div className="server-small-note">Recent shared packets from Admin Web Serial Bridge. This plot is placed above Raw Monitor for quick checking.</div>
          </div>
          <Form.Check type="switch" id="show-server-live-plot" label="Show" checked={showLivePlot} onChange={(event) => setShowLivePlot(event.target.checked)} />
        </div>
        {showLivePlot && isActive ? (
          <Row className="g-2">
            <Col xs={12} xl={6}>
              <LiveTelemetryChart
                title="Current RPY"
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
                title="Encoder Reference Angle"
                data={livePlotData}
                yLabel="deg"
                lines={[
                  { key: 'encX', name: 'Enc X [deg]', stroke: '#20c997' },
                  { key: 'encY', name: 'Enc Y [deg]', stroke: '#ffa94d' },
                  { key: 'encZ', name: 'Enc Z [deg]', stroke: '#f06595' },
                ]}
              />
            </Col>
            <Col xs={12} xl={6}>
              <LiveTelemetryChart
                title={`Encoder RPY [${latest.encoderEulerSequence || 'ZYX'}]`}
                data={livePlotData}
                yLabel="deg"
                lines={[
                  { key: 'encoderRoll', name: 'Encoder Roll', stroke: '#63e6be' },
                  { key: 'encoderPitch', name: 'Encoder Pitch', stroke: '#ffd43b' },
                  { key: 'encoderYaw', name: 'Encoder Yaw', stroke: '#ff8787' },
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

      <div className="serial-control-card rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="serial-section-title">Raw Monitor</div>
          <Form.Check type="switch" id="show-server-raw-monitor" label="Show" checked={showRawMonitor} onChange={(event) => setShowRawMonitor(event.target.checked)} />
        </div>
        {showRawMonitor ? <div className="serial-raw-line">{safeStatus.lastRawLine || '-'}</div> : null}
      </div>
    </>
  );
}

function DataLoggingSection({ latestPacket }) {
  const logRef = useRef([]);
  const lastLoggedPacketTimeRef = useRef(0);

  useEffect(() => {
    const packetTime = latestPacket?.publishedAt || latestPacket?.updatedAt;
    if (!packetTime) return;
    if (packetTime === lastLoggedPacketTimeRef.current) return;
    logRef.current.push({ ...latestPacket });
    lastLoggedPacketTimeRef.current = packetTime;
    if (logRef.current.length > 2000) logRef.current.splice(0, logRef.current.length - 2000);
  }, [latestPacket]);

  const handleDownloadCsv = () => {
    if (logRef.current.length === 0) {
      alert('No shared live data has been logged yet.');
      return;
    }
    const csv = [LOG_COLUMNS.join(','), ...logRef.current.map(packetToCsvRow)].join('\n');
    downloadTextFile(`Server_Serial_Log_${Date.now()}.csv`, `${csv}\n`);
  };

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <div>
          <div className="serial-section-title">CSV Download</div>
          <div className="server-small-note">Recent shared live packets captured in this browser.</div>
        </div>
        <Badge bg="secondary">{logRef.current.length}</Badge>
      </div>
      <Button variant="outline-light" className="w-100" onClick={handleDownloadCsv}>Download CSV</Button>
    </div>
  );
}

function ServerSharingSection({ serverSync, isAdmin, webSerialConnected }) {
  const safeServerSync = serverSync || {};
  const bridgeEnabled = Boolean(safeServerSync.bridgeEnabled);
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
    { label: 'Publish count', value: safeServerSync.publishCount ?? 0 },
    { label: 'Failed publish count', value: safeServerSync.publishFailedCount ?? 0 },
    { label: 'latestSharedPacket age', value: latestSharedPacketAgeMs != null ? `${Math.round(latestSharedPacketAgeMs)} ms` : '-' },
    { label: 'bridgeEnabled', value: bridgeEnabled ? 'true' : 'false' },
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

export default function ServerPanel({ serverSync, webSerialConnected = false, webSerialLatestPacketUpdatedAt = null, onChangeDisplayName = null, isActive = true }) {
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
      <RoleNotice role={isController ? 'controller' : role} />
      <RpyConventionSection serverSync={safeServerSync} />
      <ServerSharingSection
        serverSync={safeServerSync}
        isAdmin={isAdmin}
        webSerialConnected={webSerialConnected}
      />
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
      />

      <MonitoringSection status={status} isActive={isActive} />
      <DataLoggingSection latestPacket={status.latestPacket} />
    </div>
  );
}
