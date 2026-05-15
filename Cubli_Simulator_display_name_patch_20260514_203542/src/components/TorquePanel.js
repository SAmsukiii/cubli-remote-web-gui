import React from 'react';
import { Form, Button } from 'react-bootstrap';

export default function TorquePanel({ torque, handleTorqueChange, isPausedByLock, resetTorque }) {
  return (
    <div className="mt-3">
      <h5 className="mb-4 text-info" style={{ fontWeight: 'bold' }}>⚙️ 반작용 휠 추력 (Reaction Wheel)</h5>
      
      <Form.Group className="mb-3">
        <Form.Label>X축 모터 (Red): {torque.x} RPM</Form.Label>
        <Form.Range min="-100" max="100" value={torque.x} onChange={(e) => handleTorqueChange('x', e.target.value)} disabled={isPausedByLock} />
      </Form.Group>
      
      <Form.Group className="mb-3">
        <Form.Label>Y축 모터 (Green): {torque.y} RPM</Form.Label>
        <Form.Range min="-100" max="100" value={torque.y} onChange={(e) => handleTorqueChange('y', e.target.value)} disabled={isPausedByLock} />
      </Form.Group>
      
      <Form.Group className="mb-3">
        <Form.Label>Z축 모터 (Blue): {torque.z} RPM</Form.Label>
        <Form.Range min="-100" max="100" value={torque.z} onChange={(e) => handleTorqueChange('z', e.target.value)} disabled={isPausedByLock} />
      </Form.Group>

      <div className="d-grid mt-4">
        <Button variant="outline-info" onClick={resetTorque} disabled={isPausedByLock}>
          모터 전체 정지
        </Button>
      </div>
    </div>
  );
}