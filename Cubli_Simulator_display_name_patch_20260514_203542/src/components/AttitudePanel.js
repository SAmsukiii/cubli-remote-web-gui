import React from 'react';
import { Form, Button, Alert } from 'react-bootstrap';

export default function AttitudePanel({ 
  attitude, handleAttitudeChange, sensorMode, setSensorMode, 
  isSensorActive, toggleSensor, isPausedByLock, resetAttitude 
}) {
  const absRoll = Math.abs(attitude.roll);
  const isGimbalLockZone = sensorMode === 'euler' && absRoll >= 88 && absRoll <= 90;

  return (
    <div className="mt-3">
      <h5 className="mb-4 text-warning" style={{ fontWeight: 'bold' }}>🛰️ 글로벌 자세 제어 (Attitude)</h5>
      
      <Form.Group className="mb-4">
        <div className="d-flex justify-content-center bg-secondary rounded p-2 shadow-sm">
          <Form.Check inline type="radio" id="mode-euler" label="오일러 (짐벌락 O)" name="sensorMode" value="euler" checked={sensorMode === 'euler'} onChange={() => setSensorMode('euler')} className="text-white me-4 fw-bold" />
          <Form.Check inline type="radio" id="mode-quat" label="쿼터니언 (짐벌락 X)" name="sensorMode" value="quaternion" checked={sensorMode === 'quaternion'} onChange={() => setSensorMode('quaternion')} className="text-info fw-bold" />
        </div>
      </Form.Group>

      <div className="d-grid mb-4">
        <Button variant={isSensorActive ? "danger" : "warning"} onClick={toggleSensor} className="fw-bold shadow-sm" disabled={isPausedByLock}>
          {isSensorActive ? '📱 핸드폰 센서 동기화 끄기' : '📱 핸드폰 센서 동기화 켜기'}
        </Button>
      </div>

      <Form.Group className="mb-3">
        <Form.Label>Pitch (X축): {attitude.pitch}°</Form.Label>
        <Form.Range min="-180" max="180" value={attitude.pitch} onChange={(e) => handleAttitudeChange('pitch', e.target.value)} disabled={isSensorActive || isPausedByLock} />
      </Form.Group>
      
      <Form.Group className="mb-3">
        <Form.Label>Yaw (Y축): {attitude.yaw}°</Form.Label>
        <Form.Range min="-180" max="180" value={attitude.yaw} onChange={(e) => handleAttitudeChange('yaw', e.target.value)} disabled={isSensorActive || isPausedByLock} />
      </Form.Group>
      
      <Form.Group className="mb-3">
        <Form.Label>Roll (Z축): {attitude.roll}°</Form.Label>
        <Form.Range min="-180" max="180" value={attitude.roll} onChange={(e) => handleAttitudeChange('roll', e.target.value)} disabled={isSensorActive || isPausedByLock} className={isGimbalLockZone ? "is-invalid" : ""} />
        {isGimbalLockZone && <Alert variant="danger" className="p-1 mt-1 fw-bold text-center small">짐벌락 발생 범위 진입! ({attitude.roll}°)</Alert>}
      </Form.Group>
      
      <div className="d-grid mt-4">
        <Button variant="outline-light" onClick={resetAttitude} disabled={isSensorActive || isPausedByLock}>
          자세 초기화
        </Button>
      </div>
    </div>
  );
}