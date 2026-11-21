// Client-side project store. No database: projects live in memory and localStorage.

import type { EquipmentLine, Requirements, TraceEvent } from './contracts';
import type { MachineModel } from './model3d';
import type { Version } from './engines/versions';

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  brief: { text: string; files: { name: string; mimeType: string }[] };
  requirements: Requirements;
  equipment: EquipmentLine[];
  coverage?: number;
  trace: TraceEvent[];
  versions: Version[];
  currentId: string | null;
  /** agent-built models by catalog id, kept even after an item is replaced so old versions still draw */
  models?: Record<string, MachineModel>;
}

const KEY = 'dryrun.projects.v2';

export function loadProjects(): Project[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(projects));
  } catch {
    /* storage is a convenience only */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public lines: string[] = [],
    public trace: TraceEvent[] = [],
  ) {
    super(message);
  }
}

export async function api<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError('Cannot reach the Dry Run server. Is `npm run dev` running?');
  }
  const json = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
  if (!res.ok) {
    const lines = Array.isArray(json.errors) ? json.errors.map((e: { message: string }) => e.message) : [];
    throw new ApiError(json.error ?? 'Request failed', lines, Array.isArray(json.trace) ? json.trace : []);
  }
  return json as T;
}

/**
 * Streamed call: the server writes one JSON line per harness step, then a result or an error.
 * onEvent fires as each step arrives, so the UI shows what is happening while it happens.
 */
export async function apiStream<T>(path: string, body: unknown, onEvent: (e: TraceEvent) => void): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError('Cannot reach the Dry Run server. Is `npm run dev` running?');
  }
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new ApiError(json.error ?? `Server returned ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: { data: T } | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.t === 'event') onEvent(msg.e);
    else if (msg.t === 'result') result = { data: msg.data };
    else if (msg.t === 'error') throw new ApiError(msg.error ?? 'Request failed', (msg.errors ?? []).map((e: { message: string }) => e.message), msg.trace ?? []);
  };
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handle(line);
    if (done) break;
  }
  handle(buffer);
  if (!result) throw new ApiError('The server closed the connection before finishing');
  return (result as { data: T }).data;
}

/** $7.04 under a hundred dollars, $10,246 above: cents only where they matter. */
export const money = (v: number) => {
  if (!Number.isFinite(v)) return 'n/a';
  const cents = Math.abs(v) < 100 ? 2 : 0;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: cents, maximumFractionDigits: cents })}`;
};
export const num = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
export const pct = (v: number | undefined) => (v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);
