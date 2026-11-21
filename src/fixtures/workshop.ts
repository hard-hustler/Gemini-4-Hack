import type { FactorySpec } from '../spec';

// A small light-assembly workshop, laid out badly on purpose: the flow zig-zags
// across the floor so the single forklift is the constraint. Good v1 to improve on.
export const workshop: FactorySpec = {
  name: 'Light assembly workshop',
  floor: { width: 20, depth: 14, cellSize: 0.5 },
  docks: [
    { wall: 'W', offset: 3, kind: 'in' },
    { wall: 'W', offset: 11, kind: 'out' },
  ],
  utilityEntry: { power: { x: 0, y: 7 }, water: { x: 20, y: 13 } },
  stations: [
    { id: 'rack1', type: 'storage', x: 16, y: 1, w: 3, d: 1.5, rot: 0, cycleTimeSec: 20, operators: 0, powerKw: 0, needsWater: false, price: 450 },
    { id: 'prep1', type: 'prep', x: 2, y: 5.5, w: 2, d: 1, rot: 0, cycleTimeSec: 80, operators: 1, powerKw: 1.5, needsWater: true, price: 600 },
    { id: 'asm1', type: 'assembly', x: 14, y: 5, w: 2.5, d: 1, rot: 0, cycleTimeSec: 200, operators: 1, powerKw: 0.8, needsWater: false, price: 700 },
    { id: 'asm2', type: 'assembly', x: 14, y: 8, w: 2.5, d: 1, rot: 0, cycleTimeSec: 200, operators: 1, powerKw: 0.8, needsWater: false, price: 700 },
    { id: 'test1', type: 'test', x: 3, y: 1, w: 2, d: 1, rot: 0, cycleTimeSec: 90, operators: 1, powerKw: 2, needsWater: false, price: 1200 },
    { id: 'pack1', type: 'pack', x: 15, y: 11.5, w: 2.5, d: 1.5, rot: 0, cycleTimeSec: 70, operators: 1, powerKw: 0.5, needsWater: false, price: 500 },
  ],
  routing: ['storage', 'prep', 'assembly', 'test', 'pack'],
  demandPerHour: 30,
  forklifts: 1,
  costs: { labourPerHour: 28, electricityPerKwh: 0.16, powerRunPerM: 45, waterRunPerM: 70 },
};
