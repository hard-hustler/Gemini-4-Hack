export type Direction = 0 | 1 | 2 | 3; // 0: North (-Z), 1: East (+X), 2: South (+Z), 3: West (-X)

export type ItemType =
  | 'iron_ore'
  | 'copper_ore'
  | 'coal'
  | 'iron_plate'
  | 'copper_wire'
  | 'gear'
  | 'circuit'
  | 'robot_part';

export type ResourceNodeType = 'iron' | 'copper' | 'coal';

export type MachineType =
  | 'extractor'
  | 'conveyor_straight'
  | 'conveyor_corner'
  | 'conveyor_splitter'
  | 'conveyor_merger'
  | 'smelter'
  | 'assembler'
  | 'inserter'
  | 'storage'
  | 'generator'
  | 'power_pole'
  | 'inspector'
  | 'shipping_dock';

export type MachineStatus =
  | 'idle'
  | 'working'
  | 'starved'
  | 'blocked'
  | 'no_power'
  | 'broken';

export type RecipeId =
  | 'iron_plate'
  | 'copper_wire'
  | 'gear'
  | 'circuit'
  | 'robot_part';

export type SimSpeed = 0 | 1 | 2 | 5 | 20;

export type HeatmapMode = 'none' | 'congestion' | 'power';

export type CameraMode = 'orbit' | 'fps';

export interface RecipeIngredient {
  item: ItemType;
  count: number;
}

export interface RecipeDef {
  id: RecipeId;
  name: string;
  machine: 'smelter' | 'assembler';
  inputs: RecipeIngredient[];
  output: RecipeIngredient;
  craftTimeSec: number;
}

export interface MachineDef {
  type: MachineType;
  name: string;
  shortName: string;
  cost: number;
  tier: 1 | 2 | 3;
  powerDrawKW: number;
  powerGenKW: number;
  poleRange: number;
  description: string;
  color: string;
  isConveyor: boolean;
}

export interface ItemDef {
  type: ItemType;
  name: string;
  color: string;
  sellPrice: number;
  researchValue: number;
  shape: 'ore' | 'plate' | 'wire' | 'gear' | 'circuit' | 'robot_part';
}

export interface BeltItem {
  id: number;
  type: ItemType;
  progress: number; // 0.0 (entry) -> 1.0 (exit)
  laneFrom: Direction;
}

export interface MachineEntity {
  id: number;
  type: MachineType;
  x: number;
  z: number;
  rot: Direction;
  cornerFlip?: boolean;
  recipeId: RecipeId | null;
  status: MachineStatus;
  craftProgress: number; // 0..1
  wear: number; // 0..100
  fuel: number; // 0..100 for generators
  inputBuffer: Partial<Record<ItemType, number>>;
  outputBuffer: Partial<Record<ItemType, number>>;
  beltItems: BeltItem[];
  splitterIndex: number;
  mergerIndex: number;
  inserterProgress: number; // 0..1
  inserterHolding: ItemType | null;
  powerSatisfaction: number; // 0..1
  powered: boolean;
  totalTicks: number;
  workingTicks: number;
  starvedTicks: number;
  blockedTicks: number;
  noPowerTicks: number;
  brokenTicks: number;
  efficiencyHistory: number[];
  itemsProcessed: number;
}

export interface DroneState {
  id: number;
  x: number;
  z: number;
  targetMachineId: number | null;
  path: Array<{ x: number; z: number }>;
  pathIndex: number;
  repairing: boolean;
  repairProgress: number;
}

export interface Contract {
  id: string;
  title: string;
  item: ItemType;
  targetCount: number;
  deliveredCount: number;
  remainingSec: number;
  totalSec: number;
  rewardMoney: number;
  rewardRP: number;
  penaltyMoney: number;
  status: 'active' | 'completed' | 'failed';
}

export interface TechNode {
  id: string;
  tier: 1 | 2 | 3;
  name: string;
  description: string;
  rpCost: number;
  moneyCost: number;
  unlocksMachines: MachineType[];
  speedMultiplierBonus?: number;
  powerEfficiencyBonus?: number;
  droneSpeedBonus?: number;
  sellPriceBonus?: number;
}

export interface BlueprintItem {
  dx: number;
  dz: number;
  type: MachineType;
  rot: Direction;
  cornerFlip?: boolean;
  recipeId: RecipeId | null;
}

export interface Blueprint {
  id: string;
  name: string;
  width: number;
  height: number;
  items: BlueprintItem[];
}

export interface EntityPlacement {
  x: number;
  z: number;
  type: MachineType;
  rot: Direction;
  cornerFlip?: boolean;
  recipeId?: RecipeId | null;
}

export interface OptimizationSuggestion {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  targetX?: number;
  targetZ?: number;
  machineId?: number;
}

export interface ResourceTile {
  x: number;
  z: number;
  type: ResourceNodeType;
  richness: number;
}

export interface SimMetrics {
  tick: number;
  simTimeSec: number;
  dayTime: number; // 0..1
  money: number;
  researchPoints: number;
  powerSupplyKW: number;
  powerDemandKW: number;
  powerSatisfaction: number;
  utilizationPct: number;
  bottleneckMachineId: number | null;
  bottleneckReason: string;
  productionRates: Record<ItemType, number>; // items/min
  powerHistory: Array<{ supply: number; demand: number }>;
  totalItemsShipped: number;
  activeItemCount: number;
}

export interface SimSnapshot {
  entities: MachineEntity[];
  drones: DroneState[];
  contracts: Contract[];
  unlockedTechIds: string[];
  metrics: SimMetrics;
  congestionMap: Uint8Array; // GRID_SIZE * GRID_SIZE (0..255)
  powerMap: Uint8Array; // GRID_SIZE * GRID_SIZE (0..255)
  itemRenderBuffer: Float32Array; // stride 5: [x, y, z, itemIdx, rot]
  itemRenderCount: number;
  breakdownEventId: number | null;
  contractCompletedId: string | null;
}

export interface SerializedFactory {
  version: number;
  seed: number;
  resources: ResourceTile[];
  entities: EntityPlacement[];
  money: number;
  researchPoints: number;
  unlockedTechIds: string[];
  dayTime: number;
  simTimeSec: number;
}

export type WorkerCommand =
  | { type: 'INIT'; serialized?: SerializedFactory }
  | { type: 'SET_SPEED'; speed: SimSpeed }
  | { type: 'PLACE_ENTITIES'; placements: EntityPlacement[] }
  | { type: 'REMOVE_ENTITIES'; coords: Array<{ x: number; z: number }> }
  | { type: 'SET_RECIPE'; machineId: number; recipeId: RecipeId | null }
  | { type: 'TOGGLE_CORNER_FLIP'; machineId: number }
  | { type: 'UNLOCK_TECH'; techId: string }
  | { type: 'SPAWN_CONTRACT' }
  | { type: 'REQUEST_EXPORT' }
  | { type: 'SET_DAY_TIME'; dayTime: number };

export type WorkerResponse =
  | { type: 'READY'; resources: ResourceTile[] }
  | { type: 'SNAPSHOT'; snapshot: SimSnapshot }
  | { type: 'EXPORT_DATA'; data: SerializedFactory }
  | { type: 'ACTION_REJECTED'; reason: string };
