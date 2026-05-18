// LOCAL 3D VISUAL ONLY: wheel/frame arrow mirror controls.
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form } from 'react-bootstrap';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

const WHEEL_MIRROR_DEFAULT_KEY = 'cubliWheelMirrorDefault';
const WHEEL_MIRROR_DEFAULT_VERSION_KEY = 'cubliWheelMirrorDefaultVersion';
const WHEEL_MIRROR_DEFAULT_VERSION = 'frame-arrow-mirror-presets-v1';
const SAME_AS_WHEEL_KEY = 'sameAsWheel';
const SAME_AS_REFERENCE_FRAME_KEY = 'sameAsReferenceFrame';
const EMPTY_OBJECT = Object.freeze({});

const MIRROR_PRESET_KEY_ORDER = Object.freeze([
  'current',
  'mirrorX',
  'mirrorY',
  'mirrorZ',
  'mirrorXY',
  'mirrorXZ',
  'mirrorYZ',
  'mirrorXYZ',
]);

export const FRAME_ARROW_MIRROR_PRESETS = Object.freeze({
  current: {
    label: 'Current',
    map: ([x, y, z]) => [x, y, z],
  },
  mirrorX: {
    label: 'Mirror X',
    map: ([x, y, z]) => [-x, y, z],
  },
  mirrorY: {
    label: 'Mirror Y',
    map: ([x, y, z]) => [x, -y, z],
  },
  mirrorZ: {
    label: 'Mirror Z',
    map: ([x, y, z]) => [x, y, -z],
  },
  mirrorXY: {
    label: 'Mirror X/Y',
    map: ([x, y, z]) => [-x, -y, z],
  },
  mirrorXZ: {
    label: 'Mirror X/Z',
    map: ([x, y, z]) => [-x, y, -z],
  },
  mirrorYZ: {
    label: 'Mirror Y/Z',
    map: ([x, y, z]) => [x, -y, -z],
  },
  mirrorXYZ: {
    label: 'Mirror X/Y/Z',
    map: ([x, y, z]) => [-x, -y, -z],
  },
});

export const FRAME_ARROW_MIRROR_PRESET_OPTIONS = Object.freeze(
  MIRROR_PRESET_KEY_ORDER.map((key) => ({
    value: key,
    label: FRAME_ARROW_MIRROR_PRESETS[key].label,
  }))
);

export const DEFAULT_FRAME_DEBUG_CONFIG = Object.freeze({
  wheelMirrorPreset: 'current',
  referenceFrameArrowMirrorPreset: 'current',
  bodyFrameArrowMirrorPreset: 'current',
  mirrorX: false,
  mirrorY: false,
  mirrorZ: false,
  showHelpers: false,
  wheelPositionScale: 1,
});

function boolValue(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeBaseMirrorPresetKey(value, fallback = 'current') {
  return Object.prototype.hasOwnProperty.call(FRAME_ARROW_MIRROR_PRESETS, value)
    ? value
    : fallback;
}

function normalizeReferenceMirrorPresetKey(value, fallback = 'current') {
  return value === SAME_AS_WHEEL_KEY
    ? SAME_AS_WHEEL_KEY
    : normalizeBaseMirrorPresetKey(value, fallback);
}

function normalizeBodyMirrorPresetKey(value, fallback = 'current') {
  if (value === SAME_AS_WHEEL_KEY || value === SAME_AS_REFERENCE_FRAME_KEY) {
    return value;
  }
  return normalizeBaseMirrorPresetKey(value, fallback);
}

function mirrorFlagsToPresetKey(source = EMPTY_OBJECT) {
  const mirrorX = boolValue(source.mirrorX, false);
  const mirrorY = boolValue(source.mirrorY, false);
  const mirrorZ = boolValue(source.mirrorZ, false);

  if (mirrorX && mirrorY && mirrorZ) return 'mirrorXYZ';
  if (mirrorX && mirrorY) return 'mirrorXY';
  if (mirrorX && mirrorZ) return 'mirrorXZ';
  if (mirrorY && mirrorZ) return 'mirrorYZ';
  if (mirrorX) return 'mirrorX';
  if (mirrorY) return 'mirrorY';
  if (mirrorZ) return 'mirrorZ';
  return 'current';
}

function mirrorFlagsFromPresetKey(presetKey) {
  const key = normalizeBaseMirrorPresetKey(presetKey);
  return {
    mirrorX: key.includes('X'),
    mirrorY: key.includes('Y'),
    mirrorZ: key.includes('Z'),
  };
}

export function normalizeFrameDebugConfig(value = DEFAULT_FRAME_DEBUG_CONFIG) {
  const source = value && typeof value === 'object' ? value : DEFAULT_FRAME_DEBUG_CONFIG;
  const wheelPositionScale = Number(source.wheelPositionScale);
  const legacyWheelPreset = mirrorFlagsToPresetKey(source);
  const wheelMirrorPreset = normalizeBaseMirrorPresetKey(
    source.wheelMirrorPreset,
    legacyWheelPreset
  );
  const wheelMirrorFlags = mirrorFlagsFromPresetKey(wheelMirrorPreset);

  return {
    wheelMirrorPreset,
    referenceFrameArrowMirrorPreset: normalizeReferenceMirrorPresetKey(
      source.referenceFrameArrowMirrorPreset,
      DEFAULT_FRAME_DEBUG_CONFIG.referenceFrameArrowMirrorPreset
    ),
    bodyFrameArrowMirrorPreset: normalizeBodyMirrorPresetKey(
      source.bodyFrameArrowMirrorPreset,
      DEFAULT_FRAME_DEBUG_CONFIG.bodyFrameArrowMirrorPreset
    ),
    mirrorX: wheelMirrorFlags.mirrorX,
    mirrorY: wheelMirrorFlags.mirrorY,
    mirrorZ: wheelMirrorFlags.mirrorZ,
    showHelpers: boolValue(source.showHelpers, DEFAULT_FRAME_DEBUG_CONFIG.showHelpers),
    wheelPositionScale: Number.isFinite(wheelPositionScale)
      ? Math.max(0.65, Math.min(1.35, wheelPositionScale))
      : DEFAULT_FRAME_DEBUG_CONFIG.wheelPositionScale,
  };
}

export function getStoredFrameDebugConfig() {
  if (typeof window === 'undefined') return { ...DEFAULT_FRAME_DEBUG_CONFIG };

  try {
    const storedVersion = window.localStorage.getItem(WHEEL_MIRROR_DEFAULT_VERSION_KEY);
    const raw = window.localStorage.getItem(WHEEL_MIRROR_DEFAULT_KEY);
    const nextConfig = raw
      ? normalizeFrameDebugConfig(JSON.parse(raw))
      : { ...DEFAULT_FRAME_DEBUG_CONFIG };

    if (storedVersion !== WHEEL_MIRROR_DEFAULT_VERSION) {
      window.localStorage.setItem(WHEEL_MIRROR_DEFAULT_KEY, JSON.stringify(nextConfig));
      window.localStorage.setItem(WHEEL_MIRROR_DEFAULT_VERSION_KEY, WHEEL_MIRROR_DEFAULT_VERSION);
      return nextConfig;
    }

    if (!raw) {
      const nextDefault = { ...DEFAULT_FRAME_DEBUG_CONFIG };
      window.localStorage.setItem(WHEEL_MIRROR_DEFAULT_KEY, JSON.stringify(nextDefault));
      return nextDefault;
    }
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
    window.localStorage.setItem(WHEEL_MIRROR_DEFAULT_VERSION_KEY, WHEEL_MIRROR_DEFAULT_VERSION);
  } catch (_) {
    // Ignore blocked storage; the current in-memory visual setting still works.
  }
}

export function clearStoredFrameDebugConfig() {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(WHEEL_MIRROR_DEFAULT_KEY);
    window.localStorage.removeItem(WHEEL_MIRROR_DEFAULT_VERSION_KEY);
  } catch (_) {
    // Ignore blocked storage.
  }
}

export function mapFrameArrowMirrorVector(vector, presetKey = 'current') {
  const safeVector = Array.isArray(vector) ? vector : [0, 0, 0];
  const preset = FRAME_ARROW_MIRROR_PRESETS[normalizeBaseMirrorPresetKey(presetKey)];
  return preset.map(safeVector);
}

export function resolveWheelMirrorPresetKey(config) {
  return normalizeFrameDebugConfig(config).wheelMirrorPreset;
}

export function resolveReferenceFrameArrowMirrorPresetKey(config) {
  const safeConfig = normalizeFrameDebugConfig(config);
  if (safeConfig.referenceFrameArrowMirrorPreset === SAME_AS_WHEEL_KEY) {
    return resolveWheelMirrorPresetKey(safeConfig);
  }
  return normalizeBaseMirrorPresetKey(safeConfig.referenceFrameArrowMirrorPreset);
}

export function resolveBodyFrameArrowMirrorPresetKey(config) {
  const safeConfig = normalizeFrameDebugConfig(config);
  if (safeConfig.bodyFrameArrowMirrorPreset === SAME_AS_WHEEL_KEY) {
    return resolveWheelMirrorPresetKey(safeConfig);
  }
  if (safeConfig.bodyFrameArrowMirrorPreset === SAME_AS_REFERENCE_FRAME_KEY) {
    return resolveReferenceFrameArrowMirrorPresetKey(safeConfig);
  }
  return normalizeBaseMirrorPresetKey(safeConfig.bodyFrameArrowMirrorPreset);
}

export function mapWheelMirrorVector(vector, config, scale = 1) {
  const [x, y, z] = Array.isArray(vector) ? vector : [0, 0, 0];
  const safeConfig = normalizeFrameDebugConfig(config);
  const multiplier = Number.isFinite(Number(scale)) ? Number(scale) : 1;
  const mapped = mapFrameArrowMirrorVector([x, y, z], resolveWheelMirrorPresetKey(safeConfig));

  return mapped.map((value) => value * multiplier);
}

export function DebugLabel({ position, children }) {
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
  const helperDistance = Math.max(12, Number(axisLength) || 34) * 1.14;
  const axes = [
    { label: '+X', vector: axisDirections?.x || [1, 0, 0] },
    { label: '+Y', vector: axisDirections?.y || [0, 0, 1] },
    { label: '+Z', vector: axisDirections?.z || [0, -1, 0] },
  ];

  return (
    <group>
      <Marker position={[0, 0, 0]} radius={2.2} />
      {axes.map((axis) => (
        <group key={axis.label}>
          <GuideLine to={axis.vector.map((value) => value * helperDistance)} />
          <Marker
            position={axis.vector.map((value) => value * helperDistance)}
            radius={1.45}
          />
        </group>
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

function MirrorSelect({ id, label, value, options, onChange }) {
  return (
    <Form.Group controlId={id}>
      <Form.Label className="mb-1">{label}</Form.Label>
      <Form.Select
        size="sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          backgroundColor: '#1e1e1e',
          borderColor: 'rgba(210, 210, 210, 0.24)',
          color: '#f1f1f1',
          fontSize: '0.74rem',
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
  );
}

export function FrameDebugPanel({ value, onChange, isMobile }) {
  const [isOpen, setIsOpen] = useState(false);
  const config = normalizeFrameDebugConfig(value);
  const referenceMirrorOptions = useMemo(() => ([
    { value: SAME_AS_WHEEL_KEY, label: 'Same as Wheel' },
    ...FRAME_ARROW_MIRROR_PRESET_OPTIONS,
  ]), []);
  const bodyMirrorOptions = useMemo(() => ([
    { value: SAME_AS_WHEEL_KEY, label: 'Same as Wheel' },
    { value: SAME_AS_REFERENCE_FRAME_KEY, label: 'Same as Reference Frame' },
    ...FRAME_ARROW_MIRROR_PRESET_OPTIONS,
  ]), []);

  const update = (patch) => {
    onChange?.(normalizeFrameDebugConfig({
      ...config,
      ...patch,
    }));
  };

  const setAsDefault = () => {
    saveFrameDebugDefaultConfig(config);
  };

  const resetToCurrent = () => {
    clearStoredFrameDebugConfig();
    onChange?.(normalizeFrameDebugConfig({ ...DEFAULT_FRAME_DEBUG_CONFIG }));
  };

  return (
    <div
      className="position-absolute"
      style={{
        right: isMobile ? '0.65rem' : '1rem',
        bottom: isMobile ? '0.6rem' : '1rem',
        zIndex: 1065,
        width: isMobile ? 238 : 286,
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
            <MirrorSelect
              id="cubli-wheel-mirror"
              label="Wheel Mirror"
              value={config.wheelMirrorPreset}
              options={FRAME_ARROW_MIRROR_PRESET_OPTIONS}
              onChange={(wheelMirrorPreset) => update({ wheelMirrorPreset })}
            />

            <MirrorSelect
              id="cubli-reference-frame-arrow-mirror"
              label="Reference Frame Arrow Mirror"
              value={config.referenceFrameArrowMirrorPreset}
              options={referenceMirrorOptions}
              onChange={(referenceFrameArrowMirrorPreset) => update({ referenceFrameArrowMirrorPreset })}
            />

            <MirrorSelect
              id="cubli-body-frame-arrow-mirror"
              label="Cubli Body Frame Arrow Mirror"
              value={config.bodyFrameArrowMirrorPreset}
              options={bodyMirrorOptions}
              onChange={(bodyFrameArrowMirrorPreset) => update({ bodyFrameArrowMirrorPreset })}
            />

            <Form.Check
              type="switch"
              id="cubli-frame-debug-helpers"
              label="Show Frame Helpers"
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
              <Button type="button" variant="outline-secondary" size="sm" className="flex-fill" onClick={resetToCurrent}>
                Reset to Current
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
