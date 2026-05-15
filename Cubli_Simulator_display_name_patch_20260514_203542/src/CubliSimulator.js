import React, { useState, useRef, useEffect, Suspense, forwardRef, useMemo } from 'react';
import { Container, Row, Col, Card, Button, ButtonGroup, Modal, Tabs, Tab, Form, Alert } from 'react-bootstrap';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, PerspectiveCamera, OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import 'bootstrap/dist/css/bootstrap.min.css';
import './CubliSimulator.css';
import useEsp32Serial from './useEsp32Serial';
import useEsp32Ble from './useEsp32Ble';
import SerialPanel from './SerialPanel';
import BlePanel from './BlePanel';
import ServerPanel from './ServerPanel';
import useServerSync from './useServerSync';
import { normalizeLivePacket } from './telemetryNormalize';

/* =========================
   Camera / Layout settings
========================= */
const MIN_CAMERA_DISTANCE = 80;
const MAX_CAMERA_DISTANCE = 2200;
const WHEEL_DISTANCE = 62.5;
const BODY_SCALE = 1.0;
const WHEEL_SCALE = 1.0;
const DEFAULT_VIEW_DIRECTION = new THREE.Vector3(1, 0.72, 1).normalize();
const WEB_SERIAL_BRIDGE_PUBLISH_INTERVAL_MS = 10; // 100 Hz target for Admin Web Serial Bridge
const WEB_SERIAL_BRIDGE_MAX_IN_FLIGHT = 10; // fast 204 publish endpoint allows more overlap without blocking Viewer streaming
const WEB_SERIAL_BRIDGE_COMMAND_POLL_MS = 50; // faster bridge command relay
// Serial/IMU packet은 보통 10~100 Hz로 들어오지만 화면은 60 fps로 그려진다.
// 목표 자세까지 매 프레임 보간해서 EBIMU 자세가 계단식으로 튀지 않게 만든다.
const ATTITUDE_SMOOTHING_SPEED = 12;

/* =========================
   Utilities
========================= */
function createCenteredClone(scene) {
  const clone = scene.clone(true);
  clone.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(clone);
  const center = new THREE.Vector3();
  box.getCenter(center);

  clone.position.sub(center);

  clone.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (obj.material) {
        obj.material.needsUpdate = true;
      }
    }
  });

  return clone;
}

function fitCameraToObject(
  camera,
  object,
  controlsRef,
  targetRef,
  viewDirection = DEFAULT_VIEW_DIRECTION,
  fitOffset = 1.38
) {
  if (!camera || !object) return;

  object.updateWorldMatrix(true, true);

  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();

  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim <= 0) return;

  const fov = THREE.MathUtils.degToRad(camera.fov);
  let distance = (maxDim * 0.5) / Math.tan(fov * 0.5);
  distance *= fitOffset;
  distance = Math.max(MIN_CAMERA_DISTANCE, Math.min(MAX_CAMERA_DISTANCE, distance));

  const newPos = center.clone().add(viewDirection.clone().multiplyScalar(distance));
  camera.position.copy(newPos);
  camera.near = Math.max(0.1, distance / 100);
  camera.far = Math.max(5000, distance * 20);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  if (targetRef?.current) {
    targetRef.current.copy(center);
  }

  if (controlsRef?.current) {
    controlsRef.current.target.copy(center);
    controlsRef.current.update();
  }
}

function formatElapsedTime(ms) {
  const totalTenths = Math.floor(ms / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  return `${mm}:${ss}.${tenths}`;
}

function formatBridgeTime(msOrIso) {
  if (!msOrIso) return '-';
  const date = typeof msOrIso === 'number' ? new Date(msOrIso) : new Date(msOrIso);
  if (Number.isNaN(date.getTime())) return '-';
  return `${date.toLocaleTimeString('ko-KR', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function normalizeDeg180(value) {
  let v = Number(value) || 0;
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  return v;
}

function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

// Sensor/body frame -> displayed Cubli body frame remap.
// Mapping: X -> X, Y -> Z, Z -> -Y.
// This swaps Y/Z and makes the sensor/body Z axis point downward in the displayed Cubli frame.
const SENSOR_TO_CUBLI_FRAME_QUAT = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(Math.PI / 2, 0, 0, 'XYZ')
);
const SENSOR_TO_CUBLI_FRAME_QUAT_INV = SENSOR_TO_CUBLI_FRAME_QUAT.clone().invert();

function sanitizeDisplayNameInput(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

function remapSensorQuatToCubliFrame(sourceQuat, targetQuat) {
  if (!sourceQuat || !targetQuat) return targetQuat || new THREE.Quaternion();

  targetQuat
    .copy(SENSOR_TO_CUBLI_FRAME_QUAT)
    .multiply(sourceQuat)
    .multiply(SENSOR_TO_CUBLI_FRAME_QUAT_INV)
    .normalize();

  return targetQuat;
}


/* =========================
   1. Sub Components
========================= */

const BodyFrameAxes = forwardRef(({ axisLength = 34 }, ref) => {
  const axes = useMemo(() => {
    const length = Math.max(8, Number(axisLength) || 34);
    const headLength = Math.max(3, length * 0.15);
    const headWidth = Math.max(1.8, length * 0.08);

    const group = new THREE.Group();

    group.add(
      new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, 0),
        length,
        0xff0000,
        headLength,
        headWidth
      )
    );

    // Displayed body Y axis: sensor/body Y is remapped to displayed Cubli Z.
    group.add(
      new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0, 0),
        length,
        0x00ff00,
        headLength,
        headWidth
      )
    );

    // Displayed body Z axis: sensor/body Z is remapped to displayed Cubli -Y, downward.
    group.add(
      new THREE.ArrowHelper(
        new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(0, 0, 0),
        length,
        0x0000ff,
        headLength,
        headWidth
      )
    );

    return group;
  }, [axisLength]);

  return <primitive object={axes} ref={ref} />;
});

function CameraLocker({ cameraRef, targetRef }) {
  useFrame(() => {
    if (cameraRef.current) {
      const target = targetRef.current || new THREE.Vector3(0, 0, 0);
      cameraRef.current.lookAt(target);
    }
  });
  return null;
}

function CubliModel({
  attitude,
  attitudeQuat,
  torque,
  isPausedByLock,
  sensorMode,
  isSensorActive,
  modelRef,
  livePacketRef,
  activeSourceType,
  axisLength,
}) {
  const bodyGLTF = useGLTF('/models/body.glb');
  const wheelGLTF = useGLTF('/models/wheel.glb');

  const wheelXSpinRef = useRef();
  const wheelYSpinRef = useRef();
  const wheelZSpinRef = useRef();
  const displayedQuatRef = useRef(new THREE.Quaternion());
  const targetQuatRef = useRef(new THREE.Quaternion());
  const mappedTargetQuatRef = useRef(new THREE.Quaternion());
  const previousTargetQuatRef = useRef(new THREE.Quaternion());
  const targetEulerRef = useRef(new THREE.Euler(0, 0, 0, 'XYZ'));
  const displayedQuatInitializedRef = useRef(false);

  const centeredBodyScene = useMemo(() => createCenteredClone(bodyGLTF.scene), [bodyGLTF.scene]);
  const centeredWheelXScene = useMemo(() => createCenteredClone(wheelGLTF.scene), [wheelGLTF.scene]);
  const centeredWheelYScene = useMemo(() => createCenteredClone(wheelGLTF.scene), [wheelGLTF.scene]);
  const centeredWheelZScene = useMemo(() => createCenteredClone(wheelGLTF.scene), [wheelGLTF.scene]);

  useFrame((state, delta) => {
    // wheel mesh의 기본 회전축을 local Y로 가정
    if (wheelXSpinRef.current && !isPausedByLock) {
      wheelXSpinRef.current.rotation.y += torque.x * delta * 0.08;
    }

    if (wheelYSpinRef.current && !isPausedByLock) {
      wheelYSpinRef.current.rotation.y += torque.y * delta * 0.08;
    }

    if (wheelZSpinRef.current && !isPausedByLock) {
      wheelZSpinRef.current.rotation.y += torque.z * delta * 0.08;
    }

    if (modelRef.current) {
      let usedLivePacketQuat = false;

      // Serial/BLE 수신값은 React state 갱신 주기에 묶지 않고 render loop에서 ref로 직접 읽는다.
      // 핵심: sensorMode / isSensorActive 조건에 묶어두면 탭 전환이나 UI 패치 후
      // 첫 packet만 반영되고 이후 live packet을 놓치는 경우가 생길 수 있다.
      // 따라서 livePacketRef가 존재하고 q=[qw,qx,qy,qz]가 유효하면 항상 quaternion을 우선 사용한다.
      let packet = livePacketRef?.current || null;
      // livePacketRef 전달이 탭/렌더 타이밍 때문에 늦어지는 경우를 막기 위한 최종 fallback.
      // useEsp32Serial/useEsp32Ble가 valid packet을 받는 즉시 window slot에 최신값을 넣는다.
      if (typeof window !== 'undefined') {
        const globalPacket = activeSourceType === 'admin-web-serial' || activeSourceType === 'legacy-web-serial' || activeSourceType === 'serial'
          ? window.__CUBLI_SERIAL_PACKET
          : activeSourceType === 'ble'
            ? window.__CUBLI_BLE_PACKET
            : activeSourceType === 'server-serial'
              ? window.__CUBLI_SERVER_SERIAL_PACKET
              : null;

        if (globalPacket?.updatedAt && (!packet?.updatedAt || globalPacket.updatedAt > packet.updatedAt)) {
          packet = globalPacket;
        }
      }

      const q = packet?.q;
      if (Array.isArray(q) && q.length === 4 && q.every(Number.isFinite)) {
        const [qw, qx, qy, qz] = q;
        targetQuatRef.current.set(qx, qy, qz, qw).normalize();
        usedLivePacketQuat = true;
      }

      if (!usedLivePacketQuat) {
        if (isSensorActive && sensorMode === 'quaternion') {
          targetQuatRef.current.copy(attitudeQuat).normalize();
        } else {
          targetEulerRef.current.set(
            THREE.MathUtils.degToRad(attitude.pitch),
            THREE.MathUtils.degToRad(attitude.yaw),
            THREE.MathUtils.degToRad(attitude.roll),
            'XYZ'
          );
          targetQuatRef.current.setFromEuler(targetEulerRef.current).normalize();
        }
      }

      // Sensor/body frame과 화면 Cubli frame이 다르므로 여기에서 한 번만 frame remap을 적용한다.
      // Mapping: X -> X, Y -> Z, Z -> -Y. Identity quaternion은 그대로 identity로 유지된다.
      remapSensorQuatToCubliFrame(targetQuatRef.current, mappedTargetQuatRef.current);
      targetQuatRef.current.copy(mappedTargetQuatRef.current);

      // q와 -q가 같은 자세를 뜻하므로, 부호가 갑자기 바뀌면 slerp가 멀리 도는 것처럼 보일 수 있다.
      // 매 frame에서 목표 quaternion 부호 연속성을 한 번 더 보장한다.
      if (previousTargetQuatRef.current.dot(targetQuatRef.current) < 0) {
        targetQuatRef.current.set(
          -targetQuatRef.current.x,
          -targetQuatRef.current.y,
          -targetQuatRef.current.z,
          -targetQuatRef.current.w
        );
      }
      previousTargetQuatRef.current.copy(targetQuatRef.current);

      if (!displayedQuatInitializedRef.current) {
        displayedQuatRef.current.copy(targetQuatRef.current);
        displayedQuatInitializedRef.current = true;
      } else {
        const alpha = 1 - Math.exp(-ATTITUDE_SMOOTHING_SPEED * Math.max(delta, 0));
        displayedQuatRef.current.slerp(targetQuatRef.current, alpha);
      }

      modelRef.current.quaternion.copy(displayedQuatRef.current);
    }
  });

  return (
    <group ref={modelRef}>
      <BodyFrameAxes axisLength={axisLength} />

      <group rotation={[Math.PI, 0, 0]}>
        <group scale={[BODY_SCALE, BODY_SCALE, BODY_SCALE]}>
          <primitive object={centeredBodyScene} />
        </group>

        {/* X wheel: local Y -> body X */}
        <group position={[WHEEL_DISTANCE, 0, 0]}>
          <group rotation={[0, 0, -Math.PI / 2]}>
            <group ref={wheelXSpinRef} scale={[WHEEL_SCALE, WHEEL_SCALE, WHEEL_SCALE]}>
              <primitive object={centeredWheelXScene} />
            </group>
          </group>
        </group>

        {/* Y wheel: local Y 그대로 body Y */}
        <group position={[0, WHEEL_DISTANCE, 0]}>
          <group ref={wheelYSpinRef} scale={[WHEEL_SCALE, WHEEL_SCALE, WHEEL_SCALE]}>
            <primitive object={centeredWheelYScene} />
          </group>
        </group>

        {/* Z wheel: local Y -> body -Z, 위치는 -Z 방향 */}
        <group position={[0, 0, -WHEEL_DISTANCE]}>
          <group rotation={[Math.PI / 2, 0, 0]}>
            <group ref={wheelZSpinRef} scale={[WHEEL_SCALE, WHEEL_SCALE, WHEEL_SCALE]}>
              <primitive object={centeredWheelZScene} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

function ReferenceFrameOverlay({ isMobile }) {
  // Mini reference frame overlay. UI-only SVG coordinates.
  const width = isMobile ? 118 : 146;
  const height = isMobile ? 104 : 126;

  const origin = { x: 54, y: 34 };
  const axes = [
    { label: 'X', color: '#ff4b4b', x2: 116, y2: 34, textX: 130, textY: 39 },
    { label: 'Y', color: '#4dff6a', x2: 24, y2: 72, textX: 15, textY: 85 },
    { label: 'Z', color: '#4d7dff', x2: 54, y2: 102, textX: 54, textY: 121 },
  ];

  const markerForAxis = (label) => {
    if (label === 'X') return 'url(#cubli-axis-arrow-red)';
    if (label === 'Y') return 'url(#cubli-axis-arrow-green)';
    return 'url(#cubli-axis-arrow-blue)';
  };

  return (
    <div
      className="position-absolute"
      style={{
        bottom: isMobile ? '2.45rem' : '2.65rem',
        left: isMobile ? '0.65rem' : '0.95rem',
        width: `${width}px`,
        height: `${height}px`,
        zIndex: 1060,
        pointerEvents: 'none',
      }}
      aria-label="Cubli body-fixed reference frame"
    >
      <svg width="100%" height="100%" viewBox="0 0 140 126" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker
            id="cubli-axis-arrow-red"
            markerWidth="7"
            markerHeight="7"
            refX="6.4"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#ff4b4b" />
          </marker>
          <marker
            id="cubli-axis-arrow-green"
            markerWidth="7"
            markerHeight="7"
            refX="6.4"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#4dff6a" />
          </marker>
          <marker
            id="cubli-axis-arrow-blue"
            markerWidth="7"
            markerHeight="7"
            refX="6.4"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#4d7dff" />
          </marker>
        </defs>

        {axes.map((axis) => (
          <g key={axis.label}>
            <line
              x1={origin.x}
              y1={origin.y}
              x2={axis.x2}
              y2={axis.y2}
              stroke={axis.color}
              strokeWidth="3.4"
              strokeLinecap="round"
              markerEnd={markerForAxis(axis.label)}
            />
            <text
              x={axis.textX}
              y={axis.textY}
              textAnchor="middle"
              fontSize="14"
              fontWeight="800"
              fill={axis.color}
              stroke="#000000"
              strokeWidth="3"
              paintOrder="stroke"
            >
              {axis.label}
            </text>
          </g>
        ))}

        <circle cx={origin.x} cy={origin.y} r="3" fill="#eeeeee" opacity="0.95" />
        <text
          x={origin.x - 12}
          y={origin.y - 3}
          textAnchor="middle"
          fontSize="12"
          fontWeight="800"
          fill="#eeeeee"
          stroke="#000000"
          strokeWidth="2.6"
          paintOrder="stroke"
        >
          O
        </text>
      </svg>
    </div>
  );
}

function CubliCanvas({
  attitude,
  attitudeQuat,
  torque,
  isPausedByLock,
  sensorMode,
  isSensorActive,
  cameraRef,
  controlsRef,
  viewResetKey,
  isMobile,
  livePacketRef,
  activeSourceType,
  axisLength,
}) {
  const cubliRef = useRef();
  const cameraTargetRef = useRef(new THREE.Vector3(0, 0, 0));

  useEffect(() => {
    let rafId;

    const tryFit = () => {
      if (cameraRef.current && cubliRef.current) {
        fitCameraToObject(
          cameraRef.current,
          cubliRef.current,
          controlsRef,
          cameraTargetRef,
          DEFAULT_VIEW_DIRECTION,
          1.42
        );
      } else {
        rafId = requestAnimationFrame(tryFit);
      }
    };

    tryFit();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [cameraRef, controlsRef, viewResetKey]);

  const handleZoom = (step) => {
    if (!cameraRef.current) return;

    const currentTarget = cameraTargetRef.current || new THREE.Vector3(0, 0, 0);
    const direction = cameraRef.current.position.clone().sub(currentTarget).normalize();
    const currentDistance = cameraRef.current.position.distanceTo(currentTarget);
    const nextDistance = Math.max(
      MIN_CAMERA_DISTANCE,
      Math.min(MAX_CAMERA_DISTANCE, currentDistance + step)
    );

    const newPos = currentTarget.clone().add(direction.multiplyScalar(nextDistance));
    cameraRef.current.position.copy(newPos);
    cameraRef.current.lookAt(currentTarget);
    cameraRef.current.updateProjectionMatrix();

    if (controlsRef.current) {
      controlsRef.current.target.copy(currentTarget);
      controlsRef.current.update();
    }
  };

  return (
    <div
      className="w-100 h-100 position-relative"
      style={{
        backgroundColor: '#000',
        overflow: 'hidden',
        height: '100%',
        minHeight: '100%',
      }}
    >
      <div
        className="position-absolute"
        style={{
          top: isMobile ? '0.45rem' : '0.65rem',
          left: isMobile ? '0.65rem' : '0.9rem',
          zIndex: 1050,
          pointerEvents: 'none',
          maxWidth: isMobile ? '60%' : 'unset',
        }}
      >
        <h1
          className={isMobile ? 'h4 fw-bold m-0' : 'h2 fw-bold m-0'}
          style={{ letterSpacing: '-0.05em', color: '#fff' }}
        >
          ADCS Cubli Simulator
        </h1>
        <p
          className="text-muted m-0"
          style={{ fontSize: isMobile ? '0.76rem' : '1rem' }}
        >
          Auto Framed Cubli View
        </p>
      </div>

      <div
        className="position-absolute d-flex gap-2"
        style={{
          top: isMobile ? '0.7rem' : '1rem',
          right: isMobile ? '0.65rem' : '1rem',
          zIndex: 1050,
          flexDirection: isMobile ? 'column' : 'row',
        }}
      >
        <Button
          variant="outline-light"
          size="sm"
          className="fw-bold bg-dark p-1 px-3 fs-7"
          onClick={() => handleZoom(-30)}
        >
          ➕ Zoom In
        </Button>

        <Button
          variant="outline-light"
          size="sm"
          className="fw-bold bg-dark p-1 px-3 fs-7"
          onClick={() => handleZoom(30)}
        >
          ➖ Zoom Out
        </Button>
      </div>

      <ReferenceFrameOverlay isMobile={isMobile} />

      <div
        className="position-absolute p-1"
        style={{
          bottom: '1rem',
          left: isMobile ? '0.65rem' : '1rem',
          zIndex: 1050,
          color: '#aaa',
          fontSize: isMobile ? '0.72rem' : '0.8rem',
          textTransform: 'uppercase',
        }}
      >
        Reference Frame
      </div>

      <Canvas dpr={isMobile ? [1, 1.15] : [1, 1.35]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <PerspectiveCamera
          ref={cameraRef}
          makeDefault
          position={[260, 180, 260]}
          fov={30}
        />

        <CameraLocker cameraRef={cameraRef} targetRef={cameraTargetRef} />

        <ambientLight intensity={0.95} />
        <hemisphereLight intensity={0.8} groundColor="#222222" />
        <directionalLight position={[25, 25, 25]} intensity={1.25} />
        <directionalLight position={[-25, 12, -15]} intensity={0.7} />

        <Grid
          position={[0, -120, 0]}
          args={[900, 900]}
          sectionColor="#222"
          cellColor="#111"
          infiniteGrid={true}
        />

        <Suspense fallback={null}>
          <CubliModel
            attitude={attitude}
            attitudeQuat={attitudeQuat}
            torque={torque}
            isPausedByLock={isPausedByLock}
            sensorMode={sensorMode}
            isSensorActive={isSensorActive}
            modelRef={cubliRef}
            livePacketRef={livePacketRef}
            activeSourceType={activeSourceType}
            axisLength={axisLength}
          />
        </Suspense>

        <OrbitControls
          ref={controlsRef}
          makeDefault
          target={[0, 0, 0]}
          enableRotate={false}
          enablePan={false}
          enableDamping={false}
          enableZoom={false}
        />

      </Canvas>
    </div>
  );
}

function AttitudePanel({
  attitude,
  handleAttitudeChange,
  sensorMode,
  setSensorMode,
  isSensorActive,
  toggleSensor,
  isPausedByLock,
}) {
  const absRoll = Math.abs(attitude.roll);
  const isGimbalLockZone = sensorMode === 'euler' && absRoll >= 88 && absRoll <= 90;

  return (
    <div className="attitude-panel">
      <div className="mb-4 pt-1">
        <h3 className="h6 fw-bold text-uppercase mb-3" style={{ color: '#aaa', letterSpacing: '0.1em' }}>
          Body-fixed Axes
        </h3>

        <Form.Group as={Row} className="mb-2 align-items-center g-2">
          <Form.Label column xs={4} className="fw-bold p-0 ps-3 fs-7">
            Pitch (X):
          </Form.Label>
          <Col xs={6}>
            <Form.Range
              min="-180"
              max="180"
              step="0.1"
              value={attitude.pitch}
              onChange={(e) => handleAttitudeChange('pitch', e.target.value)}
              disabled={isSensorActive || isPausedByLock}
              className="custom-range range-quaternion"
            />
          </Col>
          <Col xs={2} className="text-end p-0 pe-3 fw-bold fs-7">
            {attitude.pitch.toFixed(1)}°
          </Col>
        </Form.Group>

        <Form.Group as={Row} className="mb-2 align-items-center g-2">
          <Form.Label column xs={4} className="fw-bold p-0 ps-3 fs-7">
            Yaw (Y):
          </Form.Label>
          <Col xs={6}>
            <Form.Range
              min="-180"
              max="180"
              step="0.1"
              value={attitude.yaw}
              onChange={(e) => handleAttitudeChange('yaw', e.target.value)}
              disabled={isSensorActive || isPausedByLock}
              className="custom-range range-quaternion"
            />
          </Col>
          <Col xs={2} className="text-end p-0 pe-3 fw-bold fs-7">
            {attitude.yaw.toFixed(1)}°
          </Col>
        </Form.Group>

        <Form.Group as={Row} className="mb-2 align-items-center g-2">
          <Form.Label column xs={4} className="fw-bold p-0 ps-3 fs-7">
            Roll (Z):
          </Form.Label>
          <Col xs={6}>
            <Form.Range
              min="-180"
              max="180"
              step="0.1"
              value={attitude.roll}
              onChange={(e) => handleAttitudeChange('roll', e.target.value)}
              disabled={isSensorActive || isPausedByLock}
              className={isGimbalLockZone ? 'custom-range range-quaternion is-invalid' : 'custom-range range-quaternion'}
            />
          </Col>
          <Col xs={2} className="text-end p-0 pe-3 fw-bold fs-7">
            {attitude.roll.toFixed(1)}°
          </Col>
        </Form.Group>
      </div>

      <div className="mb-4">
        <h3 className="h6 fw-bold text-uppercase mb-3" style={{ color: '#aaa', letterSpacing: '0.1em' }}>
          Helper
        </h3>
        <div className="bg-secondary rounded p-3 d-flex justify-content-between align-items-center shadow-sm">
          <span className="fw-bold fs-7">Gimbal Lock Zone</span>
          <span className={isGimbalLockZone ? 'fw-bold text-danger fs-8' : 'fw-bold text-success fs-8'}>
            {isGimbalLockZone ? `⚠️ WARNING (${attitude.roll}°)` : '✅ Safe'}
          </span>
        </div>
      </div>

      <div className="mb-4 pt-1">
        <h3 className="h6 fw-bold text-uppercase mb-3" style={{ color: '#aaa', letterSpacing: '0.1em' }}>
          Coordinate Axes
        </h3>

        <div className="bg-secondary rounded p-3 d-flex justify-content-between align-items-center shadow-sm mb-3">
          <span className="fw-bold fs-7">Sensor Mode</span>
          <ButtonGroup size="sm">
            <Button
              variant={sensorMode === 'euler' ? 'warning' : 'outline-warning'}
              onClick={() => setSensorMode('euler')}
              className="fw-bold fs-8 p-1 px-3"
            >
              Euler
            </Button>
            <Button
              variant={sensorMode === 'quaternion' ? 'info' : 'outline-info'}
              onClick={() => setSensorMode('quaternion')}
              className="fw-bold fs-8 p-1 px-3"
            >
              Quat.
            </Button>
          </ButtonGroup>
        </div>

        <div className="d-grid mb-4 pt-2">
          <Button
            variant={isSensorActive ? 'danger' : 'outline-warning'}
            onClick={toggleSensor}
            className="fw-bold shadow-sm p-2 fs-7"
            disabled={isPausedByLock}
          >
            {isSensorActive ? '📱 Disable Sensor' : '📱 Phone Sensor Sync'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TorquePanel({ torque, handleTorqueChange, isPausedByLock, resetTorque }) {
  return (
    <div className="torque-panel pt-2">
      <h3 className="h6 fw-bold text-uppercase mb-4 pt-1" style={{ color: '#aaa', letterSpacing: '0.1em' }}>
        Reaction Wheel 추력
      </h3>

      <Form.Group as={Row} className="mb-3 align-items-center g-2">
        <Form.Label column xs={4} className="fw-bold p-0 ps-3 fs-7">
          X축 모터:
        </Form.Label>
        <Col xs={6}>
          <Form.Range
            min="-100"
            max="100"
            step="1"
            value={torque.x}
            onChange={(e) => handleTorqueChange('x', e.target.value)}
            disabled={isPausedByLock}
            className="custom-range range-red"
          />
        </Col>
        <Col xs={2} className="text-end p-0 pe-3 fw-bold fs-7">
          {torque.x.toFixed(0)} RPM
        </Col>
      </Form.Group>

      <Form.Group as={Row} className="mb-3 align-items-center g-2">
        <Form.Label column xs={4} className="fw-bold p-0 ps-3 fs-7">
          Y축 모터:
        </Form.Label>
        <Col xs={6}>
          <Form.Range
            min="-100"
            max="100"
            step="1"
            value={torque.y}
            onChange={(e) => handleTorqueChange('y', e.target.value)}
            disabled={isPausedByLock}
            className="custom-range range-green"
          />
        </Col>
        <Col xs={2} className="text-end p-0 pe-3 fw-bold fs-7">
          {torque.y.toFixed(0)} RPM
        </Col>
      </Form.Group>

      <Form.Group as={Row} className="mb-3 align-items-center g-2">
        <Form.Label column xs={4} className="fw-bold p-0 ps-3 fs-7">
          Z축 모터:
        </Form.Label>
        <Col xs={6}>
          <Form.Range
            min="-100"
            max="100"
            step="1"
            value={torque.z}
            onChange={(e) => handleTorqueChange('z', e.target.value)}
            disabled={isPausedByLock}
            className="custom-range range-blue"
          />
        </Col>
        <Col xs={2} className="text-end p-0 pe-3 fw-bold fs-7">
          {torque.z.toFixed(0)} RPM
        </Col>
      </Form.Group>

      <div className="d-grid mt-5 pt-1">
        <Button variant="outline-info" onClick={resetTorque} disabled={isPausedByLock} className="fw-bold p-2 fs-7">
          ⚙️ Stop All Motors (0 RPM)
        </Button>
      </div>
    </div>
  );
}

function PhoneSensorPanel({
  isPhoneSensorActive,
  togglePhoneSensor,
  calibratePhoneZero,
  attitude,
  isHardwareActive,
  isPausedByLock,
  isAdmin,
}) {
  const hasDeviceOrientation = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  const adminLocked = !isAdmin;

  return (
    <div className="phone-sensor-panel">
      <div className="simple-section-title">Phone Sensor</div>
      <div className="simple-muted mb-3">
        Phone Sensor data is for visualization/shared reference, not Cubli hardware telemetry.
      </div>

      <div className="simple-status-card mb-3">
        <div className="simple-status-row">
          <span>Status</span>
          <strong className={isPhoneSensorActive ? 'text-success' : 'text-secondary'}>
            {isPhoneSensorActive ? 'Connected' : 'Off'}
          </strong>
        </div>
        <div className="simple-status-row">
          <span>Roll / Pitch / Yaw</span>
          <strong>
            {attitude.roll.toFixed(1)}° / {attitude.pitch.toFixed(1)}° / {attitude.yaw.toFixed(1)}°
          </strong>
        </div>
      </div>

      <div className="d-grid gap-2 mb-3">
        {adminLocked ? (
          <div className="simple-note warning">Phone Sensor mode is available only in Admin mode.</div>
        ) : null}
        <Button
          variant={isPhoneSensorActive ? 'outline-danger' : 'outline-light'}
          className="fw-bold simple-main-button"
          onClick={togglePhoneSensor}
          disabled={adminLocked || !hasDeviceOrientation || isPausedByLock}
        >
          {isPhoneSensorActive ? 'Disable Sensor' : 'Connect Phone Sensor'}
        </Button>

        <Button
          variant="outline-secondary"
          className="fw-bold simple-main-button"
          onClick={calibratePhoneZero}
          disabled={adminLocked || !isPhoneSensorActive}
        >
          Set Current Phone Attitude as 0°
        </Button>
      </div>

      {isHardwareActive ? (
        <div className="simple-note warning">Serial/BLE 자세 입력이 켜져 있으면 Phone Sensor는 자동으로 꺼집니다.</div>
      ) : null}

      {!hasDeviceOrientation ? (
        <div className="simple-note warning">이 브라우저는 DeviceOrientation 센서를 지원하지 않습니다.</div>
      ) : null}

      <div className="simple-note mt-3">
        Phone Sensor data is for visualization/shared reference, not Cubli hardware telemetry.
      </div>
    </div>
  );
}

function WebSerialBridgePanel({
  enabled,
  onEnabledChange,
  serialConnected,
  lastPublishAt,
  publishRateHz,
  lastError,
  publishCount,
  publishFailedCount,
  lastPublishHttpStatus,
  publishEndpointUrl,
  publishBackoffUntil,
  latestSharedPacketAgeMs,
  lastCommandStatus,
  sharedSourceLabel,
}) {
  const bridgeStatusText = enabled ? 'ON' : 'OFF';

  return (
    <div className="serial-control-card rounded p-3 mb-3">
      <div className="d-flex justify-content-between align-items-start gap-3 mb-2">
        <div>
          <div className="serial-section-title">Web Serial Bridge</div>
          <div className="server-small-note">
            Web Serial Bridge shares the Admin browser's ESP32 data through the server so viewers can see the same Cubli state.
          </div>
          <div className="server-small-note text-info">Patch v11 active: 100 Hz fast publish + SSE stream. Viewer polling is skipped while the stream is connected.</div>
        </div>
        <Form.Check
          type="switch"
          id="admin-web-serial-bridge-enabled"
          label={enabled ? 'Disable Server Sharing' : 'Enable Server Sharing'}
          checked={Boolean(enabled)}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
      </div>

      <Row className="g-2 mt-2">
        <Col xs={6}><div className="serial-value-card rounded p-2"><div className="server-small-note">Bridge status</div><strong>{bridgeStatusText}</strong></div></Col>
        <Col xs={6}><div className="serial-value-card rounded p-2"><div className="server-small-note">Web Serial connected</div><strong>{serialConnected ? 'yes' : 'no'}</strong></div></Col>
        <Col xs={6}><div className="serial-value-card rounded p-2"><div className="server-small-note">Last publish time</div><strong>{formatBridgeTime(lastPublishAt)}</strong></div></Col>
        <Col xs={6}><div className="serial-value-card rounded p-2"><div className="server-small-note">Publish rate</div><strong>{publishRateHz} Hz max ({Math.round(1000 / Math.max(publishRateHz, 1))} ms, fast stream)</strong></div></Col>
        <Col xs={6}><div className="serial-value-card rounded p-2"><div className="server-small-note">Publish count</div><strong>{publishCount ?? 0}</strong></div></Col>
        <Col xs={6}><div className="serial-value-card rounded p-2"><div className="server-small-note">Failed publish count</div><strong>{publishFailedCount ?? 0}</strong></div></Col>
        <Col xs={6}><div className="serial-value-card rounded p-2"><div className="server-small-note">Last publish HTTP status</div><strong>{lastPublishHttpStatus ?? '-'}</strong></div></Col>
        <Col xs={6}><div className="serial-value-card rounded p-2"><div className="server-small-note">latestSharedPacket age</div><strong>{latestSharedPacketAgeMs != null ? `${Math.round(latestSharedPacketAgeMs)} ms` : '-'}</strong></div></Col>
        <Col xs={12}><div className="serial-value-card rounded p-2"><div className="server-small-note">Shared source</div><strong>{sharedSourceLabel || 'Admin Web Serial Bridge'}</strong></div></Col>
        <Col xs={12}><div className="serial-value-card rounded p-2"><div className="server-small-note">Publish endpoint</div><strong className="text-break">{publishEndpointUrl || '-'}</strong></div></Col>
      </Row>

      {!serialConnected ? (
        <Alert variant="secondary" className="py-2 mt-3 mb-0">
          Connect Web Serial in the Admin browser before sharing live Cubli data.
        </Alert>
      ) : null}
      {lastCommandStatus ? (
        <Alert variant="info" className="py-2 mt-3 mb-0">
          {lastCommandStatus}
        </Alert>
      ) : null}
      {publishBackoffUntil && Date.now() < publishBackoffUntil ? (
        <Alert variant="warning" className="py-2 mt-3 mb-0">
          Publish is paused until {formatBridgeTime(publishBackoffUntil)} after repeated 404 responses.
        </Alert>
      ) : null}
      {lastError ? (
        <Alert variant="warning" className="py-2 mt-3 mb-0 text-break">
          Last publish error: {lastError}
        </Alert>
      ) : null}
    </div>
  );
}

function NameEntryModal({
  show,
  required,
  initialName,
  suggestedName,
  onSave,
  onCancel,
}) {
  const [name, setName] = useState('');
  const cleanName = sanitizeDisplayNameInput(name);
  const isValid = cleanName.length >= 1 && cleanName.length <= 30;

  useEffect(() => {
    if (!show) return;
    setName(initialName || suggestedName || '');
  }, [show, initialName, suggestedName]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!isValid) return;
    onSave(cleanName);
  };

  return (
    <Modal show={show} centered backdrop={required ? 'static' : true} keyboard={!required} onHide={required ? undefined : onCancel}>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton={!required} className="bg-dark text-light border-secondary">
          <Modal.Title>Enter your name</Modal.Title>
        </Modal.Header>
        <Modal.Body className="bg-dark text-light">
          <Form.Group>
            <Form.Label>Display name or nickname</Form.Label>
            <Form.Control
              autoFocus
              maxLength={30}
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 30))}
              placeholder="Viewer-1234"
            />
            <div className="server-small-note mt-2">1-30 characters. This is only for identifying connected clients.</div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer className="bg-dark border-secondary">
          {!required ? (
            <Button variant="outline-secondary" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button variant="outline-info" type="button" onClick={() => setName(suggestedName || '')}>
            Use Suggestion
          </Button>
          <Button variant="success" type="submit" disabled={!isValid}>
            Save Name
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}


/* =========================
   2. Main Component
========================= */

export default function CubliSimulator() {
  const [attitude, setAttitude] = useState({ pitch: 0, yaw: 0, roll: 0 });
  const [attitudeQuat, setAttitudeQuat] = useState(new THREE.Quaternion());
  const [sensorMode, setSensorMode] = useState('quaternion');
  const [torque, setTorque] = useState({ x: 0, y: 0, z: 0 });

  const [activeTab, setActiveTab] = useState('server');
  const [isLogging, setIsLogging] = useState(false);
  const [loggingStartTime, setLoggingStartTime] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const fullDataLog = useRef([]);

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallPopup, setShowInstallPopup] = useState(false);

  const [isSensorActive, setIsSensorActive] = useState(false);
  const [useSerialImu, setUseSerialImu] = useState(false);
  const [useBleImu, setUseBleImu] = useState(false);
  const [bridgeLastPublishAt, setBridgeLastPublishAt] = useState(null);
  const [bridgeLastPublishError, setBridgeLastPublishError] = useState('');
  const [bridgeLastCommandStatus, setBridgeLastCommandStatus] = useState('');
  const phoneZeroRef = useRef(null);
  const bridgePublishRef = useRef({ lastAt: 0, busy: false, lastPacketUpdatedAt: 0 });
  const bridgeCommandBusyRef = useRef(false);

  const cameraRef = useRef();
  const controlsRef = useRef();

  const [isPausedByLock, setIsPausedByLock] = useState(false);
  const [showLockModal, setShowLockModal] = useState(false);

  const [viewResetKey, setViewResetKey] = useState(0);

  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );

  const [controlPanelWidth, setControlPanelWidth] = useState(() => {
    const width = typeof window !== 'undefined' ? window.innerWidth : 1200;
    return Math.round(Math.min(680, Math.max(440, width * 0.36)));
  });
  const [axisLength, setAxisLength] = useState(34);

  const panelDragActiveRef = useRef(false);
  const [isPanelDragging, setIsPanelDragging] = useState(false);

  const serial = useEsp32Serial();
  const ble = useEsp32Ble();
  const serverSync = useServerSync();
  const { enqueueSample, publishLivePacket, publishCommandState, recordEvent } = serverSync;
  const [showNameModal, setShowNameModal] = useState(!serverSync.hasDisplayName);
  const serverSerial = serverSync.serverSerial || {};
  const isAdmin = serverSync.role === 'admin';
  const webSerialBridgeEnabled = Boolean(serverSync.bridgeEnabled);
  const setWebSerialBridgeEnabled = serverSync.setBridgeEnabled;

  const suggestedDisplayName = useMemo(() => (
    serverSync.getSuggestedDisplayName?.(isAdmin ? 'Admin' : 'Viewer') || ''
  ), [isAdmin, serverSync]);

  const handleOpenNameModal = React.useCallback(() => {
    setShowNameModal(true);
  }, []);

  const handleCloseNameModal = React.useCallback(() => {
    if (serverSync.hasDisplayName) setShowNameModal(false);
  }, [serverSync.hasDisplayName]);

  const handleSaveDisplayName = React.useCallback((value) => {
    const saved = serverSync.setDisplayName?.(value);
    if (!saved) return;
    setShowNameModal(false);
  }, [serverSync]);

  useEffect(() => {
    if (!serverSync.hasDisplayName) {
      setShowNameModal(true);
    }
  }, [serverSync.hasDisplayName]);

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const isMobile = viewportWidth < 768;
  const isTablet = viewportWidth >= 768 && viewportWidth < 992;
  const canvasHeight = isMobile ? '58dvh' : isTablet ? '72dvh' : '99dvh';
  const controlPanelMinWidth = 360;
  const controlPanelMaxWidth = Math.max(420, Math.min(900, Math.round(viewportWidth * 0.55)));
  const safeControlPanelWidth = Math.min(
    Math.max(controlPanelWidth, controlPanelMinWidth),
    controlPanelMaxWidth
  );
  const sharedPacket = serverSerial.status?.latestSharedPacket || serverSerial.latestPacket || null;
  const sharedPacketActive = Boolean(sharedPacket?.updatedAt || sharedPacket?.publishedAt);
  const serverSerialImuActive = Boolean(
    serverSerial.status?.isConnected &&
    sharedPacketActive &&
    (sharedPacket?.source === 'server-serial' || serverSerial.status?.activeSharedSource === 'server-serial')
  );
  const bleImuActive = isAdmin && useBleImu && ble.isConnected;
  const serialImuActive = isAdmin && useSerialImu && serial.isConnected;
  const phoneImuActive = isAdmin && isSensorActive;
  const hardwareImuActive = serialImuActive || bleImuActive || serverSerialImuActive;
  const activeDirectSourceCount = [
    serverSerialImuActive,
    bleImuActive,
    serialImuActive,
    phoneImuActive,
  ].filter(Boolean).length;
  const multipleSourcesActive = activeDirectSourceCount > 1;

  useEffect(() => {
    if (isAdmin) return;
    if (activeTab === 'serial' || activeTab === 'ble' || activeTab === 'phone') {
      setActiveTab('server');
    }
    setUseSerialImu(false);
    setUseBleImu(false);
    setWebSerialBridgeEnabled(false);
    setIsSensorActive(false);
    phoneZeroRef.current = null;
  }, [activeTab, isAdmin]);

  // Fallback ref: 혹시 hook이 latestPacketRef를 제공하지 않거나, 브라우저 복구 과정에서
  // ref 연결이 끊겨도 React state로 들어온 최신 packet을 3D 루프가 계속 읽을 수 있게 한다.
  const serialPacketMirrorRef = useRef(null);
  const blePacketMirrorRef = useRef(null);
  const serverSerialPacketMirrorRef = useRef(null);
  const phonePacketMirrorRef = useRef(null);
  const sharedPacketMirrorRef = useRef(null);

  useEffect(() => {
    if (serial.latestPacket?.updatedAt) {
      serialPacketMirrorRef.current = serial.latestPacket;
    }
  }, [serial.latestPacket?.updatedAt]);

  useEffect(() => {
    if (ble.latestPacket?.updatedAt) {
      blePacketMirrorRef.current = ble.latestPacket;
    }
  }, [ble.latestPacket?.updatedAt]);

  useEffect(() => {
    const latest = serverSerial.status?.latestSharedPacket || serverSerial.latestPacket;
    if (latest?.updatedAt || latest?.publishedAt) {
      serverSerialPacketMirrorRef.current = latest;
      sharedPacketMirrorRef.current = latest;
      if (typeof window !== 'undefined') {
        window.__CUBLI_SERVER_SERIAL_PACKET = latest;
      }
    }
  }, [serverSerial.latestPacket?.updatedAt, serverSerial.status?.latestSharedPacket?.publishedAt, serverSerial.status?.latestSharedPacket?.updatedAt]);

  const adminActiveSourceType = serverSerialImuActive
    ? 'server-serial'
    : bleImuActive
      ? 'ble'
      : serialImuActive
        ? 'admin-web-serial'
        : phoneImuActive
          ? 'phone'
          : 'none';
  const activeSourceType = isAdmin ? adminActiveSourceType : (sharedPacket?.source || 'none');

  const activeLivePacketRef = isAdmin
    ? (serverSerialImuActive
      ? (serverSerial.latestPacketRef || serverSerialPacketMirrorRef)
      : bleImuActive
        ? (ble.latestPacketRef || blePacketMirrorRef)
        : serialImuActive
          ? (serial.latestPacketRef || serialPacketMirrorRef)
          : phoneImuActive
            ? phonePacketMirrorRef
            : (serverSerial.latestPacketRef || sharedPacketMirrorRef))
    : (serverSerial.latestPacketRef || sharedPacketMirrorRef);

  const activeSourceLabel = isAdmin
    ? (serverSerialImuActive
      ? 'Server Remote Serial'
      : bleImuActive
        ? 'Admin BLE'
        : serialImuActive
          ? 'Admin Web Serial Bridge'
          : phoneImuActive
            ? 'Admin Phone Sensor'
            : (sharedPacket?.sourceLabel || 'No active source'))
    : (sharedPacket?.sourceLabel || 'Shared Server Data');

  const commandEventToRemoteKey = React.useCallback((event = {}) => {
    const detail = event.detail || {};
    const type = String(event.eventType || '').toUpperCase();
    const label = String(event.label || '');
    if (type === 'TARGET_ATTITUDE') {
      return {
        commandKey: 'targetAttitude',
        params: {
          roll: Number(detail.roll) || 0,
          pitch: Number(detail.pitch) || 0,
          yaw: Number(detail.yaw) || 0,
        },
        label: label || 'Send Target Attitude',
      };
    }
    if (type === 'TARE') return { commandKey: 'tare', params: {}, label: label || 'Set Zero / Tare' };
    if (type === 'STOP') return { commandKey: 'stop', params: {}, label: label || 'Stop' };
    if (type === 'RECEIVER_INFO' && /mac/i.test(label)) return { commandKey: 'macInfo', params: {}, label: 'MAC Info' };
    if (type === 'RECEIVER_INFO') return { commandKey: 'status', params: {}, label: 'Status' };
    if (type === 'EBIMU_COMMAND') {
      const cmdId = Number(detail.cmdId);
      const value = Number(detail.value);
      if (cmdId === 1) {
        if (value === 0) return { commandKey: 'magOff', params: {}, label: label || 'Mag Off' };
        if (value === 1) return { commandKey: 'magOn', params: {}, label: label || 'Mag On' };
        if (value === 2) return { commandKey: 'magAuto', params: {}, label: label || 'Mag Auto' };
      }
      if (cmdId === 2 && [250, 500, 1000, 2000].includes(value)) {
        return { commandKey: `gyro${value}`, params: {}, label: label || `${value} dps` };
      }
      if (cmdId === 3 && [2, 4, 8, 16].includes(value)) {
        return { commandKey: `acc${value}g`, params: {}, label: label || `${value} g` };
      }
      if (cmdId === 4) return { commandKey: 'accFactor', params: { factor: value || 10 }, label: label || 'Accel Filter Factor' };
      if (cmdId === 9) return { commandKey: 'ebimuDefault', params: {}, label: label || 'EBIMU Default Setup' };
      if (cmdId === 10) return { commandKey: 'ebimuStart', params: {}, label: label || 'EBIMU Start' };
      if (cmdId === 11) return { commandKey: 'ebimuStop', params: {}, label: label || 'EBIMU Stop' };
    }
    return null;
  }, []);

  const recordCommandEvent = React.useCallback((event) => {
    const fallbackSource = event?.source || activeSourceType || 'ui';
    recordEvent(
      {
        source: fallbackSource,
        eventType: event?.eventType || 'COMMAND',
        label: event?.label || 'Command',
        detail: event?.detail || {},
      },
      fallbackSource
    );
    if (isAdmin && (fallbackSource === 'admin-web-serial' || fallbackSource === 'legacy-web-serial' || fallbackSource === 'ble')) {
      const mapped = commandEventToRemoteKey(event);
      if (mapped) {
        publishCommandState?.(mapped.commandKey, mapped.params, mapped.label);
      }
    }
  }, [activeSourceType, commandEventToRemoteKey, isAdmin, publishCommandState, recordEvent]);

  useEffect(() => {
    if (!isAdmin || !webSerialBridgeEnabled || !serial.isConnected) return undefined;

    const publishLatestSerialPacket = () => {
      const packet = serial.latestPacketRef?.current || serial.latestPacket;
      if (!packet?.updatedAt) return;
      if (packet.updatedAt === bridgePublishRef.current.lastPacketUpdatedAt) return;

      const now = Date.now();
      if (now - bridgePublishRef.current.lastAt < WEB_SERIAL_BRIDGE_PUBLISH_INTERVAL_MS) return;
      if (bridgePublishRef.current.inFlight >= WEB_SERIAL_BRIDGE_MAX_IN_FLIGHT) return;

      bridgePublishRef.current.lastAt = now;
      bridgePublishRef.current.lastPacketUpdatedAt = packet.updatedAt;
      bridgePublishRef.current.inFlight += 1;

      publishLivePacket(packet, 'admin-web-serial', { force: true, minIntervalMs: 0, fast: true })
        .then((ok) => {
          if (ok) {
            setBridgeLastPublishAt(Date.now());
            setBridgeLastPublishError('');
            enqueueSample(packet, 'admin-web-serial', {
              validCount: serial.validCount,
              invalidCount: serial.invalidCount,
              warningCount: serial.warningCount,
            });
          } else {
            setBridgeLastPublishError(serverSync.lastError || 'Live publish failed or packet was skipped.');
          }
        })
        .catch((error) => {
          setBridgeLastPublishError(error?.message || 'Live publish failed.');
        })
        .finally(() => {
          bridgePublishRef.current.inFlight = Math.max(0, bridgePublishRef.current.inFlight - 1);
        });
    };

    publishLatestSerialPacket();
    const timer = window.setInterval(publishLatestSerialPacket, WEB_SERIAL_BRIDGE_PUBLISH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [
    isAdmin,
    webSerialBridgeEnabled,
    serial.isConnected,
    serial.latestPacket,
    serial.latestPacketRef,
    serial.validCount,
    serial.invalidCount,
    serial.warningCount,
    enqueueSample,
    publishLivePacket,
    serverSync.lastError,
  ]);

  useEffect(() => {
    if (!isAdmin || !webSerialBridgeEnabled || !serial.isConnected) return undefined;
    const pollBridgeCommands = serverSerial.pollBridgeCommands;
    const ackBridgeCommand = serverSerial.ackBridgeCommand;
    if (!pollBridgeCommands || !ackBridgeCommand || !serial.sendLine) return undefined;

    const relayPendingCommands = async () => {
      if (bridgeCommandBusyRef.current) return;
      bridgeCommandBusyRef.current = true;
      try {
        const commands = await pollBridgeCommands();
        for (const command of commands) {
          const serialLine = String(command.serialLine || '').trim();
          if (!serialLine) {
            await ackBridgeCommand(command.commandId, false, '', 'Bridge command is missing a serial line.');
            setBridgeLastCommandStatus('Bridge command failed: missing serial line.');
            continue;
          }

          try {
            setBridgeLastCommandStatus(`Relaying ${command.label || command.commandKey} through Web Serial...`);
            const sent = await serial.sendLine(serialLine);
            if (!sent) throw new Error(serial.error || 'Web Serial send failed.');
            await ackBridgeCommand(command.commandId, true, serialLine, '');
            setBridgeLastCommandStatus(`Relayed ${command.label || command.commandKey} through Web Serial.`);
          } catch (error) {
            const message = error?.message || 'Web Serial send failed.';
            await ackBridgeCommand(command.commandId, false, '', message);
            setBridgeLastCommandStatus(`Bridge command failed: ${message}`);
          }
        }
      } finally {
        bridgeCommandBusyRef.current = false;
      }
    };

    relayPendingCommands();
    const timer = window.setInterval(relayPendingCommands, WEB_SERIAL_BRIDGE_COMMAND_POLL_MS);
    return () => window.clearInterval(timer);
  }, [
    isAdmin,
    webSerialBridgeEnabled,
    serial.isConnected,
    serial.sendLine,
    serial.error,
    serverSerial.pollBridgeCommands,
    serverSerial.ackBridgeCommand,
  ]);

  useEffect(() => {
    if (!isAdmin || activeSourceType !== 'ble' || !ble.isConnected || !ble.latestPacket?.updatedAt) return;
    publishLivePacket(ble.latestPacket, 'ble');
    enqueueSample(ble.latestPacket, 'ble', {
      validCount: ble.validCount,
      invalidCount: ble.invalidCount,
      warningCount: ble.warningCount,
    });
  }, [
    isAdmin,
    activeSourceType,
    ble.isConnected,
    ble.latestPacket?.updatedAt,
    ble.validCount,
    ble.invalidCount,
    ble.warningCount,
    enqueueSample,
    publishLivePacket,
  ]);

  useEffect(() => {
    if (!serverSerialImuActive || !serverSerial.latestPacket?.updatedAt) return;
    enqueueSample(serverSerial.latestPacket, 'server-serial', {
      validCount: serverSerial.status?.validCount,
      invalidCount: serverSerial.status?.invalidCount,
      warningCount: serverSerial.status?.warningCount,
    });
  }, [
    serverSerialImuActive,
    serverSerial.latestPacket?.updatedAt,
    serverSerial.status?.validCount,
    serverSerial.status?.invalidCount,
    serverSerial.status?.warningCount,
    enqueueSample,
  ]);

  useEffect(() => {
    if (!isAdmin || !isSensorActive || activeSourceType !== 'phone') return undefined;

    const timer = window.setInterval(() => {
      const now = Date.now();
      const phonePacket = normalizeLivePacket({
        source: 'phone',
        sourceLabel: 'Admin Phone Sensor',
        pcTimeMs: now,
        q: [attitudeQuat.w, attitudeQuat.x, attitudeQuat.y, attitudeQuat.z],
        q0: attitudeQuat.w,
        q1: attitudeQuat.x,
        q2: attitudeQuat.y,
        q3: attitudeQuat.z,
        rollDeg: attitude.roll,
        pitchDeg: attitude.pitch,
        yawDeg: attitude.yaw,
        Roll_deg: attitude.roll,
        Pitch_deg: attitude.pitch,
        Yaw_deg: attitude.yaw,
        timestamp: now,
        seq: now,
        raw: 'phone-sensor',
        attitudeSource: 'phone_sensor',
        updatedAt: now,
      }, 'phone');
      if (!phonePacket?.ok) return;
      phonePacketMirrorRef.current = phonePacket;
      if (typeof window !== 'undefined') {
        window.__CUBLI_PHONE_PACKET = phonePacket;
      }
      publishLivePacket(phonePacket, 'phone');
      enqueueSample(phonePacket, 'phone');
    }, 250);

    return () => window.clearInterval(timer);
  }, [activeSourceType, attitude, attitudeQuat, enqueueSample, isAdmin, isSensorActive, publishLivePacket]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__CUBLI_ACTIVE_SOURCE = activeSourceType;
    }
  }, [activeSourceType]);

  useEffect(() => {
    if (!isLogging || loggingStartTime == null) return;

    const timer = setInterval(() => {
      setElapsedMs(Date.now() - loggingStartTime);
    }, 100);

    return () => clearInterval(timer);
  }, [isLogging, loggingStartTime]);

  useEffect(() => {
    if (!serverSync.hasDisplayName) return undefined;
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (isStandalone) return undefined;

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const timer = setTimeout(() => {
      setShowInstallPopup(true);
    }, 1500);

    const handleAppInstalled = () => {
      setShowInstallPopup(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      clearTimeout(timer);
    };
  }, [serverSync.hasDisplayName]);


  useEffect(() => {
    if (!serverSerial.useAsSource) return;
    setUseSerialImu(false);
    setUseBleImu(false);
    setIsSensorActive(false);
    phoneZeroRef.current = null;
    setSensorMode('quaternion');
  }, [serverSerial.useAsSource]);


  const handleUseSerialImuChange = (enabled) => {
    if (!isAdmin) return;
    setUseSerialImu(enabled);
    if (enabled) {
      setUseBleImu(false);
      serverSerial.setUseAsSource?.(false);
      setIsSensorActive(false);
      phoneZeroRef.current = null;
      setSensorMode('quaternion');
    }
  };

  const handleUseBleImuChange = (enabled) => {
    if (!isAdmin) return;
    setUseBleImu(enabled);
    if (enabled) {
      setUseSerialImu(false);
      serverSerial.setUseAsSource?.(false);
      setIsSensorActive(false);
      phoneZeroRef.current = null;
      setSensorMode('quaternion');
    }
  };

  const applyImuPacketToAttitude = React.useCallback((packet) => {
    if (!packet?.updatedAt) return;

    const nextAttitude = {
      roll: Number(packet.rollDeg ?? packet.roll_deg) || 0,
      pitch: Number(packet.pitchDeg ?? packet.pitch_deg) || 0,
      yaw: Number(packet.yawDeg ?? packet.yaw_deg) || 0,
    };

    setAttitude(nextAttitude);

    // Serial Remote와 BLE Sender 모두 q=[qw,qx,qy,qz]를 같은 형식으로 넘긴다.
    // usedQuaternion flag가 없더라도 q 배열이 있으면 quaternion 자세를 우선 적용한다.
    if (Array.isArray(packet.q) && packet.q.length === 4) {
      const [qw, qx, qy, qz] = packet.q;
      const nextQuat = new THREE.Quaternion(qx, qy, qz, qw).normalize();
      setAttitudeQuat(nextQuat);
      return;
    }

    const eulerFallbackQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(nextAttitude.pitch),
        THREE.MathUtils.degToRad(nextAttitude.yaw),
        THREE.MathUtils.degToRad(-nextAttitude.roll),
        'YXZ'
      )
    );

    setAttitudeQuat(eulerFallbackQuat);
  }, []);

  useEffect(() => {
    if (!useSerialImu || !serial.isConnected) return;
    applyImuPacketToAttitude(serial.latestPacket);
  }, [useSerialImu, serial.isConnected, serial.latestPacket?.updatedAt, applyImuPacketToAttitude]);

  useEffect(() => {
    if (!useBleImu || !ble.isConnected) return;
    applyImuPacketToAttitude(ble.latestPacket);
  }, [useBleImu, ble.isConnected, ble.latestPacket?.updatedAt, applyImuPacketToAttitude]);

  useEffect(() => {
    if (!serverSerialImuActive) return;
    applyImuPacketToAttitude(serverSerial.status?.latestSharedPacket || serverSerial.latestPacket);
  }, [serverSerialImuActive, serverSerial.latestPacket?.updatedAt, serverSerial.status?.latestSharedPacket?.publishedAt, applyImuPacketToAttitude]);

  useEffect(() => {
    if (isAdmin && adminActiveSourceType !== 'none') return;
    if (!sharedPacketActive) return;
    applyImuPacketToAttitude(sharedPacket);
  }, [adminActiveSourceType, applyImuPacketToAttitude, isAdmin, sharedPacket, sharedPacketActive]);

  const sendTransportCommand = React.useCallback(
    async (command) => {
      const body = String(command || '').trim();
      if (!body) return false;

      // 현재 자세 입력으로 쓰는 경로를 우선 사용한다.
      if (useBleImu && ble.isConnected && ble.hasCommandCharacteristic) {
        return ble.sendCommand(body);
      }
      if (useSerialImu && serial.isConnected) {
        return serial.sendCommand(body);
      }
      if (serverSerial.useAsSource && serverSerial.status?.isConnected) {
        return serverSerial.sendCommand(body);
      }

      // 선택된 source가 없어도 연결된 transport가 있으면 명령을 보낸다.
      if (ble.isConnected && ble.hasCommandCharacteristic) {
        return ble.sendCommand(body);
      }
      if (serial.isConnected) {
        return serial.sendCommand(body);
      }
      if (serverSerial.status?.isConnected) {
        return serverSerial.sendCommand(body);
      }

      alert('명령을 보낼 Serial Receiver, BLE Sender 또는 Server Serial Receiver가 연결되어 있지 않습니다.');
      return false;
    },
    [ble, serial, serverSerial, useBleImu, useSerialImu]
  );

  const handleTareCommand = React.useCallback(() => {
    recordCommandEvent({ eventType: 'TARE', label: 'Set Zero / Tare' });
    return sendTransportCommand('TARE');
  }, [recordCommandEvent, sendTransportCommand]);

  const handleStopCommand = React.useCallback(() => {
    recordCommandEvent({ eventType: 'STOP', label: 'Stop Control' });
    return sendTransportCommand('STOP');
  }, [recordCommandEvent, sendTransportCommand]);


  useEffect(() => {
    const absRoll = Math.abs(attitude.roll);

    if (sensorMode === 'euler' && absRoll >= 88 && absRoll <= 90 && !isPausedByLock) {
      setIsPausedByLock(true);
      setShowLockModal(true);

      if (isLogging) {
        handleStopLogging();
      }
    }
  }, [attitude, isPausedByLock, sensorMode, isLogging]);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        setShowInstallPopup(false);
      }
    } else {
      alert(
        "이 브라우저 환경에서는 자동 설치가 지원되지 않습니다.\n\n[수동 설치]\n📱 Android: 메뉴 ➔ '홈 화면에 추가'\n🍏 iOS: 공유 아이콘 ➔ '홈 화면에 추가'\n💻 PC: 주소창 우측 '앱 다운로드' 아이콘 클릭"
      );
      setShowInstallPopup(false);
    }
  };

  const handleModalClose = () => {
    setShowLockModal(false);
    setIsPausedByLock(false);

    setAttitude((prev) => {
      let safeRoll = prev.roll;
      if (prev.roll >= 88) safeRoll = 87;
      else if (prev.roll <= -88) safeRoll = -87;

      return { ...prev, roll: safeRoll };
    });
  };

  useEffect(() => {
    if (isPausedByLock || hardwareImuActive) return;

    const interval = setInterval(() => {
      setAttitude((prev) => {
        let p = prev.pitch;
        let y = prev.yaw;
        let r = prev.roll;

        if (!isSensorActive && !hardwareImuActive) {
          p -= torque.x * 0.15;
          y -= torque.y * 0.15;
          r -= torque.z * 0.15;

          if (p > 180) p -= 360;
          else if (p < -180) p += 360;

          if (y > 180) y -= 360;
          else if (y < -180) y += 360;

          if (r > 180) r -= 360;
          else if (r < -180) r += 360;
        }

        const newPitch = Math.round(p * 10) / 10;
        const newYaw = Math.round(y * 10) / 10;
        const newRoll = Math.round(r * 10) / 10;

        const eulerForQuat = new THREE.Euler(
          THREE.MathUtils.degToRad(newPitch),
          THREE.MathUtils.degToRad(newYaw),
          THREE.MathUtils.degToRad(-newRoll),
          'YXZ'
        );

        const nextQuat = new THREE.Quaternion().setFromEuler(eulerForQuat);

        if (isLogging) {
          const now = new Date();
          const timeString = `${now.getSeconds()}.${now.getMilliseconds()
            .toString()
            .padStart(3, '0')
            .slice(0, 2)}`;

          fullDataLog.current.push({
            time: timeString,
            roll: newRoll,
            yaw: newYaw,
            pitch: newPitch,
            qX: nextQuat.x.toFixed(4),
            qY: nextQuat.y.toFixed(4),
            qZ: nextQuat.z.toFixed(4),
            qW: nextQuat.w.toFixed(4),
          });
        }

        setAttitudeQuat(nextQuat);
        return { pitch: newPitch, yaw: newYaw, roll: newRoll };
      });
    }, 150);

    return () => clearInterval(interval);
  }, [torque, isPausedByLock, isSensorActive, isLogging, hardwareImuActive]);

  const calibratePhoneZero = React.useCallback(() => {
    phoneZeroRef.current = null;
    setAttitude({ pitch: 0, yaw: 0, roll: 0 });
    setAttitudeQuat(new THREE.Quaternion());
  }, []);

  useEffect(() => {
    const handleOrientation = (event) => {
      const raw = {
        pitch: normalizeDeg180(event.beta || 0),
        yaw: normalizeDeg180(event.alpha || 0),
        roll: normalizeDeg180(event.gamma || 0),
      };

      if (!phoneZeroRef.current) {
        phoneZeroRef.current = raw;
        setAttitude({ pitch: 0, yaw: 0, roll: 0 });
        setAttitudeQuat(new THREE.Quaternion());
        return;
      }

      const zero = phoneZeroRef.current;
      const nextAttitude = {
        pitch: round1(normalizeDeg180(raw.pitch - zero.pitch)),
        yaw: round1(normalizeDeg180(raw.yaw - zero.yaw)),
        roll: round1(normalizeDeg180(raw.roll - zero.roll)),
      };

      const nextQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(nextAttitude.pitch),
          THREE.MathUtils.degToRad(nextAttitude.yaw),
          THREE.MathUtils.degToRad(-nextAttitude.roll),
          'YXZ'
        )
      );

      setAttitude(nextAttitude);
      setAttitudeQuat(nextQuat);
    };

    if (isSensorActive && !isPausedByLock && !hardwareImuActive) {
      window.addEventListener('deviceorientation', handleOrientation);
    } else {
      window.removeEventListener('deviceorientation', handleOrientation);
    }

    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [isSensorActive, isPausedByLock, hardwareImuActive]);

  const toggleSensor = async () => {
    if (!isAdmin) return;
    if (isSensorActive) {
      setIsSensorActive(false);
      phoneZeroRef.current = null;
      setAttitude({ pitch: 0, yaw: 0, roll: 0 });
      setAttitudeQuat(new THREE.Quaternion());
      return;
    }

    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      alert('이 브라우저는 휴대폰 자세 센서를 지원하지 않습니다.');
      return;
    }

    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        const permissionState = await DeviceOrientationEvent.requestPermission();
        if (permissionState !== 'granted') {
          alert('기기의 기울기 센서 접근 권한이 필요합니다.');
          return;
        }
      } catch (error) {
        console.error('센서 권한 요청 에러:', error);
        return;
      }
    }

    setUseSerialImu(false);
    setUseBleImu(false);
    serverSerial.setUseAsSource?.(false);
    setSensorMode('quaternion');
    phoneZeroRef.current = null;
    setAttitude({ pitch: 0, yaw: 0, roll: 0 });
    setAttitudeQuat(new THREE.Quaternion());
    setIsSensorActive(true);
  };

  const handleAttitudeChange = (axis, value) => {
    if (!isPausedByLock && !isSensorActive && !hardwareImuActive) {
      setAttitude((prev) => ({ ...prev, [axis]: parseFloat(value) }));
    }
  };

  const handleTorqueChange = (axis, value) => {
    if (!isPausedByLock) {
      setTorque((prev) => ({ ...prev, [axis]: parseFloat(value) }));
    }
  };

  const sendCommandToHardware = (commandType, payload) => {
    console.log(`[통신] Command Sent: ${commandType}`, payload);
  };

  const resetAll = () => {
    recordCommandEvent({ eventType: 'RESET_VIEW', label: 'Reset All' });
    setUseSerialImu(false);
    setUseBleImu(false);
    setIsSensorActive(false);
    phoneZeroRef.current = null;
    setSensorMode('quaternion');
    setAttitude({ pitch: 0, yaw: 0, roll: 0 });
    setAttitudeQuat(new THREE.Quaternion());
    setTorque({ x: 0, y: 0, z: 0 });

    setIsLogging(false);
    setLoggingStartTime(null);
    setElapsedMs(0);
    fullDataLog.current = [];
    setViewResetKey((prev) => prev + 1);


    if (serial.isConnected) {
      serial.clearStats();
    }

    if (ble.isConnected) {
      ble.clearStats();
    }

    sendCommandToHardware('RESET_ATTITUDE', { flag: true });
  };

  const handleStartLogging = () => {
    fullDataLog.current = [];
    setElapsedMs(0);
    setLoggingStartTime(Date.now());
    setIsLogging(true);

    sendCommandToHardware('START_LOGGING', { timestamp: new Date() });
  };

  const handleStopLogging = () => {
    if (loggingStartTime != null) {
      setElapsedMs(Date.now() - loggingStartTime);
    }

    setIsLogging(false);
    setLoggingStartTime(null);

    if (fullDataLog.current.length === 0) {
      alert('저장된 데이터가 없습니다.');
      return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,Time,Roll,Yaw,Pitch,Q_x,Q_y,Q_z,Q_w\n';

    fullDataLog.current.forEach((row) => {
      csvContent += `${row.time},${row.roll},${row.yaw},${row.pitch},${row.qX},${row.qY},${row.qZ},${row.qW}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Cubli_ADCS_Log_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    sendCommandToHardware('STOP_LOGGING_AND_DOWNLOAD', {
      totalRows: fullDataLog.current.length,
    });
  };


  const handlePanelResizeStart = (event) => {
    if (isMobile) return;
    event.preventDefault();
    panelDragActiveRef.current = true;
    setIsPanelDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handlePanelWidthReset = () => {
    setControlPanelWidth(Math.round(Math.min(680, Math.max(440, viewportWidth * 0.36))));
  };

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!panelDragActiveRef.current || isMobile) return;
      const nextWidth = viewportWidth - event.clientX - 8;
      setControlPanelWidth(
        Math.min(Math.max(nextWidth, controlPanelMinWidth), controlPanelMaxWidth)
      );
    };

    const handlePointerUp = () => {
      if (!panelDragActiveRef.current) return;
      panelDragActiveRef.current = false;
      setIsPanelDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [controlPanelMaxWidth, controlPanelMinWidth, isMobile, viewportWidth]);

  return (
    <Container
      fluid
      className="cubli-root"
      style={{
        minHeight: '100dvh',
        backgroundColor: '#000',
        color: '#eee',
        padding: isMobile ? '0.45rem' : '0.35rem',
        overflowX: 'hidden',
        overflowY: isMobile ? 'auto' : 'hidden',
      }}
    >
      <div
        className={isMobile ? 'cubli-layout-mobile' : 'cubli-layout-desktop'}
        style={
          isMobile
            ? undefined
            : {
                gridTemplateColumns: `minmax(0, 1fr) 10px ${safeControlPanelWidth}px`,
              }
        }
      >
        <section
          className="cubli-canvas-pane"
          style={{
            height: canvasHeight,
            minHeight: canvasHeight,
          }}
        >
          <CubliCanvas
            attitude={attitude}
            attitudeQuat={attitudeQuat}
            torque={torque}
            isPausedByLock={isPausedByLock}
            sensorMode={sensorMode}
            isSensorActive={isSensorActive || hardwareImuActive}
            cameraRef={cameraRef}
            controlsRef={controlsRef}
            viewResetKey={viewResetKey}
            isMobile={isMobile}
            livePacketRef={activeLivePacketRef}
            activeSourceType={activeSourceType}
            axisLength={axisLength}
          />
        </section>

        {!isMobile && (
          <button
            type="button"
            className={isPanelDragging ? 'cubli-panel-resizer active' : 'cubli-panel-resizer'}
            onPointerDown={handlePanelResizeStart}
            aria-label="설정 패널 폭 조절"
            title="드래그해서 오른쪽 설정창 폭을 조절"
          >
            <span />
          </button>
        )}

        <aside
          className="cubli-control-pane"
          style={{
            height: isMobile ? 'auto' : canvasHeight,
            minHeight: isMobile ? 'auto' : canvasHeight,
          }}
        >
          <Card className="bg-dark text-light border-0 shadow-sm cubli-control-card">
            <Card.Body
              className="d-flex flex-column cubli-control-body"
              style={{
                padding: isMobile ? '1rem' : '1.1rem',
                overflowY: isMobile ? 'visible' : 'auto',
              }}
            >
              <div className="quick-control-bar rounded p-3 mb-3">
                <div className="d-flex align-items-center justify-content-between gap-2 quick-control-row">
                  <div className="quick-control-title-block">
                    <div className="quick-control-title">Quick Control</div>
                    <div className="quick-control-subtitle">Active Source: {activeSourceLabel}</div>
                  </div>
                  <Button
                    variant="outline-danger"
                    onClick={resetAll}
                    className="fw-bold shadow-sm quick-reset-button"
                  >
                    🛰 Reset
                  </Button>
                </div>

                {multipleSourcesActive ? (
                  <Alert variant="warning" className="py-2 mt-3 mb-0">
                    Multiple sources are active. Server Serial has priority.
                  </Alert>
                ) : null}

                <div className="axis-length-control mt-3">
                  <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
                    <div>
                      <div className="axis-length-title">Body Axis Length</div>
                      <div className="axis-length-subtitle">Cubli 내부 X/Y/Z 화살표 길이</div>
                    </div>
                    <div className="axis-length-value">{Math.round(axisLength)}</div>
                  </div>
                  <Form.Range
                    min="10"
                    max="90"
                    step="2"
                    value={axisLength}
                    onChange={(e) => setAxisLength(Number(e.target.value))}
                    className="custom-range"
                  />
                  <div className="d-flex justify-content-end">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="axis-length-reset"
                      onClick={() => setAxisLength(34)}
                    >
                      기본값
                    </Button>
                  </div>
                </div>
              </div>

              {!isMobile && (
                <div className="panel-width-control rounded p-3 mb-3">
                  <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
                    <div>
                      <div className="panel-width-title">설정창 폭 조절</div>
                      <div className="panel-width-subtitle">
                        오른쪽을 키우면 왼쪽 Cubli 화면은 자동으로 줄어듭니다.
                      </div>
                    </div>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="fw-bold panel-width-reset"
                      onClick={handlePanelWidthReset}
                    >
                      기본
                    </Button>
                  </div>
                  <Form.Range
                    min={controlPanelMinWidth}
                    max={controlPanelMaxWidth}
                    step="10"
                    value={safeControlPanelWidth}
                    onChange={(e) => setControlPanelWidth(Number(e.target.value))}
                    className="custom-range"
                  />
                  <div className="panel-width-value">현재 폭: {Math.round(safeControlPanelWidth)} px</div>
                </div>
              )}

              {deferredPrompt && (
                <div className="d-grid mb-3">
                  <Button
                    variant="outline-success"
                    size="sm"
                    onClick={handleInstallClick}
                    className="fw-bold shadow-sm rounded-pill p-2"
                  >
                    📲 앱으로 설치
                  </Button>
                </div>
              )}

              {isAdmin ? (
                <WebSerialBridgePanel
                  enabled={webSerialBridgeEnabled}
                  onEnabledChange={setWebSerialBridgeEnabled}
                  serialConnected={serial.isConnected}
                  lastPublishAt={serverSync.lastPublishAt || bridgeLastPublishAt}
                  publishRateHz={Math.round(1000 / WEB_SERIAL_BRIDGE_PUBLISH_INTERVAL_MS)}
                  lastError={serverSync.lastPublishError || bridgeLastPublishError}
                  publishCount={serverSync.publishCount}
                  publishFailedCount={serverSync.publishFailedCount}
                  lastPublishHttpStatus={serverSync.lastPublishHttpStatus}
                  publishEndpointUrl={serverSync.publishEndpointUrl}
                  publishBackoffUntil={serverSync.publishBackoffUntil}
                  latestSharedPacketAgeMs={serverSync.latestSharedPacketAgeMs}
                  lastCommandStatus={bridgeLastCommandStatus}
                  sharedSourceLabel="Admin Web Serial Bridge"
                />
              ) : null}

              <Tabs
                defaultActiveKey="serial"
                id="control-tabs"
                activeKey={activeTab}
                onSelect={(k) => setActiveTab(k)}
                className="mb-3 text-uppercase fw-bold p-0 tabs-container"
              >
                {isAdmin ? (
                  <Tab eventKey="serial" title="Web Serial" className="pt-2">
                    <SerialPanel
                      serial={serial}
                      useSerialImu={useSerialImu}
                      setUseSerialImu={handleUseSerialImuChange}
                      activeSourceLabel={activeSourceLabel}
                      onTare={handleTareCommand}
                      onStop={handleStopCommand}
                      onCommandEvent={recordCommandEvent}
                      isAdmin={isAdmin}
                    />
                  </Tab>
                ) : null}

                {isAdmin ? (
                  <Tab eventKey="ble" title="BLE" className="pt-2">
                    <BlePanel
                      ble={ble}
                      useBleImu={useBleImu}
                      setUseBleImu={handleUseBleImuChange}
                      activeSourceLabel={activeSourceLabel}
                      onTare={handleTareCommand}
                      onStop={handleStopCommand}
                      onCommandEvent={recordCommandEvent}
                      isAdmin={isAdmin}
                    />
                  </Tab>
                ) : null}

                {isAdmin ? (
                  <Tab eventKey="phone" title="Phone" className="pt-2">
                    <PhoneSensorPanel
                      isPhoneSensorActive={isSensorActive}
                      togglePhoneSensor={toggleSensor}
                      calibratePhoneZero={calibratePhoneZero}
                      attitude={attitude}
                      isHardwareActive={hardwareImuActive}
                      isPausedByLock={isPausedByLock}
                      isAdmin={isAdmin}
                    />
                  </Tab>
                ) : null}

                <Tab eventKey="server" title="Server" className="pt-2">
                  <ServerPanel
                    serverSync={serverSync}
                    webSerialConnected={serial.isConnected}
                    webSerialLatestPacketUpdatedAt={serial.latestPacket?.updatedAt}
                    onChangeDisplayName={handleOpenNameModal}
                  />
                </Tab>
              </Tabs>

              <div className="flex-grow-1" />
            </Card.Body>
          </Card>
        </aside>
      </div>

      <NameEntryModal
        show={showNameModal || !serverSync.hasDisplayName}
        required={!serverSync.hasDisplayName}
        initialName={serverSync.displayName}
        suggestedName={suggestedDisplayName}
        onSave={handleSaveDisplayName}
        onCancel={handleCloseNameModal}
      />

      <Modal show={showLockModal} onHide={handleModalClose} centered backdrop="static" keyboard={false}>
        <Modal.Body className="text-center py-5">
          <h1 className="text-danger fw-bold mb-0" style={{ fontSize: '3.5rem' }}>
            짐벌락 발생!
          </h1>
          <p className="text-muted mt-3">자세 제어 시스템이 일시 정지되었습니다.</p>
        </Modal.Body>
        <Modal.Footer className="justify-content-center border-0 pb-4">
          <Button
            variant="danger"
            size="lg"
            onClick={handleModalClose}
            className="px-5 fw-bold rounded-pill shadow-sm fs-6"
          >
            확인 (작동 재개)
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showInstallPopup} onHide={() => setShowInstallPopup(false)} centered backdrop="static" size="md">
        <Modal.Header closeButton className="bg-success text-white border-0">
          <Modal.Title className="fw-bold w-100 text-center">📲 Cubli ADCS 앱 다운로드</Modal.Title>
        </Modal.Header>
        <Modal.Body className="text-center py-4 bg-dark text-light">
          <p className="mb-0 fs-5">
            웹 브라우저 대신 <strong>네이티브 앱</strong>으로 설치하시면
            <br />
            센서 동기화와 시뮬레이터가 훨씬 부드럽게 작동합니다.
          </p>
        </Modal.Body>
        <Modal.Footer className="justify-content-center bg-dark border-secondary">
          <Button variant="outline-light" onClick={() => setShowInstallPopup(false)} className="px-4 fs-7 nav-tabs">
            나중에 웹으로 보기
          </Button>
          <Button variant="success" onClick={handleInstallClick} className="px-4 fw-bold shadow fs-7">
            지금 앱 설치하기
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}

useGLTF.preload('/models/body.glb');
useGLTF.preload('/models/wheel.glb');
