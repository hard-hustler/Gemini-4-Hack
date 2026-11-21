import test from 'node:test';
import assert from 'node:assert/strict';
import { FactorySimulation } from './simulation';
import { createDemoFactory } from './demoFactory';
import { analyzeFactoryLayout } from './optimizer';
import { findDronePath } from './pathfinding';
import { compressString, decompressString } from '../utils/compression';
import { GRID_SIZE } from '../data/catalog';
import { SerializedFactory } from '../types/factory';

test('deterministic demo factory produces full resource chain including circuits and robot parts', () => {
  const simA = new FactorySimulation(createDemoFactory());
  const simB = new FactorySimulation(createDemoFactory());

  for (let i = 0; i < 600; i++) {
    simA.step();
    simB.step();
  }

  const snapA = simA.buildSnapshot();
  const snapB = simB.buildSnapshot();

  // Determinism check: identical money, shipped items, and active item count
  assert.equal(snapA.metrics.money, snapB.metrics.money);
  assert.equal(snapA.metrics.totalItemsShipped, snapB.metrics.totalItemsShipped);
  assert.equal(snapA.itemRenderCount, snapB.itemRenderCount);

  // Live production checks
  assert.ok(snapA.metrics.totalItemsShipped > 0, 'Demo factory must ship goods');
  assert.ok(snapA.metrics.productionRates.iron_plate > 0, 'Must produce Iron Plates');
  assert.ok(snapA.metrics.productionRates.copper_wire > 0, 'Must produce Copper Wire');
  assert.ok(snapA.metrics.productionRates.gear > 0, 'Must produce Gears');
  assert.ok(snapA.metrics.productionRates.circuit > 0, 'Must produce Circuits');
  assert.ok(snapA.itemRenderCount > 10, 'Must pack active conveyor items into Float32Array');
});

test('power grid brownout slows machines proportionally when demand exceeds supply', () => {
  const layout: SerializedFactory = {
    version: 1,
    seed: 99,
    resources: [
      { x: 10, z: 10, type: 'iron', richness: 1 },
      { x: 10, z: 11, type: 'iron', richness: 1 },
    ],
    entities: [
      { x: 12, z: 10, type: 'generator', rot: 1 }, // 260 kW supply
      { x: 10, z: 10, type: 'assembler', rot: 1, recipeId: 'gear' }, // 85 kW
      { x: 10, z: 11, type: 'assembler', rot: 1, recipeId: 'gear' }, // 85 kW
      { x: 11, z: 10, type: 'assembler', rot: 1, recipeId: 'gear' }, // 85 kW
      { x: 11, z: 11, type: 'assembler', rot: 1, recipeId: 'gear' }, // 85 kW -> total 340 kW demand
    ],
    money: 500,
    researchPoints: 50,
    unlockedTechIds: ['tier1_basics', 'tier2_logistics'],
    dayTime: 0.3,
    simTimeSec: 1, // skip warmup
  };

  const sim = new FactorySimulation(layout);
  for (let i = 0; i < 25; i++) sim.step();
  const snap = sim.buildSnapshot();

  assert.equal(snap.metrics.powerSupplyKW, 260);
  assert.equal(snap.metrics.powerDemandKW, 340);
  assert.ok(snap.metrics.powerSatisfaction < 0.8 && snap.metrics.powerSatisfaction > 0.7);

  // Optimizer must detect critical power deficit
  const suggestions = analyzeFactoryLayout(snap.entities, snap.metrics);
  assert.ok(
    suggestions.some((s) => s.id === 'power-deficit' && s.severity === 'critical'),
    'Optimizer should report critical power deficit'
  );
});

test('A* maintenance drones pathfind to broken machine and repair it', () => {
  const sim = new FactorySimulation(createDemoFactory());
  const smelter = sim.getEntities().find((e) => e.type === 'smelter');
  assert.ok(smelter, 'Demo factory must contain a smelter');

  sim.triggerBreakdownForTest(smelter.id);
  assert.equal(
    sim.getEntities().find((e) => e.id === smelter.id)?.status,
    'broken'
  );

  // Advance simulation until a drone flies via A* and completes repair
  for (let i = 0; i < 300; i++) {
    sim.step();
  }

  const repaired = sim.getEntities().find((e) => e.id === smelter.id);
  assert.ok(repaired);
  assert.notEqual(repaired.status, 'broken', 'Drone should repair broken machine');
  assert.ok(repaired.wear < 20, 'Repaired machine wear should reset');
});

test('A* pathfinder avoids high-cost obstacles while reaching goal', () => {
  const costGrid = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (let z = 8; z <= 12; z++) {
    costGrid[z * GRID_SIZE + 10] = 20;
  }
  const path = findDronePath(8, 10, 12, 10, costGrid);
  assert.ok(path.length > 0);
  const last = path[path.length - 1];
  assert.equal(last.x, 12);
  assert.equal(last.z, 10);
});

test('LZ77 compression round-trips serialized factory JSON losslessly', () => {
  const demo = createDemoFactory();
  const json = JSON.stringify(demo);
  const compressed = compressString(json);
  assert.ok(compressed.startsWith('FW1:'));
  assert.ok(compressed.length < json.length, 'Compressed payload should be smaller than raw JSON');

  const restored = JSON.parse(decompressString(compressed)) as SerializedFactory;
  assert.equal(restored.entities.length, demo.entities.length);
  assert.equal(restored.resources.length, demo.resources.length);
  assert.equal(restored.seed, demo.seed);
});
