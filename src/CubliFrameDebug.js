// LOCAL 3D VISUAL ONLY: wheel position mirror controls.
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form } from 'react-bootstrap';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

const WHEEL_MIRROR_DEFAULT_KEY = 'cubliWheelMirrorDefault';

export const DEFAULT_FRAME_DEBUG_CONFIG = Object.freeze({
  mirrorX: true,
  mirrorY: false,
  mirrorZ: true,
  showHelpers: false,
  wheelPositionScale: 1,
});

function boolValue(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeFrameDebugConfig(value = DEFAULT_FRAME_DEBUG_CONFIG) {
  const source = value && typeof value === 'object' ? value : DEFAULT_FRAME_DEBUG_CONFIG;
  const wheelPositionScale = Number(source.wheelPositionScale);

  return {
    mirrorX: boolValue(source.mirrorX, DEFAULT_FRAME_DEBUG_CONFIG.mirrorX),
    mirrorY: boolValue(source.mirrorY, DEFAULT_FRAME_DEBUG_CONFIG.mirrorY),
    mirrorZ: boolValue(source.mirrorZ, DEFAULT_FRAME_DEBUG_CONFIG.mirrorZ),
    showHelpers: boolValue(source.showHelpers, DEFAULT_FRAME_DEBUG_CONFIG.showHelpers),
    wheelPositionScale: Number.isFinite(wheelPositionScale)
      ? Math.max(0.65, Math.min(1.35, wheelPositionScale))
      : DEFAULT_FRAME_DEBUG_CONFIG.wheelPositionScale,
  };
}

export function getStoredFrameDebugConfig() {
  if (typeof window === 'undefined') return { ...DEFAULT_FRAME_DEBUG_CONFIG };

  try {
    const raw = window.localStorage.getItem(WHEEL_MIRROR_DEFAULT_KEY);
    if (!raw) return { ...DEFAULT_FRAME_DEBUG_CONFIG };
    return normalizeFrameDebugConfig(JSON.parse(raw));
  } catch (_) {
    return { ...DEFAULT_FRAME_DEBUG_CONFIG };
  }
}

export function saveFrameDebugDefaultConfig(config) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      WHEEL_MIRROR_DEFAULT_KEY,
      JSON.stringify(normalizeFrameDebugConfig(config))
    );
  } catch (_) {
    // Ignore blocked storage; the current in-memory visual setting still works.
  }
}

export function clearStoredFrameDebugConfig() {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(WHEEL_MIRROR_DEFAULT_KEY);
  } catch (_) {
    // Ignore blocked storage.
  }
}

export function mapWheelMirrorVector(vector, config, scale = 1) {
  const [x, y, z] = Array.isArray(vector) ? vector : [0, 0, 0];
  const safeConfig = normalizeFrameDebugConfig(config);
  const multiplier = Number.isFinite(Number(scale)) ? Number(scale) : 1;

  return [
    safeConfig.mirrorX ? -x : x,
    safeConfig.mirrorY ? -y : y,
    safeConfig.mirrorZ ? -z : z,
  ].map((value) => value * multiplier);
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
  const config = normalizeFrameDebugConfig(value);

  const update = (patch) => {
    onChange?.(normalizeFrameDebugConfig({
      ...config,
      ...patch,
    }));
  };

  const setAsDefault = () => {
    saveFrameDebugDefaultConfig(config);
  };

  const resetFactoryDefault = () => {
    clearStoredFrameDebugConfig();
    onChange?.({ ...DEFAULT_FRAME_DEBUG_CONFIG });
  };

  return (
    <div
      className="position-absolute"
      style={{
        right: isMobile ? '0.65rem' : '1rem',
        bottom: isMobile ? '0.6rem' : '1rem',
        zIndex: 1065,
        width: isMobile ? 214 : 244,
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
          <span>Wheel Mirror</span>
          <span>{isOpen ? '-' : '+'}</span>
        </Button>

        {isOpen ? (
          <div className="p-2 d-grid gap-2">
            <Form.Check
              type="switch"
              id="cubli-wheel-mirror-x"
              label="Mirror X position"
              checked={config.mirrorX}
              onChange={(event) => update({ mirrorX: event.target.checked })}
            />

            <Form.Check
              type="switch"
              id="cubli-wheel-mirror-y"
              label="Mirror Y position"
              checked={config.mirrorY}
              onChange={(event) => update({ mirrorY: event.target.checked })}
            />

            <Form.Check
              type="switch"
              id="cubli-wheel-mirror-z"
              label="Mirror Z position"
              checked={config.mirrorZ}
              onChange={(event) => update({ mirrorZ: event.target.checked })}
            />

            <Form.Check
              type="switch"
              id="cubli-frame-debug-helpers"
              label="Position helpers"
              checked={config.showHelpers}
              onChange={(event) => update({ showHelpers: event.target.checked })}
            />

            <Form.Group>
              <div className="d-flex justify-content-between gap-2">
                <Form.Label className="mb-1">Wheel Distance</Form.Label>
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

            <div className="d-flex gap-2">
              <Button type="button" variant="outline-light" size="sm" className="flex-fill" onClick={setAsDefault}>
                Set Default
              </Button>
              <Button type="button" variant="outline-secondary" size="sm" className="flex-fill" onClick={resetFactoryDefault}>
                Factory
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
