import React, { useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, useGLTF, PerspectiveCamera } from '@react-three/drei';
import { Button, ButtonGroup } from 'react-bootstrap';
import * as THREE from 'three';

// 카메라 시선을 (0,0,0)에 절대 고정시키는 컴포넌트
function CameraLocker({ cameraRef }) {
  useFrame(() => {
    if (cameraRef.current) {
      cameraRef.current.lookAt(0, 0, 0);
    }
  });
  return null;
}

function CubliModel({ attitude, attitudeQuat, torque, isPausedByLock, sensorMode, isSensorActive }) {
  const bodyGLTF = useGLTF('/models/body.glb');
  const wheelXGLTF = useGLTF('/models/wheel.glb');
  const wheelYGLTF = useGLTF('/models/wheel.glb');
  const wheelZGLTF = useGLTF('/models/wheel.glb');
  
  const groupRef = useRef();
  const wheelXRef = useRef();
  const wheelYRef = useRef();
  const wheelZRef = useRef();

  useFrame((state, delta) => {
    if (wheelXRef.current && !isPausedByLock) wheelXRef.current.rotation.x += torque.x * delta * 0.1; 
    if (wheelYRef.current && !isPausedByLock) wheelYRef.current.rotation.y += torque.y * delta * 0.1;
    if (wheelZRef.current && !isPausedByLock) wheelZRef.current.rotation.z += torque.z * delta * 0.1;

    if (groupRef.current) {
      if (isSensorActive && sensorMode === 'quaternion') {
        groupRef.current.quaternion.copy(attitudeQuat);
      } 
      else {
        groupRef.current.quaternion.identity();
        groupRef.current.rotation.x = THREE.MathUtils.degToRad(attitude.pitch);
        groupRef.current.rotation.y = THREE.MathUtils.degToRad(attitude.yaw);
        groupRef.current.rotation.z = THREE.MathUtils.degToRad(attitude.roll);
      }
    }
  });

  return (
    <group ref={groupRef}>
      <axesHelper args={[4]} />
      <group rotation={[Math.PI, 0, 0]}>
        <primitive object={bodyGLTF.scene} />
        <group ref={wheelXRef} position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]}><primitive object={wheelXGLTF.scene} /></group>
        <group ref={wheelYRef} position={[0, 0, 0]}><primitive object={wheelYGLTF.scene} /></group>
        <group ref={wheelZRef} position={[0, 0, 0]} rotation={[Math.PI, 0, 0]}><primitive object={wheelZGLTF.scene} /></group>
      </group>
    </group>
  );
}

export default function CubliCanvas({ attitude, attitudeQuat, torque, isPausedByLock, sensorMode, isSensorActive, cameraRef }) {
  
  // 정확히 지정된 수치(±50)만큼 카메라를 이동시키는 로직
  const handleZoom = (step) => {
    if (cameraRef.current) {
      const currentPos = cameraRef.current.position;
      // 현재 카메라가 바라보는 중심을 향한 방향 벡터 계산
      const direction = currentPos.clone().normalize();
      
      // 해당 방향으로 step만큼 더해서 새로운 위치 지정 (step이 음수면 확대, 양수면 축소)
      const newPos = currentPos.clone().add(direction.multiplyScalar(step));
      const distance = newPos.length();
      
      // 🌟 [수정됨] 모델을 크게 보이게 하기 위해 최소 거리를 50으로 줄임 🌟
      // 너무 가깝거나(50) 너무 멀어지지(1000) 않도록 제한
      if (distance >= 50 && distance <= 1000) {
        cameraRef.current.position.copy(newPos);
        cameraRef.current.updateProjectionMatrix();
      }
    }
  };

  // 🌟 [신규] 특정 고정 시점으로 카메라를 즉시 이동시키는 함수 🌟
  const setViewport = (viewType) => {
    if (!cameraRef.current) return;
    
    // 모델을 크게 보이게 하기 위해 적당히 가까운 거리(약 120~170)로 고정
    switch (viewType) {
      case 'iso': // 입체각 (초기값)
        cameraRef.current.position.set(100, 100, 100); // 🌟 크게 보이게 수정 🌟
        break;
      case 'front': // 정면 (Z축 방향)
        cameraRef.current.position.set(0, 0, 170); // 🌟 크게 보이게 수정 🌟
        break;
      case 'top': // 윗면 (Y축 방향)
        // Y축 바로 위에서 보면 OrbitControls가 꼬이므로 Z축에 아주 미세한 값을 줌
        cameraRef.current.position.set(0, 170, 0.1); // 🌟 크게 보이게 수정 🌟
        break;
      case 'side': // 측면 (X축 방향)
        cameraRef.current.position.set(170, 0, 0); // 🌟 크게 보이게 수정 🌟
        break;
      default:
        cameraRef.current.position.set(100, 100, 100);
    }
    
    // 위치 이동 후 (0,0,0)을 바라보도록 강제 업데이트
    cameraRef.current.lookAt(0, 0, 0);
    cameraRef.current.updateProjectionMatrix();
  };

  return (
    <div className="w-100 h-100 rounded shadow-sm position-relative" style={{ backgroundColor: '#000', overflow: 'hidden', minHeight: '400px' }}>
      <h5 className="position-absolute text-white m-3" style={{ zIndex: 10 }}>ADCS Cubli Simulator</h5>
      
      {/* 🌟 카메라 컨트롤 버튼 모음 (우측 상단 배치) 🌟 */}
      <div className="position-absolute d-flex flex-column gap-2" style={{ top: '20px', right: '20px', zIndex: 1050 }}>
        
        {/* 줌 버튼 그룹 */}
        <ButtonGroup>
          <Button variant="secondary" size="sm" className="fw-bold opacity-75" onClick={() => handleZoom(-50)}>
            ➕ 확대
          </Button>
          <Button variant="secondary" size="sm" className="fw-bold opacity-75" onClick={() => handleZoom(50)}>
            ➖ 축소
          </Button>
        </ButtonGroup>
        
        {/* 🌟 [신규] 시점 분리 버튼 그룹 🌟 */}
        <ButtonGroup vertical>
          <Button variant="outline-light" size="sm" className="fw-bold bg-dark p-1" style={{ fontSize: '0.75rem' }} onClick={() => setViewport('iso')}>
            입체 (Iso)
          </Button>
          <Button variant="outline-light" size="sm" className="fw-bold bg-dark p-1" style={{ fontSize: '0.75rem' }} onClick={() => setViewport('front')}>
            정면 (Front)
          </Button>
          <Button variant="outline-light" size="sm" className="fw-bold bg-dark p-1" style={{ fontSize: '0.75rem' }} onClick={() => setViewport('top')}>
            윗면 (Top)
          </Button>
          <Button variant="outline-light" size="sm" className="fw-bold bg-dark p-1" style={{ fontSize: '0.75rem' }} onClick={() => setViewport('side')}>
            측면 (Side)
          </Button>
        </ButtonGroup>
      </div>

      <Canvas>
        {/* 🌟 [수정됨] 초기 위치를 [100, 100, 100]으로 당겨서 모델이 크게 보이게 시작 🌟 */}
        <PerspectiveCamera 
          ref={cameraRef} 
          makeDefault 
          position={[100, 100, 100]} 
          fov={45} 
        />
        
        <CameraLocker cameraRef={cameraRef} />

        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 10]} intensity={1} />
        <Environment preset="city" />
        <axesHelper args={[10]} material-opacity={0.3} material-transparent={true} />

        <Suspense fallback={null}>
          <CubliModel 
            attitude={attitude} attitudeQuat={attitudeQuat} torque={torque} 
            isPausedByLock={isPausedByLock} sensorMode={sensorMode} isSensorActive={isSensorActive}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}