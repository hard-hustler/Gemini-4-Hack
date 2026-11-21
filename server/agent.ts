// Managed Agents job: run the layout search many times in parallel inside a remote sandbox.
// The sandbox clones this (public) repo, so it runs the exact same engines we run here.
// Its answer is treated as untrusted: every returned op list is re-validated and re-simulated locally.

import { objective } from '../src/engines/search';
import { validate } from '../src/engines/validate';
import { compare, evaluate } from '../src/engines/versions';
import { applyOps, type EditOp, type FactorySpec } from '../src/spec';
import { GeminiError } from './gemini';
import type { Candidate } from './optimize';

const AGENT = 'antigravity-preview-09-2026';
const REPO = process.env.DRYRUN_REPO ?? 'https://github.com/hard-hustler/Gemini-4-Hack';
const RUNS = 8;
const ITERS = 500;

export async function deepSearch(spec: FactorySpec) {
  const started = Date.now();
  const baseEv = evaluate(spec);
  if (!baseEv.ok) throw new Error('The current layout is not valid: ' + baseEv.errors.map((e) => e.message).join('; '));

  const input = `In /workspace/dryrun there is a Node project. /workspace/spec.json is a factory layout.
Do exactly this, in one shell session:
1. cd /workspace/dryrun && npm ci --silent --no-audit --no-fund
2. Start ${RUNS} searches in parallel as background jobs, one per seed 1..${RUNS}:
   for s in $(seq 1 ${RUNS}); do npx tsx scripts/search.ts /workspace/spec.json --seed $s --iters ${ITERS} > /tmp/out_$s.json 2>/tmp/err_$s.txt & done; wait
3. cat /tmp/out_*.json
Reply with only the raw output of step 3 (one JSON object per line), no commentary and no code fences. If a step fails, reply with the error text instead.`;

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '', 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(285_000),
    body: JSON.stringify({
      agent: AGENT,
      input,
      environment: {
        type: 'remote',
        sources: [
          { type: 'repository', source: REPO, target: '/workspace/dryrun' },
          { type: 'inline', content: JSON.stringify(spec), target: '/workspace/spec.json' },
        ],
      },
      agent_config: { type: 'antigravity', model: 'gemini-4-hydrogen' },
    }),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) throw new GeminiError(res.status, String(json?.error?.code ?? res.status), String(json?.error?.message ?? 'Managed agent call failed'));
  const text: string = (json.steps ?? [])
    .filter((s: any) => s.type === 'model_output')
    .flatMap((s: any) => s.content ?? [])
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n');

  // Parse whatever JSON lines came back; ignore anything else.
  const runs: { seed: number; ops: EditOp[] }[] = [];
  for (const line of text.split('\n')) {
    const at = line.indexOf('{');
    if (at < 0) continue;
    try {
      const o = JSON.parse(line.slice(at));
      if (Array.isArray(o.ops)) runs.push({ seed: Number(o.seed), ops: o.ops });
    } catch {
      /* not a result line */
    }
  }
  if (!runs.length) throw new GeminiError(502, 'agent_no_results', `Agent returned no search results: ${text.slice(0, 300)}`);

  const candidates: Candidate[] = await Promise.all(
    runs.map(async (r): Promise<Candidate> => {
      const c: Candidate = { name: `Sandbox search, seed ${r.seed}`, reason: `Best layout from a ${ITERS}-step seeded search run in the agent sandbox.`, ops: r.ops, status: 'invalid' };
      try {
        const next = applyOps(spec, r.ops);
        const errs = validate(next);
        if (errs.length) {
          c.errors = errs.map((e) => e.message);
          return c;
        }
        const ev = evaluate(next);
        if (!ev.ok) return c;
        c.spec = next;
        c.status = 'evaluated';
        c.score = objective(baseEv.metrics, ev.metrics);
        const rows = Object.fromEntries(compare(baseEv.metrics, ev.metrics).map((x) => [x.key, x.delta]));
        c.deltas = { uph: rows.uph, leadMin: rows.lead, costPerUnit: rows.cpu, buildCost: rows.build, forkliftM: rows.fork };
      } catch (e) {
        c.errors = [(e as Error).message];
      }
      return c;
    }),
  );
  candidates.sort((a, b) => (a.score ?? 9) - (b.score ?? 9));
  const valid = candidates.filter((c) => c.status === 'evaluated').length;
  const total = Date.now() - started;
  return {
    explanation: `A managed agent ran ${RUNS} seeded searches in a remote sandbox and ${runs.length} came back. Each was re-checked and re-simulated here. The best three:`,
    candidates: candidates.slice(0, 3),
    stats: { proposed: runs.length, firstPassValid: valid, validAfterRepair: valid, tokens: json.usage?.total_tokens, ms: { propose: total, repair: 0, gate: 0, simulate: 0, total } },
  };
}
