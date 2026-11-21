import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  ITEM_ORDER,
  ITEMS,
  ITEM_STRIDE,
  MAX_INSTANCED_ITEMS,
} from '../data/catalog';
import { liveItemBufferRef } from '../state/useFactoryStore';

// Module-scope pre-allocated helper to keep GC at zero in the 60 FPS render loop
const _dummy = new THREE.Object3D();

export const InstancedItems: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const itemColors = useMemo(
    () => ITEM_ORDER.map((t) => new THREE.Color(ITEMS[t].color)),
    []
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const buf = liveItemBufferRef.buffer;
    const count = Math.min(MAX_INSTANCED_ITEMS, liveItemBufferRef.count);
    mesh.count = count;

    for (let i = 0; i < count; i++) {
      const o = i * ITEM_STRIDE;
      const wx = buf[o];
      const wy = buf[o + 1];
      const wz = buf[o + 2];
      const itemIdx = buf[o + 3] | 0;
      const rot = buf[o + 4];

      _dummy.position.set(wx, wy, wz);
      _dummy.rotation.set(0, rot, 0);

      if (itemIdx === 3) {
        _dummy.scale.set(1.18, 0.42, 1.18); // Iron Plate
      } else if (itemIdx === 4) {
        _dummy.scale.set(0.75, 0.95, 0.75); // Copper Wire Spool
      } else if (itemIdx === 5) {
        _dummy.scale.set(1.0, 0.55, 1.0); // Iron Gear
      } else if (itemIdx === 6) {
        _dummy.scale.set(1.1, 0.65, 0.92); // Logic Circuit
      } else if (itemIdx === 7) {
        _dummy.scale.set(1.22, 1.08, 1.22); // Robot Part
      } else {
        _dummy.scale.set(0.88, 0.88, 0.88); // Raw Ores / Coal
      }

      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
      mesh.setColorAt(i, itemColors[itemIdx] ?? itemColors[0]);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, MAX_INSTANCED_ITEMS]}
      castShadow
      frustumCulled={false}
    >
      <boxGeometry args={[0.24, 0.2, 0.24]} />
      <meshStandardMaterial roughness={0.32} metalness={0.58} />
    </instancedMesh>
  );
};
