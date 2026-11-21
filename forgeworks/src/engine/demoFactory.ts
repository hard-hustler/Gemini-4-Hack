import { GRID_SIZE } from '../data/catalog';
import { EntityPlacement, ResourceTile, SerializedFactory } from '../types/factory';

export function createResourceMap(): ResourceTile[] {
  const tiles: ResourceTile[] = [];
  const seen = new Set<string>();
  const addPatch = (
    cx: number,
    cz: number,
    radius: number,
    type: ResourceTile['type']
  ) => {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz <= radius * radius + 0.5) {
          const x = cx + dx;
          const z = cz + dz;
          const key = `${x},${z}`;
          if (
            x >= 1 &&
            x < GRID_SIZE - 1 &&
            z >= 1 &&
            z < GRID_SIZE - 1 &&
            !seen.has(key)
          ) {
            seen.add(key);
            tiles.push({ x, z, type, richness: 1 });
          }
        }
      }
    }
  };

  // Iron patches
  addPatch(18, 28, 2, 'iron');
  addPatch(18, 37, 2, 'iron');
  addPatch(46, 16, 2, 'iron');
  addPatch(12, 14, 2, 'iron');

  // Copper patches
  addPatch(24, 44, 2, 'copper');
  addPatch(48, 42, 2, 'copper');
  addPatch(30, 14, 2, 'copper');

  // Coal patches
  addPatch(16, 20, 2, 'coal');
  addPatch(50, 28, 2, 'coal');
  addPatch(34, 52, 2, 'coal');

  return tiles;
}

export function createDemoFactory(): SerializedFactory {
  const resources = createResourceMap();
  const entities: EntityPlacement[] = [];

  const put = (
    x: number,
    z: number,
    type: EntityPlacement['type'],
    rot: EntityPlacement['rot'] = 1,
    recipeId: EntityPlacement['recipeId'] = null,
    cornerFlip = false
  ) => {
    entities.push({ x, z, type, rot, recipeId, cornerFlip });
  };

  const beltLine = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    rot: 0 | 1 | 2 | 3
  ) => {
    const dx = Math.sign(x2 - x1);
    const dz = Math.sign(z2 - z1);
    let x = x1;
    let z = z1;
    while (true) {
      put(x, z, 'conveyor_straight', rot);
      if (x === x2 && z === z2) break;
      x += dx;
      z += dz;
    }
  };

  // --- Power Station (North-West): 3 Coal Extractors -> 6 Power Generators (1,560 kW) ---
  put(15, 19, 'extractor', 0);
  put(15, 18, 'conveyor_straight', 0);
  put(15, 17, 'conveyor_corner', 0, null, false); // North -> East
  beltLine(16, 17, 19, 17, 1);
  put(20, 17, 'conveyor_splitter', 1);
  put(21, 17, 'inserter', 1);
  put(22, 17, 'generator', 1);
  put(20, 16, 'conveyor_corner', 0, null, false); // North -> East
  put(21, 16, 'inserter', 1);
  put(22, 16, 'generator', 1);

  put(16, 20, 'extractor', 1);
  put(16, 22, 'extractor', 1);
  beltLine(17, 20, 19, 20, 1);
  put(20, 20, 'conveyor_splitter', 1);
  put(21, 20, 'inserter', 1);
  put(22, 20, 'generator', 1);
  put(20, 19, 'conveyor_straight', 0);
  put(20, 18, 'conveyor_corner', 0, null, false); // North -> East
  put(21, 18, 'inserter', 1);
  put(22, 18, 'generator', 1);

  beltLine(17, 22, 19, 22, 1);
  put(20, 22, 'conveyor_splitter', 1);
  put(21, 22, 'inserter', 1);
  put(22, 22, 'generator', 1);
  put(20, 23, 'conveyor_straight', 2);
  put(20, 24, 'conveyor_corner', 2, null, true); // South -> East
  put(21, 24, 'inserter', 1);
  put(22, 24, 'generator', 1);

  // --- Line D (North): Iron Ore (18,26) -> Smelter -> Robot Part Assembler (39,32) ---
  put(18, 26, 'extractor', 1);
  beltLine(19, 26, 22, 26, 1);
  put(23, 26, 'inserter', 1);
  put(24, 26, 'smelter', 1, 'iron_plate');
  put(25, 26, 'inserter', 1);
  beltLine(26, 26, 38, 26, 1);
  put(39, 26, 'conveyor_corner', 1, null, false); // East -> South
  beltLine(39, 27, 39, 30, 2);
  put(39, 31, 'inserter', 2); // Feeds Iron Plates into Robot Part Assembler from North

  // --- Line A: Iron Ore (18,28 & 18,29) -> Merger -> Smelter -> Gear Assembler -> Circuit Assembler ---
  put(18, 28, 'extractor', 1);
  put(18, 29, 'extractor', 1);
  beltLine(19, 28, 20, 28, 1);
  beltLine(19, 29, 20, 29, 1);
  put(21, 29, 'conveyor_corner', 1, null, true); // East -> North into merger
  put(21, 28, 'conveyor_merger', 1);
  put(22, 28, 'conveyor_straight', 1);
  put(23, 28, 'inserter', 1);
  put(24, 28, 'smelter', 1, 'iron_plate');
  put(25, 28, 'inserter', 1);
  beltLine(26, 28, 28, 28, 1);
  put(29, 28, 'inserter', 1);
  put(30, 28, 'assembler', 1, 'gear');
  put(31, 28, 'inserter', 1);
  beltLine(32, 28, 33, 28, 1);
  put(34, 28, 'conveyor_corner', 1, null, false); // East -> South
  put(34, 29, 'conveyor_straight', 2);
  put(34, 30, 'conveyor_straight', 2);
  put(34, 31, 'inserter', 2); // Feeds Gears into Circuit Assembler from North

  // --- Line B (West): Iron Ore (18,36 & 18,38) -> Merger -> Smelter -> Splitter -> Storage & Plate Dock ---
  put(18, 36, 'extractor', 1);
  put(18, 38, 'extractor', 1);
  beltLine(19, 36, 21, 36, 1);
  beltLine(19, 38, 21, 38, 1);
  put(22, 38, 'conveyor_corner', 1, null, true); // East -> North
  put(22, 37, 'conveyor_straight', 0);
  put(22, 36, 'conveyor_merger', 1);
  put(23, 36, 'inserter', 1);
  put(24, 36, 'smelter', 1, 'iron_plate');
  put(25, 36, 'inserter', 1);
  beltLine(26, 36, 28, 36, 1);
  put(29, 36, 'conveyor_splitter', 1);
  // Splitter East -> Storage Crate buffer
  put(30, 36, 'conveyor_straight', 1);
  put(31, 36, 'inserter', 1);
  put(32, 36, 'storage', 1);
  // Splitter South -> Iron Plate Shipping Dock
  put(29, 37, 'conveyor_straight', 2);
  put(29, 38, 'inserter', 2);
  put(29, 39, 'shipping_dock', 2);

  // --- Line C (South): Copper Ore (24,44 & 24,43) -> Copper Wire Smelters -> Circuit Assembler + Dock ---
  put(24, 44, 'extractor', 1);
  beltLine(25, 44, 27, 44, 1);
  put(28, 44, 'inserter', 1);
  put(29, 44, 'smelter', 1, 'copper_wire');
  put(30, 44, 'inserter', 1);
  beltLine(31, 44, 33, 44, 1);
  put(34, 44, 'conveyor_corner', 1, null, true); // East -> North
  beltLine(34, 43, 34, 34, 0);
  put(34, 33, 'inserter', 0); // Feeds Copper Wire into Circuit Assembler from South

  // Secondary Copper Wire line -> Shipping Dock
  put(24, 43, 'extractor', 1);
  put(25, 43, 'conveyor_straight', 1);
  put(26, 43, 'inserter', 1);
  put(27, 43, 'smelter', 1, 'copper_wire');
  put(28, 43, 'inserter', 1);
  beltLine(29, 43, 31, 43, 1);
  put(32, 43, 'conveyor_corner', 1, null, true); // East -> North
  put(32, 42, 'conveyor_straight', 0);
  put(32, 41, 'inserter', 0);
  put(32, 40, 'shipping_dock', 0);

  // --- Circuit Assembler (34,32) -> Splitter -> Robot Part Assembler (39,32) + Circuit Dock ---
  put(34, 32, 'assembler', 1, 'circuit');
  put(35, 32, 'inserter', 1);
  put(36, 32, 'conveyor_splitter', 1);
  // Splitter East -> Robot Part Assembler -> Quality Inspector -> Shipping Dock
  put(37, 32, 'conveyor_straight', 1);
  put(38, 32, 'inserter', 1);
  put(39, 32, 'assembler', 1, 'robot_part');
  put(40, 32, 'inserter', 1);
  put(41, 32, 'conveyor_straight', 1);
  put(42, 32, 'inspector', 1);
  put(43, 32, 'conveyor_straight', 1);
  put(44, 32, 'inserter', 1);
  put(45, 32, 'shipping_dock', 1);

  // Splitter South -> Direct Circuit Export via Shipping Dock
  put(36, 33, 'conveyor_straight', 2);
  put(36, 34, 'conveyor_straight', 2);
  put(36, 35, 'inserter', 2);
  put(36, 36, 'shipping_dock', 2);

  // --- Power Poles placed cleanly on open aisles (zero overlap with belts) ---
  put(18, 21, 'power_pole', 0);
  put(24, 17, 'power_pole', 0);
  put(24, 21, 'power_pole', 0);
  put(21, 25, 'power_pole', 0);
  put(27, 25, 'power_pole', 0);
  put(33, 25, 'power_pole', 0);
  put(38, 25, 'power_pole', 0);
  put(43, 29, 'power_pole', 0);
  put(21, 32, 'power_pole', 0);
  put(20, 35, 'power_pole', 0);
  put(26, 34, 'power_pole', 0);
  put(32, 34, 'power_pole', 0);
  put(38, 34, 'power_pole', 0);
  put(26, 41, 'power_pole', 0);
  put(31, 41, 'power_pole', 0);

  const map = new Map<string, EntityPlacement>();
  for (const e of entities) {
    map.set(`${e.x},${e.z}`, e);
  }

  return {
    version: 1,
    seed: 133742,
    resources,
    entities: Array.from(map.values()),
    money: 1200,
    researchPoints: 35,
    unlockedTechIds: ['tier1_basics', 'tier2_logistics'],
    dayTime: 0.34,
    simTimeSec: 0,
  };
}
