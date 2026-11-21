import React, { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { STATUS_COLORS } from '../data/catalog';
import { liveEntitiesRef, useFactoryStore } from '../state/useFactoryStore';
import { MachineEntity } from '../types/factory';
import {
  getConveyorBeltTexture,
  getHazardStripeTexture,
  getIndustrialPanelBumpTexture,
  getVentLouverTexture,
} from './textures';

const MAX_BELTS = 2048;
const MAX_ENTITIES = 4096;

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

// Realistic heavy-industry PBR material palette
const MAT_GALV_STEEL = new THREE.MeshStandardMaterial({
  color: '#707b88',
  metalness: 0.74,
  roughness: 0.36,
});
const MAT_BRUSHED_ALUM = new THREE.MeshStandardMaterial({
  color: '#b6c0cb',
  metalness: 0.82,
  roughness: 0.24,
});
const MAT_CHROME = new THREE.MeshStandardMaterial({
  color: '#e0e6ee',
  metalness: 0.94,
  roughness: 0.14,
});
const MAT_CAST_IRON = new THREE.MeshStandardMaterial({
  color: '#2a2f37',
  metalness: 0.56,
  roughness: 0.68,
});
const MAT_DARK_STEEL = new THREE.MeshStandardMaterial({
  color: '#3a424d',
  metalness: 0.6,
  roughness: 0.46,
});
const MAT_CAT_YELLOW = new THREE.MeshStandardMaterial({
  color: '#d89b18',
  metalness: 0.26,
  roughness: 0.42,
});
const MAT_KUKA_ORANGE = new THREE.MeshStandardMaterial({
  color: '#dd5a1b',
  metalness: 0.3,
  roughness: 0.34,
});
const MAT_CNC_WHITE = new THREE.MeshStandardMaterial({
  color: '#d8dde3',
  metalness: 0.22,
  roughness: 0.34,
});
const MAT_CNC_CHARCOAL = new THREE.MeshStandardMaterial({
  color: '#252c36',
  metalness: 0.42,
  roughness: 0.48,
});
const MAT_CNC_INTERIOR = new THREE.MeshStandardMaterial({
  color: '#eef6ff',
  emissive: '#bcd7f2',
  emissiveIntensity: 0.45,
  roughness: 0.4,
});
const MAT_CNC_GLASS = new THREE.MeshStandardMaterial({
  color: '#1b2b38',
  metalness: 0.55,
  roughness: 0.1,
  transparent: true,
  opacity: 0.48,
});
const MAT_HMI_SCREEN = new THREE.MeshStandardMaterial({
  color: '#38bdf8',
  emissive: '#0284c7',
  emissiveIntensity: 0.9,
  roughness: 0.2,
});
const MAT_ESTOP_RED = new THREE.MeshStandardMaterial({
  color: '#dc2626',
  metalness: 0.2,
  roughness: 0.35,
});
const MAT_BRASS = new THREE.MeshStandardMaterial({
  color: '#c99a3c',
  metalness: 0.86,
  roughness: 0.24,
});
const MAT_COPPER = new THREE.MeshStandardMaterial({
  color: '#b9693a',
  metalness: 0.86,
  roughness: 0.26,
});
const MAT_REFRACTORY_KILN = new THREE.MeshStandardMaterial({
  color: '#433c39',
  metalness: 0.46,
  roughness: 0.72,
});
const MAT_EXHAUST_STEEL = new THREE.MeshStandardMaterial({
  color: '#525861',
  metalness: 0.78,
  roughness: 0.36,
});
const MAT_GEN_OLIVE = new THREE.MeshStandardMaterial({
  color: '#3f4f45',
  metalness: 0.38,
  roughness: 0.52,
});
const MAT_WOOD_CRATE = new THREE.MeshStandardMaterial({
  color: '#a37e50',
  metalness: 0.06,
  roughness: 0.84,
});
const MAT_WOOD_DARK = new THREE.MeshStandardMaterial({
  color: '#735634',
  metalness: 0.05,
  roughness: 0.88,
});
const MAT_DOCK_CONCRETE = new THREE.MeshStandardMaterial({
  color: '#58606a',
  metalness: 0.16,
  roughness: 0.82,
});
const MAT_RUBBER = new THREE.MeshStandardMaterial({
  color: '#1d2127',
  metalness: 0.08,
  roughness: 0.9,
});
const MAT_DOCK_SAFETY_GREEN = new THREE.MeshStandardMaterial({
  color: '#2b6e55',
  metalness: 0.34,
  roughness: 0.46,
});
const MAT_INSPECTOR_GLASS = new THREE.MeshStandardMaterial({
  color: '#1f3f4a',
  metalness: 0.52,
  roughness: 0.12,
});
const MAT_CERAMIC_INSULATOR = new THREE.MeshStandardMaterial({
  color: '#73482d',
  metalness: 0.18,
  roughness: 0.26,
});
const MAT_POWER_CABLE = new THREE.MeshBasicMaterial({ color: '#272d36' });
const MAT_LASER = new THREE.MeshBasicMaterial({ color: '#22d3ee' });
const MAT_STORAGE_BAR = new THREE.MeshStandardMaterial({
  color: '#10b981',
  emissive: '#059669',
  emissiveIntensity: 0.55,
});
const MAT_DOCK_BEACON = new THREE.MeshStandardMaterial({
  color: '#34d399',
  emissive: '#10b981',
  emissiveIntensity: 1.35,
});
const MAT_ANDON_POLE = new THREE.MeshStandardMaterial({
  color: '#5c6673',
  metalness: 0.8,
  roughness: 0.3,
});

interface MachineMaterialsBundle {
  panelWhite: THREE.MeshStandardMaterial;
  panelYellow: THREE.MeshStandardMaterial;
  panelOlive: THREE.MeshStandardMaterial;
  panelKiln: THREE.MeshStandardMaterial;
  ventLouver: THREE.MeshStandardMaterial;
  hazardStripe: THREE.MeshStandardMaterial;
}

const HeroMachineItem: React.FC<{
  entity: MachineEntity;
  onSelect: (id: number) => void;
  beltTex: THREE.CanvasTexture;
  mats: MachineMaterialsBundle;
}> = React.memo(({ entity, onSelect, beltTex, mats }) => {
  const drillGroupRef = useRef<THREE.Group>(null);
  const chuckRef = useRef<THREE.Group>(null);
  const carouselRef = useRef<THREE.Group>(null);
  const spindleRef = useRef<THREE.Mesh>(null);
  const furnaceCoreRef = useRef<THREE.Mesh>(null);
  const armBaseRef = useRef<THREE.Group>(null);
  const armForeRef = useRef<THREE.Group>(null);
  const flywheelRef = useRef<THREE.Group>(null);
  const laserRef = useRef<THREE.Mesh>(null);
  const beaconRef = useRef<THREE.Mesh>(null);
  const storageBarRef = useRef<THREE.Mesh>(null);

  const rotY = -entity.rot * (Math.PI / 2);

  useFrame(({ clock }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const t = clock.getElapsedTime();
    const live = liveEntitiesRef.byId.get(entity.id) ?? entity;
    const activeSpeed =
      live.status === 'working' ? Math.max(0.25, live.powerSatisfaction) : 0;

    if (drillGroupRef.current && entity.type === 'extractor') {
      drillGroupRef.current.rotation.y += delta * 7.2 * activeSpeed;
      drillGroupRef.current.position.y =
        0.48 + Math.sin(t * 7.5 * activeSpeed) * 0.055;
    }

    if (chuckRef.current && entity.type === 'assembler') {
      chuckRef.current.rotation.y += delta * 5.2 * activeSpeed;
    }
    if (carouselRef.current && entity.type === 'assembler') {
      carouselRef.current.rotation.y -= delta * 1.4 * activeSpeed;
    }
    if (spindleRef.current && entity.type === 'assembler') {
      spindleRef.current.position.y =
        0.54 + Math.sin(t * 5.2 * activeSpeed) * 0.09;
    }

    if (furnaceCoreRef.current && entity.type === 'smelter') {
      const mat = furnaceCoreRef.current.material as THREE.MeshStandardMaterial;
      const flicker =
        live.powerSatisfaction < 0.92
          ? 0.4 + Math.abs(Math.sin(t * 22 + entity.id)) * 1.15
          : 1.65 + Math.sin(t * 4.8 + entity.id) * 0.35;
      mat.emissiveIntensity = live.status === 'working' ? flicker : 0.15;
    }

    if (armBaseRef.current && entity.type === 'inserter') {
      const progress = live.inserterHolding ? live.inserterProgress : 0;
      const swing = progress * Math.PI;
      armBaseRef.current.rotation.y = Math.PI - swing;
      if (armForeRef.current) {
        armForeRef.current.rotation.x = 0.85 + Math.sin(progress * Math.PI) * 0.32;
      }
    }

    if (flywheelRef.current && entity.type === 'generator') {
      flywheelRef.current.rotation.x += delta * 5.4 * (live.fuel > 0 ? 1 : 0);
    }

    if (laserRef.current && entity.type === 'inspector') {
      laserRef.current.position.z = Math.sin(t * 4.5) * 0.25;
    }

    if (beaconRef.current && entity.type === 'shipping_dock') {
      beaconRef.current.rotation.y += delta * 3.8;
    }

    if (storageBarRef.current && entity.type === 'storage') {
      let fill = 0;
      for (const v of Object.values(live.outputBuffer)) fill += v ?? 0;
      const ratio = Math.max(0.12, Math.min(1, fill / 40));
      storageBarRef.current.scale.y = ratio;
      storageBarRef.current.position.y = 0.14 + ratio * 0.24;
    }
  });

  return (
    <group
      position={[entity.x + 0.5, 0, entity.z + 0.5]}
      rotation={[0, rotY, 0]}
      onClick={(ev) => {
        ev.stopPropagation();
        onSelect(entity.id);
      }}
    >
      {/* Splitter / Merger: Heavy Galvanized Industrial Diverter Bridge */}
      {(entity.type === 'conveyor_splitter' ||
        entity.type === 'conveyor_merger') && (
        <group>
          <mesh
            position={[0, 0.11, 0]}
            castShadow
            receiveShadow
            material={MAT_CAST_IRON}
          >
            <boxGeometry args={[0.92, 0.22, 0.92]} />
          </mesh>
          <mesh
            position={[0, 0.32, 0]}
            castShadow
            receiveShadow
            material={
              entity.type === 'conveyor_splitter'
                ? MAT_GALV_STEEL
                : MAT_DARK_STEEL
            }
          >
            <boxGeometry args={[0.84, 0.22, 0.84]} />
          </mesh>
          {/* Hazard throat guards */}
          <mesh position={[0, 0.22, 0.44]} material={mats.hazardStripe}>
            <boxGeometry args={[0.68, 0.06, 0.04]} />
          </mesh>
          <mesh position={[0, 0.22, -0.44]} material={mats.hazardStripe}>
            <boxGeometry args={[0.68, 0.06, 0.04]} />
          </mesh>
          {/* Pneumatic diverter actuator cylinder + yellow housing */}
          <mesh position={[0, 0.47, -0.14]} castShadow material={mats.panelYellow}>
            <boxGeometry args={[0.42, 0.1, 0.3]} />
          </mesh>
          <mesh
            position={[0, 0.47, 0.18]}
            rotation={[Math.PI / 2, 0, 0]}
            material={MAT_CHROME}
          >
            <cylinderGeometry args={[0.045, 0.045, 0.34, 8]} />
          </mesh>
          <mesh position={[-0.32, 0.46, 0.2]} material={MAT_BRUSHED_ALUM}>
            <boxGeometry args={[0.14, 0.08, 0.18]} />
          </mesh>
        </group>
      )}

      {/* Ore Extractor: Realistic Heavy Quarry Rotary Drill Rig */}
      {entity.type === 'extractor' && (
        <group>
          {/* Heavy bolted steel skid chassis */}
          <mesh
            position={[0, 0.11, 0]}
            castShadow
            receiveShadow
            material={MAT_CAST_IRON}
          >
            <boxGeometry args={[0.94, 0.2, 0.94]} />
          </mesh>
          {/* Hazard stripe safety bumper */}
          <mesh position={[0, 0.12, 0.475]} material={mats.hazardStripe}>
            <boxGeometry args={[0.88, 0.09, 0.03]} />
          </mesh>
          {/* Rear diesel hydraulic powerpack + radiator louver grille */}
          <mesh
            position={[0, 0.38, -0.28]}
            castShadow
            receiveShadow
            material={mats.panelYellow}
          >
            <boxGeometry args={[0.78, 0.36, 0.34]} />
          </mesh>
          <mesh position={[0, 0.38, -0.455]} material={mats.ventLouver}>
            <planeGeometry args={[0.62, 0.26]} />
          </mesh>
          {/* Diesel exhaust stack */}
          <mesh
            position={[0.31, 0.72, -0.34]}
            castShadow
            material={MAT_EXHAUST_STEEL}
          >
            <cylinderGeometry args={[0.038, 0.048, 0.56, 8]} />
          </mesh>
          {/* Twin vertical steel drill mast rails + top crosshead gearbox */}
          <mesh
            position={[-0.32, 0.68, 0.04]}
            castShadow
            material={mats.panelYellow}
          >
            <boxGeometry args={[0.1, 1.04, 0.11]} />
          </mesh>
          <mesh
            position={[0.32, 0.68, 0.04]}
            castShadow
            material={mats.panelYellow}
          >
            <boxGeometry args={[0.1, 1.04, 0.11]} />
          </mesh>
          {/* Twin chrome hydraulic lift cylinders flanking the mast */}
          <mesh position={[-0.2, 0.64, 0.04]} material={MAT_CHROME}>
            <cylinderGeometry args={[0.03, 0.03, 0.88, 8]} />
          </mesh>
          <mesh position={[0.2, 0.64, 0.04]} material={MAT_CHROME}>
            <cylinderGeometry args={[0.03, 0.03, 0.88, 8]} />
          </mesh>
          {/* Top rotary drive gearbox */}
          <mesh
            position={[0, 1.18, 0.04]}
            castShadow
            material={MAT_DARK_STEEL}
          >
            <boxGeometry args={[0.78, 0.18, 0.32]} />
          </mesh>
          {/* Angled ore discharge hopper chute */}
          <mesh
            position={[0, 0.26, 0.38]}
            rotation={[0.32, 0, 0]}
            castShadow
            material={MAT_GALV_STEEL}
          >
            <boxGeometry args={[0.48, 0.18, 0.26]} />
          </mesh>
          {/* Animated spiral fluted quarry auger bit */}
          <group ref={drillGroupRef} position={[0, 0.48, 0.06]}>
            <mesh castShadow material={MAT_CHROME}>
              <cylinderGeometry args={[0.075, 0.055, 0.72, 10]} />
            </mesh>
            <mesh position={[0, -0.34, 0]} material={MAT_DARK_STEEL}>
              <coneGeometry args={[0.16, 0.26, 6]} />
            </mesh>
            {/* Helical cutting collars */}
            <mesh position={[0, -0.14, 0]} rotation={[0.2, 0, 0.2]} material={MAT_BRUSHED_ALUM}>
              <cylinderGeometry args={[0.17, 0.17, 0.045, 8]} />
            </mesh>
            <mesh position={[0, 0.04, 0]} rotation={[-0.2, 0, 0.2]} material={MAT_BRUSHED_ALUM}>
              <cylinderGeometry args={[0.17, 0.17, 0.045, 8]} />
            </mesh>
            <mesh position={[0, 0.22, 0]} rotation={[0.2, 0, -0.2]} material={MAT_BRUSHED_ALUM}>
              <cylinderGeometry args={[0.16, 0.16, 0.045, 8]} />
            </mesh>
          </group>
        </group>
      )}

      {/* Blast Smelter: Cylindrical Refractory Kiln + Reinforcing Hoops + Forced-Air Blower + Molten Hearth */}
      {entity.type === 'smelter' && (
        <group>
          {/* Heavy cast-iron hearth plinth */}
          <mesh
            position={[0, 0.11, 0]}
            castShadow
            receiveShadow
            material={MAT_CAST_IRON}
          >
            <boxGeometry args={[0.94, 0.22, 0.94]} />
          </mesh>
          {/* Main tapered cylindrical blast kiln shell */}
          <mesh
            position={[-0.04, 0.56, -0.02]}
            castShadow
            receiveShadow
            material={mats.panelKiln}
          >
            <cylinderGeometry args={[0.35, 0.42, 0.72, 12]} />
          </mesh>
          {/* 3 Heavy steel tension reinforcing hoops around kiln */}
          <mesh position={[-0.04, 0.34, -0.02]} material={MAT_DARK_STEEL}>
            <cylinderGeometry args={[0.425, 0.435, 0.055, 12]} />
          </mesh>
          <mesh position={[-0.04, 0.58, -0.02]} material={MAT_DARK_STEEL}>
            <cylinderGeometry args={[0.39, 0.4, 0.055, 12]} />
          </mesh>
          <mesh position={[-0.04, 0.82, -0.02]} material={MAT_COPPER}>
            <cylinderGeometry args={[0.365, 0.375, 0.065, 12]} />
          </mesh>
          {/* Conical refractory exhaust hood */}
          <mesh position={[-0.04, 1.0, -0.02]} castShadow material={MAT_REFRACTORY_KILN}>
            <cylinderGeometry args={[0.2, 0.36, 0.2, 12]} />
          </mesh>
          {/* Tall insulated steel flue stack + collar */}
          <mesh
            position={[-0.04, 1.34, -0.06]}
            castShadow
            material={MAT_EXHAUST_STEEL}
          >
            <cylinderGeometry args={[0.11, 0.15, 0.56, 10]} />
          </mesh>
          <mesh position={[-0.04, 1.56, -0.06]} material={MAT_DARK_STEEL}>
            <cylinderGeometry args={[0.145, 0.145, 0.05, 10]} />
          </mesh>
          {/* Side forced-air combustion blower turbine & air duct */}
          <mesh
            position={[0.34, 0.36, -0.22]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
            material={MAT_GALV_STEEL}
          >
            <cylinderGeometry args={[0.14, 0.14, 0.18, 10]} />
          </mesh>
          <mesh
            position={[0.34, 0.62, -0.14]}
            rotation={[0.35, 0, 0.2]}
            material={MAT_EXHAUST_STEEL}
          >
            <cylinderGeometry args={[0.055, 0.055, 0.42, 8]} />
          </mesh>
          {/* Recessed furnace viewport frame + white-hot glowing molten hearth core */}
          <mesh position={[-0.04, 0.42, 0.35]} material={MAT_CAST_IRON}>
            <boxGeometry args={[0.48, 0.34, 0.14]} />
          </mesh>
          <mesh ref={furnaceCoreRef} position={[-0.04, 0.42, 0.38]}>
            <boxGeometry args={[0.36, 0.22, 0.11]} />
            <meshStandardMaterial
              color="#ffb454"
              emissive="#f97316"
              emissiveIntensity={1.65}
              roughness={0.2}
            />
          </mesh>
        </group>
      )}

      {/* CNC Assembler: Enclosed Haas/DMG-Style 5-Axis Machining Center + Operator HMI Pendant */}
      {entity.type === 'assembler' && (
        <group>
          {/* Heavy cast-iron machine base bed */}
          <mesh
            position={[0, 0.11, 0]}
            castShadow
            receiveShadow
            material={MAT_CAST_IRON}
          >
            <boxGeometry args={[0.94, 0.22, 0.94]} />
          </mesh>
          {/* Rear & side enclosed off-white sheet-metal CNC cabinet */}
          <mesh
            position={[0, 0.56, -0.18]}
            castShadow
            receiveShadow
            material={mats.panelWhite}
          >
            <boxGeometry args={[0.88, 0.68, 0.5]} />
          </mesh>
          <mesh
            position={[-0.36, 0.56, 0.24]}
            castShadow
            material={mats.panelWhite}
          >
            <boxGeometry args={[0.16, 0.68, 0.36]} />
          </mesh>
          <mesh
            position={[0.36, 0.56, 0.24]}
            castShadow
            material={mats.panelWhite}
          >
            <boxGeometry args={[0.16, 0.68, 0.36]} />
          </mesh>
          {/* Top charcoal canopy header */}
          <mesh
            position={[0, 0.94, 0.02]}
            castShadow
            material={MAT_CNC_CHARCOAL}
          >
            <boxGeometry args={[0.9, 0.12, 0.88]} />
          </mesh>
          {/* Illuminated clean white interior machining bay */}
          <mesh position={[0, 0.54, 0.1]} material={MAT_CNC_INTERIOR}>
            <boxGeometry args={[0.56, 0.52, 0.08]} />
          </mesh>
          {/* Spinning rotary steel workpiece chuck inside bay */}
          <group ref={chuckRef} position={[0, 0.27, 0.2]}>
            <mesh material={MAT_CHROME}>
              <cylinderGeometry args={[0.15, 0.17, 0.09, 10]} />
            </mesh>
            <mesh position={[0, 0.06, 0]} material={MAT_BRASS}>
              <boxGeometry args={[0.24, 0.04, 0.06]} />
            </mesh>
          </group>
          {/* Vertical plunging pneumatic Z-axis milling spindle */}
          <mesh
            ref={spindleRef}
            position={[0, 0.54, 0.2]}
            castShadow
            material={MAT_BRUSHED_ALUM}
          >
            <cylinderGeometry args={[0.055, 0.04, 0.38, 10]} />
          </mesh>
          {/* Transparent polycarbonate safety door window */}
          <mesh position={[0, 0.55, 0.42]} material={MAT_CNC_GLASS}>
            <boxGeometry args={[0.58, 0.48, 0.025]} />
          </mesh>
          {/* Top-mounted rotating tool-changer carousel turret */}
          <group ref={carouselRef} position={[-0.18, 1.05, -0.1]}>
            <mesh castShadow material={MAT_DARK_STEEL}>
              <cylinderGeometry args={[0.21, 0.21, 0.1, 10]} />
            </mesh>
            <mesh position={[0.14, 0.06, 0]} material={MAT_BRASS}>
              <cylinderGeometry args={[0.03, 0.03, 0.08, 6]} />
            </mesh>
            <mesh position={[-0.14, 0.06, 0]} material={MAT_CHROME}>
              <cylinderGeometry args={[0.03, 0.03, 0.08, 6]} />
            </mesh>
            <mesh position={[0, 0.06, 0.14]} material={MAT_BRASS}>
              <cylinderGeometry args={[0.03, 0.03, 0.08, 6]} />
            </mesh>
          </group>
          {/* Articulated CNC Operator HMI Control Pendant on front-right */}
          <mesh position={[0.45, 0.58, 0.36]} castShadow material={MAT_CNC_CHARCOAL}>
            <boxGeometry args={[0.12, 0.26, 0.18]} />
          </mesh>
          <mesh position={[0.45, 0.62, 0.455]} material={MAT_HMI_SCREEN}>
            <planeGeometry args={[0.09, 0.12]} />
          </mesh>
          <mesh position={[0.45, 0.5, 0.455]} material={MAT_ESTOP_RED}>
            <cylinderGeometry args={[0.02, 0.02, 0.02, 8]} />
          </mesh>
          {/* Rear cooling louver grille */}
          <mesh position={[0, 0.54, -0.435]} rotation={[0, Math.PI, 0]} material={mats.ventLouver}>
            <planeGeometry args={[0.66, 0.46]} />
          </mesh>
        </group>
      )}

      {/* Robotic Arm (Inserter): KUKA-Style 6-Axis Articulated Industrial Robot */}
      {entity.type === 'inserter' && (
        <group>
          {/* Bolted circular steel floor mounting flange */}
          <mesh
            position={[0, 0.045, 0]}
            castShadow
            receiveShadow
            material={MAT_CAST_IRON}
          >
            <cylinderGeometry args={[0.35, 0.39, 0.09, 12]} />
          </mesh>
          {/* Cast rotating turret waist */}
          <mesh position={[0, 0.18, 0]} castShadow material={MAT_DARK_STEEL}>
            <cylinderGeometry args={[0.2, 0.26, 0.19, 12]} />
          </mesh>
          <group ref={armBaseRef} position={[0, 0.3, 0]}>
            {/* Horizontal black servo motor shoulder knuckle */}
            <mesh
              position={[0, 0.02, 0]}
              rotation={[0, 0, Math.PI / 2]}
              castShadow
              material={MAT_CAST_IRON}
            >
              <cylinderGeometry args={[0.11, 0.11, 0.28, 10]} />
            </mesh>
            {/* Twin parallel KUKA-orange lower boom arms */}
            <mesh
              position={[-0.075, 0.22, -0.14]}
              rotation={[0.42, 0, 0]}
              castShadow
              material={MAT_KUKA_ORANGE}
            >
              <boxGeometry args={[0.065, 0.46, 0.1]} />
            </mesh>
            <mesh
              position={[0.075, 0.22, -0.14]}
              rotation={[0.42, 0, 0]}
              castShadow
              material={MAT_KUKA_ORANGE}
            >
              <boxGeometry args={[0.065, 0.46, 0.1]} />
            </mesh>
            {/* Elbow servo motor drum + articulated forearm */}
            <group ref={armForeRef} position={[0, 0.4, -0.26]} rotation={[0.95, 0, 0]}>
              <mesh rotation={[0, 0, Math.PI / 2]} material={MAT_CAST_IRON}>
                <cylinderGeometry args={[0.085, 0.085, 0.22, 10]} />
              </mesh>
              <mesh position={[0, 0.19, 0]} castShadow material={MAT_KUKA_ORANGE}>
                <cylinderGeometry args={[0.055, 0.075, 0.38, 8]} />
              </mesh>
              {/* Wrist & dual-jaw pneumatic chrome gripper */}
              <mesh position={[0, 0.39, 0]} material={MAT_DARK_STEEL}>
                <boxGeometry args={[0.16, 0.05, 0.09]} />
              </mesh>
              <mesh position={[-0.06, 0.45, 0]} material={MAT_CHROME}>
                <boxGeometry args={[0.03, 0.1, 0.05]} />
              </mesh>
              <mesh position={[0.06, 0.45, 0]} material={MAT_CHROME}>
                <boxGeometry args={[0.03, 0.1, 0.05]} />
              </mesh>
            </group>
          </group>
        </group>
      )}

      {/* Storage Crate: Galvanized Steel Industrial Pallet Rack + Slatted Cargo Box */}
      {entity.type === 'storage' && (
        <group>
          <mesh
            position={[0, 0.06, 0]}
            castShadow
            receiveShadow
            material={MAT_CAST_IRON}
          >
            <boxGeometry args={[0.9, 0.12, 0.9]} />
          </mesh>
          {/* 4 corner galvanized pallet-rack upright posts */}
          {[
            [-0.4, -0.4],
            [0.4, -0.4],
            [-0.4, 0.4],
            [0.4, 0.4],
          ].map(([px, pz], idx) => (
            <mesh
              key={idx}
              position={[px, 0.44, pz]}
              castShadow
              material={MAT_GALV_STEEL}
            >
              <boxGeometry args={[0.07, 0.72, 0.07]} />
            </mesh>
          ))}
          {/* Top rack steel frame */}
          <mesh position={[0, 0.8, 0]} material={MAT_GALV_STEEL}>
            <boxGeometry args={[0.88, 0.06, 0.88]} />
          </mesh>
          {/* Wooden strapped industrial cargo crate inside rack */}
          <mesh
            position={[0, 0.4, 0]}
            castShadow
            receiveShadow
            material={MAT_WOOD_CRATE}
          >
            <boxGeometry args={[0.72, 0.56, 0.72]} />
          </mesh>
          <mesh position={[0, 0.4, 0]} material={MAT_WOOD_DARK}>
            <boxGeometry args={[0.75, 0.08, 0.75]} />
          </mesh>
          {/* Live LED fill-level gauge bar */}
          <mesh
            ref={storageBarRef}
            position={[0, 0.3, 0.41]}
            material={MAT_STORAGE_BAR}
          >
            <boxGeometry args={[0.46, 0.46, 0.04]} />
          </mesh>
        </group>
      )}

      {/* Power Generator: Heavy Horizontal Turbine Genset + Copper Stator + Exhaust Stack + Spoked Flywheel */}
      {entity.type === 'generator' && (
        <group>
          {/* Bolted cast-iron skid bedplate + OSHA hazard side trim */}
          <mesh
            position={[0, 0.1, 0]}
            castShadow
            receiveShadow
            material={MAT_CAST_IRON}
          >
            <boxGeometry args={[0.94, 0.18, 0.94]} />
          </mesh>
          <mesh position={[0, 0.1, 0.475]} material={mats.hazardStripe}>
            <boxGeometry args={[0.9, 0.07, 0.025]} />
          </mesh>
          {/* Main horizontal cylindrical steel steam/coal turbine barrel */}
          <mesh
            position={[-0.08, 0.44, -0.06]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
            receiveShadow
            material={mats.panelOlive}
          >
            <cylinderGeometry args={[0.28, 0.28, 0.68, 12]} />
          </mesh>
          {/* Ribbed cooling fins along turbine drum */}
          <mesh
            position={[-0.24, 0.44, -0.06]}
            rotation={[0, 0, Math.PI / 2]}
            material={MAT_DARK_STEEL}
          >
            <cylinderGeometry args={[0.31, 0.31, 0.05, 12]} />
          </mesh>
          <mesh
            position={[0.08, 0.44, -0.06]}
            rotation={[0, 0, Math.PI / 2]}
            material={MAT_DARK_STEEL}
          >
            <cylinderGeometry args={[0.31, 0.31, 0.05, 12]} />
          </mesh>
          {/* Copper-wound alternator stator housing */}
          <mesh
            position={[0.31, 0.44, -0.06]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
            material={MAT_COPPER}
          >
            <cylinderGeometry args={[0.23, 0.23, 0.2, 12]} />
          </mesh>
          {/* Side electrical switchgear box + radiator louver grille */}
          <mesh
            position={[0, 0.36, 0.3]}
            castShadow
            material={MAT_DARK_STEEL}
          >
            <boxGeometry args={[0.74, 0.34, 0.24]} />
          </mesh>
          <mesh position={[0, 0.36, 0.425]} material={mats.ventLouver}>
            <planeGeometry args={[0.56, 0.24]} />
          </mesh>
          {/* Brass steam pressure manifold & tall vertical exhaust silencer stack */}
          <mesh position={[0.26, 0.74, -0.28]} material={MAT_BRASS}>
            <cylinderGeometry args={[0.07, 0.07, 0.32, 8]} />
          </mesh>
          <mesh
            position={[-0.28, 0.92, -0.28]}
            castShadow
            material={MAT_EXHAUST_STEEL}
          >
            <cylinderGeometry args={[0.075, 0.095, 0.84, 10]} />
          </mesh>
          <mesh position={[-0.28, 1.34, -0.28]} material={MAT_DARK_STEEL}>
            <cylinderGeometry args={[0.11, 0.11, 0.04, 10]} />
          </mesh>
          {/* Animated spoked brass/steel heavy flywheel */}
          <group ref={flywheelRef} position={[-0.43, 0.46, -0.06]}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow material={MAT_BRASS}>
              <cylinderGeometry args={[0.26, 0.26, 0.08, 12]} />
            </mesh>
            <mesh material={MAT_CAST_IRON}>
              <boxGeometry args={[0.1, 0.46, 0.05]} />
            </mesh>
            <mesh material={MAT_CAST_IRON}>
              <boxGeometry args={[0.1, 0.05, 0.46]} />
            </mesh>
          </group>
        </group>
      )}

      {/* Power Pole: Galvanized Steel Utility Pylon + Cross-Arm Truss + Porcelain Insulators */}
      {entity.type === 'power_pole' && (
        <group>
          <mesh position={[0, 0.12, 0]} castShadow material={MAT_DOCK_CONCRETE}>
            <boxGeometry args={[0.42, 0.24, 0.42]} />
          </mesh>
          <mesh position={[0, 0.26, 0]} material={MAT_CAST_IRON}>
            <cylinderGeometry args={[0.13, 0.15, 0.06, 8]} />
          </mesh>
          <mesh position={[0, 1.04, 0]} castShadow material={MAT_GALV_STEEL}>
            <cylinderGeometry args={[0.055, 0.1, 1.72, 8]} />
          </mesh>
          {/* Cross-arm + diagonal structural struts */}
          <mesh position={[0, 1.78, 0]} castShadow material={MAT_BRUSHED_ALUM}>
            <boxGeometry args={[0.78, 0.065, 0.085]} />
          </mesh>
          <mesh
            position={[-0.17, 1.63, 0]}
            rotation={[0, 0, -0.68]}
            material={MAT_GALV_STEEL}
          >
            <boxGeometry args={[0.035, 0.34, 0.035]} />
          </mesh>
          <mesh
            position={[0.17, 1.63, 0]}
            rotation={[0, 0, 0.68]}
            material={MAT_GALV_STEEL}
          >
            <boxGeometry args={[0.035, 0.34, 0.035]} />
          </mesh>
          {/* Ribbed brown porcelain high-voltage insulators */}
          <mesh position={[-0.31, 1.86, 0]} material={MAT_CERAMIC_INSULATOR}>
            <cylinderGeometry args={[0.048, 0.062, 0.12, 8]} />
          </mesh>
          <mesh position={[0.31, 1.86, 0]} material={MAT_CERAMIC_INSULATOR}>
            <cylinderGeometry args={[0.048, 0.062, 0.12, 8]} />
          </mesh>
        </group>
      )}

      {/* Quality Inspector: Precision Optical Metrology Bridge + Sweeping Laser Triangulation */}
      {entity.type === 'inspector' && (
        <group>
          <mesh
            position={[0, 0.11, 0]}
            receiveShadow
            castShadow
            material={MAT_CAST_IRON}
          >
            <boxGeometry args={[0.9, 0.18, 0.98]} />
          </mesh>
          <mesh position={[0, 0.21, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.7, 0.98]} />
            <meshStandardMaterial
              color="#ffffff"
              map={beltTex}
              roughness={0.8}
            />
          </mesh>
          {/* Dual extruded brushed-aluminum metrology columns */}
          <mesh
            position={[-0.38, 0.56, 0]}
            castShadow
            material={MAT_BRUSHED_ALUM}
          >
            <boxGeometry args={[0.13, 0.82, 0.36]} />
          </mesh>
          <mesh
            position={[0.38, 0.56, 0]}
            castShadow
            material={MAT_BRUSHED_ALUM}
          >
            <boxGeometry args={[0.13, 0.82, 0.36]} />
          </mesh>
          {/* Safety light-curtain bars */}
          <mesh position={[-0.31, 0.5, 0.16]} material={MAT_CAT_YELLOW}>
            <boxGeometry args={[0.035, 0.52, 0.035]} />
          </mesh>
          <mesh position={[0.31, 0.5, 0.16]} material={MAT_CAT_YELLOW}>
            <boxGeometry args={[0.035, 0.52, 0.035]} />
          </mesh>
          {/* Overhead optical camera bridge */}
          <mesh
            position={[0, 0.96, 0]}
            castShadow
            material={mats.panelWhite}
          >
            <boxGeometry args={[0.92, 0.16, 0.38]} />
          </mesh>
          <mesh position={[0, 0.84, 0]} material={MAT_INSPECTOR_GLASS}>
            <boxGeometry args={[0.64, 0.08, 0.24]} />
          </mesh>
          {/* Sweeping cyan laser scanner plane */}
          <mesh ref={laserRef} position={[0, 0.5, 0]} material={MAT_LASER}>
            <boxGeometry args={[0.64, 0.025, 0.025]} />
          </mesh>
        </group>
      )}

      {/* Shipping Dock: Reinforced Concrete Bay + Rubber Fenders + OSHA Hazard Curb + Strapped Pallets */}
      {entity.type === 'shipping_dock' && (
        <group>
          <mesh
            position={[0, 0.21, 0]}
            castShadow
            receiveShadow
            material={MAT_DOCK_CONCRETE}
          >
            <boxGeometry args={[0.94, 0.42, 0.94]} />
          </mesh>
          {/* OSHA diagonal hazard curb & rubber truck dock bumpers */}
          <mesh position={[0, 0.44, 0.44]} material={mats.hazardStripe}>
            <boxGeometry args={[0.92, 0.07, 0.08]} />
          </mesh>
          <mesh position={[-0.32, 0.24, 0.48]} material={MAT_RUBBER}>
            <boxGeometry args={[0.14, 0.28, 0.06]} />
          </mesh>
          <mesh position={[0.32, 0.24, 0.48]} material={MAT_RUBBER}>
            <boxGeometry args={[0.14, 0.28, 0.06]} />
          </mesh>
          {/* Hydraulic green dock leveler deck plate */}
          <mesh
            position={[0, 0.46, 0.12]}
            castShadow
            material={MAT_DOCK_SAFETY_GREEN}
          >
            <boxGeometry args={[0.76, 0.08, 0.44]} />
          </mesh>
          {/* Stacked wooden pallet + cargo crate */}
          <mesh position={[-0.14, 0.46, -0.24]} material={MAT_WOOD_DARK}>
            <boxGeometry args={[0.42, 0.07, 0.36]} />
          </mesh>
          <mesh
            position={[-0.14, 0.62, -0.24]}
            castShadow
            material={MAT_WOOD_CRATE}
          >
            <boxGeometry args={[0.36, 0.25, 0.3]} />
          </mesh>
          {/* Safety bollard & rotating green dispatch beacon */}
          <mesh position={[0.34, 0.56, -0.32]} material={MAT_ANDON_POLE}>
            <cylinderGeometry args={[0.045, 0.055, 0.28, 8]} />
          </mesh>
          <mesh
            ref={beaconRef}
            position={[0.34, 0.74, -0.32]}
            material={MAT_DOCK_BEACON}
          >
            <cylinderGeometry args={[0.06, 0.065, 0.14, 8]} />
          </mesh>
        </group>
      )}
    </group>
  );
});

export const MachineMeshes: React.FC = () => {
  const topologyEntities = useFactoryStore((s) => s.topologyEntities);
  const selectedEntityId = useFactoryStore((s) => s.selectedEntityId);
  const bottleneckId = useFactoryStore((s) => s.metrics.bottleneckMachineId);
  const selectEntity = useFactoryStore((s) => s.selectEntity);
  const speed = useFactoryStore((s) => s.speed);

  const { gl } = useThree();
  const maxAniso = useMemo(
    () => Math.min(8, gl.capabilities.getMaxAnisotropy()),
    [gl]
  );

  const beltTex = useMemo(() => getConveyorBeltTexture(maxAniso), [maxAniso]);
  const panelBump = useMemo(
    () => getIndustrialPanelBumpTexture(maxAniso),
    [maxAniso]
  );
  const ventTex = useMemo(() => getVentLouverTexture(maxAniso), [maxAniso]);
  const hazardTex = useMemo(() => getHazardStripeTexture(maxAniso), [maxAniso]);

  const mats = useMemo<MachineMaterialsBundle>(
    () => ({
      panelWhite: new THREE.MeshStandardMaterial({
        color: '#d8dde3',
        metalness: 0.24,
        roughness: 0.36,
        bumpMap: panelBump,
        bumpScale: 0.014,
      }),
      panelYellow: new THREE.MeshStandardMaterial({
        color: '#d89b18',
        metalness: 0.28,
        roughness: 0.42,
        bumpMap: panelBump,
        bumpScale: 0.016,
      }),
      panelOlive: new THREE.MeshStandardMaterial({
        color: '#3f4f45',
        metalness: 0.38,
        roughness: 0.52,
        bumpMap: panelBump,
        bumpScale: 0.015,
      }),
      panelKiln: new THREE.MeshStandardMaterial({
        color: '#433c39',
        metalness: 0.48,
        roughness: 0.68,
        bumpMap: panelBump,
        bumpScale: 0.022,
      }),
      ventLouver: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        map: ventTex,
        metalness: 0.5,
        roughness: 0.45,
      }),
      hazardStripe: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        map: hazardTex,
        metalness: 0.2,
        roughness: 0.55,
      }),
    }),
    [panelBump, ventTex, hazardTex]
  );

  const { straightBelts, cornerBelts, heroMachines } = useMemo(() => {
    const straight: MachineEntity[] = [];
    const corner: MachineEntity[] = [];
    const heroes: MachineEntity[] = [];
    for (const e of topologyEntities) {
      if (e.type === 'conveyor_straight') straight.push(e);
      else if (e.type === 'conveyor_corner') corner.push(e);
      else heroes.push(e);
    }
    return { straightBelts: straight, cornerBelts: corner, heroMachines: heroes };
  }, [topologyEntities]);

  const straightBodyRef = useRef<THREE.InstancedMesh>(null);
  const straightLegRef = useRef<THREE.InstancedMesh>(null);
  const straightRailLRef = useRef<THREE.InstancedMesh>(null);
  const straightRailRRef = useRef<THREE.InstancedMesh>(null);
  const straightTopRef = useRef<THREE.InstancedMesh>(null);

  const cornerBaseRef = useRef<THREE.InstancedMesh>(null);
  const cornerGuardRef = useRef<THREE.InstancedMesh>(null);
  const cornerTopRef = useRef<THREE.InstancedMesh>(null);

  const shadowInstRef = useRef<THREE.InstancedMesh>(null);
  const orbInstRef = useRef<THREE.InstancedMesh>(null);
  const bottleneckRingRef = useRef<THREE.Mesh>(null);

  useLayoutEffect(() => {
    const sBody = straightBodyRef.current;
    const sLeg = straightLegRef.current;
    const sRailL = straightRailLRef.current;
    const sRailR = straightRailRRef.current;
    const sTop = straightTopRef.current;
    if (sBody && sLeg && sRailL && sRailR && sTop) {
      const n = Math.min(MAX_BELTS, straightBelts.length);
      sBody.count = n;
      sLeg.count = n;
      sRailL.count = n;
      sRailR.count = n;
      sTop.count = n;
      for (let i = 0; i < n; i++) {
        const b = straightBelts[i];
        const rotY = -b.rot * (Math.PI / 2);
        const cx = b.x + 0.5;
        const cz = b.z + 0.5;
        const cosR = Math.cos(rotY);
        const sinR = Math.sin(rotY);

        // Elevated C-channel roller bed frame
        _dummy.position.set(cx, 0.16, cz);
        _dummy.rotation.set(0, rotY, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        sBody.setMatrixAt(i, _dummy.matrix);

        // Dark structural H-frame pedestal stand beneath bed
        _dummy.position.set(cx, 0.055, cz);
        _dummy.rotation.set(0, rotY, 0);
        _dummy.updateMatrix();
        sLeg.setMatrixAt(i, _dummy.matrix);

        _dummy.position.set(cx - 0.41 * cosR, 0.225, cz + 0.41 * sinR);
        _dummy.rotation.set(0, rotY, 0);
        _dummy.updateMatrix();
        sRailL.setMatrixAt(i, _dummy.matrix);

        _dummy.position.set(cx + 0.41 * cosR, 0.225, cz - 0.41 * sinR);
        _dummy.rotation.set(0, rotY, 0);
        _dummy.updateMatrix();
        sRailR.setMatrixAt(i, _dummy.matrix);

        _dummy.position.set(cx, 0.215, cz);
        _dummy.rotation.set(-Math.PI / 2, 0, rotY);
        _dummy.updateMatrix();
        sTop.setMatrixAt(i, _dummy.matrix);
      }
      sBody.instanceMatrix.needsUpdate = true;
      sLeg.instanceMatrix.needsUpdate = true;
      sRailL.instanceMatrix.needsUpdate = true;
      sRailR.instanceMatrix.needsUpdate = true;
      sTop.instanceMatrix.needsUpdate = true;
    }

    const cBase = cornerBaseRef.current;
    const cGuard = cornerGuardRef.current;
    const cTop = cornerTopRef.current;
    if (cBase && cGuard && cTop) {
      const n = Math.min(MAX_BELTS, cornerBelts.length);
      cBase.count = n;
      cGuard.count = n;
      cTop.count = n;
      for (let i = 0; i < n; i++) {
        const b = cornerBelts[i];
        const rotY = -b.rot * (Math.PI / 2);
        const cx = b.x + 0.5;
        const cz = b.z + 0.5;
        const flip = b.cornerFlip ? -1 : 1;

        _dummy.position.set(cx, 0.13, cz);
        _dummy.rotation.set(0, rotY, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        cBase.setMatrixAt(i, _dummy.matrix);

        const gx = -0.37 * flip;
        const cosR = Math.cos(rotY);
        const sinR = Math.sin(rotY);
        _dummy.position.set(cx + gx * cosR, 0.23, cz - gx * sinR);
        _dummy.rotation.set(0, rotY, 0);
        _dummy.updateMatrix();
        cGuard.setMatrixAt(i, _dummy.matrix);

        _dummy.position.set(cx, 0.215, cz);
        _dummy.rotation.set(-Math.PI / 2, 0, rotY - (Math.PI / 2) * flip);
        _dummy.updateMatrix();
        cTop.setMatrixAt(i, _dummy.matrix);
      }
      cBase.instanceMatrix.needsUpdate = true;
      cGuard.instanceMatrix.needsUpdate = true;
      cTop.instanceMatrix.needsUpdate = true;
    }

    const shadows = shadowInstRef.current;
    if (shadows) {
      const n = Math.min(MAX_ENTITIES, topologyEntities.length);
      shadows.count = n;
      for (let i = 0; i < n; i++) {
        const e = topologyEntities[i];
        _dummy.position.set(e.x + 0.5, 0.014, e.z + 0.5);
        _dummy.rotation.set(-Math.PI / 2, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        shadows.setMatrixAt(i, _dummy.matrix);
      }
      shadows.instanceMatrix.needsUpdate = true;
    }
  }, [straightBelts, cornerBelts, topologyEntities]);

  // Animate belt tread, compact corner Andon stack-lights, and bottleneck ring
  useFrame(({ clock }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const t = clock.getElapsedTime();

    if (speed > 0) {
      beltTex.offset.y -= delta * Math.min(4, 1.45 * Math.sqrt(speed));
    }

    const orbs = orbInstRef.current;
    if (orbs) {
      const list = liveEntitiesRef.list;
      let count = 0;
      for (let i = 0; i < list.length && count < MAX_ENTITIES; i++) {
        const e = list[i];
        if (
          e.type === 'conveyor_straight' ||
          e.type === 'conveyor_corner' ||
          e.type === 'power_pole' ||
          e.type === 'inserter'
        ) {
          continue;
        }
        const y =
          e.type === 'smelter'
            ? 1.1
            : e.type === 'extractor'
              ? 1.32
              : e.type === 'assembler'
                ? 1.08
                : 0.96;
        const pulse = e.status === 'broken' ? 1.2 + Math.sin(t * 10) * 0.25 : 1;
        _dummy.position.set(e.x + 0.86, y, e.z + 0.16);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(pulse, pulse, pulse);
        _dummy.updateMatrix();
        orbs.setMatrixAt(count, _dummy.matrix);
        _color.set(STATUS_COLORS[e.status]);
        orbs.setColorAt(count, _color);
        count++;
      }
      orbs.count = count;
      orbs.instanceMatrix.needsUpdate = true;
      if (orbs.instanceColor) orbs.instanceColor.needsUpdate = true;
    }

    if (bottleneckRingRef.current) {
      const s = 1 + Math.sin(t * 6) * 0.08;
      bottleneckRingRef.current.scale.set(s, s, 1);
    }
  });

  // Realistic sagging catenary overhead power cables (3 segments per span)
  const cableSegments = useMemo(() => {
    const poles = topologyEntities.filter((e) => e.type === 'power_pole');
    const gens = topologyEntities.filter((e) => e.type === 'generator');
    const segs: Array<{
      key: string;
      mid: [number, number, number];
      len: number;
      quat: THREE.Quaternion;
    }> = [];
    const up = new THREE.Vector3(0, 1, 0);

    const addCatenary = (
      a: { x: number; z: number; id: number },
      b: { x: number; z: number; id: number },
      ay: number,
      by: number
    ) => {
      const p0 = new THREE.Vector3(a.x + 0.5, ay, a.z + 0.5);
      const p3 = new THREE.Vector3(b.x + 0.5, by, b.z + 0.5);
      const sag = Math.min(0.32, p0.distanceTo(p3) * 0.045);
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 3; s++) {
        const u = s / 3;
        const p = new THREE.Vector3().lerpVectors(p0, p3, u);
        p.y -= Math.sin(u * Math.PI) * sag;
        pts.push(p);
      }
      for (let s = 0; s < 3; s++) {
        const start = pts[s];
        const end = pts[s + 1];
        const dir = new THREE.Vector3().subVectors(end, start);
        const len = dir.length();
        const mid = new THREE.Vector3()
          .addVectors(start, end)
          .multiplyScalar(0.5);
        const quat = new THREE.Quaternion().setFromUnitVectors(
          up,
          dir.normalize()
        );
        segs.push({
          key: `${a.id}-${b.id}-${s}`,
          mid: [mid.x, mid.y, mid.z],
          len,
          quat,
        });
      }
    };

    for (let i = 0; i < poles.length; i++) {
      for (let j = i + 1; j < poles.length; j++) {
        if (
          Math.hypot(poles[i].x - poles[j].x, poles[i].z - poles[j].z) <= 7.5
        ) {
          addCatenary(poles[i], poles[j], 1.88, 1.88);
        }
      }
    }
    // Each turbine generator connects cleanly to its single nearest power pole
    for (const g of gens) {
      let nearest: MachineEntity | null = null;
      let bestDist = 6.5;
      for (const p of poles) {
        const d = Math.hypot(p.x - g.x, p.z - g.z);
        if (d <= bestDist) {
          bestDist = d;
          nearest = p;
        }
      }
      if (nearest) {
        addCatenary(nearest, g, 1.88, 0.92);
      }
    }
    return segs;
  }, [topologyEntities]);

  const selectedEntity = useMemo(
    () => topologyEntities.find((e) => e.id === selectedEntityId) ?? null,
    [topologyEntities, selectedEntityId]
  );

  const bottleneckEntity = useMemo(
    () => topologyEntities.find((e) => e.id === bottleneckId) ?? null,
    [topologyEntities, bottleneckId]
  );

  return (
    <group>
      {/* Grounded Contact Shadows */}
      <instancedMesh
        ref={shadowInstRef}
        args={[undefined, undefined, MAX_ENTITIES]}
        frustumCulled={false}
      >
        <circleGeometry args={[0.52, 12]} />
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.3}
          depthWrite={false}
        />
      </instancedMesh>

      {/* Instanced Elevated Galvanized Roller Conveyors */}
      <instancedMesh
        ref={straightLegRef}
        args={[undefined, undefined, MAX_BELTS]}
        frustumCulled={false}
        material={MAT_CAST_IRON}
      >
        <boxGeometry args={[0.78, 0.11, 0.24]} />
      </instancedMesh>
      <instancedMesh
        ref={straightBodyRef}
        args={[undefined, undefined, MAX_BELTS]}
        castShadow
        receiveShadow
        frustumCulled={false}
        material={MAT_GALV_STEEL}
      >
        <boxGeometry args={[0.88, 0.1, 0.98]} />
      </instancedMesh>
      <instancedMesh
        ref={straightRailLRef}
        args={[undefined, undefined, MAX_BELTS]}
        frustumCulled={false}
        material={MAT_BRUSHED_ALUM}
      >
        <boxGeometry args={[0.055, 0.065, 0.98]} />
      </instancedMesh>
      <instancedMesh
        ref={straightRailRRef}
        args={[undefined, undefined, MAX_BELTS]}
        frustumCulled={false}
        material={MAT_BRUSHED_ALUM}
      >
        <boxGeometry args={[0.055, 0.065, 0.98]} />
      </instancedMesh>
      <instancedMesh
        ref={straightTopRef}
        args={[undefined, undefined, MAX_BELTS]}
        receiveShadow
        frustumCulled={false}
      >
        <planeGeometry args={[0.74, 0.98]} />
        <meshStandardMaterial
          color="#ffffff"
          map={beltTex}
          roughness={0.82}
          metalness={0.12}
        />
      </instancedMesh>

      {/* Instanced Corner Roller Conveyors */}
      <instancedMesh
        ref={cornerBaseRef}
        args={[undefined, undefined, MAX_BELTS]}
        castShadow
        receiveShadow
        frustumCulled={false}
        material={MAT_GALV_STEEL}
      >
        <boxGeometry args={[0.88, 0.16, 0.88]} />
      </instancedMesh>
      <instancedMesh
        ref={cornerGuardRef}
        args={[undefined, undefined, MAX_BELTS]}
        frustumCulled={false}
        material={MAT_CAT_YELLOW}
      >
        <boxGeometry args={[0.065, 0.075, 0.78]} />
      </instancedMesh>
      <instancedMesh
        ref={cornerTopRef}
        args={[undefined, undefined, MAX_BELTS]}
        frustumCulled={false}
      >
        <planeGeometry args={[0.7, 0.7]} />
        <meshStandardMaterial color="#ffffff" map={beltTex} roughness={0.82} />
      </instancedMesh>

      {/* Compact Corner-Mounted Industrial Andon Stack Light Caps */}
      <instancedMesh
        ref={orbInstRef}
        args={[undefined, undefined, MAX_ENTITIES]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.048, 0.048, 0.13, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* Detailed Realistic Industrial Hero Machineries */}
      {heroMachines.map((e) => (
        <HeroMachineItem
          key={e.id}
          entity={e}
          onSelect={selectEntity}
          beltTex={beltTex}
          mats={mats}
        />
      ))}

      {/* Realistic Sagging Catenary Overhead Power Lines */}
      {cableSegments.map((seg) => (
        <mesh
          key={seg.key}
          position={seg.mid}
          quaternion={seg.quat}
          material={MAT_POWER_CABLE}
        >
          <cylinderGeometry args={[0.015, 0.015, seg.len, 4]} />
        </mesh>
      ))}

      {/* Selected Machine Ring */}
      {selectedEntity && (
        <mesh
          position={[selectedEntity.x + 0.5, 0.05, selectedEntity.z + 0.5]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.52, 0.63, 24]} />
          <meshBasicMaterial color="#38bdf8" side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Bottleneck Red Highlight Ring */}
      {bottleneckEntity && (
        <mesh
          ref={bottleneckRingRef}
          position={[bottleneckEntity.x + 0.5, 0.065, bottleneckEntity.z + 0.5]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.56, 0.68, 24]} />
          <meshBasicMaterial color="#ef4444" side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
};
