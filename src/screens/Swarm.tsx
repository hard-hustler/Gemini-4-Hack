// The sourcing swarm: one sculptor agent per process step, all running at once.
// Each agent scouts a Shop listing, models it in detail, then loops render -> inspect -> correct.
// The browser drives the loop because it owns the renderer; every model call goes through the server.

import { useEffect, useRef, useState } from 'react';
import type { CatalogItem, EquipmentLine, ShopListing, TraceEvent } from '../contracts';
import type { MachineModel } from '../model3d';
import { apiStream, money } from '../store';
import { Icon } from '../ui/icons';
import { renderModel } from '../ui/thumbs';

type Stage = 'queued' | 'scout' | 'model' | 'render' | 'inspect' | 'correct' | 'done' | 'failed';
const RAIL: { id: Stage; label: string }[] = [
  { id: 'scout', label: 'Scout' },
  { id: 'model', label: 'Model' },
  { id: 'render', label: 'Render' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'correct', label: 'Correct' },
];
const MAX_ROUNDS = 3;

interface Agent {
  key: string;
  label: string;
  stage: Stage;
  reached: Stage[];
  live?: string;
  listing?: ShopListing;
  renders: string[];
  log: { text: string; tone: 'ok' | 'retry' | 'fail' }[];
  likeness?: number;
  round: number;
  parts?: number;
  item?: CatalogItem;
  error?: string;
  startedAt: number;
  ms?: number;
}

interface Inspection {
  likeness: number;
  coherent: number;
  proportions: number;
  accepted: boolean;
  problems: string[];
  sawPhoto: boolean;
}

const b64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

export function Swarm({ lines, onApply, onClose }: { lines: EquipmentLine[]; onApply: (items: Record<string, CatalogItem>, events: TraceEvent[]) => void; onClose: () => void }) {
  const active = lines.filter((l) => l.qty > 0);
  const [agents, setAgents] = useState<Agent[]>(() => active.map((l) => ({ key: l.stepType, label: l.label, stage: 'queued', reached: [], renders: [], log: [], round: 0, startedAt: Date.now() })));
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(false);
  const t0 = useRef(Date.now());

  const patch = (key: string, fn: (a: Agent) => Partial<Agent>) => setAgents((cur) => cur.map((a) => (a.key === key ? { ...a, ...fn(a) } : a)));
  const enter = (key: string, stage: Stage) => patch(key, (a) => ({ stage, reached: a.reached.includes(stage) ? a.reached : [...a.reached, stage], live: undefined }));

  const runAgent = async (line: EquipmentLine) => {
    const key = line.stepType;
    const onEvent = (e: TraceEvent) => {
      if (e.status === 'running') return patch(key, () => ({ live: e.title }));
      patch(key, (a) => ({ live: undefined, log: [...a.log, { text: e.detail ? `${e.title}: ${e.detail}` : e.title, tone: e.status === 'fail' ? 'fail' : e.status === 'retry' ? 'retry' : 'ok' }] }));
    };
    const step = { type: line.stepType, label: line.label, itemName: line.item.source === 'builtin' ? line.item.name : line.label, cycleTimeSec: line.item.cycleTimeSec, operators: line.item.operators };
    const began = Date.now();
    try {
      enter(key, 'scout');
      const sc = await apiStream<{ listing: ShopListing; fit: number }>('/api/agent/scout', { step }, onEvent);
      patch(key, () => ({ listing: sc.listing }));

      enter(key, 'model');
      const ds = await apiStream<{ model: MachineModel | null; errors: string[]; sawPhoto: boolean; meta: { name: string; powerKw: number; needsWater: boolean; dimsStated: boolean } }>('/api/agent/design', { listing: sc.listing, step }, onEvent);
      if (!ds.model) throw new Error(`The model never passed the structural check: ${ds.errors[0] ?? 'unknown problem'}`);

      let model = ds.model;
      let best: { model: MachineModel; ins: Inspection; round: number } | null = null;
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        enter(key, 'render');
        patch(key, () => ({ round, parts: model.parts.length, live: 'Rendering the model' }));
        const png = await renderModel(model);
        patch(key, (a) => ({ renders: [...a.renders, png] }));

        enter(key, 'inspect');
        const ins = await apiStream<Inspection>('/api/agent/inspect', { listing: sc.listing, model, render: b64(png) }, onEvent);
        if (!best || ins.likeness > best.ins.likeness) best = { model, ins, round };
        patch(key, () => ({ likeness: best!.ins.likeness }));
        if (ins.accepted || round === MAX_ROUNDS || !ins.problems.length) break;

        enter(key, 'correct');
        const rv = await apiStream<{ model: MachineModel | null; errors: string[] }>('/api/agent/revise', { listing: sc.listing, step, model, render: b64(png), problems: ins.problems }, onEvent);
        if (!rv.model) {
          patch(key, (a) => ({ log: [...a.log, { text: 'The correction broke the structure, so the best earlier version is kept', tone: 'retry' }] }));
          break;
        }
        model = rv.model;
      }
      const final = best!;
      const item: CatalogItem = {
        id: `shop-${sc.listing.variantId.split('/').pop()}`,
        name: ds.meta.name,
        stationType: line.stepType,
        footprint: final.model.size,
        cycleTimeSec: line.item.cycleTimeSec,
        operators: line.item.operators,
        powerKw: ds.meta.powerKw,
        needsWater: ds.meta.needsWater,
        price: sc.listing.price,
        source: 'shopify',
        listing: { ...sc.listing, description: undefined },
        model: final.model,
        modelChecks: { likeness: final.ins.likeness, coherent: final.ins.coherent, proportions: final.ins.proportions, accepted: final.ins.accepted, rounds: final.round, parts: final.model.parts.length, sawPhoto: ds.sawPhoto, dimsStated: ds.meta.dimsStated, fit: sc.fit },
        confidence: sc.fit,
      };
      // show the version that was kept, which is not always the last one rendered
      const keptPng = await renderModel(final.model);
      patch(key, (a) => ({ stage: 'done', live: undefined, item, parts: final.model.parts.length, likeness: final.ins.likeness, renders: a.renders[a.renders.length - 1] === keptPng ? a.renders : [...a.renders, keptPng], ms: Date.now() - began }));
    } catch (e) {
      patch(key, () => ({ stage: 'failed', live: undefined, error: (e as Error).message, ms: Date.now() - began }));
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void Promise.all(active.map(runAgent));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const running = agents.some((a) => a.stage !== 'done' && a.stage !== 'failed');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(Date.now() - t0.current), 500);
    return () => clearInterval(t);
  }, [running]);

  const built = agents.filter((a) => a.item);
  const mean = built.length ? built.reduce((t, a) => t + (a.likeness ?? 0), 0) / built.length : 0;
  const apply = () => {
    const items: Record<string, CatalogItem> = {};
    const events: TraceEvent[] = [];
    for (const a of built) {
      items[a.key] = a.item!;
      events.push({
        stage: 'convert',
        actor: 'agent',
        title: `Sculptor built ${a.item!.name} for ${a.label}`,
        detail: `${a.parts} parts, ${Math.round((a.likeness ?? 0) * 100)}% likeness after ${a.item!.modelChecks?.rounds} round${a.item!.modelChecks?.rounds === 1 ? '' : 's'}`,
        ms: a.ms ?? 0,
        status: a.item!.modelChecks?.accepted ? 'ok' : 'retry',
      });
    }
    onApply(items, events);
  };

  return (
    <div className="swarm" role="dialog" aria-label="Sourcing swarm">
      <header className="swarm-head">
        <div>
          <h2>Sourcing swarm</h2>
          <p>
            {agents.length} agents, one per step. Each finds a real listing, models it part by part, renders it, and has an inspector compare the render with the listing photo.
          </p>
        </div>
        <div className="swarm-stats">
          <span>
            <b>
              {built.length}/{agents.length}
            </b>{' '}
            built
          </span>
          <span>
            <b>{built.length ? `${Math.round(mean * 100)}%` : '–'}</b> mean likeness
          </span>
          <span>
            <b>{(elapsed / 1000).toFixed(0)} s</b>
          </span>
          <button className="ghost" onClick={onClose}>
            {running ? 'Hide' : 'Close'}
          </button>
          <button className="primary" disabled={running || !built.length} onClick={apply}>
            Use {built.length || ''} in the plan <Icon name="arrowRight" />
          </button>
        </div>
      </header>

      <div className="swarm-grid">
        {agents.map((a, i) => (
          <article key={a.key} className={`agent ${a.stage}`}>
            <header>
              <span className="agent-n">{String(i + 1).padStart(2, '0')}</span>
              <b>{a.label}</b>
              <span className="agent-state">
                {a.stage === 'done' ? (
                  <Icon name="check" size={14} />
                ) : a.stage === 'failed' ? (
                  <Icon name="x" size={14} />
                ) : (
                  <span className="spinner" />
                )}
              </span>
            </header>

            <div className="agent-view">
              <div className="agent-render">
                {a.renders.length ? <img src={a.renders[a.renders.length - 1]} alt={`Render of the model, version ${a.renders.length}`} /> : <span className="agent-wait">{a.stage === 'failed' ? 'No model' : 'Not built yet'}</span>}
                {a.renders.length > 1 && (
                  <div className="agent-history" aria-label="Earlier versions">
                    {a.renders.slice(0, -1).map((r, k) => (
                      <img key={k} src={r} alt={`Version ${k + 1}`} />
                    ))}
                  </div>
                )}
              </div>
              <div className="agent-photo">{a.listing?.image ? <img src={a.listing.image} alt="Listing photo" /> : <span className="agent-wait">Searching</span>}</div>
            </div>

            <ol className="rail">
              {RAIL.map((s) => (
                <li key={s.id} className={a.stage === s.id ? 'on' : a.reached.includes(s.id) ? 'done' : ''}>
                  {s.label}
                </li>
              ))}
            </ol>

            <p className="agent-title">{a.listing ? `${a.listing.title.slice(0, 64)} · ${money(a.listing.price)}` : ' '}</p>

            <div className="agent-log">
              {a.log.slice(-3).map((l, k) => (
                <span key={k} className={l.tone}>
                  {l.text.slice(0, 150)}
                </span>
              ))}
              {a.live && <span className="live-line">{a.live}…</span>}
              {a.error && <span className="fail">{a.error}</span>}
            </div>

            <footer>
              <span>{a.parts ? `${a.parts} parts` : ''}</span>
              <span>{a.round ? `round ${a.round}` : ''}</span>
              <span className={a.likeness !== undefined && a.likeness < 0.7 ? 'low' : ''}>{a.likeness !== undefined ? `${Math.round(a.likeness * 100)}% likeness` : ''}</span>
              <span>{a.ms ? `${(a.ms / 1000).toFixed(0)} s` : ''}</span>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
