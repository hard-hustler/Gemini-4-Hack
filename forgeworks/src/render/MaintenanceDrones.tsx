import React, { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { liveDronesRef, useFactoryStore } from '../state/useFactoryStore';

const DroneMesh: React.FC<{ droneIndex: number; droneId: number }> = React.memo(
  ({ droneIndex, droneId }) => {
    const groupRef = useRef<THREE.Group>(null);
    const beamRef = useRef<THREE.Mesh>(null);
    const rotor1 = useRef<THREE.Mesh>(null);
    const rotor2 = useRef<THREE.Mesh>(null);
    const rotor3 = useRef<THREE.Mesh>(null);
    const rotor4 = useRef<THREE.Mesh>(null);
    const initialized = useRef(false);

    useFrame(({ clock }, rawDelta) => {
      const delta = Math.min(rawDelta, 0.1);
      const t = clock.getElapsedTime();
      const drone = liveDronesRef.list[droneIndex];
      if (!drone) return;

      if (groupRef.current) {
        if (!initialized.current) {
          groupRef.current.position.set(drone.x + 0.5, 2.08, drone.z + 0.5);
          initialized.current = true;
        } else {
          const alpha = 1 - Math.exp(-10 * delta);
          groupRef.current.position.x = THREE.MathUtils.lerp(
            groupRef.current.position.x,
            drone.x + 0.5,
            alpha
          );
          groupRef.current.position.z = THREE.MathUtils.lerp(
            groupRef.current.position.z,
            drone.z + 0.5,
            alpha
          );
          groupRef.current.position.y =
            2.08 + Math.sin(t * 4 + droneId) * 0.1;
        }
      }
      if (beamRef.current) {
        beamRef.current.visible = drone.repairing;
      }
      if (rotor1.current) rotor1.current.rotation.y += delta * 24;
      if (rotor2.current) rotor2.current.rotation.y -= delta * 24;
      if (rotor3.current) rotor3.current.rotation.y -= delta * 24;
      if (rotor4.current) rotor4.current.rotation.y += delta * 24;
    });

    return (
      <group ref={groupRef} position={[31.5, 2.08, 31.5]}>
        <mesh castShadow>
          <boxGeometry args={[0.42, 0.14, 0.42]} />
          <meshStandardMaterial
            color="#f59e0b"
            metalness={0.45}
            roughness={0.32}
          />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <boxGeometry args={[0.24, 0.08, 0.24]} />
          <meshStandardMaterial
            color="#1e293b"
            metalness={0.7}
            roughness={0.25}
          />
        </mesh>
        {[
          [-0.28, 0.08, -0.28, rotor1],
          [0.28, 0.08, -0.28, rotor2],
          [-0.28, 0.08, 0.28, rotor3],
          [0.28, 0.08, 0.28, rotor4],
        ].map(([rx, ry, rz, ref], idx) => (
          <mesh
            key={idx}
            ref={ref as React.RefObject<THREE.Mesh>}
            position={[rx as number, ry as number, rz as number]}
          >
            <boxGeometry args={[0.28, 0.02, 0.05]} />
            <meshBasicMaterial color="#e2e8f0" />
          </mesh>
        ))}
        <mesh ref={beamRef} position={[0, -0.88, 0]} visible={false}>
          <cylinderGeometry args={[0.03, 0.12, 1.55, 8]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.78} />
        </mesh>
      </group>
    );
  }
);

export const MaintenanceDrones: React.FC = () => {
  const droneCount = useFactoryStore((s) => s.drones.length);
  const indices = Array.from({ length: droneCount }, (_, i) => i);

  return (
    <group>
      {indices.map((i) => (
        <DroneMesh key={i} droneIndex={i} droneId={i + 1} />
      ))}
    </group>
  );
};
