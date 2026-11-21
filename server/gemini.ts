// Server-side Gemini client using the official @google/genai SDK (Interactions, Decisions, and 3.8 TTS).
// Keeps GEMINI_API_KEY strictly on the server with v1beta + aistudio-build headers.

import { GoogleGenAI } from '@google/genai';
import type { AdvocateVoice } from '../src/contracts';

export const MODELS = {
  /** fast multimodal reader: sketch / document / voice -> spec or ops */
  hydrogen: 'gemini-4-hydrogen',
  /** stronger reasoner: proposes improvement ops, explains bottlenecks, surgical fixer */
  neon: 'gemini-4-neon',
  /** Decisions API: calibrated yes/no, choice and score answers, zero output tokens */
  decision: 'gemini-decision-1',
  /** Gemini 3.8 Flash-Lite TTS: expressive unary WAV synthesis for floor characters */
  tts: 'gemini-3.8-flash-lite-tts',
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

let cachedClient: { key: string; ai: GoogleGenAI } | null = null;

function client(): GoogleGenAI {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new GeminiError(500, 'no_key', 'GEMINI_API_KEY is not set on the server');
  if (cachedClient && cachedClient.key === k) return cachedClient.ai;
  const ai = new GoogleGenAI({
    apiKey: k,
    apiVersion: 'v1beta',
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
  cachedClient = { key: k, ai };
  return ai;
}

function wrapError(e: unknown): never {
  if (e instanceof GeminiError) throw e;
  const err = e as { status?: number; code?: string | number; message?: string; error?: { status?: string; code?: number; message?: string } };
  const status = Number(err?.status ?? err?.error?.code ?? 502);
  const code = String(err?.error?.status ?? err?.code ?? status);
  const message = String(err?.error?.message ?? err?.message ?? 'Gemini API request failed');
  throw new GeminiError(status, code, message);
}

export interface InteractOptions {
  model: string;
  input: string | Block[] | Step[];
  system?: string;
  /** JSON Schema; when set the reply is parsed and returned as `json` */
  schema?: object;
  thinking?: 'low' | 'medium' | 'high' | 'xhigh';
  maxOutputTokens?: number;
  /** built-in tools, e.g. [{ type: 'google_search' }] */
  tools?: object[];
}

export interface InteractResult<T = unknown> {
  text: string;
  json: T;
  usage: Record<string, unknown>;
  ms: number;
  /** pages a search-grounded answer cites */
  sources: { url: string; title: string }[];
  /** search queries the model ran */
  queries: string[];
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
  if (o.tools?.length) body.tools = o.tools;

  let res: any;
  try {
    res = await (client().interactions as any).create(body);
  } catch (e) {
    wrapError(e);
  }

  const fromSteps: string = (res?.steps ?? [])
    .filter((s: any) => s.type === 'model_output')
    .flatMap((s: any) => s.content ?? [])
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('');
  const fromOutputs: string = (res?.outputs ?? [])
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('');
  const text = fromSteps || fromOutputs || String(res?.output_text ?? '');

  if (!text) throw new GeminiError(502, 'empty_output', `Model returned no text (status ${res?.status ?? 'unknown'})`);
  let json: any = undefined;
  if (o.schema) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new GeminiError(502, 'bad_json', `Model output was not valid JSON: ${text.slice(0, 200)}`);
    }
  }
  const sources = new Map<string, string>();
  const queries: string[] = [];
  for (const s of res?.steps ?? []) {
    if (s.type === 'google_search_call') for (const q of s.arguments?.queries ?? []) queries.push(String(q));
    if (s.type === 'model_output') for (const c of s.content ?? []) for (const a of c.annotations ?? []) if (a.type === 'url_citation' && a.url && ![...sources.values()].includes(String(a.title ?? a.url))) sources.set(String(a.url), String(a.title ?? a.url));
  }
  return { text, json, usage: (res?.usage ?? {}) as Record<string, unknown>, ms: Date.now() - started, sources: [...sources].map(([url, title]) => ({ url, title })), queries };
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
export async function decide(
  input: string | Block[],
  questions: Record<string, Question>,
): Promise<{ answers: Record<string, Answer>; usage: Record<string, unknown>; ms: number }> {
  const started = Date.now();
  try {
    const res: any = await (client().decisions as any).create({
      model: MODELS.decision,
      input,
      questions,
    });
    return { answers: res?.answers ?? {}, usage: res?.usage ?? {}, ms: Date.now() - started };
  } catch (e) {
    wrapError(e);
  }
}

// Bounded in-memory LRU cache for TTS WAV clips so re-playing a character line is instant
const TTS_CACHE = new Map<string, { audioBase64: string; mimeType: string }>();
const MAX_TTS_CACHE = 48;

export interface SpeakOptions {
  text: string;
  voice: AdvocateVoice;
  style?: string;
}

export interface SpeakResult {
  audioBase64: string;
  mimeType: string;
  voice: AdvocateVoice;
  cached: boolean;
  ms: number;
}

/** Synthesize character speech via Gemini 3.8 Flash-Lite TTS (unary WAV output). */
export async function speakText(o: SpeakOptions): Promise<SpeakResult> {
  const started = Date.now();
  const cleanText = o.text.trim().slice(0, 600);
  if (!cleanText) throw new GeminiError(400, 'empty_text', 'Speech text is required');
  const style = (o.style ?? 'Clear, natural industrial engineer speaking on a factory floor').trim();
  const cacheKey = `${o.voice}|${style}|${cleanText}`;
  const hit = TTS_CACHE.get(cacheKey);
  if (hit) {
    // Refresh LRU order
    TTS_CACHE.delete(cacheKey);
    TTS_CACHE.set(cacheKey, hit);
    return { ...hit, voice: o.voice, cached: true, ms: Date.now() - started };
  }

  let res: any;
  try {
    res = await (client().interactions as any).create({
      model: MODELS.tts,
      input: [
        {
          type: 'text',
          text: cleanText,
          annotations: [{ type: 'speech_metadata', style }],
        },
      ],
      response_format: { type: 'audio' },
      generation_config: {
        speech_config: [{ language: 'en-US', voice: o.voice }],
      },
      store: false,
    });
  } catch (e) {
    wrapError(e);
  }

  const audioFromSteps = (res?.steps ?? [])
    .filter((s: any) => s.type === 'model_output')
    .flatMap((s: any) => s.content ?? [])
    .find((c: any) => c.type === 'audio' && c.data);
  const audioFromOutputs = (res?.outputs ?? []).find((c: any) => c.type === 'audio' && c.data);
  const audioBase64: string | undefined = res?.output_audio?.data ?? audioFromSteps?.data ?? audioFromOutputs?.data;
  const mimeType: string = res?.output_audio?.mime_type ?? audioFromSteps?.mime_type ?? audioFromOutputs?.mime_type ?? 'audio/wav';

  if (!audioBase64) {
    throw new GeminiError(502, 'empty_audio', `TTS model returned no audio (status ${res?.status ?? 'unknown'})`);
  }

  if (TTS_CACHE.size >= MAX_TTS_CACHE) {
    const oldest = TTS_CACHE.keys().next().value;
    if (oldest) TTS_CACHE.delete(oldest);
  }
  TTS_CACHE.set(cacheKey, { audioBase64, mimeType });

  return { audioBase64, mimeType, voice: o.voice, cached: false, ms: Date.now() - started };
}
