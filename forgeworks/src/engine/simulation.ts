import {
  FIXED_DT,
  GRID_SIZE,
  ITEM_INDEX,
  ITEM_ORDER,
  ITEM_STRIDE,
  ITEMS,
  MACHINES,
  MAX_INSTANCED_ITEMS,
  RECIPES,
  TECH_TREE,
} from '../data/catalog';
import {
  Contract,
  Direction,
  DroneState,
  EntityPlacement,
  ItemType,
  MachineEntity,
  MachineType,
  RecipeId,
  ResourceNodeType,
  SerializedFactory,
  SimMetrics,
  SimSnapshot,
  TechNode,
} from '../types/factory';
import { createDemoFactory } from './demoFactory';
import { findDronePath } from './pathfinding';

const DIR_VEC: ReadonlyArray<{ dx: number; dz: number }> = [
  { dx: 0, dz: -1 }, // 0: North
  { dx: 1, dz: 0 }, // 1: East
  { dx: 0, dz: 1 }, // 2: South
  { dx: -1, dz: 0 }, // 3: West
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class FactorySimulation {
  private seed = 133742;
  private rng = mulberry32(133742);
  private nextEntityId = 1;
  private nextBeltItemId = 1;
  private nextContractSeq = 1;

  public tickCount = 0;
  public simTimeSec = 0;
  public dayTime = 0.34;
  public money = 1200;
  public researchPoints = 35;
  public unlockedTechIds = new Set<string>(['tier1_basics', 'tier2_logistics']);

  private resourceGrid: Array<ResourceNodeType | null> = new Array(
    GRID_SIZE * GRID_SIZE
  ).fill(null);
  private entityGrid: Array<MachineEntity | null> = new Array(
    GRID_SIZE * GRID_SIZE
  ).fill(null);
  private entities: MachineEntity[] = [];
  private drones: DroneState[] = [];
  private contracts: Contract[] = [];

  private congestionMap = new Uint8Array(GRID_SIZE * GRID_SIZE);
  private powerMap = new Uint8Array(GRID_SIZE * GRID_SIZE);
  private droneCostMap = new Uint8Array(GRID_SIZE * GRID_SIZE);
  private itemRenderBuffer = new Float32Array(MAX_INSTANCED_ITEMS * ITEM_STRIDE);

  private prodWindows: Record<ItemType, number[]> = {
    iron_ore: [],
    copper_ore: [],
    coal: [],
    iron_plate: [],
    copper_wire: [],
    gear: [],
    circuit: [],
    robot_part: [],
  };
  private powerHistory: Array<{ supply: number; demand: number }> = [];
  private totalItemsShipped = 0;
  private breakdownEventId: number | null = null;
  private contractCompletedId: string | null = null;

  constructor(initial?: SerializedFactory) {
    this.load(initial ?? createDemoFactory());
  }

  private idx(x: number, z: number): number {
    return z * GRID_SIZE + x;
  }

  private inBounds(x: number, z: number): boolean {
    return x >= 0 && x < GRID_SIZE && z >= 0 && z < GRID_SIZE;
  }

  public getResources() {
    const out: Array<{
      x: number;
      z: number;
      type: ResourceNodeType;
      richness: number;
    }> = [];
    for (let z = 0; z < GRID_SIZE; z++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const t = this.resourceGrid[this.idx(x, z)];
        if (t) out.push({ x, z, type: t, richness: 1 });
      }
    }
    return out;
  }

  public getEntities(): ReadonlyArray<MachineEntity> {
    return this.entities;
  }

  public getDrones(): ReadonlyArray<DroneState> {
    return this.drones;
  }

  public getContracts(): ReadonlyArray<Contract> {
    return this.contracts;
  }

  public setDayTime(dayTime: number): void {
    this.dayTime = ((dayTime % 1) + 1) % 1;
  }

  public load(data: SerializedFactory): void {
    this.seed = data.seed || 133742;
    this.rng = mulberry32(this.seed);
    this.nextEntityId = 1;
    this.nextBeltItemId = 1;
    this.nextContractSeq = 1;
    this.tickCount = 0;
    this.simTimeSec = data.simTimeSec ?? 0;
    this.dayTime = data.dayTime ?? 0.34;
    this.money = data.money ?? 1200;
    this.researchPoints = data.researchPoints ?? 35;
    this.unlockedTechIds = new Set(data.unlockedTechIds ?? ['tier1_basics']);
    this.totalItemsShipped = 0;

    this.resourceGrid.fill(null);
    for (const r of data.resources) {
      if (this.inBounds(r.x, r.z)) {
        this.resourceGrid[this.idx(r.x, r.z)] = r.type;
      }
    }

    this.entityGrid.fill(null);
    this.entities = [];
    for (const p of data.entities) {
      this.placeSingle(p, true);
    }

    this.drones = [
      {
        id: 1,
        x: 26,
        z: 26,
        targetMachineId: null,
        path: [],
        pathIndex: 0,
        repairing: false,
        repairProgress: 0,
      },
      {
        id: 2,
        x: 36,
        z: 36,
        targetMachineId: null,
        path: [],
        pathIndex: 0,
        repairing: false,
        repairProgress: 0,
      },
      {
        id: 3,
        x: 30,
        z: 32,
        targetMachineId: null,
        path: [],
        pathIndex: 0,
        repairing: false,
        repairProgress: 0,
      },
    ];

    this.contracts = [];
    this.spawnContract();
    this.spawnContract();

    for (const key of ITEM_ORDER) {
      this.prodWindows[key] = [];
    }
    this.powerHistory = [];

    // Pre-warm fresh factory for 22 seconds so all tiers including Robot Parts are alive on first frame
    if (this.simTimeSec === 0) {
      for (let i = 0; i < 440; i++) {
        this.stepInternal(true);
      }
    }
  }

  public exportSerialized(): SerializedFactory {
    return {
      version: 1,
      seed: this.seed,
      resources: this.getResources(),
      entities: this.entities.map((e) => ({
        x: e.x,
        z: e.z,
        type: e.type,
        rot: e.rot,
        cornerFlip: e.cornerFlip,
        recipeId: e.recipeId,
      })),
      money: Math.floor(this.money),
      researchPoints: Math.floor(this.researchPoints),
      unlockedTechIds: Array.from(this.unlockedTechIds),
      dayTime: this.dayTime,
      simTimeSec: this.simTimeSec,
    };
  }

  private getTechBonuses() {
    let speedMult = 1;
    let powerEff = 1;
    let droneSpeedMult = 1;
    let sellPriceMult = 1;
    for (const id of this.unlockedTechIds) {
      const node: TechNode | undefined = TECH_TREE.find((t) => t.id === id);
      if (!node) continue;
      if (node.speedMultiplierBonus) speedMult += node.speedMultiplierBonus;
      if (node.powerEfficiencyBonus) powerEff -= node.powerEfficiencyBonus;
      if (node.droneSpeedBonus) droneSpeedMult += node.droneSpeedBonus;
      if (node.sellPriceBonus) sellPriceMult += node.sellPriceBonus;
    }
    return {
      speedMult,
      powerEff: Math.max(0.5, powerEff),
      droneSpeedMult,
      sellPriceMult,
    };
  }

  public isMachineUnlocked(type: MachineType): boolean {
    for (const id of this.unlockedTechIds) {
      const node = TECH_TREE.find((t) => t.id === id);
      if (node && node.unlocksMachines.includes(type)) return true;
    }
    return false;
  }

  public unlockTech(techId: string): { ok: boolean; reason?: string } {
    if (this.unlockedTechIds.has(techId)) {
      return { ok: false, reason: 'Already unlocked' };
    }
    const node = TECH_TREE.find((t) => t.id === techId);
    if (!node) return { ok: false, reason: 'Unknown technology' };
    if (this.researchPoints < node.rpCost) {
      return { ok: false, reason: `Need ${node.rpCost} RP` };
    }
    if (this.money < node.moneyCost) {
      return { ok: false, reason: `Need $${node.moneyCost}` };
    }
    this.researchPoints -= node.rpCost;
    this.money -= node.moneyCost;
    this.unlockedTechIds.add(techId);
    return { ok: true };
  }

  public placeEntities(
    placements: EntityPlacement[]
  ): { ok: boolean; reason?: string } {
    for (const p of placements) {
      const res = this.placeSingle(p, false);
      if (!res.ok) return res;
    }
    return { ok: true };
  }

  private placeSingle(
    p: EntityPlacement,
    free: boolean
  ): { ok: boolean; reason?: string } {
    if (!this.inBounds(p.x, p.z)) return { ok: false, reason: 'Out of bounds' };
    if (!free && !this.isMachineUnlocked(p.type)) {
      return {
        ok: false,
        reason: `${MACHINES[p.type].name} requires Tech Tree unlock`,
      };
    }
    const cellIdx = this.idx(p.x, p.z);
    if (this.entityGrid[cellIdx]) {
      return { ok: false, reason: 'Tile already occupied' };
    }
    if (p.type === 'extractor' && !this.resourceGrid[cellIdx]) {
      return {
        ok: false,
        reason: 'Ore Extractor must be placed on an Ore or Coal deposit',
      };
    }
    const cost = MACHINES[p.type].cost;
    if (!free && this.money < cost) {
      return { ok: false, reason: `Need $${cost}` };
    }
    if (!free) this.money -= cost;

    let defaultRecipe = p.recipeId ?? null;
    if (!defaultRecipe && p.type === 'smelter') defaultRecipe = 'iron_plate';
    if (!defaultRecipe && p.type === 'assembler') defaultRecipe = 'gear';

    const entity: MachineEntity = {
      id: this.nextEntityId++,
      type: p.type,
      x: p.x,
      z: p.z,
      rot: p.rot,
      cornerFlip: p.cornerFlip ?? false,
      recipeId: defaultRecipe,
      status: 'idle',
      craftProgress: 0,
      wear: 0,
      fuel: p.type === 'generator' ? 100 : 0,
      inputBuffer: {},
      outputBuffer: {},
      beltItems: [],
      splitterIndex: 0,
      mergerIndex: 0,
      inserterProgress: 0,
      inserterHolding: null,
      powerSatisfaction: 1,
      powered: true,
      totalTicks: 0,
      workingTicks: 0,
      starvedTicks: 0,
      blockedTicks: 0,
      noPowerTicks: 0,
      brokenTicks: 0,
      efficiencyHistory: [],
      itemsProcessed: 0,
    };

    this.entityGrid[cellIdx] = entity;
    this.entities.push(entity);
    return { ok: true };
  }

  public removeEntities(coords: Array<{ x: number; z: number }>): void {
    for (const c of coords) {
      if (!this.inBounds(c.x, c.z)) continue;
      const cellIdx = this.idx(c.x, c.z);
      const ent = this.entityGrid[cellIdx];
      if (!ent) continue;
      this.money += Math.floor(MACHINES[ent.type].cost * 0.5);
      this.entityGrid[cellIdx] = null;
      this.entities = this.entities.filter((e) => e.id !== ent.id);
    }
  }

  public setRecipe(machineId: number, recipeId: RecipeId | null): void {
    const ent = this.entities.find((e) => e.id === machineId);
    if (!ent) return;
    ent.recipeId = recipeId;
    ent.craftProgress = 0;
  }

  public toggleCornerFlip(machineId: number): void {
    const ent = this.entities.find((e) => e.id === machineId);
    if (!ent || ent.type !== 'conveyor_corner') return;
    ent.cornerFlip = !ent.cornerFlip;
  }

  public triggerBreakdownForTest(machineId: number): void {
    const ent = this.entities.find((e) => e.id === machineId);
    if (!ent) return;
    ent.wear = 100;
    ent.status = 'broken';
    this.breakdownEventId = ent.id;
  }

  public spawnContract(): void {
    const active = this.contracts.filter((c) => c.status === 'active');
    if (active.length >= 3) return;
    const pool: Array<{ item: ItemType; min: number; max: number; sec: number }> = [
      { item: 'iron_plate', min: 30, max: 70, sec: 180 },
      { item: 'copper_wire', min: 40, max: 100, sec: 180 },
      { item: 'gear', min: 20, max: 50, sec: 220 },
      { item: 'circuit', min: 15, max: 45, sec: 260 },
      { item: 'robot_part', min: 5, max: 16, sec: 320 },
    ];
    const pick = pool[Math.floor(this.rng() * pool.length)];
    const targetCount =
      pick.min + Math.floor(this.rng() * (pick.max - pick.min + 1));
    const baseVal = ITEMS[pick.item].sellPrice * targetCount;
    const contract: Contract = {
      id: `CTR-${this.nextContractSeq++}`,
      title: `Deliver ${targetCount} ${ITEMS[pick.item].name}s`,
      item: pick.item,
      targetCount,
      deliveredCount: 0,
      remainingSec: pick.sec,
      totalSec: pick.sec,
      rewardMoney: Math.round(baseVal * 0.65) + 120,
      rewardRP: Math.max(8, Math.round(targetCount * 0.45)),
      penaltyMoney: Math.round(baseVal * 0.25) + 40,
      status: 'active',
    };
    this.contracts.unshift(contract);
    if (this.contracts.length > 6) this.contracts.pop();
  }

  public step(): void {
    this.stepInternal(false);
  }

  private stepInternal(warmup: boolean): void {
    this.tickCount++;
    this.simTimeSec += FIXED_DT;
    this.dayTime = (this.dayTime + FIXED_DT / 180) % 1; // 3-minute day/night cycle
    this.breakdownEventId = null;
    this.contractCompletedId = null;

    const bonuses = this.getTechBonuses();
    const { supplyKW, demandKW } = this.solvePowerGrid(bonuses.powerEff);

    this.congestionMap.fill(0);
    this.powerMap.fill(0);
    this.droneCostMap.fill(0);

    for (const e of this.entities) {
      if (!MACHINES[e.type].isConveyor) {
        this.droneCostMap[this.idx(e.x, e.z)] = 2;
      }
      const pDraw = MACHINES[e.type].powerDrawKW * bonuses.powerEff;
      if (pDraw > 0 && e.powered) {
        this.powerMap[this.idx(e.x, e.z)] = Math.min(
          255,
          Math.round((pDraw / 90) * 255)
        );
      } else if (e.type === 'generator' && e.fuel > 0) {
        this.powerMap[this.idx(e.x, e.z)] = 220;
      }
    }

    // 1. Update production machines & inserters
    for (const e of this.entities) {
      this.updateMachine(e, bonuses.speedMult, warmup);
    }

    // 2. Update conveyors (item queuing, backpressure, splitters, mergers)
    this.updateConveyors(bonuses.speedMult);

    // 3. Update A* maintenance drones
    this.updateDrones(bonuses.droneSpeedMult);

    // 4. Rolling 1 Hz analytics & contract countdown
    if (this.tickCount % 20 === 0) {
      this.updateSecondMetrics(supplyKW, demandKW);
    }
  }

  private solvePowerGrid(powerEff: number): {
    supplyKW: number;
    demandKW: number;
    satisfaction: number;
  } {
    const poweredNodes = new Set<number>();
    const poles = this.entities.filter((e) => e.type === 'power_pole');
    const gens = this.entities.filter((e) => e.type === 'generator');

    const activeGens = gens.filter((g) => g.status !== 'broken' && g.fuel > 0);
    let supplyKW = 0;
    for (const g of activeGens) {
      supplyKW += MACHINES.generator.powerGenKW;
      g.status = 'working';
    }
    for (const g of gens) {
      if (g.status !== 'broken' && g.fuel <= 0) {
        g.status = 'starved';
      }
    }

    const visitedPoles = new Set<number>();
    const queue: MachineEntity[] = [];

    for (const g of activeGens) {
      for (const p of poles) {
        if (
          Math.hypot(p.x - g.x, p.z - g.z) <= 6.5 &&
          !visitedPoles.has(p.id)
        ) {
          visitedPoles.add(p.id);
          queue.push(p);
        }
      }
      for (const e of this.entities) {
        if (Math.hypot(e.x - g.x, e.z - g.z) <= 4.5) {
          poweredNodes.add(e.id);
        }
      }
    }

    while (queue.length > 0) {
      const pole = queue.shift()!;
      pole.powered = true;
      pole.status = 'working';
      for (const other of poles) {
        if (
          !visitedPoles.has(other.id) &&
          Math.hypot(other.x - pole.x, other.z - pole.z) <= 7.5
        ) {
          visitedPoles.add(other.id);
          queue.push(other);
        }
      }
      for (const e of this.entities) {
        if (Math.hypot(e.x - pole.x, e.z - pole.z) <= 5.5) {
          poweredNodes.add(e.id);
        }
      }
    }

    for (const p of poles) {
      if (!visitedPoles.has(p.id)) {
        p.powered = false;
        p.status = 'no_power';
      }
    }

    let demandKW = 0;
    for (const e of this.entities) {
      const draw = MACHINES[e.type].powerDrawKW * powerEff;
      if (draw <= 0) {
        e.powered = true;
        e.powerSatisfaction = 1;
        continue;
      }
      if (poweredNodes.has(e.id)) {
        e.powered = true;
        demandKW += draw;
      } else {
        e.powered = false;
        e.powerSatisfaction = 0;
      }
    }

    const satisfaction = demandKW <= 0 ? 1 : Math.min(1, supplyKW / demandKW);
    for (const e of this.entities) {
      if (MACHINES[e.type].powerDrawKW > 0 && e.powered) {
        e.powerSatisfaction = satisfaction;
      }
    }

    return { supplyKW, demandKW, satisfaction };
  }

  private getNeighbor(x: number, z: number, dir: Direction): MachineEntity | null {
    const v = DIR_VEC[dir];
    const nx = x + v.dx;
    const nz = z + v.dz;
    if (!this.inBounds(nx, nz)) return null;
    return this.entityGrid[this.idx(nx, nz)];
  }

  private bufferTotal(buf: Partial<Record<ItemType, number>>): number {
    let sum = 0;
    for (const k of ITEM_ORDER) {
      sum += buf[k] ?? 0;
    }
    return sum;
  }

  private pushItemToTarget(
    target: MachineEntity,
    item: ItemType,
    fromDir: Direction
  ): boolean {
    if (MACHINES[target.type].isConveyor) {
      if (target.beltItems.length >= 4) return false;
      const minProg = target.beltItems.reduce(
        (m, b) => Math.min(m, b.progress),
        1
      );
      if (minProg < 0.24) return false;

      // Merger round-robin priority across up to 3 incoming directions
      if (target.type === 'conveyor_merger') {
        const incomingDirs: Direction[] = [
          ((target.rot + 2) % 4) as Direction,
          ((target.rot + 1) % 4) as Direction,
          ((target.rot + 3) % 4) as Direction,
        ];
        const waitingDirs = incomingDirs.filter((d) => {
          const n = this.getNeighbor(target.x, target.z, d);
          return (
            n !== null &&
            MACHINES[n.type].isConveyor &&
            n.beltItems.some((bi) => bi.progress >= 0.94)
          );
        });
        if (waitingDirs.length > 1) {
          let chosenDir = waitingDirs[0];
          for (let attempt = 0; attempt < 3; attempt++) {
            const candidate = incomingDirs[(target.mergerIndex + attempt) % 3];
            if (waitingDirs.includes(candidate)) {
              chosenDir = candidate;
              break;
            }
          }
          if (chosenDir !== fromDir) return false;
          target.mergerIndex =
            (incomingDirs.indexOf(fromDir) + 1) % incomingDirs.length;
        }
      }

      target.beltItems.push({
        id: this.nextBeltItemId++,
        type: item,
        progress: 0.02,
        laneFrom: fromDir,
      });
      return true;
    }

    if (target.type === 'storage') {
      if (this.bufferTotal(target.outputBuffer) >= 40) return false;
      target.outputBuffer[item] = (target.outputBuffer[item] ?? 0) + 1;
      target.itemsProcessed++;
      return true;
    }

    if (target.type === 'generator') {
      if (item === 'coal' && target.fuel < 95) {
        target.fuel = Math.min(100, target.fuel + 35);
        target.itemsProcessed++;
        return true;
      }
      return false;
    }

    if (target.type === 'shipping_dock') {
      this.sellItem(target, item);
      return true;
    }

    if (target.type === 'smelter' || target.type === 'assembler') {
      const currentRecipe = target.recipeId ? RECIPES[target.recipeId] : null;
      const acceptsCurrent =
        currentRecipe?.inputs.some((i) => i.item === item) ?? false;
      if (!acceptsCurrent) {
        const auto = Object.values(RECIPES).find(
          (r) =>
            r.machine === target.type && r.inputs.some((i) => i.item === item)
        );
        if (auto && this.bufferTotal(target.inputBuffer) === 0) {
          target.recipeId = auto.id;
        } else if (!acceptsCurrent) {
          return false;
        }
      }
      const curr = target.inputBuffer[item] ?? 0;
      if (curr >= 8) return false;
      target.inputBuffer[item] = curr + 1;
      return true;
    }

    return false;
  }

  private pullItemFromSource(source: MachineEntity): ItemType | null {
    if (MACHINES[source.type].isConveyor) {
      if (source.beltItems.length === 0) return null;
      let bestIdx = 0;
      for (let i = 1; i < source.beltItems.length; i++) {
        if (source.beltItems[i].progress > source.beltItems[bestIdx].progress) {
          bestIdx = i;
        }
      }
      if (source.beltItems[bestIdx].progress < 0.25) return null;
      const [removed] = source.beltItems.splice(bestIdx, 1);
      return removed.type;
    }

    for (const k of ITEM_ORDER) {
      const count = source.outputBuffer[k] ?? 0;
      if (count > 0) {
        source.outputBuffer[k] = count - 1;
        return k;
      }
    }
    return null;
  }

  private sellItem(dock: MachineEntity, item: ItemType): void {
    const bonuses = this.getTechBonuses();
    const val = Math.round(ITEMS[item].sellPrice * bonuses.sellPriceMult);
    this.money += val;
    this.researchPoints += ITEMS[item].researchValue * 0.35;
    this.totalItemsShipped++;
    dock.itemsProcessed++;

    for (const c of this.contracts) {
      if (c.status === 'active' && c.item === item) {
        c.deliveredCount++;
        if (c.deliveredCount >= c.targetCount) {
          c.status = 'completed';
          this.money += c.rewardMoney;
          this.researchPoints += c.rewardRP;
          this.contractCompletedId = c.id;
        }
      }
    }
  }

  private recordProd(item: ItemType): void {
    this.prodWindows[item].push(this.simTimeSec);
  }

  private updateMachine(
    e: MachineEntity,
    speedMult: number,
    warmup: boolean
  ): void {
    e.totalTicks++;

    if (e.status === 'broken') {
      e.brokenTicks++;
      return;
    }

    if (!e.powered && MACHINES[e.type].powerDrawKW > 0) {
      e.status = 'no_power';
      e.noPowerTicks++;
      return;
    }

    const effSpeed = speedMult * e.powerSatisfaction;

    if (e.type === 'generator') {
      e.fuel = Math.max(0, e.fuel - FIXED_DT * 0.45);
      if (e.fuel > 0) {
        e.workingTicks++;
        this.maybeTriggerWear(e, 0.2, warmup);
      } else {
        e.starvedTicks++;
      }
      return;
    }

    if (e.type === 'storage') {
      const total = this.bufferTotal(e.outputBuffer);
      e.status = total >= 40 ? 'blocked' : total > 0 ? 'working' : 'idle';
      if (e.status === 'working') e.workingTicks++;
      return;
    }

    if (e.type === 'shipping_dock') {
      e.status = 'working';
      e.workingTicks++;
      return;
    }

    if (e.type === 'extractor') {
      const res = this.resourceGrid[this.idx(e.x, e.z)];
      if (!res) {
        e.status = 'starved';
        e.starvedTicks++;
        return;
      }
      const itemMap: Record<ResourceNodeType, ItemType> = {
        iron: 'iron_ore',
        copper: 'copper_ore',
        coal: 'coal',
      };
      const outItem = itemMap[res];
      const buffered = e.outputBuffer[outItem] ?? 0;

      if (buffered > 0) {
        const front = this.getNeighbor(e.x, e.z, e.rot);
        if (
          front &&
          (MACHINES[front.type].isConveyor || front.type === 'storage')
        ) {
          if (
            this.pushItemToTarget(front, outItem, ((e.rot + 2) % 4) as Direction)
          ) {
            e.outputBuffer[outItem] = buffered - 1;
          }
        }
      }

      if ((e.outputBuffer[outItem] ?? 0) >= 6) {
        e.status = 'blocked';
        e.blockedTicks++;
        return;
      }

      e.status = 'working';
      e.workingTicks++;
      e.craftProgress += (FIXED_DT / 1.35) * effSpeed;
      if (e.craftProgress >= 1) {
        e.craftProgress -= 1;
        e.outputBuffer[outItem] = (e.outputBuffer[outItem] ?? 0) + 1;
        e.itemsProcessed++;
        this.recordProd(outItem);
        this.maybeTriggerWear(e, 0.45, warmup);
      }
      return;
    }

    if (e.type === 'smelter' || e.type === 'assembler') {
      const recipe = e.recipeId ? RECIPES[e.recipeId] : null;
      if (!recipe || recipe.machine !== e.type) {
        e.status = 'idle';
        return;
      }

      const outItem = recipe.output.item;
      const outCount = e.outputBuffer[outItem] ?? 0;
      if (outCount >= 6) {
        e.status = 'blocked';
        e.blockedTicks++;
        return;
      }

      if (e.craftProgress > 0) {
        e.status = 'working';
        e.workingTicks++;
        e.craftProgress += (FIXED_DT / recipe.craftTimeSec) * effSpeed;
        if (e.craftProgress >= 1) {
          e.craftProgress = 0;
          e.outputBuffer[outItem] =
            (e.outputBuffer[outItem] ?? 0) + recipe.output.count;
          e.itemsProcessed += recipe.output.count;
          for (let c = 0; c < recipe.output.count; c++) {
            this.recordProd(outItem);
          }
          this.maybeTriggerWear(e, 0.65, warmup);
        }
        return;
      }

      const hasAll = recipe.inputs.every(
        (ing) => (e.inputBuffer[ing.item] ?? 0) >= ing.count
      );
      if (!hasAll) {
        e.status = 'starved';
        e.starvedTicks++;
        return;
      }

      for (const ing of recipe.inputs) {
        e.inputBuffer[ing.item] = (e.inputBuffer[ing.item] ?? 0) - ing.count;
      }
      e.craftProgress = 0.001;
      e.status = 'working';
      e.workingTicks++;
      return;
    }

    if (e.type === 'inserter') {
      const backDir = ((e.rot + 2) % 4) as Direction;
      const source = this.getNeighbor(e.x, e.z, backDir);
      const target = this.getNeighbor(e.x, e.z, e.rot);

      if (!source || !target) {
        e.status = 'idle';
        return;
      }

      if (!e.inserterHolding) {
        const pulled = this.pullItemFromSource(source);
        if (!pulled) {
          e.status = 'starved';
          e.starvedTicks++;
          return;
        }
        e.inserterHolding = pulled;
        e.inserterProgress = 0.05;
        e.status = 'working';
        e.workingTicks++;
        return;
      }

      if (e.inserterProgress < 1) {
        e.inserterProgress = Math.min(
          1,
          e.inserterProgress + FIXED_DT * 2.5 * effSpeed
        );
        e.status = 'working';
        e.workingTicks++;
        return;
      }

      if (this.pushItemToTarget(target, e.inserterHolding, backDir)) {
        e.inserterHolding = null;
        e.inserterProgress = 0;
        e.itemsProcessed++;
        e.status = 'working';
        e.workingTicks++;
        this.maybeTriggerWear(e, 0.2, warmup);
      } else {
        e.status = 'blocked';
        e.blockedTicks++;
      }
    }
  }

  private maybeTriggerWear(
    e: MachineEntity,
    amount: number,
    warmup: boolean
  ): void {
    if (warmup) return;
    e.wear = Math.min(100, e.wear + amount * 0.22);
    if (e.wear > 72) {
      const prob = (e.wear - 72) * 0.00028;
      if (this.rng() < prob) {
        e.status = 'broken';
        this.breakdownEventId = e.id;
      }
    }
  }

  private getConveyorOutputDirs(e: MachineEntity): Direction[] {
    if (e.type === 'conveyor_corner') {
      const turn = e.cornerFlip ? (e.rot + 3) % 4 : (e.rot + 1) % 4;
      return [turn as Direction];
    }
    if (e.type === 'conveyor_splitter') {
      return [
        e.rot,
        ((e.rot + 1) % 4) as Direction,
        ((e.rot + 3) % 4) as Direction,
      ];
    }
    return [e.rot];
  }

  private updateConveyors(speedMult: number): void {
    const beltStep = FIXED_DT * 1.45 * speedMult;

    for (const e of this.entities) {
      if (!MACHINES[e.type].isConveyor) continue;
      e.totalTicks++;

      if (e.status === 'broken') {
        e.brokenTicks++;
        continue;
      }

      if (
        e.type === 'inspector' ||
        e.type === 'conveyor_splitter' ||
        e.type === 'conveyor_merger'
      ) {
        if (!e.powered) {
          e.status = 'no_power';
          e.noPowerTicks++;
          continue;
        }
      }

      e.beltItems.sort((a, b) => b.progress - a.progress);

      let blockedAny = false;
      for (let i = 0; i < e.beltItems.length; i++) {
        const item = e.beltItems[i];
        const maxAllowed =
          i === 0 ? 1.0 : Math.max(0.05, e.beltItems[i - 1].progress - 0.25);

        if (item.progress < maxAllowed) {
          const prevProg = item.progress;
          item.progress = Math.min(maxAllowed, item.progress + beltStep);

          if (e.type === 'inspector' && prevProg < 0.5 && item.progress >= 0.5) {
            const rp = ITEMS[item.type].researchValue;
            if (rp > 0) {
              this.researchPoints += rp * 0.5;
              e.itemsProcessed++;
            }
          }
        }

        if (item.progress >= 0.96 && i === 0) {
          const outDirs = this.getConveyorOutputDirs(e);
          let moved = false;

          if (e.type === 'conveyor_splitter') {
            for (let attempt = 0; attempt < outDirs.length; attempt++) {
              const idx = (e.splitterIndex + attempt) % outDirs.length;
              const dir = outDirs[idx];
              const next = this.getNeighbor(e.x, e.z, dir);
              if (
                next &&
                (MACHINES[next.type].isConveyor ||
                  next.type === 'shipping_dock' ||
                  next.type === 'storage')
              ) {
                if (
                  this.pushItemToTarget(
                    next,
                    item.type,
                    ((dir + 2) % 4) as Direction
                  )
                ) {
                  e.splitterIndex = (idx + 1) % outDirs.length;
                  moved = true;
                  break;
                }
              }
            }
          } else {
            const dir = outDirs[0];
            const next = this.getNeighbor(e.x, e.z, dir);
            if (
              next &&
              (MACHINES[next.type].isConveyor ||
                next.type === 'shipping_dock' ||
                next.type === 'storage')
            ) {
              moved = this.pushItemToTarget(
                next,
                item.type,
                ((dir + 2) % 4) as Direction
              );
            }
          }

          if (moved) {
            e.beltItems.shift();
            e.itemsProcessed++;
            i--;
          } else {
            blockedAny = true;
          }
        } else if (item.progress >= maxAllowed - 0.01 && i > 0) {
          blockedAny = true;
        }
      }

      if (e.beltItems.length === 0) {
        e.status = 'idle';
      } else if (blockedAny && e.beltItems.length >= 3) {
        e.status = 'blocked';
        e.blockedTicks++;
      } else {
        e.status = 'working';
        e.workingTicks++;
      }

      const congestion = Math.min(255, Math.round((e.beltItems.length / 4) * 255));
      this.congestionMap[this.idx(e.x, e.z)] = congestion;
    }
  }

  private updateDrones(droneSpeedMult: number): void {
    const brokenMachines = this.entities.filter((e) => e.status === 'broken');

    for (const drone of this.drones) {
      if (drone.targetMachineId !== null) {
        const target = this.entities.find(
          (e) => e.id === drone.targetMachineId && e.status === 'broken'
        );
        if (!target) {
          drone.targetMachineId = null;
          drone.path = [];
          drone.repairing = false;
          drone.repairProgress = 0;
          continue;
        }

        const dist = Math.hypot(target.x - drone.x, target.z - drone.z);
        if (dist < 0.25) {
          drone.repairing = true;
          drone.repairProgress += FIXED_DT * 0.55 * droneSpeedMult;
          if (drone.repairProgress >= 1) {
            target.status = 'idle';
            target.wear = 0;
            drone.targetMachineId = null;
            drone.repairing = false;
            drone.repairProgress = 0;
            drone.path = [];
          }
          continue;
        }

        if (drone.pathIndex < drone.path.length) {
          const wp = drone.path[drone.pathIndex];
          const dx = wp.x - drone.x;
          const dz = wp.z - drone.z;
          const d = Math.hypot(dx, dz);
          const move = FIXED_DT * 7.5 * droneSpeedMult;
          if (d <= move) {
            drone.x = wp.x;
            drone.z = wp.z;
            drone.pathIndex++;
          } else {
            drone.x += (dx / d) * move;
            drone.z += (dz / d) * move;
          }
        }
      } else {
        const claimed = new Set(
          this.drones
            .map((d) => d.targetMachineId)
            .filter((id): id is number => id !== null)
        );
        const candidate = brokenMachines.find((m) => !claimed.has(m.id));
        if (candidate) {
          drone.targetMachineId = candidate.id;
          drone.path = findDronePath(
            drone.x,
            drone.z,
            candidate.x,
            candidate.z,
            this.droneCostMap
          );
          drone.pathIndex = 0;
          drone.repairing = false;
          drone.repairProgress = 0;
        }
      }
    }
  }

  private updateSecondMetrics(supplyKW: number, demandKW: number): void {
    const cutoff = this.simTimeSec - 60;
    for (const item of ITEM_ORDER) {
      const arr = this.prodWindows[item];
      while (arr.length > 0 && arr[0] < cutoff) {
        arr.shift();
      }
    }

    this.powerHistory.push({
      supply: Math.round(supplyKW),
      demand: Math.round(demandKW),
    });
    if (this.powerHistory.length > 30) this.powerHistory.shift();

    for (const e of this.entities) {
      const eff =
        e.totalTicks > 0 ? Math.round((e.workingTicks / e.totalTicks) * 100) : 0;
      e.efficiencyHistory.push(eff);
      if (e.efficiencyHistory.length > 24) e.efficiencyHistory.shift();
    }

    for (const c of this.contracts) {
      if (c.status !== 'active') continue;
      c.remainingSec = Math.max(0, c.remainingSec - 1);
      if (c.remainingSec === 0) {
        c.status = 'failed';
        this.money = Math.max(0, this.money - c.penaltyMoney);
      }
    }
  }

  public buildSnapshot(): SimSnapshot {
    const productionRates = {} as Record<ItemType, number>;
    const windowScale =
      this.simTimeSec < 60 && this.simTimeSec > 2 ? 60 / this.simTimeSec : 1;
    for (const item of ITEM_ORDER) {
      productionRates[item] = Math.round(
        this.prodWindows[item].length * windowScale
      );
    }

    const activeMachines = this.entities.filter(
      (e) =>
        e.type === 'smelter' ||
        e.type === 'assembler' ||
        e.type === 'extractor' ||
        e.type === 'inserter'
    );
    let workingCount = 0;
    let bottleneckId: number | null = null;
    let bottleneckScore = 0;
    let bottleneckReason = 'Factory balanced';

    for (const m of activeMachines) {
      if (m.status === 'working') workingCount++;
      if (m.totalTicks < 20) continue;
      const starvedRatio = m.starvedTicks / m.totalTicks;
      const blockedRatio = m.blockedTicks / m.totalTicks;
      const noPowerRatio = m.noPowerTicks / m.totalTicks;
      const weight =
        m.type === 'assembler' ? 1.4 : m.type === 'smelter' ? 1.2 : 1.0;
      const score =
        Math.max(starvedRatio, blockedRatio, noPowerRatio) * weight +
        (m.status === 'broken' ? 1 : 0);

      if (score > bottleneckScore && score > 0.22) {
        bottleneckScore = score;
        bottleneckId = m.id;
        if (m.status === 'broken') {
          bottleneckReason = `${MACHINES[m.type].shortName} #${m.id} is broken`;
        } else if (noPowerRatio > 0.25) {
          bottleneckReason = `${MACHINES[m.type].shortName} #${m.id} lacks power`;
        } else if (starvedRatio >= blockedRatio) {
          bottleneckReason = `${MACHINES[m.type].shortName} #${m.id} starved (${Math.round(starvedRatio * 100)}%)`;
        } else {
          bottleneckReason = `${MACHINES[m.type].shortName} #${m.id} blocked (${Math.round(blockedRatio * 100)}%)`;
        }
      }
    }

    const lastPower = this.powerHistory[this.powerHistory.length - 1] ?? {
      supply: 0,
      demand: 0,
    };
    const satisfaction =
      lastPower.demand <= 0
        ? 1
        : Math.min(1, lastPower.supply / lastPower.demand);

    let itemCount = 0;
    for (const e of this.entities) {
      if (itemCount >= MAX_INSTANCED_ITEMS) break;

      if (e.type === 'inserter' && e.inserterHolding) {
        const angle = (e.rot * Math.PI) / 2 + (1 - e.inserterProgress) * Math.PI;
        const offset = itemCount * ITEM_STRIDE;
        this.itemRenderBuffer[offset] = e.x + 0.5 + Math.sin(angle) * 0.42;
        this.itemRenderBuffer[offset + 1] = 0.72;
        this.itemRenderBuffer[offset + 2] = e.z + 0.5 - Math.cos(angle) * 0.42;
        this.itemRenderBuffer[offset + 3] = ITEM_INDEX[e.inserterHolding];
        this.itemRenderBuffer[offset + 4] = angle;
        itemCount++;
        continue;
      }

      if (!MACHINES[e.type].isConveyor) continue;
      const outDir = this.getConveyorOutputDirs(e)[0];
      const outV = DIR_VEC[outDir];
      const inV = DIR_VEC[e.rot];

      for (const bi of e.beltItems) {
        if (itemCount >= MAX_INSTANCED_ITEMS) break;
        const offset = itemCount * ITEM_STRIDE;
        let wx = e.x + 0.5;
        let wz = e.z + 0.5;

        if (e.type === 'conveyor_corner') {
          const backV = DIR_VEC[(e.rot + 2) % 4];
          if (bi.progress < 0.5) {
            const t = bi.progress * 2;
            wx += backV.dx * 0.5 * (1 - t);
            wz += backV.dz * 0.5 * (1 - t);
          } else {
            const t = (bi.progress - 0.5) * 2;
            wx += outV.dx * 0.5 * t;
            wz += outV.dz * 0.5 * t;
          }
        } else {
          const t = bi.progress - 0.5;
          wx += inV.dx * t;
          wz += inV.dz * t;
        }

        this.itemRenderBuffer[offset] = wx;
        this.itemRenderBuffer[offset + 1] = 0.34;
        this.itemRenderBuffer[offset + 2] = wz;
        this.itemRenderBuffer[offset + 3] = ITEM_INDEX[bi.type];
        this.itemRenderBuffer[offset + 4] = e.rot * (Math.PI / 2);
        itemCount++;
      }
    }

    const clonedBuffer = this.itemRenderBuffer.slice(0, itemCount * ITEM_STRIDE);

    const metrics: SimMetrics = {
      tick: this.tickCount,
      simTimeSec: this.simTimeSec,
      dayTime: this.dayTime,
      money: Math.floor(this.money),
      researchPoints: Math.floor(this.researchPoints),
      powerSupplyKW: lastPower.supply,
      powerDemandKW: lastPower.demand,
      powerSatisfaction: satisfaction,
      utilizationPct:
        activeMachines.length > 0
          ? Math.round((workingCount / activeMachines.length) * 100)
          : 0,
      bottleneckMachineId: bottleneckId,
      bottleneckReason,
      productionRates,
      powerHistory: [...this.powerHistory],
      totalItemsShipped: this.totalItemsShipped,
      activeItemCount: itemCount,
    };

    return {
      entities: this.entities.map((e) => ({
        ...e,
        inputBuffer: { ...e.inputBuffer },
        outputBuffer: { ...e.outputBuffer },
        beltItems: e.beltItems.map((b) => ({ ...b })),
        efficiencyHistory: [...e.efficiencyHistory],
      })),
      drones: this.drones.map((d) => ({ ...d, path: [...d.path] })),
      contracts: this.contracts.map((c) => ({ ...c })),
      unlockedTechIds: Array.from(this.unlockedTechIds),
      metrics,
      congestionMap: new Uint8Array(this.congestionMap),
      powerMap: new Uint8Array(this.powerMap),
      itemRenderBuffer: clonedBuffer,
      itemRenderCount: itemCount,
      breakdownEventId: this.breakdownEventId,
      contractCompletedId: this.contractCompletedId,
    };
  }
}
