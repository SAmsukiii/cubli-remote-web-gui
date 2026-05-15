import React, { useMemo, useState } from 'react';
import { Accordion, Alert, Badge, Button, Col, Form, Row, Table } from 'react-bootstrap';

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

function formatNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toFixed(digits);
}

function formatDateTime(timestamp) {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleTimeString('ko-KR', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

function StatusBadge({ status }) {
  if (status === 'connected') return <Badge bg="success">LIVE</Badge>;
  if (status === 'stale') return <Badge bg="warning" text="dark">STALE</Badge>;
  if (status === 'unsupported') return <Badge bg="danger">UNSUPPORTED</Badge>;
  return <Badge bg="secondary">DISCONNECTED</Badge>;
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

export default function BlePanel({ ble, useBleImu, setUseBleImu, activeSourceLabel, onCommandEvent, isAdmin = false }) {
  const latestPacket = ble.latestPacket || {};
  const env = ble.bleEnvironment || {};
  const validPercent = useMemo(() => `${(ble.validRatio * 100).toFixed(1)}%`, [ble.validRatio]);
  const [targetRoll, setTargetRoll] = useState(0);
  const [targetPitch, setTargetPitch] = useState(0);
  const [targetYaw, setTargetYaw] = useState(0);
  const [accFactor, setAccFactor] = useState(10);
  const [showRecent, setShowRecent] = useState(false);

  const adminLocked = !isAdmin;
  const commandDisabled = adminLocked || !ble.isConnected || !ble.hasCommandCharacteristic;

  const emitCommandEvent = React.useCallback((eventType, label, detail = {}) => {
    if (!onCommandEvent) return;
    onCommandEvent({
      source: 'ble',
      eventType,
      label,
      detail,
    });
  }, [onCommandEvent]);

  const sendBleCommand = async (command, meta = {}) => {
    const body = String(command || '').trim();
    if (!body) return false;

    emitCommandEvent(meta.eventType || 'BLE_COMMAND', meta.label || 'BLE Command', {
      command: body,
      ...(meta.detail || {}),
    });

    return ble.sendCommand(body);
  };

  const sendController = (type, v1 = 0, v2 = 0, v3 = 0, meta = {}) => {
    const commandType = Number(type) || 0;
    const target1 = Number(v1) || 0;
    const target2 = Number(v2) || 0;
    const target3 = Number(v3) || 0;
    return sendBleCommand(`${commandType} ${target1} ${target2} ${target3}`, {
      eventType: meta.eventType || 'COMMAND',
      label: meta.label || 'Controller Command',
      detail: { commandType, target1, target2, target3, ...(meta.detail || {}) },
    });
  };

  const sendEbimuRuntime = (cmdId, value = 0, label = 'EBIMU Command') => sendController(50, cmdId, value, 0, {
    eventType: 'EBIMU_COMMAND',
    label,
    detail: { cmdId, value },
  });

  const connectionRows = [
    { label: 'Status', value: ble.connectionStatus || '-' },
    { label: 'Device', value: ble.deviceName || 'CUBLI__EBIMU_SENDER' },
    { label: 'Notify char', value: ble.hasNotifyCharacteristic ? 'FOUND' : '-' },
    { label: 'Command char', value: ble.hasCommandCharacteristic ? 'FOUND' : '-' },
    { label: 'Active source', value: activeSourceLabel || '-' },
    { label: 'Last update', value: formatDateTime(ble.lastReceivedAt) },
    { label: 'Valid / Invalid', value: `${ble.validCount} / ${ble.invalidCount}` },
    { label: 'Valid ratio', value: validPercent },
  ];

  const quaternionRows = [
    { label: 'q0 / qw', value: formatNumber(latestPacket.q0, 5) },
    { label: 'q1 / qx', value: formatNumber(latestPacket.q1, 5) },
    { label: 'q2 / qy', value: formatNumber(latestPacket.q2, 5) },
    { label: 'q3 / qz', value: formatNumber(latestPacket.q3, 5) },
    { label: 'norm', value: formatNumber(latestPacket.norm, 5) },
  ];

  const rpyRows = [
    { label: 'Roll', value: `${formatNumber(latestPacket.rollDeg, 2)}°` },
    { label: 'Pitch', value: `${formatNumber(latestPacket.pitchDeg, 2)}°` },
    { label: 'Yaw', value: `${formatNumber(latestPacket.yawDeg, 2)}°` },
    { label: 'timestamp', value: `${formatNumber(latestPacket.ebimuTimestampMs, 0)} ms` },
    { label: 'packetCount', value: formatNumber(latestPacket.packetCount ?? latestPacket.seq, 0) },
  ];

  return (
    <div className="serial-panel pt-2">
      <div className="d-flex justify-content-between align-items-center mb-3 gap-2">
        <h3 className="h6 fw-bold text-uppercase m-0" style={{ color: '#aaa', letterSpacing: '0.08em' }}>
          Admin BLE
        </h3>
        <StatusBadge status={ble.connectionStatus} />
      </div>

      <div className="serial-control-card rounded p-3 mb-3">
        {adminLocked ? (
          <Alert variant="secondary" className="serial-alert py-2">
            BLE direct control is available only in Admin mode.
          </Alert>
        ) : null}
        <div className="d-grid gap-2">
          {ble.isConnected ? (
            <Button variant="outline-danger" onClick={ble.disconnect} disabled={adminLocked}>Disconnect BLE IMU</Button>
          ) : (
            <>
              <Button variant="outline-info" onClick={() => ble.connect()} disabled={adminLocked || !ble.isSupported}>Connect BLE IMU</Button>
              <Button variant="outline-light" onClick={() => ble.connect({ broadScan: true })} disabled={adminLocked || !ble.isSupported}>Broad Scan</Button>
              <Button variant="outline-primary" onClick={() => ble.connect({ broadScan: true, preferBluefy: true })} disabled={adminLocked || !ble.isSupported}>Bluefy / iPhone</Button>
            </>
          )}

          <Form.Check
            type="switch"
            id="use-ble-sender-quat"
            label="Use as Admin Direct Bridge source"
            checked={useBleImu}
            onChange={(e) => setUseBleImu(e.target.checked)}
            disabled={adminLocked || !ble.isConnected}
          />
        </div>
      </div>

      {!ble.isSupported ? (
        <Alert variant="warning" className="serial-alert py-2">
          {env.accessHint || 'Web Bluetooth를 지원하는 브라우저가 필요합니다.'}
        </Alert>
      ) : null}
      {ble.isStale ? <Alert variant="warning" className="serial-alert py-2">최근 BLE 데이터가 들어오지 않습니다.</Alert> : null}
      {ble.commandWarning ? <Alert variant="warning" className="serial-alert py-2">{ble.commandWarning}</Alert> : null}
      {ble.error ? <Alert variant="danger" className="serial-alert py-2">{ble.error}</Alert> : null}
      {ble.lastInvalidReason ? <Alert variant="warning" className="serial-alert py-2">{ble.lastInvalidReason}</Alert> : null}

      <Row className="g-2 mb-3">
        <Col xs={12}><ValueGrid title="BLE Connection" rows={connectionRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Quaternion" rows={quaternionRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="RPY / EBIMU" rows={rpyRows} /></Col>
      </Row>

      <div className="serial-control-card rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center mb-3 gap-2">
          <div className="serial-section-title">Commands</div>
          <Button variant="outline-light" size="sm" disabled={adminLocked} onClick={() => { emitCommandEvent('CLEAR_STATS', 'Clear BLE Stats'); ble.clearStats(); }}>Clear Stats</Button>
        </div>

        <Accordion defaultActiveKey="control" flush alwaysOpen className="command-accordion">
          <CommandAccordionItem eventKey="control" title="Control">
            <CommandGroup>
              <CommandButton label="Set Zero / Tare" onClick={() => sendBleCommand('TARE', { eventType: 'TARE', label: 'Set Zero / Tare' })} disabled={commandDisabled} />
              <CommandButton label="Stop" onClick={() => sendBleCommand('STOP', { eventType: 'STOP', label: 'Stop' })} disabled={commandDisabled} />
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
                <Button
                  variant="outline-light"
                  className="w-100"
                  disabled={commandDisabled}
                  onClick={() => sendController(1, Number(targetRoll) || 0, Number(targetPitch) || 0, Number(targetYaw) || 0, { eventType: 'TARGET_ATTITUDE', label: 'Send Target Attitude', detail: { roll: Number(targetRoll) || 0, pitch: Number(targetPitch) || 0, yaw: Number(targetYaw) || 0 } })}
                >
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
              <CommandButton label="Status" onClick={() => sendBleCommand('STATUS?', { eventType: 'RECEIVER_INFO', label: 'Status' })} disabled={commandDisabled} />
              <CommandButton label="MAC Info" onClick={() => sendBleCommand('MAC?', { eventType: 'RECEIVER_INFO', label: 'MAC Info' })} disabled={commandDisabled} />
            </CommandGroup>
          </CommandAccordionItem>
        </Accordion>
      </div>

      <div className="serial-control-card rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="serial-section-title">Monitor</div>
          <Form.Check type="switch" id="show-ble-recent" label="Recent" checked={showRecent} onChange={(e) => setShowRecent(e.target.checked)} />
        </div>
        {showRecent ? <div className="serial-note-visible text-break mb-2">Last BLE raw line: {ble.lastRawLine || '-'}</div> : null}

        {showRecent ? (
          <div className="serial-table-wrapper">
            <Table striped bordered hover variant="dark" size="sm" className="serial-table mb-0">
              <thead>
                <tr>
                  <th>count</th>
                  <th>qw</th>
                  <th>qx</th>
                  <th>qy</th>
                  <th>qz</th>
                  <th>roll</th>
                  <th>pitch</th>
                  <th>yaw</th>
                </tr>
              </thead>
              <tbody>
                {(ble.recentPackets || []).map((packet) => (
                  <tr key={`${packet.packetCount}-${packet.updatedAt}`}>
                    <td>{packet.packetCount ?? packet.seq}</td>
                    <td>{formatNumber(packet.q0, 4)}</td>
                    <td>{formatNumber(packet.q1, 4)}</td>
                    <td>{formatNumber(packet.q2, 4)}</td>
                    <td>{formatNumber(packet.q3, 4)}</td>
                    <td>{formatNumber(packet.rollDeg, 2)}</td>
                    <td>{formatNumber(packet.pitchDeg, 2)}</td>
                    <td>{formatNumber(packet.yawDeg, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
