// CLI for the layout search, so it can run anywhere Node does (including a managed-agent sandbox).
//   npx tsx scripts/search.ts spec.json --seed 3 --iters 400
// Prints one JSON line: { seed, score, ops, tried, valid, accepted }.
import { readFileSync } from 'node:fs';
import { localSearch } from '../src/engines/search';
import type { FactorySpec } from '../src/spec';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const file = args.find((a) => !a.startsWith('--') && a.endsWith('.json'));
if (!file) {
  console.error('usage: tsx scripts/search.ts <spec.json> [--seed N] [--iters N]');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(file, 'utf8')) as FactorySpec;
const seed = flag('seed', 1);
const { spec: _best, ...out } = localSearch(spec, { seed, iters: flag('iters', 300) });
console.log(JSON.stringify({ seed, ...out }));
