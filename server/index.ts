// Small Node proxy for model calls. The key stays server-side in GEMINI_API_KEY.
import express, { type Response } from 'express';
import type { FactorySpec } from '../src/spec';
import { GeminiError, MODELS, type Block } from './gemini';
import { deepSearch } from './agent';
import { optimise } from './optimize';
import { editPlan, PipelineError, readPlan, scoreElements } from './pipeline';

const app = express();
app.use(express.json({ limit: '30mb' }));

function mediaBlock(mimeType: string, data: string): Block {
  const type = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'document';
  // browsers report e.g. "audio/webm;codecs=opus"; the API wants the bare type
  return { type, data, mime_type: mimeType.split(';')[0] };
}

function fail(res: Response, e: unknown) {
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
app.post('/api/edit', async (req, res) => {
  try {
    const { spec, text, audio } = req.body as { spec: FactorySpec; text?: string; audio?: { mimeType: string; data: string } };
    if (!spec || (!text && !audio)) return void res.status(400).json({ error: 'spec and one of text or audio are required' });
    const started = Date.now();
    const out = await editPlan(spec, { text, audio: audio ? mediaBlock(audio.mimeType, audio.data) : undefined });
    res.json({ ...out, ms: Date.now() - started });
  } catch (e) {
    fail(res, e);
  }
});

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
app.post('/api/deep-search', async (req, res) => {
  try {
    const { spec } = req.body as { spec: FactorySpec };
    if (!spec) return void res.status(400).json({ error: 'spec is required' });
    res.json(await deepSearch(spec));
  } catch (e) {
    fail(res, e);
  }
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`api on http://localhost:${port} (key ${process.env.GEMINI_API_KEY ? 'set' : 'MISSING'})`));
