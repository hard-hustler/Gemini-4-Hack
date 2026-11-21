// Client-side project store. No database: projects live in memory and localStorage.

import type { EquipmentLine, Requirements, TraceEvent } from './contracts';
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

export const money = (v: number) => (Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 })}` : 'n/a');
export const num = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
export const pct = (v: number | undefined) => (v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);
