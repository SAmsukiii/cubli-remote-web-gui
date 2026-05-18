// LOCAL 3D DEBUG ONLY: temporary visual controls for Cubli wheel/frame axis mapping checks.
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form } from 'react-bootstrap';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

export const FRAME_DEBUG_CURRENT = 'current';
export const FRAME_DEBUG_SAME_AS_WHEEL = 'same-as-wheel';

export const FRAME_DEBUG_PRESETS = [
  { value: FRAME_DEBUG_CURRENT, label: 'Current' },
  { value: 'swap-xy', label: 'Swap X/Y' },
  { value: 'swap-yz', label: 'Swap Y/Z' },
  { value: 'swap-xz', label: 'Swap X/Z' },
  { value: 'mirror-x', label: 'Mirror X' },
  { value: 'mirror-y', label: 'Mirror Y' },
  { value: 'mirror-z', label: 'Mirror Z' },
  { value: 'transpose-test', label: 'Transpose Test' },
];

export const FRAME_ARROW_DEBUG_PRESETS = [
  { value: FRAME_DEBUG_SAME_AS_WHEEL, label: 'Same as Wheel' },
  ...FRAME_DEBUG_PRESETS,
];

export const DEFAULT_FRAME_DEBUG_CONFIG = Object.freeze({
  wheelPreset: FRAME_DEBUG_CURRENT,
  arrowPreset: FRAME_DEBUG_CURRENT,
  showHelpers: false,
  wheelPositionScale: 1,
});

export function resolveFrameArrowPreset(arrowPreset, wheelPreset) {
  return arrowPreset === FRAME_DEBUG_SAME_AS_WHEEL ? wheelPreset : arrowPreset;
}

export function applyFrameDebugPreset(vector, preset = FRAME_DEBUG_CURRENT) {
  const [x, y, z] = Array.isArray(vector) ? vector : [0, 0, 0];

  switch (preset) {
    case 'swap-xy':
      return [y, x, z];
    case 'swap-yz':
      return [x, z, y];
    case 'swap-xz':
      return [z, y, x];
    case 'mirror-x':
      return [-x, y, z];
    case 'mirror-y':
      return [x, -y, z];
    case 'mirror-z':
      return [x, y, -z];
    case 'transpose-test':
      // Transpose Test is only a visual debugging preset for suspected row/column axis mapping error.
      return [y, z, x];
    case FRAME_DEBUG_CURRENT:
    default:
      return [x, y, z];
  }
}

export function mapFrameDebugVector(vector, preset, scale = 1) {
  const mapped = applyFrameDebugPreset(vector, preset);
  const multiplier = Number.isFinite(Number(scale)) ? Number(scale) : 1;
  return mapped.map((value) => value * multiplier);
}

function DebugLabel({ position, children }) {
  return (
    <Html position={position} center distanceFactor={8} style={{ pointerEvents: 'none' }}>
      <span
        style={{
          display: 'inline-block',
          padding: '1px 4px',
          borderRadius: 3,
          background: 'rgba(12, 12, 12, 0.72)',
          color: '#d8d8d8',
          fontSize: 10,
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          border: '1px solid rgba(160, 160, 160, 0.28)',
        }}
      >
        {children}
      </span>
    </Html>
  );
}

function GuideLine({ from = [0, 0, 0], to = [0, 0, 0] }) {
  const geometry = useMemo(() => (
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...from),
      new THREE.Vector3(...to),
    ])
  ), [from, to]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <line geometry={geometry}>
      <lineBasicMaterial attach="material" color="#8f8f8f" transparent opacity={0.45} />
    </line>
  );
}

function Marker({ position, radius = 1.9 }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[radius, 12, 12]} />
      <meshBasicMaterial color="#b8b8b8" transparent opacity={0.8} />
    </mesh>
  );
}

export function FrameAxisDebugHelpers({ axisDirections, axisLength }) {
  const labelDistance = Math.max(12, Number(axisLength) || 34) * 1.14;
  const axes = [
    { label: '+X', vector: axisDirections?.x || [1, 0, 0] },
    { label: '+Y', vector: axisDirections?.y || [0, 0, 1] },
    { label: '+Z', vector: axisDirections?.z || [0, -1, 0] },
  ];

  return (
    <group>
      <Marker position={[0, 0, 0]} radius={2.2} />
      {axes.map((axis) => (
        <DebugLabel
          key={axis.label}
          position={axis.vector.map((value) => value * labelDistance)}
        >
          {axis.label}
        </DebugLabel>
      ))}
    </group>
  );
}

export function WheelLayoutDebugHelpers({ wheelPositions }) {
  const wheels = [
    { label: 'Wheel X', position: wheelPositions?.x || [0, 0, 0] },
    { label: 'Wheel Y', position: wheelPositions?.y || [0, 0, 0] },
    { label: 'Wheel Z', position: wheelPositions?.z || [0, 0, 0] },
  ];

  return (
    <group>
      {wheels.map((wheel) => (
        <group key={wheel.label}>
          <GuideLine to={wheel.position} />
          <Marker position={wheel.position} />
          <DebugLabel position={wheel.position.map((value) => value * 1.08)}>
            {wheel.label}
          </DebugLabel>
        </group>
      ))}
    </group>
  );
}

export function FrameDebugPanel({ value, onChange, isMobile }) {
  const [isOpen, setIsOpen] = useState(false);
  const config = value || DEFAULT_FRAME_DEBUG_CONFIG;

  const update = (patch) => {
    onChange?.({
      ...DEFAULT_FRAME_DEBUG_CONFIG,
      ...config,
      ...patch,
    });
  };

  const reset = () => {
    onChange?.({ ...DEFAULT_FRAME_DEBUG_CONFIG });
  };

  return (
    <div
      className="position-absolute"
      style={{
        right: isMobile ? '0.65rem' : '1rem',
        bottom: isMobile ? '0.6rem' : '1rem',
        zIndex: 1065,
        width: isMobile ? 210 : 236,
        color: '#e5e5e5',
        fontSize: '0.76rem',
      }}
    >
      <div
        className="rounded"
        style={{
          background: 'rgba(14, 14, 14, 0.88)',
          border: '1px solid rgba(180, 180, 180, 0.18)',
          boxShadow: '0 10px 24px rgba(0, 0, 0, 0.28)',
          overflow: 'hidden',
        }}
      >
        <Button
          type="button"
          variant="outline-secondary"
          size="sm"
          className="w-100 border-0 rounded-0 text-start d-flex justify-content-between align-items-center"
          style={{ color: '#f2f2f2', background: 'rgba(40, 40, 40, 0.72)' }}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <span>3D Frame Debug</span>
          <span>{isOpen ? '-' : '+'}</span>
        </Button>

        {isOpen ? (
          <div className="p-2 d-grid gap-2">
            <Form.Group>
              <Form.Label className="mb-1">Wheel Mapping</Form.Label>
              <Form.Select
                size="sm"
                value={config.wheelPreset}
                onChange={(event) => update({ wheelPreset: event.target.value })}
              >
                {FRAME_DEBUG_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
              </Form.Select>
            </Form.Group>

            <Form.Group>
              <Form.Label className="mb-1">Arrow Mapping</Form.Label>
              <Form.Select
                size="sm"
                value={config.arrowPreset}
                onChange={(event) => update({ arrowPreset: event.target.value })}
              >
                {FRAME_ARROW_DEBUG_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
              </Form.Select>
            </Form.Group>

            <Form.Check
              type="switch"
              id="cubli-frame-debug-helpers"
              label="Helpers"
              checked={Boolean(config.showHelpers)}
              onChange={(event) => update({ showHelpers: event.target.checked })}
            />

            <Form.Group>
              <div className="d-flex justify-content-between gap-2">
                <Form.Label className="mb-1">Wheel Scale</Form.Label>
                <span>{Number(config.wheelPositionScale || 1).toFixed(2)}</span>
              </div>
              <Form.Range
                min="0.65"
                max="1.35"
                step="0.01"
                value={config.wheelPositionScale}
                onChange={(event) => update({ wheelPositionScale: Number(event.target.value) })}
                className="custom-range"
              />
            </Form.Group>

            <Button type="button" variant="outline-light" size="sm" onClick={reset}>
              Reset
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
