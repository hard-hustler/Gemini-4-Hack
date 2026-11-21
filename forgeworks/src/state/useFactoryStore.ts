import { create } from 'zustand';
import { soundEngine } from '../audio/soundEngine';
import { tourNarrator } from '../audio/tourNarrator';
import { TOUR_STEPS } from '../data/tourSteps';
import { analyzeFactoryLayout } from '../engine/optimizer';
import {
  Blueprint,
  CameraMode,
  Contract,
  Direction,
  DroneState,
  EntityPlacement,
  HeatmapMode,
  MachineEntity,
  MachineType,
  OptimizationSuggestion,
  RecipeId,
  ResourceTile,
  SerializedFactory,
  SimMetrics,
  SimSpeed,
  WorkerCommand,
  WorkerResponse,
} from '../types/factory';
import { compressString, decompressString } from '../utils/compression';

export interface UndoAction {
  kind: 'place' | 'remove';
  placed: EntityPlacement[];
  removed: EntityPlacement[];
}

export type ActiveModal =
  | 'none'
  | 'tech'
  | 'blueprints'
  | 'saveLoad'
  | 'help'
  | 'architecture';

export interface PerfStats {
  fps: number;
  drawCalls: number;
  triangles: number;
}

const SAVE_SLOT_PREFIX = 'forgeworks_slot_';
const AUTOSAVE_KEY = 'forgeworks_autosave';
const BLUEPRINTS_KEY = 'forgeworks_blueprints';

// Shared mutable refs read directly in R3F useFrame at 60 FPS with zero React re-renders
export const liveItemBufferRef: {
  buffer: Float32Array;
  count: number;
} = {
  buffer: new Float32Array(0),
  count: 0,
};

export const liveEntitiesRef: {
  list: MachineEntity[];
  byId: Map<number, MachineEntity>;
} = {
  list: [],
  byId: new Map(),
};

export const liveDronesRef: {
  list: DroneState[];
} = {
  list: [],
};

export const liveMetricsRef: {
  current: SimMetrics;
} = {
  current: {
    tick: 0,
    simTimeSec: 0,
    dayTime: 0.34,
    money: 1200,
    researchPoints: 35,
    powerSupplyKW: 0,
    powerDemandKW: 0,
    powerSatisfaction: 1,
    utilizationPct: 0,
    bottleneckMachineId: null,
    bottleneckReason: 'Initializing...',
    productionRates: {
      iron_ore: 0,
      copper_ore: 0,
      coal: 0,
      iron_plate: 0,
      copper_wire: 0,
      gear: 0,
      circuit: 0,
      robot_part: 0,
    },
    powerHistory: [],
    totalItemsShipped: 0,
    activeItemCount: 0,
  },
};

// Shared camera focus coordinates for spatial audio & smooth cinematic glides
export const cameraFocusRef = {
  x: 30.5,
  z: 31,
  pendingTarget: null as { x: number; z: number } | null,
  pendingCamera: null as {
    pos: readonly [number, number, number];
    target: readonly [number, number, number];
  } | null,
};

export type UiMode = 'tour' | 'build';

interface FactoryStore {
  worker: Worker | null;
  ready: boolean;
  resources: ResourceTile[];
  entities: MachineEntity[];
  topologyEntities: MachineEntity[];
  drones: DroneState[];
  contracts: Contract[];
  unlockedTechIds: string[];
  metrics: SimMetrics;
  congestionMap: Uint8Array;
  powerMap: Uint8Array;

  speed: SimSpeed;
  uiMode: UiMode;
  activeTourStepId: string;
  autoTourPlaying: boolean;
  voiceEnabled: boolean;
  tourSpeaking: boolean;
  selectedTool: MachineType | null;
  deleteMode: boolean;
  blueprintMode: boolean;
  activeBlueprint: Blueprint | null;
  blueprints: Blueprint[];
  rotation: Direction;

  cameraMode: CameraMode;
  heatmapMode: HeatmapMode;
  selectedEntityId: number | null;
  sidebarTab: 'analytics' | 'inspector' | 'contracts';
  sidebarCollapsed: boolean;
  activeModal: ActiveModal;
  toastMessage: string | null;

  undoStack: UndoAction[];
  redoStack: UndoAction[];
  suggestions: OptimizationSuggestion[];

  tutorialEnabled: boolean;
  tutorialCompletedSteps: string[];
  audioMuted: boolean;
  perfStats: PerfStats;
  exportedString: string;
  lastAutosaveLabel: string;

  initWorker: () => void;
  sendCommand: (cmd: WorkerCommand) => void;
  setSpeed: (speed: SimSpeed) => void;
  setUiMode: (mode: UiMode) => void;
  goToTourStep: (stepId: string, stopAuto?: boolean) => void;
  setAutoTourPlaying: (playing: boolean) => void;
  toggleVoiceEnabled: () => void;
  setTourSpeaking: (speaking: boolean) => void;
  selectTool: (tool: MachineType | null) => void;
  toggleDeleteMode: () => void;
  toggleBlueprintMode: () => void;
  rotateCW: () => void;
  setCameraMode: (mode: CameraMode) => void;
  setHeatmapMode: (mode: HeatmapMode) => void;
  selectEntity: (id: number | null) => void;
  setSidebarTab: (tab: 'analytics' | 'inspector' | 'contracts') => void;
  toggleSidebar: () => void;
  setActiveModal: (modal: ActiveModal) => void;
  setPerfStats: (stats: PerfStats) => void;
  showToast: (msg: string) => void;
  focusTile: (x: number, z: number) => void;
  setDayTime: (dayTime: number) => void;

  placeWithUndo: (placements: EntityPlacement[]) => void;
  removeWithUndo: (coords: Array<{ x: number; z: number }>) => void;
  undo: () => void;
  redo: () => void;

  saveBlueprintRegion: (
    name: string,
    x1: number,
    z1: number,
    x2: number,
    z2: number
  ) => void;
  renameBlueprint: (id: string, name: string) => void;
  selectBlueprintToStamp: (bp: Blueprint | null) => void;
  deleteBlueprint: (id: string) => void;

  setRecipe: (machineId: number, recipeId: RecipeId | null) => void;
  toggleCornerFlip: (machineId: number) => void;
  unlockTech: (techId: string) => void;
  spawnContract: () => void;
  runOptimizer: () => void;

  completeTutorialStep: (stepId: string) => void;
  dismissTutorial: () => void;
  reopenTutorial: () => void;
  toggleAudioMute: () => void;

  saveToSlot: (slotKey: string) => void;
  loadFromSlot: (slotKey: string) => void;
  resetDemoFactory: () => void;
  requestExportString: () => void;
  importFromString: (str: string) => void;
}

const DEFAULT_METRICS: SimMetrics = {
  tick: 0,
  simTimeSec: 0,
  dayTime: 0.34,
  money: 1200,
  researchPoints: 35,
  powerSupplyKW: 0,
  powerDemandKW: 0,
  powerSatisfaction: 1,
  utilizationPct: 0,
  bottleneckMachineId: null,
  bottleneckReason: 'Initializing...',
  productionRates: {
    iron_ore: 0,
    copper_ore: 0,
    coal: 0,
    iron_plate: 0,
    copper_wire: 0,
    gear: 0,
    circuit: 0,
    robot_part: 0,
  },
  powerHistory: [],
  totalItemsShipped: 0,
  activeItemCount: 0,
};

function loadSavedBlueprints(): Blueprint[] {
  try {
    const raw = localStorage.getItem(BLUEPRINTS_KEY);
    if (raw) return JSON.parse(raw) as Blueprint[];
  } catch {
    // ignore malformed local storage
  }
  return [
    {
      id: 'bp-smelter-cell',
      name: 'Smelter Line Cell',
      width: 5,
      height: 1,
      items: [
        { dx: 0, dz: 0, type: 'conveyor_straight', rot: 1, recipeId: null },
        { dx: 1, dz: 0, type: 'inserter', rot: 1, recipeId: null },
        { dx: 2, dz: 0, type: 'smelter', rot: 1, recipeId: 'iron_plate' },
        { dx: 3, dz: 0, type: 'inserter', rot: 1, recipeId: null },
        { dx: 4, dz: 0, type: 'conveyor_straight', rot: 1, recipeId: null },
      ],
    },
    {
      id: 'bp-gear-module',
      name: 'Gear Assembler Module',
      width: 5,
      height: 1,
      items: [
        { dx: 0, dz: 0, type: 'conveyor_straight', rot: 1, recipeId: null },
        { dx: 1, dz: 0, type: 'inserter', rot: 1, recipeId: null },
        { dx: 2, dz: 0, type: 'assembler', rot: 1, recipeId: 'gear' },
        { dx: 3, dz: 0, type: 'inserter', rot: 1, recipeId: null },
        { dx: 4, dz: 0, type: 'conveyor_straight', rot: 1, recipeId: null },
      ],
    },
  ];
}

let pendingSaveTarget: string | null = null;
let lastTopologyKey = '';
let lastUiCommitMs = 0;

function computeTopologyKey(entities: MachineEntity[]): string {
  let key = `${entities.length}:`;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    key += `${e.id},${e.x},${e.z},${e.rot},${e.cornerFlip ? 1 : 0};`;
  }
  return key;
}

export const useFactoryStore = create<FactoryStore>((set, get) => ({
  worker: null,
  ready: false,
  resources: [],
  entities: [],
  topologyEntities: [],
  drones: [],
  contracts: [],
  unlockedTechIds: ['tier1_basics', 'tier2_logistics'],
  metrics: DEFAULT_METRICS,
  congestionMap: new Uint8Array(64 * 64),
  powerMap: new Uint8Array(64 * 64),

  speed: 1,
  uiMode: 'tour',
  activeTourStepId: 'overview',
  autoTourPlaying: false,
  voiceEnabled: true,
  tourSpeaking: false,
  selectedTool: null,
  deleteMode: false,
  blueprintMode: false,
  activeBlueprint: null,
  blueprints: loadSavedBlueprints(),
  rotation: 1,

  cameraMode: 'orbit',
  heatmapMode: 'none',
  selectedEntityId: null,
  sidebarTab: 'analytics',
  sidebarCollapsed: true,
  activeModal: 'none',
  toastMessage: null,

  undoStack: [],
  redoStack: [],
  suggestions: [],

  tutorialEnabled: false,
  tutorialCompletedSteps: [],
  audioMuted: false,
  perfStats: { fps: 60, drawCalls: 0, triangles: 0 },
  exportedString: '',
  lastAutosaveLabel: 'Not yet',

  initWorker: () => {
    if (get().worker) return;
    const worker = new Worker(
      new URL('../workers/simWorker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'READY') {
        set({ ready: true, resources: msg.resources });
      } else if (msg.type === 'SNAPSHOT') {
        const snap = msg.snapshot;
        liveItemBufferRef.buffer = snap.itemRenderBuffer;
        liveItemBufferRef.count = snap.itemRenderCount;
        liveEntitiesRef.list = snap.entities;
        liveEntitiesRef.byId.clear();
        for (let i = 0; i < snap.entities.length; i++) {
          liveEntitiesRef.byId.set(snap.entities[i].id, snap.entities[i]);
        }
        liveDronesRef.list = snap.drones;
        liveMetricsRef.current = snap.metrics;

        if (snap.breakdownEventId !== null) {
          const broken = snap.entities.find(
            (e) => e.id === snap.breakdownEventId
          );
          if (broken) {
            soundEngine.playBreakdownAlarm(
              broken.x,
              broken.z,
              cameraFocusRef.x,
              cameraFocusRef.z
            );
            get().showToast(
              `Machine #${broken.id} broke down. Maintenance drone dispatched.`
            );
          }
        }
        if (snap.contractCompletedId !== null) {
          soundEngine.playChime();
          get().showToast(
            `Contract ${snap.contractCompletedId} completed. Reward credited.`
          );
        }

        let activeCount = 0;
        let workingSmelters = 0;
        let workingAssemblers = 0;
        let workingExtractors = 0;
        let workingGenerators = 0;
        let sampleAssembler: MachineEntity | null = null;
        let sampleInserter: MachineEntity | null = null;
        let sampleExtractor: MachineEntity | null = null;

        for (let i = 0; i < snap.entities.length; i++) {
          const e = snap.entities[i];
          if (e.status === 'working') {
            activeCount++;
            if (e.type === 'smelter') workingSmelters++;
            else if (e.type === 'assembler') {
              workingAssemblers++;
              if (!sampleAssembler) sampleAssembler = e;
            } else if (e.type === 'extractor') {
              workingExtractors++;
              if (!sampleExtractor) sampleExtractor = e;
            } else if (e.type === 'generator') {
              workingGenerators++;
            } else if (e.type === 'inserter' && e.inserterHolding) {
              if (!sampleInserter) sampleInserter = e;
            }
          }
        }

        const simSpeed = get().speed;
        soundEngine.updateFactorySoundscape({
          activeMachines: activeCount,
          workingSmelters,
          workingAssemblers,
          workingExtractors,
          workingGenerators,
          activeItems: snap.itemRenderCount,
          speed: simSpeed,
          listenerX: cameraFocusRef.x,
          listenerZ: cameraFocusRef.z,
        });

        // Spatialized realistic factory floor foley timed to active machinery
        if (simSpeed > 0) {
          const tick = snap.metrics.tick;
          if (snap.itemRenderCount > 0 && tick % 18 === 0) {
            const bx = snap.itemRenderBuffer[0] ?? 32;
            const bz = snap.itemRenderBuffer[2] ?? 32;
            soundEngine.playBeltRattle(bx, bz, cameraFocusRef.x, cameraFocusRef.z);
          }
          if (sampleAssembler && tick % 28 === 6) {
            soundEngine.playMetalStamp(
              sampleAssembler.x,
              sampleAssembler.z,
              cameraFocusRef.x,
              cameraFocusRef.z
            );
          }
          if (sampleAssembler && tick % 44 === 16) {
            soundEngine.playPneumaticHiss(
              sampleAssembler.x,
              sampleAssembler.z,
              cameraFocusRef.x,
              cameraFocusRef.z
            );
          }
          if (sampleInserter && tick % 24 === 12) {
            soundEngine.playServoWhir(
              sampleInserter.x,
              sampleInserter.z,
              cameraFocusRef.x,
              cameraFocusRef.z
            );
          }
          if (sampleExtractor && tick % 36 === 20) {
            soundEngine.playDrillRumble(
              sampleExtractor.x,
              sampleExtractor.z,
              cameraFocusRef.x,
              cameraFocusRef.z
            );
          }
        }

        const topoKey = computeTopologyKey(snap.entities);
        const topologyChanged = topoKey !== lastTopologyKey;
        const now = performance.now();

        if (topologyChanged || now - lastUiCommitMs >= 250) {
          lastUiCommitMs = now;
          if (topologyChanged) {
            lastTopologyKey = topoKey;
            set({
              entities: snap.entities,
              topologyEntities: snap.entities,
              drones: snap.drones,
              contracts: snap.contracts,
              unlockedTechIds: snap.unlockedTechIds,
              metrics: snap.metrics,
              congestionMap: snap.congestionMap,
              powerMap: snap.powerMap,
            });
          } else {
            set({
              entities: snap.entities,
              drones: snap.drones,
              contracts: snap.contracts,
              unlockedTechIds: snap.unlockedTechIds,
              metrics: snap.metrics,
              congestionMap: snap.congestionMap,
              powerMap: snap.powerMap,
            });
          }
        }
      } else if (msg.type === 'ACTION_REJECTED') {
        get().showToast(msg.reason);
      } else if (msg.type === 'EXPORT_DATA') {
        const compressed = compressString(JSON.stringify(msg.data));
        if (pendingSaveTarget) {
          try {
            localStorage.setItem(pendingSaveTarget, compressed);
            const nowStr = new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });
            if (pendingSaveTarget === AUTOSAVE_KEY) {
              set({ lastAutosaveLabel: nowStr });
            } else {
              get().showToast('Factory saved to local storage.');
            }
          } catch {
            get().showToast('Storage quota exceeded while saving.');
          }
          pendingSaveTarget = null;
        } else {
          set({ exportedString: compressed });
        }
      }
    };

    let initialSerialized: SerializedFactory | undefined;
    try {
      const auto = localStorage.getItem(AUTOSAVE_KEY);
      if (auto) {
        initialSerialized = JSON.parse(
          decompressString(auto)
        ) as SerializedFactory;
      }
    } catch {
      initialSerialized = undefined;
    }

    set({ worker });
    worker.postMessage({
      type: 'INIT',
      serialized: initialSerialized,
    } satisfies WorkerCommand);
  },

  sendCommand: (cmd) => {
    get().worker?.postMessage(cmd);
  },

  setSpeed: (speed) => {
    soundEngine.unlock();
    set({ speed });
    get().sendCommand({ type: 'SET_SPEED', speed });
  },

  setUiMode: (uiMode) => {
    soundEngine.unlock();
    if (uiMode === 'tour') {
      set({
        uiMode,
        selectedTool: null,
        deleteMode: false,
        blueprintMode: false,
        activeBlueprint: null,
      });
    } else {
      tourNarrator.stop();
      set({ uiMode, autoTourPlaying: false, tourSpeaking: false });
    }
  },

  goToTourStep: (stepId, stopAuto = false) => {
    soundEngine.unlock();
    const step = TOUR_STEPS.find((t) => t.id === stepId);
    if (step) {
      cameraFocusRef.pendingTarget = null;
      cameraFocusRef.pendingCamera = {
        pos: step.cameraPos,
        target: step.cameraTarget,
      };
    }
    set((s) => ({
      activeTourStepId: stepId,
      cameraMode: 'orbit',
      autoTourPlaying: stopAuto ? false : s.autoTourPlaying,
    }));
  },

  setAutoTourPlaying: (autoTourPlaying) => {
    soundEngine.unlock();
    if (!autoTourPlaying) {
      tourNarrator.stop();
      set({ autoTourPlaying: false, tourSpeaking: false });
    } else {
      set({ autoTourPlaying: true });
    }
  },

  toggleVoiceEnabled: () => {
    soundEngine.unlock();
    const next = !get().voiceEnabled;
    if (!next) {
      tourNarrator.stop();
      set({ voiceEnabled: false, tourSpeaking: false });
    } else {
      set({ voiceEnabled: true });
    }
  },

  setTourSpeaking: (tourSpeaking) => set({ tourSpeaking }),

  selectTool: (tool) => {
    soundEngine.unlock();
    set({
      uiMode: tool ? 'build' : get().uiMode,
      autoTourPlaying: tool ? false : get().autoTourPlaying,
      selectedTool: tool,
      deleteMode: false,
      blueprintMode: false,
      activeBlueprint: null,
    });
  },

  toggleDeleteMode: () => {
    soundEngine.unlock();
    set((s) => ({
      uiMode: !s.deleteMode ? 'build' : s.uiMode,
      autoTourPlaying: false,
      deleteMode: !s.deleteMode,
      selectedTool: null,
      blueprintMode: false,
      activeBlueprint: null,
    }));
  },

  toggleBlueprintMode: () => {
    soundEngine.unlock();
    set((s) => ({
      uiMode: !s.blueprintMode ? 'build' : s.uiMode,
      autoTourPlaying: false,
      blueprintMode: !s.blueprintMode,
      selectedTool: null,
      deleteMode: false,
      activeBlueprint: null,
    }));
  },

  rotateCW: () => {
    set((s) => ({ rotation: ((s.rotation + 1) % 4) as Direction }));
  },

  setCameraMode: (cameraMode) => {
    if (cameraMode === 'fps') get().completeTutorialStep('walk');
    set({ cameraMode });
  },

  setHeatmapMode: (heatmapMode) => {
    if (heatmapMode !== 'none') get().completeTutorialStep('heatmap');
    set({ heatmapMode });
  },

  selectEntity: (selectedEntityId) => {
    if (selectedEntityId !== null) {
      get().completeTutorialStep('observe');
      set({ selectedEntityId, sidebarTab: 'inspector', sidebarCollapsed: false });
    } else {
      set({ selectedEntityId: null });
    }
  },

  setSidebarTab: (sidebarTab) => set({ sidebarTab, sidebarCollapsed: false }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setActiveModal: (activeModal) => set({ activeModal }),
  setPerfStats: (perfStats) => set({ perfStats }),

  showToast: (toastMessage) => {
    set({ toastMessage });
    setTimeout(() => {
      if (get().toastMessage === toastMessage) {
        set({ toastMessage: null });
      }
    }, 3200);
  },

  focusTile: (x, z) => {
    cameraFocusRef.pendingTarget = { x: x + 0.5, z: z + 0.5 };
  },

  setDayTime: (dayTime) => {
    get().sendCommand({ type: 'SET_DAY_TIME', dayTime });
  },

  placeWithUndo: (placements) => {
    if (placements.length === 0) return;
    soundEngine.unlock();
    const first = placements[0];
    soundEngine.playPlace(first.x, first.z, cameraFocusRef.x, cameraFocusRef.z);
    get().completeTutorialStep('place');

    set((s) => ({
      undoStack: [
        ...s.undoStack.slice(-49),
        { kind: 'place', placed: placements, removed: [] },
      ],
      redoStack: [],
    }));
    get().sendCommand({ type: 'PLACE_ENTITIES', placements });
  },

  removeWithUndo: (coords) => {
    if (coords.length === 0) return;
    const entities = get().entities;
    const removed: EntityPlacement[] = [];
    for (const c of coords) {
      const found = entities.find((e) => e.x === c.x && e.z === c.z);
      if (found) {
        removed.push({
          x: found.x,
          z: found.z,
          type: found.type,
          rot: found.rot,
          cornerFlip: found.cornerFlip,
          recipeId: found.recipeId,
        });
      }
    }
    if (removed.length === 0) return;
    soundEngine.playPlace(
      removed[0].x,
      removed[0].z,
      cameraFocusRef.x,
      cameraFocusRef.z
    );
    set((s) => ({
      undoStack: [
        ...s.undoStack.slice(-49),
        { kind: 'remove', placed: [], removed },
      ],
      redoStack: [],
    }));
    get().sendCommand({ type: 'REMOVE_ENTITIES', coords });
  },

  undo: () => {
    const stack = get().undoStack;
    if (stack.length === 0) return;
    const action = stack[stack.length - 1];
    if (action.kind === 'place') {
      get().sendCommand({
        type: 'REMOVE_ENTITIES',
        coords: action.placed.map((p) => ({ x: p.x, z: p.z })),
      });
    } else {
      get().sendCommand({ type: 'PLACE_ENTITIES', placements: action.removed });
    }
    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, action],
    }));
  },

  redo: () => {
    const stack = get().redoStack;
    if (stack.length === 0) return;
    const action = stack[stack.length - 1];
    if (action.kind === 'place') {
      get().sendCommand({ type: 'PLACE_ENTITIES', placements: action.placed });
    } else {
      get().sendCommand({
        type: 'REMOVE_ENTITIES',
        coords: action.removed.map((r) => ({ x: r.x, z: r.z })),
      });
    }
    set((s) => ({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, action],
    }));
  },

  saveBlueprintRegion: (name, x1, z1, x2, z2) => {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minZ = Math.min(z1, z2);
    const maxZ = Math.max(z1, z2);

    const inside = get().entities.filter(
      (e) => e.x >= minX && e.x <= maxX && e.z >= minZ && e.z <= maxZ
    );
    if (inside.length === 0) {
      get().showToast('Selected region contains no machines.');
      return;
    }

    const bp: Blueprint = {
      id: `bp-${Date.now()}`,
      name: name.trim() || `Blueprint ${get().blueprints.length + 1}`,
      width: maxX - minX + 1,
      height: maxZ - minZ + 1,
      items: inside.map((e) => ({
        dx: e.x - minX,
        dz: e.z - minZ,
        type: e.type,
        rot: e.rot,
        cornerFlip: e.cornerFlip,
        recipeId: e.recipeId,
      })),
    };

    const updated = [bp, ...get().blueprints];
    localStorage.setItem(BLUEPRINTS_KEY, JSON.stringify(updated));
    set({
      blueprints: updated,
      blueprintMode: false,
      activeBlueprint: bp,
    });
    get().showToast(
      `Saved blueprint "${bp.name}" (${bp.items.length} entities). Click floor to stamp.`
    );
  },

  renameBlueprint: (id, name) => {
    const clean = name.trim();
    if (!clean) return;
    const updated = get().blueprints.map((b) =>
      b.id === id ? { ...b, name: clean } : b
    );
    localStorage.setItem(BLUEPRINTS_KEY, JSON.stringify(updated));
    set({ blueprints: updated });
  },

  selectBlueprintToStamp: (activeBlueprint) => {
    set({
      activeBlueprint,
      selectedTool: null,
      deleteMode: false,
      blueprintMode: false,
      activeModal: 'none',
    });
  },

  deleteBlueprint: (id) => {
    const updated = get().blueprints.filter((b) => b.id !== id);
    localStorage.setItem(BLUEPRINTS_KEY, JSON.stringify(updated));
    set({ blueprints: updated });
  },

  setRecipe: (machineId, recipeId) => {
    get().sendCommand({ type: 'SET_RECIPE', machineId, recipeId });
  },

  toggleCornerFlip: (machineId) => {
    get().sendCommand({ type: 'TOGGLE_CORNER_FLIP', machineId });
  },

  unlockTech: (techId) => {
    soundEngine.unlock();
    soundEngine.playChime();
    get().sendCommand({ type: 'UNLOCK_TECH', techId });
  },

  spawnContract: () => {
    get().sendCommand({ type: 'SPAWN_CONTRACT' });
  },

  runOptimizer: () => {
    get().completeTutorialStep('optimize');
    const suggestions = analyzeFactoryLayout(get().entities, get().metrics);
    set({ suggestions, sidebarTab: 'analytics', sidebarCollapsed: false });
  },

  completeTutorialStep: (stepId) => {
    set((s) =>
      s.tutorialCompletedSteps.includes(stepId)
        ? s
        : { tutorialCompletedSteps: [...s.tutorialCompletedSteps, stepId] }
    );
  },

  dismissTutorial: () => set({ tutorialEnabled: false }),
  reopenTutorial: () => set({ tutorialEnabled: true }),

  toggleAudioMute: () => {
    soundEngine.unlock();
    const next = !get().audioMuted;
    soundEngine.setMuted(next);
    set({ audioMuted: next });
  },

  saveToSlot: (slotKey) => {
    pendingSaveTarget =
      slotKey === 'autosave' ? AUTOSAVE_KEY : `${SAVE_SLOT_PREFIX}${slotKey}`;
    get().sendCommand({ type: 'REQUEST_EXPORT' });
  },

  loadFromSlot: (slotKey) => {
    const key =
      slotKey === 'autosave' ? AUTOSAVE_KEY : `${SAVE_SLOT_PREFIX}${slotKey}`;
    const raw = localStorage.getItem(key);
    if (!raw) {
      get().showToast('Save slot is empty.');
      return;
    }
    try {
      const parsed = JSON.parse(decompressString(raw)) as SerializedFactory;
      get().sendCommand({ type: 'INIT', serialized: parsed });
      set({
        activeModal: 'none',
        undoStack: [],
        redoStack: [],
        selectedEntityId: null,
      });
      get().showToast('Factory loaded successfully.');
    } catch {
      get().showToast('Failed to parse save data.');
    }
  },

  resetDemoFactory: () => {
    localStorage.removeItem(AUTOSAVE_KEY);
    get().sendCommand({ type: 'INIT', serialized: undefined });
    set({
      activeModal: 'none',
      undoStack: [],
      redoStack: [],
      selectedEntityId: null,
      suggestions: [],
    });
    get().showToast('Demo factory restored.');
  },

  requestExportString: () => {
    pendingSaveTarget = null;
    get().sendCommand({ type: 'REQUEST_EXPORT' });
  },

  importFromString: (str) => {
    try {
      const parsed = JSON.parse(decompressString(str)) as SerializedFactory;
      if (
        !parsed ||
        !Array.isArray(parsed.entities) ||
        !Array.isArray(parsed.resources)
      ) {
        get().showToast('Invalid factory payload.');
        return;
      }
      get().sendCommand({ type: 'INIT', serialized: parsed });
      set({
        activeModal: 'none',
        undoStack: [],
        redoStack: [],
        selectedEntityId: null,
      });
      get().showToast('Factory imported successfully.');
    } catch {
      get().showToast('Could not decompress or parse factory string.');
    }
  },
}));
