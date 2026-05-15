import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, Alert, Badge, Button, Col, Form, Row } from 'react-bootstrap';

const CSV_COLUMNS = [
  'pc_time_ms',
  'published_at',
  'source',
  'source_label',
  'q0',
  'q1',
  'q2',
  'q3',
  'Roll_deg',
  'Pitch_deg',
  'Yaw_deg',
  'desired_roll_deg',
  'desired_pitch_deg',
  'desired_yaw_deg',
  'qerr_deg',
  'qerr_source',
  'wx',
  'wy',
  'wz',
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
  'control_mode',
  'EBIMU_status',
  'logging_status',
  'timestamp',
  'seq',
  'lastCommandKey',
  'lastCommandLabel',
  'raw',
];

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

function formatElapsedTime(ms) {
  const totalTenths = Math.floor(ms / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function packetToCsvRow(packet) {
  const row = {
    ...packet,
    pc_time_ms: packet.pc_time_ms ?? packet.pcTimeMs ?? packet.updatedAt,
    published_at: packet.publishedAt,
    source_label: packet.sourceLabel,
    Roll_deg: packet.Roll_deg ?? packet.roll_deg ?? packet.rollDeg,
    Pitch_deg: packet.Pitch_deg ?? packet.pitch_deg ?? packet.pitchDeg,
    Yaw_deg: packet.Yaw_deg ?? packet.yaw_deg ?? packet.yawDeg,
    qerr_source: packet.qerrSource,
    angular_rate_source: packet.angularRateSource,
    timestamp: packet.timestamp ?? packet.ebimu_timestamp_ms ?? packet.ebimuTimestampMs,
  };
  return CSV_COLUMNS.map((column) => csvEscape(row[column])).join(',');
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
  const [isLogging, setIsLogging] = useState(false);
  const [loggingStartTime, setLoggingStartTime] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [showMonitor, setShowMonitor] = useState(false);
  const logRef = useRef([]);
  const lastLoggedPacketTimeRef = useRef(0);

  const latest = serial.latestPacket || {};
  const stale = serial.lastReceivedAt ? Date.now() - serial.lastReceivedAt > 500 : true;
  const statusVariant = !serial.isConnected ? 'secondary' : stale ? 'warning' : 'success';
  const statusText = !serial.isConnected ? 'DISCONNECTED' : stale ? 'STALE' : 'LIVE';
  const adminLocked = !isAdmin;
  const commandDisabled = adminLocked || !serial.isConnected;

  const emitCommandEvent = React.useCallback((eventType, label, detail = {}) => {
    if (!onCommandEvent) return;
    onCommandEvent({
      source: 'admin-web-serial',
      eventType,
      label,
      detail,
    });
  }, [onCommandEvent]);

  useEffect(() => {
    if (!isLogging || loggingStartTime == null) return undefined;
    const timer = setInterval(() => setElapsedMs(Date.now() - loggingStartTime), 100);
    return () => clearInterval(timer);
  }, [isLogging, loggingStartTime]);

  useEffect(() => {
    if (!isLogging) return;
    if (!latest?.updatedAt) return;
    if (latest.updatedAt === lastLoggedPacketTimeRef.current) return;
    logRef.current.push({ ...latest });
    lastLoggedPacketTimeRef.current = latest.updatedAt;
  }, [isLogging, latest]);

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

  const qerrRows = useMemo(() => [
    { label: 'qerr_deg', value: latest.qerr_deg != null || latest.qerrDeg != null ? `${formatNumber(latest.qerr_deg ?? latest.qerrDeg, 2)} deg` : '-' },
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

  const telemetryStatusRows = useMemo(() => [
    { label: 'control_mode', value: formatStatusToken(latest.control_mode) },
    { label: 'EBIMU_status', value: formatStatusToken(latest.EBIMU_status) },
    { label: 'logging_status', value: formatStatusToken(latest.logging_status) },
  ], [latest]);

  const encoderRows = useMemo(() => [
    { label: 'Encoder X', value: `${formatNumber(latest.enc_x_deg, 2)}°` },
    { label: 'Encoder Y', value: `${formatNumber(latest.enc_y_deg, 2)}°` },
    { label: 'Encoder Z', value: `${formatNumber(latest.enc_z_deg, 2)}°` },
    { label: 'enc q0', value: formatNumber(latest.enc_q0, 5) },
    { label: 'enc q1', value: formatNumber(latest.enc_q1, 5) },
    { label: 'enc q2', value: formatNumber(latest.enc_q2, 5) },
    { label: 'enc q3', value: formatNumber(latest.enc_q3, 5) },
  ], [latest]);

  const statusRows = useMemo(() => [
    { label: 'Source', value: latest.sourceLabel || 'Admin Web Serial Bridge' },
    { label: 'Baudrate', value: `${serial.baudRate} bps` },
    { label: 'Timestamp', value: `${formatNumber(latest.ebimu_timestamp_ms, 0)}` },
    { label: 'Seq / RX', value: `${formatNumber(latest.seq, 0)} / ${formatNumber(latest.rxCount, 0)}` },
    { label: 'Valid / Invalid', value: `${serial.validCount} / ${serial.invalidCount}` },
    { label: 'Ignored', value: `${serial.ignoredCount ?? 0}` },
    { label: 'Warning', value: `${serial.warningCount || 0}` },
    { label: 'Last RX', value: formatDateTime(serial.lastReceivedAt) },
    { label: 'Last command', value: serial.lastCommand || '-' },
  ], [latest, serial]);

  const handleStartLogging = () => {
    logRef.current = [];
    lastLoggedPacketTimeRef.current = 0;
    setElapsedMs(0);
    setLoggingStartTime(Date.now());
    setIsLogging(true);
  };

  const handleStopLogging = () => {
    if (loggingStartTime != null) setElapsedMs(Date.now() - loggingStartTime);
    setIsLogging(false);
    setLoggingStartTime(null);
  };

  const handleDownloadCsv = () => {
    if (logRef.current.length === 0) {
      alert('저장된 Serial 데이터가 없습니다. Start Logging 후 packet을 수신해 주세요.');
      return;
    }
    const csv = [CSV_COLUMNS.join(','), ...logRef.current.map(packetToCsvRow)].join('\n');
    downloadTextFile(`CubeController_Remote_Log_${Date.now()}.csv`, `${csv}\n`);
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
      </div>
      ) : null}

      {isAdmin ? (
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

          <CommandAccordionItem eventKey="stream" title="EBIMU Stream">
            <CommandGroup>
              <CommandButton label="Default Setup" onClick={() => sendEbimuRuntime(EBIMU_COMMANDS.DEFAULT, 0, 'EBIMU Default Setup')} disabled={commandDisabled} />
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

      <Row className="g-2 mb-3">
        <Col xs={12} xl={6}><ValueGrid title="IMU Quaternion" rows={quaternionRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Current RPY (computed from quaternion)" rows={attitudeRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Attitude Error" rows={qerrRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Angular Rate" rows={rateRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Reaction Wheel Speed" rows={wheelRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Telemetry Status" rows={telemetryStatusRows} /></Col>
        <Col xs={12}><ValueGrid title="Encoder" rows={encoderRows} /></Col>
        <Col xs={12}><ValueGrid title="Receiver" rows={statusRows} /></Col>
      </Row>

      <div className="serial-control-card rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="serial-section-title">Logging</div>
          <Badge bg={isLogging ? 'danger' : 'secondary'}>{isLogging ? 'REC' : 'IDLE'}</Badge>
        </div>
        <div className="serial-timer mb-2">{formatElapsedTime(elapsedMs)}</div>
        <div className="d-grid gap-2">
          {isLogging ? (
            <Button variant="danger" onClick={handleStopLogging}>Stop Logging</Button>
          ) : (
            <Button variant="outline-success" onClick={handleStartLogging}>Start Logging</Button>
          )}
          <Button variant="outline-light" onClick={handleDownloadCsv}>Download CSV</Button>
        </div>
      </div>

      <div className="serial-control-card rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="serial-section-title">Monitor</div>
          <Form.Check type="switch" id="show-serial-monitor" label="Show" checked={showMonitor} onChange={(e) => setShowMonitor(e.target.checked)} />
        </div>
        {showMonitor ? <div className="serial-note-visible text-break">Last raw line: {serial.lastRawLine || '-'}</div> : null}
      </div>

      {serial.lastInvalidReason ? <Alert variant="warning" className="py-2">Parser note: {serial.lastInvalidReason}</Alert> : null}
    </div>
  );
}
