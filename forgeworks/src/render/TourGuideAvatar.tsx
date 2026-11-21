import React, { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { tourVoiceStateRef } from '../audio/tourNarrator';
import { TOUR_STEPS } from '../data/tourSteps';
import { useFactoryStore } from '../state/useFactoryStore';

// Shared realistic PPE & clothing PBR materials for Elena Vance (Lead Plant Engineer)
const MAT_HARDHAT = new THREE.MeshStandardMaterial({
  color: '#eab308',
  metalness: 0.12,
  roughness: 0.34,
});
const MAT_HIVIS_VEST = new THREE.MeshStandardMaterial({
  color: '#c4e01c',
  metalness: 0.05,
  roughness: 0.62,
});
const MAT_REFLECTIVE_STRIPE = new THREE.MeshStandardMaterial({
  color: '#d8e2ec',
  metalness: 0.65,
  roughness: 0.25,
});
const MAT_WORK_SHIRT = new THREE.MeshStandardMaterial({
  color: '#2c3748',
  metalness: 0.05,
  roughness: 0.85,
});
const MAT_DENIM = new THREE.MeshStandardMaterial({
  color: '#23344d',
  metalness: 0.04,
  roughness: 0.88,
});
const MAT_BOOTS = new THREE.MeshStandardMaterial({
  color: '#3a2a1e',
  metalness: 0.1,
  roughness: 0.72,
});
const MAT_SKIN = new THREE.MeshStandardMaterial({
  color: '#dca884',
  metalness: 0.02,
  roughness: 0.62,
});
const MAT_HAIR = new THREE.MeshStandardMaterial({
  color: '#2a211c',
  metalness: 0.08,
  roughness: 0.76,
});
const MAT_GLASSES = new THREE.MeshStandardMaterial({
  color: '#1e293b',
  metalness: 0.55,
  roughness: 0.18,
});
const MAT_CLIPBOARD = new THREE.MeshStandardMaterial({
  color: '#7c8794',
  metalness: 0.6,
  roughness: 0.35,
});
const MAT_PAPER = new THREE.MeshStandardMaterial({
  color: '#f1f5f9',
  metalness: 0.0,
  roughness: 0.9,
});
const MAT_MOUTH = new THREE.MeshBasicMaterial({ color: '#4c1d24' });
const MAT_HEADSET = new THREE.MeshStandardMaterial({
  color: '#181e27',
  metalness: 0.4,
  roughness: 0.4,
});

/**
 * Animated 3D Plant Engineer ("Elena Vance") who walks across the concrete factory floor
 * between Guided Tour stations, faces the user/machinery, holds an aluminum clipboard,
 * gestures with her right arm, and moves her head/mouth while giving the live voice tour.
 */
export const TourGuideAvatar: React.FC = () => {
  const uiMode = useFactoryStore((s) => s.uiMode);
  const activeTourStepId = useFactoryStore((s) => s.activeTourStepId);

  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const rightForearmRef = useRef<THREE.Group>(null);
  const speakRingRef = useRef<THREE.Mesh>(null);

  const posRef = useRef(new THREE.Vector3(30.2, 0, 39.2));
  const yawRef = useRef(0);

  useFrame(({ clock, camera }, rawDelta) => {
    const root = rootRef.current;
    if (!root) return;
    const delta = Math.min(rawDelta, 0.1);
    const t = clock.getElapsedTime();

    const step =
      TOUR_STEPS.find((s) => s.id === activeTourStepId) ?? TOUR_STEPS[0];
    const targetX = step.guidePos[0];
    const targetZ = step.guidePos[1];

    const dx = targetX - posRef.current.x;
    const dz = targetZ - posRef.current.z;
    const dist = Math.hypot(dx, dz);
    const isWalking = dist > 0.12;

    if (isWalking) {
      // Walk briskly across long bay spans so she arrives right as the camera glides in,
      // then slow to a natural human stride for the last 2.5 meters
      const walkSpeed = dist > 3.5 ? Math.max(9.5, dist * 2.2) : 4.2;
      const move = Math.min(dist, walkSpeed * delta);
      posRef.current.x += (dx / dist) * move;
      posRef.current.z += (dz / dist) * move;
    } else {
      posRef.current.x = targetX;
      posRef.current.z = targetZ;
    }

    root.position.set(posRef.current.x, 0, posRef.current.z);

    // Smooth yaw: face travel path while walking, otherwise face partway between camera & machinery
    let desiredYaw = yawRef.current;
    if (isWalking) {
      desiredYaw = Math.atan2(dx, dz);
    } else {
      const toCamX = camera.position.x - posRef.current.x;
      const toCamZ = camera.position.z - posRef.current.z;
      const toMachX = step.guideLookAt[0] - posRef.current.x;
      const toMachZ = step.guideLookAt[1] - posRef.current.z;
      const camYaw = Math.atan2(toCamX, toCamZ);
      const machYaw = Math.atan2(toMachX, toMachZ);
      // Stand angled toward camera while gesturing easily toward the machinery
      const diff = Math.atan2(
        Math.sin(machYaw - camYaw),
        Math.cos(machYaw - camYaw)
      );
      desiredYaw = camYaw + diff * 0.28;
    }

    const yawDiff = Math.atan2(
      Math.sin(desiredYaw - yawRef.current),
      Math.cos(desiredYaw - yawRef.current)
    );
    yawRef.current += yawDiff * Math.min(1, delta * 7.5);
    root.rotation.y = yawRef.current;

    const speaking = tourVoiceStateRef.speaking;
    if (tourVoiceStateRef.energy > 0) {
      tourVoiceStateRef.energy = Math.max(
        0,
        tourVoiceStateRef.energy - delta * 4.5
      );
    }

    // Walking stride vs standing idle/presenting body kinematics
    if (bodyRef.current) {
      bodyRef.current.position.y = isWalking
        ? Math.abs(Math.sin(t * 9.5)) * 0.055
        : Math.sin(t * 2.1) * 0.012;
      bodyRef.current.rotation.z = isWalking
        ? Math.sin(t * 9.5) * 0.04
        : Math.sin(t * 1.4) * 0.015;
    }

    if (leftLegRef.current && rightLegRef.current) {
      const stride = isWalking ? Math.sin(t * 9.5) * 0.52 : 0;
      leftLegRef.current.rotation.x = THREE.MathUtils.lerp(
        leftLegRef.current.rotation.x,
        stride,
        Math.min(1, delta * 12)
      );
      rightLegRef.current.rotation.x = THREE.MathUtils.lerp(
        rightLegRef.current.rotation.x,
        -stride,
        Math.min(1, delta * 12)
      );
    }

    // Left arm holds aluminum inspection clipboard comfortably at chest height
    if (leftArmRef.current) {
      const targetRotX = isWalking ? -0.45 - Math.sin(t * 9.5) * 0.16 : -0.68;
      leftArmRef.current.rotation.x = THREE.MathUtils.lerp(
        leftArmRef.current.rotation.x,
        targetRotX,
        Math.min(1, delta * 10)
      );
      leftArmRef.current.rotation.z = 0.12;
    }

    // Right arm swings naturally while walking, and gestures expressively toward machinery while speaking
    if (rightArmRef.current && rightForearmRef.current) {
      if (isWalking) {
        rightArmRef.current.rotation.x = Math.sin(t * 9.5) * 0.45;
        rightArmRef.current.rotation.z = -0.1;
        rightForearmRef.current.rotation.x = -0.25;
      } else if (speaking) {
        rightArmRef.current.rotation.x = THREE.MathUtils.lerp(
          rightArmRef.current.rotation.x,
          -0.85 + Math.sin(t * 4.4) * 0.22,
          Math.min(1, delta * 9)
        );
        rightArmRef.current.rotation.z = THREE.MathUtils.lerp(
          rightArmRef.current.rotation.z,
          -0.38 + Math.cos(t * 3.1) * 0.18,
          Math.min(1, delta * 9)
        );
        rightForearmRef.current.rotation.x = -0.45 + Math.sin(t * 6.2) * 0.2;
      } else {
        rightArmRef.current.rotation.x = THREE.MathUtils.lerp(
          rightArmRef.current.rotation.x,
          -0.18 + Math.sin(t * 1.6) * 0.05,
          Math.min(1, delta * 8)
        );
        rightArmRef.current.rotation.z = THREE.MathUtils.lerp(
          rightArmRef.current.rotation.z,
          -0.14,
          Math.min(1, delta * 8)
        );
        rightForearmRef.current.rotation.x = -0.22;
      }
    }

    // Expressive head nods & lip-sync mouth movement when speaking
    if (headRef.current) {
      headRef.current.rotation.x = speaking
        ? Math.sin(t * 5.2) * 0.08
        : Math.sin(t * 1.4) * 0.03;
      headRef.current.rotation.y = speaking
        ? Math.sin(t * 2.1) * 0.18
        : Math.sin(t * 0.9) * 0.08;
    }

    if (mouthRef.current) {
      const openScale = speaking
        ? 0.45 +
          Math.abs(Math.sin(t * 14.5)) * 0.9 +
          tourVoiceStateRef.energy * 0.45
        : 0.2;
      mouthRef.current.scale.set(1, openScale, 1);
    }

    // Subtle grounded speaker indicator ring on concrete around boots
    if (speakRingRef.current) {
      const s = speaking ? 1 + Math.sin(t * 5.5) * 0.07 : 0.92;
      speakRingRef.current.scale.set(s, s, 1);
    }
  });

  if (uiMode !== 'tour') return null;

  return (
    <group ref={rootRef} position={[30.2, 0, 39.2]}>
      {/* Grounded contact shadow beneath boots */}
      <mesh position={[0, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.38, 16]} />
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.34}
          depthWrite={false}
        />
      </mesh>

      {/* Subtle safety floor ring so user spots the live tour engineer easily */}
      <mesh
        ref={speakRingRef}
        position={[0, 0.032, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.42, 0.52, 24]} />
        <meshBasicMaterial
          color="#f59e0b"
          transparent
          opacity={0.78}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Articulated Humanoid Body (1.76m realistic height) */}
      <group ref={bodyRef}>
        {/* Left Leg + Steel-Toe Work Boot */}
        <group ref={leftLegRef} position={[-0.12, 0.82, 0]}>
          <mesh position={[0, -0.36, 0]} castShadow material={MAT_DENIM}>
            <cylinderGeometry args={[0.095, 0.08, 0.72, 10]} />
          </mesh>
          <mesh position={[0, -0.75, 0.03]} castShadow material={MAT_BOOTS}>
            <boxGeometry args={[0.14, 0.14, 0.25]} />
          </mesh>
        </group>

        {/* Right Leg + Steel-Toe Work Boot */}
        <group ref={rightLegRef} position={[0.12, 0.82, 0]}>
          <mesh position={[0, -0.36, 0]} castShadow material={MAT_DENIM}>
            <cylinderGeometry args={[0.095, 0.08, 0.72, 10]} />
          </mesh>
          <mesh position={[0, -0.75, 0.03]} castShadow material={MAT_BOOTS}>
            <boxGeometry args={[0.14, 0.14, 0.25]} />
          </mesh>
        </group>

        {/* Pelvis & Utility Tool Belt */}
        <mesh position={[0, 0.86, 0]} castShadow material={MAT_DENIM}>
          <boxGeometry args={[0.36, 0.16, 0.22]} />
        </mesh>
        <mesh position={[0, 0.93, 0]} material={MAT_BOOTS}>
          <boxGeometry args={[0.38, 0.055, 0.24]} />
        </mesh>

        {/* Torso + High-Visibility Reflective Plant Safety Vest */}
        <mesh position={[0, 1.18, 0]} castShadow material={MAT_WORK_SHIRT}>
          <boxGeometry args={[0.39, 0.48, 0.23]} />
        </mesh>
        <mesh position={[0, 1.17, 0]} castShadow material={MAT_HIVIS_VEST}>
          <boxGeometry args={[0.41, 0.44, 0.245]} />
        </mesh>
        {/* Horizontal & vertical OSHA silver reflective safety stripes */}
        <mesh position={[0, 1.07, 0]} material={MAT_REFLECTIVE_STRIPE}>
          <boxGeometry args={[0.42, 0.045, 0.252]} />
        </mesh>
        <mesh position={[-0.12, 1.24, 0]} material={MAT_REFLECTIVE_STRIPE}>
          <boxGeometry args={[0.042, 0.28, 0.252]} />
        </mesh>
        <mesh position={[0.12, 1.24, 0]} material={MAT_REFLECTIVE_STRIPE}>
          <boxGeometry args={[0.042, 0.28, 0.252]} />
        </mesh>

        {/* Left Arm holding Aluminum Inspection Clipboard */}
        <group ref={leftArmRef} position={[-0.26, 1.36, 0]}>
          <mesh position={[0, -0.17, 0]} castShadow material={MAT_WORK_SHIRT}>
            <cylinderGeometry args={[0.068, 0.058, 0.34, 8]} />
          </mesh>
          <mesh
            position={[0, -0.37, 0.09]}
            rotation={[0.6, 0, 0]}
            castShadow
            material={MAT_SKIN}
          >
            <cylinderGeometry args={[0.052, 0.046, 0.26, 8]} />
          </mesh>
          {/* Aluminum Clipboard + Checklist Sheet */}
          <group position={[0.06, -0.44, 0.22]} rotation={[0.45, 0.25, -0.12]}>
            <mesh castShadow material={MAT_CLIPBOARD}>
              <boxGeometry args={[0.24, 0.02, 0.32]} />
            </mesh>
            <mesh position={[0, 0.014, 0]} material={MAT_PAPER}>
              <boxGeometry args={[0.2, 0.008, 0.26]} />
            </mesh>
          </group>
        </group>

        {/* Right Arm (gestures toward machinery while speaking) */}
        <group ref={rightArmRef} position={[0.26, 1.36, 0]}>
          <mesh position={[0, -0.16, 0]} castShadow material={MAT_WORK_SHIRT}>
            <cylinderGeometry args={[0.068, 0.058, 0.32, 8]} />
          </mesh>
          <group ref={rightForearmRef} position={[0, -0.31, 0]}>
            <mesh position={[0, -0.14, 0]} castShadow material={MAT_SKIN}>
              <cylinderGeometry args={[0.054, 0.045, 0.28, 8]} />
            </mesh>
            <mesh position={[0, -0.3, 0.02]} material={MAT_SKIN}>
              <sphereGeometry args={[0.052, 8, 8]} />
            </mesh>
          </group>
        </group>

        {/* Neck + Expressive Head + Comms Headset + Yellow OSHA Safety Hard Hat */}
        <group ref={headRef} position={[0, 1.46, 0]}>
          <mesh position={[0, 0.04, 0]} material={MAT_SKIN}>
            <cylinderGeometry args={[0.065, 0.072, 0.1, 8]} />
          </mesh>
          {/* Head */}
          <mesh position={[0, 0.18, 0]} castShadow material={MAT_SKIN}>
            <sphereGeometry args={[0.145, 14, 12]} />
          </mesh>
          {/* Dark Hair + Low Bun */}
          <mesh position={[0, 0.19, -0.05]} material={MAT_HAIR}>
            <sphereGeometry args={[0.14, 12, 10]} />
          </mesh>
          <mesh position={[0, 0.16, -0.17]} material={MAT_HAIR}>
            <sphereGeometry args={[0.075, 10, 10]} />
          </mesh>
          {/* Safety Glasses */}
          <mesh position={[0, 0.195, 0.13]} material={MAT_GLASSES}>
            <boxGeometry args={[0.21, 0.052, 0.04]} />
          </mesh>
          {/* Animated Speaking Mouth */}
          <mesh
            ref={mouthRef}
            position={[0, 0.115, 0.138]}
            material={MAT_MOUTH}
          >
            <boxGeometry args={[0.062, 0.022, 0.015]} />
          </mesh>
          {/* Plant Comms Headset Boom Mic */}
          <mesh position={[-0.145, 0.18, 0.01]} material={MAT_HEADSET}>
            <cylinderGeometry args={[0.036, 0.036, 0.03, 10]} />
          </mesh>
          <mesh
            position={[-0.08, 0.125, 0.12]}
            rotation={[0, 0.4, 0.25]}
            material={MAT_HEADSET}
          >
            <boxGeometry args={[0.14, 0.014, 0.014]} />
          </mesh>
          {/* Yellow OSHA Safety Hard Hat Dome + Ridge + Front Brim */}
          <mesh position={[0, 0.24, 0]} castShadow material={MAT_HARDHAT}>
            <sphereGeometry
              args={[0.165, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56]}
            />
          </mesh>
          <mesh position={[0, 0.36, 0]} material={MAT_HARDHAT}>
            <boxGeometry args={[0.055, 0.045, 0.26]} />
          </mesh>
          <mesh
            position={[0, 0.245, 0.06]}
            rotation={[0.08, 0, 0]}
            castShadow
            material={MAT_HARDHAT}
          >
            <cylinderGeometry args={[0.17, 0.185, 0.022, 14]} />
          </mesh>
        </group>
      </group>
    </group>
  );
};
