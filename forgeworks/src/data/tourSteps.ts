import { ItemType } from '../types/factory';

export interface TourStep {
  id: string;
  shortLabel: string;
  stepNumber: string;
  title: string;
  summary: string;
  flow: readonly string[];
  metricItem?: ItemType;
  metricLabel?: string;
  cameraPos: readonly [number, number, number];
  cameraTarget: readonly [number, number, number];
  /** Open concrete aisle position [x, z] where the animated 3D Plant Engineer stands */
  guidePos: readonly [number, number];
  /** Target point [x, z] the engineer gestures toward while explaining */
  guideLookAt: readonly [number, number];
  highlightTiles: ReadonlyArray<readonly [number, number]>;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'overview',
    shortLabel: 'Overview',
    stepNumber: 'Factory Overview',
    title: 'End-to-End Automated Robotics Factory',
    summary:
      'Raw coal, iron, and copper enter on the left, move through furnaces and CNC machines in the center, and ship out as finished Robot Parts on the right.',
    flow: [
      'Mining & Power',
      'Blast Smelting',
      'CNC Machining',
      'Assembly',
      'QC & Shipping',
    ],
    cameraPos: [46.5, 20.5, 50.5],
    cameraTarget: [30.5, 0.6, 31],
    guidePos: [28.4, 35.8],
    guideLookAt: [31.0, 31.0],
    highlightTiles: [],
  },
  {
    id: 'power',
    shortLabel: '1. Power',
    stepNumber: 'Step 1 of 5 · Power Generation',
    title: 'Coal Turbine Power Plant',
    summary:
      'Mining rigs dig coal and feed turbine generators. Overhead cables carry high-voltage power across the factory floor so every machine runs at full speed.',
    flow: [
      'Coal Vein',
      'Rotary Drill',
      'Coal Belt',
      'Turbine Generators',
      'Overhead Grid',
    ],
    metricItem: 'coal',
    metricLabel: 'Coal/min',
    cameraPos: [29.4, 6.8, 27.6],
    cameraTarget: [22.2, 0.7, 20.6],
    guidePos: [24.6, 21.8],
    guideLookAt: [22.5, 20.5],
    highlightTiles: [
      [22, 16],
      [22, 17],
      [22, 18],
      [22, 20],
      [22, 22],
      [22, 24],
    ],
  },
  {
    id: 'mining',
    shortLabel: '2. Mining',
    stepNumber: 'Step 2 of 5 · Raw Extraction',
    title: 'Iron & Copper Ore Extraction',
    summary:
      'Heavy quarry drills bore into underground Iron and Copper seams, dropping raw ore chunks onto roller conveyors that merge into the main production lines.',
    flow: ['Ore Deposit', 'Rotary Drill Rig', 'Roller Conveyor', 'Line Merger'],
    metricItem: 'iron_ore',
    metricLabel: 'Iron Ore/min',
    cameraPos: [12.4, 5.6, 34.4],
    cameraTarget: [18.8, 0.7, 28.8],
    guidePos: [16.8, 30.2],
    guideLookAt: [18.8, 28.5],
    highlightTiles: [
      [18, 26],
      [18, 28],
      [18, 29],
    ],
  },
  {
    id: 'smelting',
    shortLabel: '3. Smelting',
    stepNumber: 'Step 3 of 5 · Metal Refining',
    title: 'High-Temperature Blast Furnaces',
    summary:
      'Articulated robotic arms pick raw Iron Ore off the belt and load glowing blast furnaces, which refine the metal into flat Steel Plates for machining.',
    flow: ['Iron Ore', 'Robotic Arm', 'Blast Smelter', 'Iron Plate'],
    metricItem: 'iron_plate',
    metricLabel: 'Iron Plates/min',
    cameraPos: [28.8, 5.0, 34.8],
    cameraTarget: [24.2, 0.7, 28.4],
    guidePos: [23.2, 30.6],
    guideLookAt: [24.5, 28.0],
    highlightTiles: [
      [24, 26],
      [24, 28],
      [24, 36],
    ],
  },
  {
    id: 'machining',
    shortLabel: '4. Assembly',
    stepNumber: 'Step 4 of 5 · Machining & Electronics',
    title: 'CNC Gears & Logic Circuit Assembly',
    summary:
      'Enclosed 5-axis CNC machining centers cut Steel Plates into precision Gears. Down the line, Gears meet spooled Copper Wire inside the electronics cell to build Logic Circuits.',
    flow: [
      'Iron Plate → Gear',
      'Gear + Copper Wire',
      'CNC Assembler',
      'Logic Circuit',
    ],
    metricItem: 'circuit',
    metricLabel: 'Circuits/min',
    cameraPos: [30.4, 6.4, 38.6],
    cameraTarget: [32.8, 0.7, 30.8],
    guidePos: [31.2, 32.6],
    guideLookAt: [34.2, 32.2],
    highlightTiles: [
      [30, 28],
      [34, 32],
    ],
  },
  {
    id: 'shipping',
    shortLabel: '5. QC & Ship',
    stepNumber: 'Step 5 of 5 · Final Robotics & Export',
    title: 'Robot Assembly, Laser Inspection & Shipping',
    summary:
      'The final CNC cell builds complete Robot Parts from Circuits and Plates. Every unit passes through a laser Quality Inspector before Shipping Docks export it for cash.',
    flow: [
      'Circuit + Plate',
      'Robot Part',
      'Laser Inspector',
      'Shipping Dock ($ + RP)',
    ],
    metricItem: 'robot_part',
    metricLabel: 'Robot Parts/min',
    cameraPos: [48.2, 6.0, 38.8],
    cameraTarget: [42.0, 0.7, 32.6],
    guidePos: [43.8, 34.4],
    guideLookAt: [42.2, 32.5],
    highlightTiles: [
      [39, 32],
      [42, 32],
      [45, 32],
    ],
  },
];
