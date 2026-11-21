// Does the evals checker actually drop bad findings? The technicians rarely write a generic one, so
// this feeds the checker findings that are generic on purpose, next to specific ones, and counts.
//   npx tsx --env-file=.env scripts/check-checker.ts [public/demos/machine-shop.json]
import { readFileSync } from 'node:fs';
import { checkerQuestion, KEEP_AT, plantSheet } from '../server/advocate';
import { decide, type Question } from '../server/gemini';
import { evaluate } from '../src/engines/versions';
import type { Project } from '../src/store';

const file = process.argv[2] ?? 'public/demos/machine-shop.json';
const project = JSON.parse(readFileSync(file, 'utf8')) as Project;
const spec = project.versions[project.versions.length - 1].spec;
const ev = evaluate(spec, 10);
if (!ev.ok) throw new Error('the demo layout must be valid');
const sheet = plantSheet(spec, ev.metrics, ev.routes, project.requirements);
const first = spec.stations.find((s) => s.powerKw > 0) ?? spec.stations[0];
const about = `machine ${first.id} (${first.name ?? first.type})`;

// Advice that is true of any factory. Each names the machine, so naming one is not enough to pass.
const generic = [
  'Operator training. Operators should be properly trained before using this machine. Action: Ensure all operators complete training.',
  'Regular maintenance. Machines need regular maintenance to stay reliable. Action: Consider setting up a preventive maintenance schedule.',
  'Safety signage. Safety signs help keep workers aware of hazards. Action: Install appropriate signage around the machine.',
  'Electrical safety. Electrical installations should comply with local codes. Action: Ensure a qualified electrician inspects the wiring.',
  'Housekeeping. A clean workplace is a safe workplace. Action: Keep the area around the machine tidy.',
  'Emergency plan. Every facility should have an emergency plan. Action: Develop and communicate an evacuation procedure.',
  'Efficiency. The layout could be optimised to improve efficiency. Action: Consider reviewing the workflow for improvements.',
  'Quality. Quality control is important for customer satisfaction. Action: Ensure parts are inspected regularly.',
  'Protective equipment. Workers should wear appropriate protective equipment. Action: Provide PPE to all staff.',
  'Spare parts. It may be helpful to keep spare parts on hand. Action: Consider stocking common spares.',
];

// Findings that quote this plant: each built from a real machine and a real number on the sheet.
const powered = spec.stations.filter((s) => s.powerKw > 0);
const far = [...ev.routes.power].sort((a, b) => b.length - a.length)[0];
const farStation = spec.stations.find((s) => s.id === far?.id) ?? first;
const wet = spec.stations.find((s) => s.needsWater) ?? first;
const load = spec.stations.reduce((t, s) => t + s.powerKw, 0);
const specific = [
  `Feeder undersized for run. ${farStation.id} draws ${farStation.powerKw} kW at the end of a ${far?.length.toFixed(0)} m run from the supply, the longest on the floor. Action: Size its feeder for volt drop under 3% at that length.`,
  `No main service rating. ${load.toFixed(0)} kW is connected across ${powered.length} machines and the sheet states no service size. Action: Specify a main service rated for ${Math.ceil((load * 1.25) / 10) * 10} kW.`,
  `No drain at the wet process. ${wet.id} takes water and no drain, sump or separator is on the sheet. Action: Add a floor drain with an oil-water separator beside ${wet.id}.`,
  `No compressed air. The sheet lists no compressor and ${first.id} (${first.name ?? first.type}) needs shop air to run. Action: Add a screw compressor with dryer sized for the machines that use air.`,
  `Output short of demand. The simulator measures ${ev.metrics.sim.unitsPerHour.median.toFixed(1)} an hour against ${spec.demandPerHour} demanded, with ${ev.metrics.sim.bottleneck.name} as the bottleneck. Action: Add one ${ev.metrics.sim.bottleneck.name} station.`,
];

const questions: Record<string, Question> = {};
generic.forEach((g, i) => (questions[`g${i}`] = checkerQuestion(about, g)));
specific.forEach((g, i) => (questions[`s${i}`] = checkerQuestion('the plant', g)));
const out = await decide(sheet, questions);
const score = (k: string) => {
  const a = out.answers[k];
  return a?.type === 'noul' ? a.noul : NaN;
};
const g = generic.map((text, i) => ({ text: text.split('.')[0], p: score(`g${i}`) }));
const sp = specific.map((text, i) => ({ text: text.split('.')[0], p: score(`s${i}`) }));
const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(4);
console.log(`Checker on ${project.name} (keeps a finding at ${pct(KEEP_AT).trim()} or above)\n`);
console.log('Generic on purpose: should be dropped');
for (const r of g) console.log(`  ${pct(r.p)}  ${r.p < KEEP_AT ? 'dropped' : 'KEPT   '}  ${r.text}`);
console.log('\nSpecific to this plant: should be kept');
for (const r of sp) console.log(`  ${pct(r.p)}  ${r.p >= KEEP_AT ? 'kept   ' : 'DROPPED'}  ${r.text}`);
const dropped = g.filter((r) => r.p < KEEP_AT).length;
const keptOk = sp.filter((r) => r.p >= KEEP_AT).length;
console.log(`\nDropped ${dropped} of ${g.length} generic findings; kept ${keptOk} of ${sp.length} specific ones. (${out.ms} ms)`);
