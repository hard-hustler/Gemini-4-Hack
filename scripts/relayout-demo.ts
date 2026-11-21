// Re-lay a saved demo with the current placer and write it back.
//   npx tsx scripts/relayout-demo.ts public/demos/car-plant.json
import { readFileSync, writeFileSync } from 'node:fs';
import { buildLayout } from '../src/engines/place';
import { evaluate, makeVersion } from '../src/engines/versions';
import type { Project } from '../src/store';

const file = process.argv[2];
if (!file) throw new Error('usage: tsx scripts/relayout-demo.ts <demo.json>');
const project = JSON.parse(readFileSync(file, 'utf8')) as Project;
const placed = buildLayout(project.requirements, project.equipment, { polish: false });
const ev = evaluate(placed.spec, placed.spec.stations.length > 40 ? 10 : 30);
if (!ev.ok) throw new Error('layout is not valid: ' + ev.errors.map((e) => e.message).join('; '));
const v1 = makeVersion(placed.spec, ev.metrics, null, 1, 'First layout');
writeFileSync(file, JSON.stringify({ ...project, versions: [v1], currentId: v1.id }));
const xs = placed.spec.stations.map((s) => s.x);
const ys = placed.spec.stations.map((s) => s.y);
console.log(file, placed.spec.stations.length, 'stations on', placed.spec.floor.width, 'x', placed.spec.floor.depth, '| spans x', Math.min(...xs), '-', Math.max(...xs), 'y', Math.min(...ys), '-', Math.max(...ys));
console.log('units/h', ev.metrics.sim.unitsPerHour.median.toFixed(1), 'of', placed.spec.demandPerHour, '| lead', (ev.metrics.sim.leadTimeSec.median / 60).toFixed(0), 'min | build $' + Math.round(ev.metrics.cost.buildCost).toLocaleString(), '| conveyor m', Math.round(ev.routes.totals.pathM));
