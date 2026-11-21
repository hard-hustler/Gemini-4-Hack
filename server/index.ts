// Small Node proxy for model calls. The key stays server-side in GEMINI_API_KEY.
import express, { type Request, type Response } from 'express';
import type { AdvocateFinding, Emit, Requirements } from '../src/contracts';
import type { FactorySpec } from '../src/spec';
import { GeminiError, MODELS, type Block } from './gemini';
import { isCharacterRole, proposeAdvocateFix, runAdvocateAudit, synthesizeAdvocateSpeech } from './advocate';
import { deepSearch } from './agent';
import { improveToGoal, type Goal } from './improve';
import { optimise } from './optimize';
import { layoutProject, planProject } from './harness';
import { convertListing } from './recipes';
import { design, inspect, revise, scout, type StepBrief } from './sculpt';
import { priceEquipment, searchListings } from './shop';
import { editPlan, PipelineError, readPlan, scoreElements } from './pipeline';

const app = express();
app.use(express.json({ limit: '30mb' }));

function mediaBlock(mimeType: string, data: string): Block {
  const type = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'document';
  // browsers report e.g. "audio/webm;codecs=opus"; the API wants the bare type
  return { type, data, mime_type: mimeType.split(';')[0] };
}

function fail(res: Response, e: unknown) {
  const extra = e as { lines?: string[]; trace?: unknown[] };
  if (!(e instanceof PipelineError) && !(e instanceof GeminiError) && (extra?.lines || extra?.trace)) {
    return void res.status(422).json({ error: (e as Error).message, errors: (extra.lines ?? []).map((message) => ({ message })), trace: extra.trace ?? [] });
  }
  if (e instanceof PipelineError) {
    res.status(422).json({ error: e.message, attempts: e.attempts, errors: e.errors });
  } else if (e instanceof GeminiError) {
    console.error('gemini error', e.status, e.code, e.message);
    res.status(502).json({ error: `Gemini ${e.code}: ${e.message}` });
  } else {
    console.error(e);
    res.status(500).json({ error: (e as Error).message ?? 'Server error' });
  }
}

/**
 * Streamed endpoint: newline-delimited JSON. Each harness step is written as it happens
 * ({t:'event'}), then one {t:'result'} or {t:'error'} line ends the response.
 */
function streamed<B>(handler: (body: B, emit: Emit) => Promise<unknown> | unknown) {
  return async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const write = (line: unknown) => res.write(JSON.stringify(line) + '\n');
    try {
      const data = await handler(req.body as B, (e) => write({ t: 'event', e }));
      write({ t: 'result', data });
    } catch (e) {
      const extra = e as { lines?: string[]; trace?: unknown[]; errors?: { message: string }[]; attempts?: unknown[] };
      if (e instanceof GeminiError) console.error('gemini error', e.status, e.code, e.message);
      else if (!extra.lines && !(e instanceof PipelineError)) console.error(e);
      write({
        t: 'error',
        error: e instanceof GeminiError ? `Gemini ${e.code}: ${e.message}` : ((e as Error).message ?? 'Server error'),
        errors: extra.lines?.map((message) => ({ message })) ?? (e instanceof PipelineError ? e.errors : []),
        trace: extra.trace ?? [],
      });
    }
    res.end();
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKey: Boolean(process.env.GEMINI_API_KEY), models: MODELS });
});

// Sketch photo or document -> validated FactorySpec + per-element confidence.
app.post('/api/read', async (req, res) => {
  try {
    const { mimeType, data, hint } = req.body as { mimeType: string; data: string; hint?: string };
    if (!mimeType || !data) return void res.status(400).json({ error: 'mimeType and data (base64) are required' });
    const media = mediaBlock(mimeType, data);
    const started = Date.now();
    const plan = await readPlan(media, hint);
    // Confidence is advisory: a Decisions failure must not lose a valid plan.
    let confidence = {};
    let confidenceError: string | undefined;
    try {
      confidence = await scoreElements(media, plan.spec);
    } catch (e) {
      confidenceError = (e as Error).message;
    }
    res.json({ ...plan, confidence, confidenceError, ms: Date.now() - started });
  } catch (e) {
    fail(res, e);
  }
});

// Typed or spoken instruction -> validated edit ops.
app.post(
  '/api/edit',
  streamed<{ spec: FactorySpec; text?: string; audio?: { mimeType: string; data: string } }>(async ({ spec, text, audio }, emit) => {
    if (!spec || (!text && !audio)) throw new Error('spec and one of text or audio are required');
    const started = Date.now();
    emit({ stage: 'plan', actor: 'hydrogen', title: audio ? 'Listening to the instruction' : 'Planning the edit', ms: 0, status: 'running' });
    const out = await editPlan(spec, { text, audio: audio ? mediaBlock(audio.mimeType, audio.data) : undefined });
    const retries = out.attempts.length - 1;
    emit({
      stage: 'plan',
      actor: 'hydrogen',
      title: out.ops.length ? `Edit: “${out.transcript}”` : `No change for “${out.transcript}”`,
      detail: out.ops.length ? `${out.ops.length} op${out.ops.length > 1 ? 's' : ''}${retries ? `, valid after ${retries} rejected attempt${retries > 1 ? 's' : ''}` : ', valid first time'}` : out.reason,
      ms: Date.now() - started,
      status: !out.ops.length ? 'fail' : retries ? 'retry' : 'ok',
    });
    return { ...out, ms: Date.now() - started };
  }),
);

// Neon proposes candidates; only validated ones are gated, simulated and returned.
app.post('/api/optimise', async (req, res) => {
  try {
    const { spec } = req.body as { spec: FactorySpec };
    if (!spec) return void res.status(400).json({ error: 'spec is required' });
    res.json(await optimise(spec));
  } catch (e) {
    fail(res, e);
  }
});

// Managed agent runs the layout search in parallel in a sandbox; results are re-checked here.
app.post(
  '/api/deep-search',
  streamed<{ spec: FactorySpec }>(async ({ spec }, emit) => {
    if (!spec) throw new Error('spec is required');
    emit({ stage: 'improve', actor: 'agent', title: 'Managed agent is running 8 searches in its sandbox', ms: 0, status: 'running' });
    const out = await deepSearch(spec);
    const ok = out.candidates.filter((c) => c.status === 'evaluated').length;
    emit({ stage: 'improve', actor: 'agent', title: `Sandbox search returned ${out.stats.proposed} layouts`, detail: `${ok} of the top ${out.candidates.length} pass the layout rules after re-checking here`, ms: out.stats.ms.total, status: 'ok' });
    return out;
  }),
);

// Goal-driven improve loop with automatic 5-agent Devil's Advocate gate.
app.post(
  '/api/improve',
  streamed<{ spec: FactorySpec; goal?: Goal; requirements?: Requirements }>(async ({ spec, goal, requirements }, emit) => {
    if (!spec) throw new Error('spec is required');
    return improveToGoal(spec, goal ?? 'cost', emit, requirements);
  }),
);

// ---- 5-Agent Devil's Advocate Audit, Surgical Fixer, and Real-Time Character Voice ----
app.post(
  '/api/advocate/audit',
  streamed<{ spec: FactorySpec; requirements?: Requirements }>(async ({ spec, requirements }, emit) => {
    if (!spec) throw new Error('spec is required');
    return runAdvocateAudit(spec, emit, requirements, { fastGate: false });
  }),
);

app.post(
  '/api/advocate/fix',
  streamed<{ spec: FactorySpec; findings?: AdvocateFinding[]; requirements?: Requirements }>(async ({ spec, findings, requirements }, emit) => {
    if (!spec) throw new Error('spec is required');
    return proposeAdvocateFix(spec, Array.isArray(findings) ? findings : [], emit, requirements);
  }),
);

app.post('/api/advocate/speak', async (req, res) => {
  try {
    const { role, text } = req.body as { role?: string; text?: string };
    if (!text?.trim()) return void res.status(400).json({ error: 'text is required' });
    const charRole = isCharacterRole(role) ? role : 'stress';
    const out = await synthesizeAdvocateSpeech(charRole, text.trim());
    res.json(out);
  } catch (e) {
    fail(res, e);
  }
});

// ---- Harness: brief -> plan -> (user review) -> layout ----
app.post(
  '/api/project/plan',
  streamed<{ text?: string; files?: { name: string; mimeType: string; data: string }[] }>(({ text, files }, emit) => planProject(text ?? '', files ?? [], emit)),
);

app.post(
  '/api/project/layout',
  streamed<{ requirements: Parameters<typeof layoutProject>[0]; equipment: Parameters<typeof layoutProject>[1] }>(({ requirements, equipment }, emit) => {
    if (!requirements || !equipment) throw new Error('requirements and equipment are required');
    return layoutProject(requirements, equipment, emit);
  }),
);

// ---- Catalog seam: Shopify search and listing -> CatalogItem ----
app.post('/api/catalog/search', async (req, res) => {
  try {
    const { query } = req.body as { query: string };
    if (!query?.trim()) return void res.status(400).json({ error: 'query is required' });
    res.json({ listings: await searchListings(query.trim()) });
  } catch (e) {
    fail(res, e);
  }
});

app.post(
  '/api/catalog/convert',
  streamed<{ listing: Parameters<typeof convertListing>[0]; step: Parameters<typeof convertListing>[1] }>(({ listing, step }, emit) => {
    if (!listing || !step) throw new Error('listing and step are required');
    return convertListing(listing, step, emit);
  }),
);

// ---- Sculptor agents: scout a listing, model it in detail, inspect the render, correct ----
app.post('/api/agent/scout', streamed<{ step: StepBrief }>(({ step }, emit) => scout(step, emit)));
app.post('/api/agent/design', streamed<{ listing: Parameters<typeof design>[0]; step: StepBrief }>(({ listing, step }, emit) => design(listing, step, emit)));
app.post(
  '/api/agent/inspect',
  streamed<{ listing: Parameters<typeof inspect>[0]; model: Parameters<typeof inspect>[1]; render: string }>(({ listing, model, render }, emit) => inspect(listing, model, render, emit)),
);
app.post(
  '/api/agent/revise',
  streamed<{ listing: Parameters<typeof revise>[0]; step: StepBrief; model: Parameters<typeof revise>[2]; render: string; problems: string[] }>(({ listing, step, model, render, problems }, emit) =>
    revise(listing, step, model, render, problems, emit),
  ),
);

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`api on http://localhost:${port} (key ${process.env.GEMINI_API_KEY ? 'set' : 'MISSING'})`));
