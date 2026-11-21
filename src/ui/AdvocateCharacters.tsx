// Articulated 3D factory-floor characters for the 5 Devil's Advocate specialists
// and Elena Vasquez (Surgical Fixer). Characters walk smoothly along A* floor aisles,
// turn to face inspected machinery, gesture while speaking, and are clickable in 3D.

import { Billboard, Line, Text } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AdvocateCharacter, CharacterRole, CharacterWalkPlan } from '../contracts';
import { ADVOCATE_CHARACTERS } from '../engines/advocate';
import type { FactorySpec, Point } from '../spec';
import { INK } from './Equipment';

type V3 = [number, number, number];

function toV3(spec: FactorySpec, p: Point, y = 0): V3 {
  return [p.x - spec.floor.width / 2, y, p.y - spec.floor.depth / 2];
}

function shortestAngleDiff(from: number, to: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function RoleProp({ prop, accent }: { prop: AdvocateCharacter['prop']; accent: string }) {
  switch (prop) {
    case 'tablet':
      return (
        <group position={[0, -0.34, 0.16]} rotation={[-0.65, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.24, 0.03, 0.18]} />
            <meshStandardMaterial color="#24272c" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.018, 0]}>
            <boxGeometry args={[0.2, 0.005, 0.14]} />
            <meshBasicMaterial color={accent} />
          </mesh>
        </group>
      );
    case 'clipboard':
      return (
        <group position={[0, -0.34, 0.16]} rotation={[-0.7, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.22, 0.025, 0.28]} />
            <meshStandardMaterial color="#8f6b43" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.016, 0.01]}>
            <boxGeometry args={[0.18, 0.006, 0.22]} />
            <meshStandardMaterial color="#fffcf5" roughness={0.9} />
          </mesh>
        </group>
      );
    case 'ledger':
      return (
        <group position={[0, -0.34, 0.15]} rotation={[-0.55, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.22, 0.035, 0.26]} />
            <meshStandardMaterial color="#2a3441" roughness={0.75} />
          </mesh>
          <mesh position={[0, 0.02, 0]}>
            <boxGeometry args={[0.18, 0.006, 0.2]} />
            <meshStandardMaterial color="#e8eef3" roughness={0.9} />
          </mesh>
        </group>
      );
    case 'blueprint':
      return (
        <group position={[0.04, -0.28, 0.14]} rotation={[0.4, 0, 0.5]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.045, 0.045, 0.44, 12]} />
            <meshStandardMaterial color="#f5f8fc" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[0.048, 0.048, 0.06, 12]} />
            <meshStandardMaterial color={accent} roughness={0.75} />
          </mesh>
        </group>
      );
    case 'wrench':
      return (
        <group position={[0, -0.36, 0.14]} rotation={[0.8, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.04, 0.34, 0.025]} />
            <meshStandardMaterial color="#8e949c" roughness={0.45} metalness={0.55} />
          </mesh>
          <mesh position={[0, 0.17, 0]} castShadow>
            <boxGeometry args={[0.11, 0.07, 0.03]} />
            <meshStandardMaterial color="#8e949c" roughness={0.45} metalness={0.55} />
          </mesh>
        </group>
      );
    case 'laser':
      return (
        <group position={[0, -0.32, 0.18]} rotation={[0.15, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.08, 0.08, 0.22]} />
            <meshStandardMaterial color="#df7f2e" roughness={0.65} />
          </mesh>
          <mesh position={[0, 0, 0.115]}>
            <boxGeometry args={[0.04, 0.04, 0.02]} />
            <meshBasicMaterial color="#fff0d9" />
          </mesh>
        </group>
      );
  }
}

/** The note over a technician's head: what they are doing, then what they found. */
export interface CrewBubble {
  text: string;
  tone: 'writing' | 'blocker' | 'warning' | 'advisory' | 'clear';
}

const BUBBLE_EDGE: Record<CrewBubble['tone'], string> = { writing: '#b8ae9c', blocker: '#bd4630', warning: '#df7f2e', advisory: '#8b8477', clear: '#2f7d57' };

/** A speech bubble that always faces the camera. Sized from the text, and larger on a large floor so it stays readable. */
function Bubble({ bubble, y, scale }: { bubble: CrewBubble; y: number; scale: number }) {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    if (bubble.tone !== 'writing') return;
    const t = setInterval(() => setDots((d) => (d % 3) + 1), 420);
    return () => clearInterval(t);
  }, [bubble.tone]);
  const raw = bubble.tone === 'writing' ? `${bubble.text} ${'.'.repeat(dots)}${' '.repeat(3 - dots)}` : bubble.text;
  const text = raw.length > 78 ? `${raw.slice(0, 76).replace(/\s+\S*$/, '')}…` : raw;
  const perLine = 27;
  const lines = Math.max(1, Math.ceil(text.length / perLine));
  const w = Math.min(text.length, perLine) * 0.112 + 0.42;
  const h = lines * 0.27 + 0.22;
  return (
    <Billboard position={[0, y, 0]} scale={scale}>
      <mesh position={[0, h / 2 + 0.12, -0.02]} renderOrder={28}>
        <planeGeometry args={[w + 0.07, h + 0.07]} />
        <meshBasicMaterial color={BUBBLE_EDGE[bubble.tone]} depthTest={false} />
      </mesh>
      <mesh position={[0, 0.12, -0.02]} rotation={[0, 0, Math.PI / 4]} renderOrder={28}>
        <planeGeometry args={[0.2, 0.2]} />
        <meshBasicMaterial color={BUBBLE_EDGE[bubble.tone]} depthTest={false} />
      </mesh>
      <mesh position={[0, h / 2 + 0.12, -0.01]} renderOrder={29}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color="#fffdf9" depthTest={false} />
      </mesh>
      <mesh position={[0, 0.155, -0.01]} rotation={[0, 0, Math.PI / 4]} renderOrder={29}>
        <planeGeometry args={[0.15, 0.15]} />
        <meshBasicMaterial color="#fffdf9" depthTest={false} />
      </mesh>
      <Text position={[0, h / 2 + 0.12, 0]} fontSize={0.2} lineHeight={1.3} maxWidth={w - 0.3} textAlign="center" color={INK} anchorX="center" anchorY="middle" renderOrder={30} material-depthTest={false} material-depthWrite={false}>
        {text}
      </Text>
    </Billboard>
  );
}

function CharacterAvatar({
  spec,
  plan,
  isActive,
  isSpeaking,
  animate,
  onSelect,
  bubble,
}: {
  spec: FactorySpec;
  plan: CharacterWalkPlan;
  bubble?: CrewBubble;
  isActive: boolean;
  isSpeaking: boolean;
  animate: boolean;
  onSelect?: (role: CharacterRole) => void;
}) {
  const char = ADVOCATE_CHARACTERS[plan.role];
  const [hover, setHover] = useState(false);

  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const waveRef = useRef<THREE.Group>(null);

  const pathData = useMemo(() => {
    const pts = plan.path.map((p) => new THREE.Vector3(...toV3(spec, p, 0)));
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const lookAt = new THREE.Vector3(...toV3(spec, plan.lookAtPoint, 0));
    const stand = new THREE.Vector3(...toV3(spec, plan.standPoint, 0));
    return { pts, cum, total: cum[cum.length - 1] ?? 0, lookAt, stand };
  }, [spec, plan]);

  // Persistent walk progress so the character walks smoothly from start to standPoint
  const progressRef = useRef(0);
  const walkPhaseRef = useRef(0);
  const yawRef = useRef(0);
  const pathKey = useMemo(() => plan.path.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('|'), [plan.path]);
  const lastPathKey = useRef('');

  useFrame(({ clock }, delta) => {
    const root = rootRef.current;
    if (!root) return;

    if (lastPathKey.current !== pathKey) {
      lastPathKey.current = pathKey;
      // Start walking from the beginning of the A* route (or snap to stand if animations off)
      progressRef.current = animate ? 0 : pathData.total;
      if (pathData.pts.length) {
        const startPt = animate ? pathData.pts[0] : pathData.stand;
        root.position.copy(startPt);
      }
    }

    const dt = Math.min(delta, 0.05);
    const t = clock.elapsedTime;
    const speed = isActive || isSpeaking ? 2.45 : 1.9;
    const walking = animate && progressRef.current < pathData.total - 0.02;

    if (walking) {
      progressRef.current = Math.min(pathData.total, progressRef.current + dt * speed);
      let segIdx = 1;
      while (segIdx < pathData.cum.length - 1 && pathData.cum[segIdx] < progressRef.current) segIdx++;
      const a = pathData.pts[segIdx - 1] ?? pathData.stand;
      const b = pathData.pts[segIdx] ?? pathData.stand;
      const segLen = pathData.cum[segIdx] - pathData.cum[segIdx - 1];
      const alpha = segLen > 1e-5 ? (progressRef.current - pathData.cum[segIdx - 1]) / segLen : 1;
      root.position.lerpVectors(a, b, alpha);

      if (segLen > 1e-5) {
        const targetYaw = Math.atan2(b.x - a.x, b.z - a.z);
        yawRef.current += shortestAngleDiff(yawRef.current, targetYaw) * Math.min(1, dt * 11);
      }
      walkPhaseRef.current += dt * 10.5;
    } else {
      root.position.copy(pathData.stand);
      const targetYaw = Math.atan2(pathData.lookAt.x - root.position.x, pathData.lookAt.z - root.position.z);
      yawRef.current += shortestAngleDiff(yawRef.current, targetYaw) * Math.min(1, dt * 8);
    }

    root.rotation.y = yawRef.current;

    const stride = walking ? Math.sin(walkPhaseRef.current) * 0.58 : 0;
    const bob = walking ? Math.abs(Math.sin(walkPhaseRef.current)) * 0.045 : Math.sin(t * 2.2 + (plan.role.length * 0.7)) * 0.012;

    if (bodyRef.current) {
      bodyRef.current.position.y = bob;
      bodyRef.current.rotation.x = isSpeaking && !walking ? 0.05 + Math.sin(t * 6.5) * 0.03 : walking ? 0.06 : 0;
    }

    if (leftLegRef.current && rightLegRef.current) {
      leftLegRef.current.rotation.x = THREE.MathUtils.lerp(leftLegRef.current.rotation.x, stride, Math.min(1, dt * 14));
      rightLegRef.current.rotation.x = THREE.MathUtils.lerp(rightLegRef.current.rotation.x, -stride, Math.min(1, dt * 14));
    }

    if (leftArmRef.current && rightArmRef.current) {
      if (walking) {
        leftArmRef.current.rotation.x = THREE.MathUtils.lerp(leftArmRef.current.rotation.x, -stride * 0.75 - 0.15, Math.min(1, dt * 12));
        rightArmRef.current.rotation.x = THREE.MathUtils.lerp(rightArmRef.current.rotation.x, stride * 0.85, Math.min(1, dt * 12));
        rightArmRef.current.rotation.z = THREE.MathUtils.lerp(rightArmRef.current.rotation.z, 0.05, Math.min(1, dt * 12));
      } else if (isSpeaking) {
        // Hold prop up in left hand; gesture expressively toward inspected station with right arm
        leftArmRef.current.rotation.x = THREE.MathUtils.lerp(leftArmRef.current.rotation.x, -0.58 + Math.sin(t * 3.8) * 0.06, Math.min(1, dt * 10));
        rightArmRef.current.rotation.x = THREE.MathUtils.lerp(rightArmRef.current.rotation.x, -0.95 + Math.sin(t * 7.2) * 0.24, Math.min(1, dt * 10));
        rightArmRef.current.rotation.z = THREE.MathUtils.lerp(rightArmRef.current.rotation.z, -0.14 + Math.cos(t * 5.1) * 0.08, Math.min(1, dt * 10));
      } else {
        leftArmRef.current.rotation.x = THREE.MathUtils.lerp(leftArmRef.current.rotation.x, -0.38, Math.min(1, dt * 8));
        rightArmRef.current.rotation.x = THREE.MathUtils.lerp(rightArmRef.current.rotation.x, -0.08 + Math.sin(t * 1.6) * 0.03, Math.min(1, dt * 8));
        rightArmRef.current.rotation.z = THREE.MathUtils.lerp(rightArmRef.current.rotation.z, 0.04, Math.min(1, dt * 8));
      }
    }

    if (headRef.current) {
      if (isSpeaking && !walking) {
        headRef.current.rotation.x = Math.sin(t * 8.4) * 0.08;
        headRef.current.rotation.y = Math.sin(t * 3.1) * 0.12;
      } else {
        headRef.current.rotation.x = THREE.MathUtils.lerp(headRef.current.rotation.x, 0, Math.min(1, dt * 8));
        headRef.current.rotation.y = THREE.MathUtils.lerp(headRef.current.rotation.y, Math.sin(t * 0.9 + plan.role.length) * 0.08, Math.min(1, dt * 6));
      }
    }

    if (ringRef.current) {
      const pulse = isSpeaking ? 1 + Math.sin(t * 6.5) * 0.14 : isActive ? 1.06 : 1;
      ringRef.current.scale.set(pulse, pulse, 1);
    }

    if (waveRef.current) {
      const s = 0.85 + Math.sin(t * 10) * 0.22;
      waveRef.current.scale.set(s, s, 1);
    }
  });

  const hasHardHat = plan.role !== 'electrical';
  const showTag = isSpeaking || isActive || hover;
  const firstName = char.name.split(' ')[0];
  const handleClick = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onSelect?.(plan.role);
  };

  return (
    <>
      {/* Subtle sightline from active/speaking character to the exact station they are inspecting */}
      {(isActive || isSpeaking) && (
        <Line
          points={[
            [pathData.stand.x, 0.05, pathData.stand.z],
            [pathData.lookAt.x, 0.05, pathData.lookAt.z],
          ]}
          color={char.accent}
          lineWidth={2}
          dashed
          dashSize={0.22}
          gapSize={0.16}
        />
      )}

      <group
        ref={rootRef}
        position={[pathData.stand.x, 0, pathData.stand.z]}
        onPointerDown={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
      >
        {/* Ground shadow */}
        <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.36, 20]} />
          <meshBasicMaterial color="#3b3123" transparent opacity={0.18} depthWrite={false} />
        </mesh>

        {/* Active / speaking floor ring */}
        {(isActive || isSpeaking || hover) && (
          <mesh ref={ringRef} position={[0, 0.022, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.38, 0.5, 28]} />
            <meshBasicMaterial color={char.accent} transparent opacity={isSpeaking ? 0.92 : 0.65} depthWrite={false} />
          </mesh>
        )}

        {/* Articulated Human Rig (~1.72m tall) */}
        <group ref={bodyRef}>
          {/* Left Leg */}
          <group ref={leftLegRef} position={[-0.1, 0.72, 0]}>
            <mesh position={[0, -0.32, 0]} castShadow>
              <boxGeometry args={[0.14, 0.62, 0.16]} />
              <meshStandardMaterial color={char.suitColor} roughness={0.9} />
            </mesh>
            <mesh position={[0, -0.66, 0.03]} castShadow>
              <boxGeometry args={[0.15, 0.1, 0.22]} />
              <meshStandardMaterial color="#1f2124" roughness={0.9} />
            </mesh>
          </group>

          {/* Right Leg */}
          <group ref={rightLegRef} position={[0.1, 0.72, 0]}>
            <mesh position={[0, -0.32, 0]} castShadow>
              <boxGeometry args={[0.14, 0.62, 0.16]} />
              <meshStandardMaterial color={char.suitColor} roughness={0.9} />
            </mesh>
            <mesh position={[0, -0.66, 0.03]} castShadow>
              <boxGeometry args={[0.15, 0.1, 0.22]} />
              <meshStandardMaterial color="#1f2124" roughness={0.9} />
            </mesh>
          </group>

          {/* Torso & Role Jacket/Vest */}
          <mesh position={[0, 1.05, 0]} castShadow>
            <boxGeometry args={[0.42, 0.62, 0.24]} />
            <meshStandardMaterial color={char.vestColor} roughness={0.85} />
          </mesh>
          {/* High-vis safety stripes for floor safety / stress / fixer roles */}
          {(plan.role === 'safety' || plan.role === 'process' || plan.role === 'fixer') && (
            <mesh position={[0, 0.95, 0]}>
              <boxGeometry args={[0.435, 0.06, 0.252]} />
              <meshStandardMaterial color="#f5efe2" roughness={0.5} />
            </mesh>
          )}
          {/* Collar / tie detail */}
          <mesh position={[0, 1.34, 0.04]}>
            <boxGeometry args={[0.16, 0.07, 0.18]} />
            <meshStandardMaterial color="#f5f1e8" roughness={0.9} />
          </mesh>

          {/* Left Arm + Role Prop */}
          <group ref={leftArmRef} position={[-0.27, 1.3, 0]}>
            <mesh position={[0, -0.22, 0]} castShadow>
              <boxGeometry args={[0.12, 0.48, 0.13]} />
              <meshStandardMaterial color={char.suitColor} roughness={0.88} />
            </mesh>
            <mesh position={[0, -0.47, 0]} castShadow>
              <boxGeometry args={[0.1, 0.1, 0.1]} />
              <meshStandardMaterial color={char.skinColor} roughness={0.85} />
            </mesh>
            <RoleProp prop={char.prop} accent={char.accent} />
          </group>

          {/* Right Arm (gestures toward machine when speaking) */}
          <group ref={rightArmRef} position={[0.27, 1.3, 0]}>
            <mesh position={[0, -0.22, 0]} castShadow>
              <boxGeometry args={[0.12, 0.48, 0.13]} />
              <meshStandardMaterial color={char.suitColor} roughness={0.88} />
            </mesh>
            <mesh position={[0, -0.47, 0]} castShadow>
              <boxGeometry args={[0.1, 0.1, 0.1]} />
              <meshStandardMaterial color={char.skinColor} roughness={0.85} />
            </mesh>
          </group>

          {/* Head + Helmet / Hair */}
          <group ref={headRef} position={[0, 1.54, 0]}>
            <mesh castShadow>
              <boxGeometry args={[0.26, 0.27, 0.25]} />
              <meshStandardMaterial color={char.skinColor} roughness={0.85} />
            </mesh>
            {/* Subtle eyes facing forward (+Z) so orientation toward machine is unmistakably readable */}
            <mesh position={[-0.06, 0.02, 0.128]}>
              <boxGeometry args={[0.032, 0.032, 0.01]} />
              <meshBasicMaterial color={INK} />
            </mesh>
            <mesh position={[0.06, 0.02, 0.128]}>
              <boxGeometry args={[0.032, 0.032, 0.01]} />
              <meshBasicMaterial color={INK} />
            </mesh>

            {hasHardHat ? (
              <group position={[0, 0.13, 0]}>
                <mesh castShadow>
                  <cylinderGeometry args={[0.17, 0.18, 0.13, 14]} />
                  <meshStandardMaterial color={char.hatColor} roughness={0.55} />
                </mesh>
                <mesh position={[0, -0.055, 0.04]} castShadow>
                  <boxGeometry args={[0.34, 0.03, 0.34]} />
                  <meshStandardMaterial color={char.hatColor} roughness={0.55} />
                </mesh>
              </group>
            ) : (
              <mesh position={[0, 0.12, -0.01]} castShadow>
                <boxGeometry args={[0.28, 0.1, 0.27]} />
                <meshStandardMaterial color={char.hatColor} roughness={0.9} />
              </mesh>
            )}
          </group>

          {/* Animated minimalist speaking sound-wave bars when actively speaking */}
          {isSpeaking && (
            <Billboard position={[0, 2.08, 0]}>
              <group ref={waveRef}>
                {[-0.14, 0, 0.14].map((x, idx) => (
                  <mesh key={x} position={[x, 0, 0]}>
                    <planeGeometry args={[0.055, idx === 1 ? 0.2 : 0.12]} />
                    <meshBasicMaterial color={char.accent} depthTest={false} />
                  </mesh>
                ))}
              </group>
            </Billboard>
          )}
        </group>

        {/* Clean name/role billboard on active speaker or hovered inspector */}
        {showTag ? (
          <Billboard position={[0, isSpeaking ? 2.52 : 2.28, 0]}>
            <Text
              fontSize={0.27}
              color={INK}
              anchorY="bottom"
              outlineWidth={0.055}
              outlineColor="#fffaf1"
              renderOrder={25}
              material-depthTest={false}
              material-depthWrite={false}
            >
              {char.name}
            </Text>
            <Text
              fontSize={0.18}
              color={char.accent}
              anchorY="top"
              position={[0, -0.04, 0]}
              outlineWidth={0.045}
              outlineColor="#fffaf1"
              renderOrder={25}
              material-depthTest={false}
              material-depthWrite={false}
            >
              {isSpeaking ? `Speaking · ${char.shortTitle}` : char.shortTitle}
            </Text>
          </Billboard>
        ) : (
          <Billboard position={[0, 2.04, 0]}>
            <Text
              fontSize={0.2}
              color="#57534b"
              anchorY="bottom"
              outlineWidth={0.045}
              outlineColor="#fffaf1"
              renderOrder={22}
              material-depthTest={false}
              material-depthWrite={false}
            >
              {firstName}
            </Text>
          </Billboard>
        )}
        {bubble && <Bubble bubble={bubble} y={showTag ? (isSpeaking ? 3.0 : 2.78) : 2.42} scale={Math.max(1.4, Math.min(6, Math.max(spec.floor.width, spec.floor.depth) / 15))} />}
      </group>
    </>
  );
}

export function AdvocateCharacters({
  spec,
  walkPlans,
  activeRole,
  speakingRole,
  animate = true,
  onSelectCharacter,
  bubbles,
}: {
  spec: FactorySpec;
  walkPlans: CharacterWalkPlan[];
  bubbles?: Partial<Record<CharacterRole, CrewBubble>>;
  activeRole?: CharacterRole | null;
  speakingRole?: CharacterRole | null;
  animate?: boolean;
  onSelectCharacter?: (role: CharacterRole) => void;
}) {
  return (
    <group>
      {walkPlans.map((plan) => (
        <CharacterAvatar
          key={plan.role}
          spec={spec}
          plan={plan}
          isActive={activeRole === plan.role}
          isSpeaking={speakingRole === plan.role}
          animate={animate}
          onSelect={onSelectCharacter}
          bubble={bubbles?.[plan.role]}
        />
      ))}
    </group>
  );
}
