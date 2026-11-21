import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PointerLockControls, Sky } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  cameraFocusRef,
  liveMetricsRef,
  useFactoryStore,
} from '../state/useFactoryStore';
import { FactoryFloor } from './FactoryFloor';
import { InstancedItems } from './InstancedItems';
import { MachineMeshes } from './MachineMeshes';
import { MaintenanceDrones } from './MaintenanceDrones';
import { TourGuideAvatar } from './TourGuideAvatar';
import { detectSoftwareGl } from './textures';

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _camGoal = new THREE.Vector3();

// Realistic architectural sky progression: crisp daylight -> warm golden dusk -> deep night
const _dayColor = new THREE.Color('#9db5cc');
const _duskColor = new THREE.Color('#8e6452');
const _nightColor = new THREE.Color('#0c1320');
const _bgScratch = new THREE.Color();
const _sunDayColor = new THREE.Color('#fff7eb');
const _sunDuskColor = new THREE.Color('#f59e56');
const _ambDayColor = new THREE.Color('#e6effa');
const _ambNightColor = new THREE.Color('#2c3a4f');
const _hemiDaySky = new THREE.Color('#d2e4f7');
const _hemiNightSky = new THREE.Color('#1a2538');

const EnvironmentAndSoftwarePacer: React.FC<{ isSoftwareGl: boolean }> = ({
  isSoftwareGl,
}) => {
  const { gl, scene, invalidate } = useThree();

  // Studio PBR environment map for crisp metallic reflections
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    return () => {
      scene.environment = null;
      envRT.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  // Software-WebGL afterDraw pacer so headless Chromium / SwiftShader never starves UI
  useEffect(() => {
    if (!isSoftwareGl) return;
    let alive = true;
    let timerId = 0;

    const scheduleNext = () => {
      if (!alive) return;
      const ctx = gl.getContext() as WebGL2RenderingContext;
      if (ctx && typeof ctx.fenceSync === 'function') {
        const sync = ctx.fenceSync(ctx.SYNC_GPU_COMMANDS_COMPLETE, 0);
        ctx.flush();
        const poll = () => {
          if (!alive) {
            if (sync) ctx.deleteSync(sync);
            return;
          }
          const state = sync
            ? ctx.getSyncParameter(sync, ctx.SYNC_STATUS)
            : ctx.SIGNALED;
          if (state === ctx.UNSIGNALED) {
            timerId = window.setTimeout(poll, 12);
          } else {
            if (sync) ctx.deleteSync(sync);
            timerId = window.setTimeout(() => {
              if (!alive) return;
              invalidate();
              scheduleNext();
            }, 130);
          }
        };
        timerId = window.setTimeout(poll, 12);
      } else {
        timerId = window.setTimeout(() => {
          if (!alive) return;
          invalidate();
          scheduleNext();
        }, 160);
      }
    };

    invalidate();
    scheduleNext();

    return () => {
      alive = false;
      window.clearTimeout(timerId);
    };
  }, [isSoftwareGl, gl, invalidate]);

  return null;
};

const CameraAndPerfRig: React.FC<{ isSoftwareGl: boolean }> = ({
  isSoftwareGl,
}) => {
  const cameraMode = useFactoryStore((s) => s.cameraMode);
  const setCameraMode = useFactoryStore((s) => s.setCameraMode);
  const setAutoTourPlaying = useFactoryStore((s) => s.setAutoTourPlaying);
  const setPerfStats = useFactoryStore((s) => s.setPerfStats);

  const orbitRef = useRef<OrbitControlsImpl>(null);
  const keysRef = useRef<Record<string, boolean>>({});
  const fpsCounter = useRef({ frames: 0, lastTime: performance.now() });
  const { camera, gl } = useThree();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.code] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (cameraMode === 'fps') {
      camera.position.set(
        cameraFocusRef.x,
        1.78,
        Math.min(60, cameraFocusRef.z + 5)
      );
      camera.lookAt(cameraFocusRef.x, 1.5, cameraFocusRef.z);
    }
  }, [cameraMode, camera]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);

    // Smooth cinematic multi-angle glide for Guided Factory Tour steps
    if (
      cameraFocusRef.pendingCamera &&
      orbitRef.current &&
      cameraMode === 'orbit'
    ) {
      const { pos, target } = cameraFocusRef.pendingCamera;
      _camGoal.set(pos[0], pos[1], pos[2]);
      _targetPos.set(target[0], target[1], target[2]);
      const alpha = isSoftwareGl ? 0.65 : 1 - Math.exp(-5.5 * delta);
      camera.position.lerp(_camGoal, alpha);
      orbitRef.current.target.lerp(_targetPos, alpha);
      orbitRef.current.update();
      if (
        camera.position.distanceTo(_camGoal) < 0.08 &&
        orbitRef.current.target.distanceTo(_targetPos) < 0.08
      ) {
        camera.position.copy(_camGoal);
        orbitRef.current.target.copy(_targetPos);
        orbitRef.current.update();
        cameraFocusRef.pendingCamera = null;
      }
    } else if (
      cameraFocusRef.pendingTarget &&
      orbitRef.current &&
      cameraMode === 'orbit'
    ) {
      // Smooth exponential damping for click-to-focus machine targets
      const { x, z } = cameraFocusRef.pendingTarget;
      _targetPos.set(x, 0.5, z);
      _camGoal.set(x + 7.5, 8.2, z + 8.5);
      const alpha = isSoftwareGl ? 0.65 : 1 - Math.exp(-6.5 * delta);
      orbitRef.current.target.lerp(_targetPos, alpha);
      camera.position.lerp(_camGoal, alpha);
      orbitRef.current.update();
      if (orbitRef.current.target.distanceTo(_targetPos) < 0.08) {
        cameraFocusRef.pendingTarget = null;
      }
    }

    if (cameraMode === 'orbit' && orbitRef.current) {
      cameraFocusRef.x = orbitRef.current.target.x;
      cameraFocusRef.z = orbitRef.current.target.z;
    }

    // First-Person "Walk the Floor" WASD movement
    if (cameraMode === 'fps') {
      const moveSpeed = (keysRef.current['ShiftLeft'] ? 12 : 6.5) * delta;
      camera.getWorldDirection(_forward);
      _forward.y = 0;
      if (_forward.lengthSq() > 0.0001) _forward.normalize();
      _right.crossVectors(_forward, camera.up).normalize();

      if (keysRef.current['KeyW'] || keysRef.current['ArrowUp']) {
        camera.position.addScaledVector(_forward, moveSpeed);
      }
      if (keysRef.current['KeyS'] || keysRef.current['ArrowDown']) {
        camera.position.addScaledVector(_forward, -moveSpeed);
      }
      if (keysRef.current['KeyD'] || keysRef.current['ArrowRight']) {
        camera.position.addScaledVector(_right, moveSpeed);
      }
      if (keysRef.current['KeyA'] || keysRef.current['ArrowLeft']) {
        camera.position.addScaledVector(_right, -moveSpeed);
      }

      camera.position.x = THREE.MathUtils.clamp(camera.position.x, 1, 63);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, 1, 63);
      camera.position.y = 1.78;
      cameraFocusRef.x = camera.position.x;
      cameraFocusRef.z = camera.position.z;
    }

    // Update FPS / Draw Call metrics at 1-2 Hz
    fpsCounter.current.frames++;
    const now = performance.now();
    const interval = isSoftwareGl ? 1000 : 500;
    if (now - fpsCounter.current.lastTime >= interval) {
      const elapsed = (now - fpsCounter.current.lastTime) / 1000;
      const fps = Math.round(fpsCounter.current.frames / elapsed);
      fpsCounter.current.frames = 0;
      fpsCounter.current.lastTime = now;
      setPerfStats({
        fps,
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
      });
    }
  });

  return cameraMode === 'orbit' ? (
    <OrbitControls
      ref={orbitRef}
      target={[30.5, 0.5, 31]}
      maxPolarAngle={Math.PI / 2 - 0.05}
      minDistance={3.5}
      maxDistance={85}
      enableDamping={!isSoftwareGl}
      dampingFactor={0.08}
      onStart={() => {
        cameraFocusRef.pendingTarget = null;
        cameraFocusRef.pendingCamera = null;
        setAutoTourPlaying(false);
      }}
    />
  ) : (
    <PointerLockControls onUnlock={() => setCameraMode('orbit')} />
  );
};

const DayNightLighting: React.FC<{ isSoftwareGl: boolean }> = ({
  isSoftwareGl,
}) => {
  const { scene } = useThree();
  const dirLightRef = useRef<THREE.DirectionalLight>(null);
  const ambLightRef = useRef<THREE.AmbientLight>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight>(null);
  const fogRef = useRef<THREE.Fog>(null);

  useFrame(() => {
    const dayTime = liveMetricsRef.current.dayTime;
    const angle = dayTime * Math.PI * 2 - Math.PI / 2;
    const sunY = Math.sin(angle) * 48;
    const sunX = Math.cos(angle) * 48;
    const daylight = THREE.MathUtils.clamp(
      (Math.sin(angle) + 0.18) / 1.18,
      0,
      1
    );

    if (daylight > 0.35) {
      _bgScratch.lerpColors(_duskColor, _dayColor, (daylight - 0.35) / 0.65);
    } else {
      _bgScratch.lerpColors(_nightColor, _duskColor, daylight / 0.35);
    }

    if (scene.background instanceof THREE.Color) {
      scene.background.copy(_bgScratch);
    }
    scene.environmentIntensity = 0.22 + daylight * 0.72;
    if (fogRef.current) {
      fogRef.current.color.copy(_bgScratch);
    }

    if (ambLightRef.current) {
      ambLightRef.current.intensity = 0.22 + daylight * 0.38;
      ambLightRef.current.color.lerpColors(_ambNightColor, _ambDayColor, daylight);
    }
    if (hemiLightRef.current) {
      hemiLightRef.current.intensity = 0.35 + daylight * 0.62;
      hemiLightRef.current.color.lerpColors(_hemiNightSky, _hemiDaySky, daylight);
    }
    if (dirLightRef.current) {
      dirLightRef.current.position.set(32 + sunX, Math.max(12, sunY), 24);
      dirLightRef.current.intensity = 0.28 + daylight * 2.25;
      dirLightRef.current.color.lerpColors(
        _sunDuskColor,
        _sunDayColor,
        Math.min(1, daylight * 1.35)
      );
    }
  });

  return (
    <>
      <color attach="background" args={['#9db5cc']} />
      <fog ref={fogRef} attach="fog" args={['#9db5cc', 76, 178]} />
      {!isSoftwareGl && (
        <Sky
          sunPosition={[52, 34, 22]}
          turbidity={6}
          rayleigh={1.1}
          mieCoefficient={0.004}
        />
      )}
      <ambientLight ref={ambLightRef} intensity={0.55} color="#e6effa" />
      <hemisphereLight
        ref={hemiLightRef}
        args={['#d2e4f7', '#4a4f57', 0.92]}
      />
      <directionalLight
        ref={dirLightRef}
        position={[52, 38, 24]}
        intensity={2.35}
        color="#fff7eb"
        castShadow={!isSoftwareGl}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={34}
        shadow-camera-bottom={-34}
        shadow-camera-near={5}
        shadow-camera-far={130}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
    </>
  );
};

export const SceneCanvas: React.FC = () => {
  const isSoftwareGl = useMemo(() => detectSoftwareGl(), []);
  const [contextLost, setContextLost] = useState(false);

  return (
    <div
      className="absolute inset-0 w-full h-full"
      data-testid="factory-canvas-container"
    >
      {contextLost ? (
        <div className="w-full h-full flex items-center justify-center bg-[#0c1016] text-slate-300 text-sm">
          WebGL rendering context interrupted. Restoring factory viewport...
        </div>
      ) : (
        <Canvas
          shadows={!isSoftwareGl}
          frameloop={isSoftwareGl ? 'demand' : 'always'}
          dpr={isSoftwareGl ? 1 : [1, 2]}
          camera={{ position: [47, 21, 51], fov: 44, near: 0.2, far: 260 }}
          gl={{
            antialias: !isSoftwareGl,
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.04,
          }}
          onCreated={({ gl }) => {
            const canvas = gl.domElement;
            canvas.addEventListener('webglcontextlost', (ev) => {
              ev.preventDefault();
              setContextLost(true);
            });
            canvas.addEventListener('webglcontextrestored', () => {
              setContextLost(false);
            });
          }}
        >
          <EnvironmentAndSoftwarePacer isSoftwareGl={isSoftwareGl} />
          <DayNightLighting isSoftwareGl={isSoftwareGl} />
          <CameraAndPerfRig isSoftwareGl={isSoftwareGl} />
          <FactoryFloor />
          <MachineMeshes />
          <InstancedItems />
          <MaintenanceDrones />
          <TourGuideAvatar />
        </Canvas>
      )}
    </div>
  );
};
