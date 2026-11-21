// Thin REST client for the two Gemini surfaces we use. Shapes follow the docs at
// aistudio.google.com/docs (Interactions API, Decisions API), read on 2026-11-21.

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const MODELS = {
  /** fast multimodal reader: sketch / document / voice -> spec or ops */
  hydrogen: 'gemini-4-hydrogen',
  /** stronger reasoner: proposes improvement ops, explains bottlenecks */
  neon: 'gemini-4-neon',
  /** Decisions API: calibrated yes/no, choice and score answers, zero output tokens */
  decision: 'gemini-decision-1',
} as const;

export type Block =
  | { type: 'text'; text: string }
  | { type: 'image' | 'audio' | 'document'; data: string; mime_type: string };

export type Step = { type: 'user_input' | 'model_output'; content: Block[] };

export class GeminiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new GeminiError(500, 'no_key', 'GEMINI_API_KEY is not set on the server');
  return k;
}

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new GeminiError(res.status, String(err.code ?? err.status ?? res.status), String(err.message ?? text.slice(0, 300)));
  }
  return json;
}

export interface InteractOptions {
  model: string;
  input: string | Block[] | Step[];
  system?: string;
  /** JSON Schema; when set the reply is parsed and returned as `json` */
  schema?: object;
  thinking?: 'low' | 'medium' | 'high' | 'xhigh';
  maxOutputTokens?: number;
}

export interface InteractResult<T = unknown> {
  text: string;
  json: T;
  usage: Record<string, unknown>;
  ms: number;
}

export async function interact<T = unknown>(o: InteractOptions): Promise<InteractResult<T>> {
  const started = Date.now();
  const body: Record<string, unknown> = { model: o.model, input: o.input, store: false };
  if (o.system) body.system_instruction = o.system;
  const gen: Record<string, unknown> = {};
  if (o.thinking) gen.thinking_level = o.thinking;
  if (o.maxOutputTokens) gen.max_output_tokens = o.maxOutputTokens;
  if (Object.keys(gen).length) body.generation_config = gen;
  if (o.schema) body.response_format = { type: 'text', mime_type: 'application/json', schema: o.schema };

  const res = await post('interactions', body);
  const text: string = (res.steps ?? [])
    .filter((s: any) => s.type === 'model_output')
    .flatMap((s: any) => s.content ?? [])
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('');
  if (!text) throw new GeminiError(502, 'empty_output', `Model returned no text (status ${res.status ?? 'unknown'})`);
  let json: any = undefined;
  if (o.schema) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new GeminiError(502, 'bad_json', `Model output was not valid JSON: ${text.slice(0, 200)}`);
    }
  }
  return { text, json, usage: res.usage ?? {}, ms: Date.now() - started };
}

export type Question =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type Answer =
  | { type: 'noul'; noul: number; confidence: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number };

/** Decisions API: up to 1,000 independent questions about one shared input. */
export async function decide(input: string | Block[], questions: Record<string, Question>): Promise<{ answers: Record<string, Answer>; usage: Record<string, unknown>; ms: number }> {
  const started = Date.now();
  const res = await post('decisions', { model: MODELS.decision, input, questions });
  return { answers: res.answers ?? {}, usage: res.usage ?? {}, ms: Date.now() - started };
}
