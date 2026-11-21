import { useEffect, useMemo, useRef, useState } from 'react';
import type { TraceEvent } from '../contracts';
import { compare, evaluate, makeVersion, type Version } from '../engines/versions';
import { validate, type ValidationError } from '../engines/validate';
import { applyOp, type EditOp, type FactorySpec } from '../spec';
import { apiStream, ApiError, money, num, type Project } from '../store';
import { startRecording, type Recorder } from '../ui/audio';
import { Notice, RunStatus, TopBar, useRun } from '../ui/common';
import { Icon } from '../ui/icons';
import { Scene, type Layers } from '../ui/Scene';

type Goal = 'cost' | 'lead' | 'build';
interface Deltas {
  uph: number;
  leadMin: number;
  costPerUnit: number;
  buildCost: number;
}
interface Tried {
  name: string;
  reason: string;
  source: 'neon' | 'search';
  outcome: 'kept' | 'simulated' | 'gated out' | 'rejected';
  errors?: string[];
  gate?: number;
  deltas?: Deltas;
}
interface ImproveResult {
  goalLabel: string;
  explanation: string;
  rounds: { n: number; tried: Tried[]; kept?: string; ms: number }[];
  kept: { round: number; name: string; spec: FactorySpec }[];
  deltas: Deltas;
  meetsDemand: boolean;
  stopped: string;
  ms: number;
}
interface SandboxResult {
  explanation: string;
  candidates: { name: string; status: 'evaluated' | 'invalid' | 'gated_out'; spec?: FactorySpec; errors?: string[]; deltas?: Deltas & { forkliftM: number } }[];
}

const describeOp = (op: EditOp): string => {
  switch (op.op) {
    case 'move':
      return `Moved ${op.id} to ${op.x}, ${op.y}`;
    case 'rotate':
      return `Turned ${op.id} to ${op.rot}°`;
    case 'add':
      return `Added ${op.station.id} (${op.station.type})`;
    case 'remove':
      return `Removed ${op.id}`;
    case 'moveDock':
      return `Moved dock ${op.index} to the ${{ N: 'north', S: 'south', E: 'east', W: 'west' }[op.wall]} wall, ${op.offset} m along`;
    case 'setParam':
      return `Set ${op.path} to ${op.value}`;
  }
};

const PANEL = 380;

/** True on screens too narrow for the panel to sit beside the floor. */
function useNarrow() {
  const query = '(max-width: 900px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}
type Tab = 'overview' | 'improve' | 'equipment' | 'versions';
const GOALS: { id: Goal; label: string }[] = [
  { id: 'cost', label: 'Cost per unit' },
  { id: 'lead', label: 'Lead time' },
  { id: 'build', label: 'Build cost' },
];

function Stat({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span>{label}</span>
      <b>
        {value}
        {unit && <small>{unit}</small>}
      </b>
      {sub && <span>{sub}</span>}
    </div>
  );
}

function DeltaLine({ d }: { d: Deltas }) {
  // a change that rounds to zero is shown as no change, without a sign or a colour
  const part = (v: number, shown: string, unit: string, goodWhenNegative = true) => {
    const zero = !/[1-9]/.test(shown);
    return (
      <span className={zero ? 'muted' : v < 0 === goodWhenNegative ? 'good' : 'warn'}>
        {zero ? '' : v > 0 ? '+' : '−'}
        {shown} {unit}
      </span>
    );
  };
  return (
    <div className="deltas">
      {part(d.leadMin, num(Math.abs(d.leadMin)), 'min lead')}
      {part(d.costPerUnit, money(Math.abs(d.costPerUnit)), 'a unit')}
      {part(d.buildCost, money(Math.abs(d.buildCost)), 'build')}
      {part(d.uph, num(Math.abs(d.uph)), 'an hour', false)}
    </div>
  );
}

function CompareModal({ versions, a, b, onPick, onClose }: { versions: Version[]; a: Version; b: Version; onPick: (k: 'a' | 'b', id: string) => void; onClose: () => void }) {
  const rows = compare(a.metrics, b.metrics);
  const evA = useMemo(() => evaluate(a.spec, 2), [a]);
  const evB = useMemo(() => evaluate(b.spec, 2), [b]);
  const layers: Layers = { flow: true, routes: false, power: false, water: false, labels: false };
  return (
    <div className="scrim center" onClick={onClose}>
      <div className="compare" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Compare versions">
        <header>
          <h2>
            {a.id} against {b.id}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="compare-views">
          {(
            [
              ['a', a, evA],
              ['b', b, evB],
            ] as const
          ).map(([k, v, ev]) => (
            <div key={k} className="compare-view">
              <select value={v.id} onChange={(e) => onPick(k, e.target.value)} aria-label={k === 'a' ? 'First version' : 'Second version'}>
                {versions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.id} · {x.label}
                  </option>
                ))}
              </select>
              <Scene spec={v.spec} routes={ev.ok ? ev.routes : null} layers={layers} interactive={false} animate={false} />
            </div>
          ))}
        </div>
        <table>
          <thead>
            <tr>
              <th />
              <th>{a.id}</th>
              <th>{b.id}</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td>{r.unit === '$' ? money(r.a) : `${num(r.a, 2)} ${r.unit}`}</td>
                <td>{r.unit === '$' ? money(r.b) : `${num(r.b, 2)} ${r.unit}`}</td>
                {(() => {
                  const shown = r.unit === '$' ? money(Math.abs(r.delta)) : num(Math.abs(r.delta), 2);
                  const zero = !/[1-9]/.test(shown);
                  return (
                    <td className={zero || r.better === null ? 'muted' : r.better ? 'good' : 'warn'}>
                      {zero ? '' : r.delta > 0 ? '+' : '−'}
                      {shown}
                    </td>
                  );
                })()}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          What changed in {b.id}: {b.diff.join('; ') || 'nothing'}.
        </p>
      </div>
    </div>
  );
}

export function Workspace({ project, onHome, onPlan, onChange }: { project: Project; onHome: () => void; onPlan: () => void; onChange: (patch: Partial<Project>) => void }) {
  const versions = project.versions;
  const current = versions.find((v) => v.id === project.currentId) ?? versions[versions.length - 1];
  // draft is always a validated spec; preview is whatever is under the cursor mid-drag
  const [draft, setDraft] = useState<FactorySpec>(current.spec);
  const [preview, setPreview] = useState<FactorySpec | null>(null);
  const [rejected, setRejected] = useState<ValidationError[]>([]);
  const [layers, setLayers] = useState<Layers>({ flow: true, routes: false, power: false, water: false, labels: true });
  const [tab, setTab] = useState<Tab>('overview');
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; title: string; lines: string[] } | null>(null);
  const [command, setCommand] = useState('');
  const [recording, setRecording] = useState(false);
  const [goal, setGoal] = useState<Goal>('cost');
  const [mode, setMode] = useState<'improve' | 'sandbox' | null>(null);
  const [improved, setImproved] = useState<(ImproveResult & { saved: string[] }) | null>(null);
  const [sandbox, setSandbox] = useState<SandboxResult | null>(null);
  const [cmp, setCmp] = useState<{ a: string; b: string } | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const run = useRun();
  const busy = run.busy;
  const narrow = useNarrow();

  useEffect(() => {
    setDraft(current.spec);
    setRejected([]);
  }, [current.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const evaluation = useMemo(() => evaluate(draft), [draft]);
  const previewErrors = useMemo(() => (preview ? validate(preview) : []), [preview]);
  const metrics = evaluation.ok ? evaluation.metrics : current.metrics;
  const sim = metrics.sim;
  const dirty = JSON.stringify(draft) !== JSON.stringify(current.spec);
  const shown = preview ?? draft;
  const v1 = versions[0];
  const nextN = Math.max(...versions.map((v) => v.n)) + 1;
  const hot = sim.bottleneck.utilisation >= 0.85;

  /** Run a streamed harness call; its steps land in the tracker live and in the project's run log after. */
  const call = async <T,>(label: string, path: string, body: unknown): Promise<T | null> => {
    setNotice(null);
    let events: TraceEvent[] = [];
    try {
      const out = await run.run(label, (onEvent) => apiStream<T>(path, body, onEvent));
      events = out.events;
      return out.value;
    } catch (e) {
      const err = e as ApiError;
      setNotice({ tone: 'error', title: err.message, lines: err.lines ?? [] });
      return null;
    } finally {
      if (events.length) onChange({ trace: [...project.trace, ...events] });
    }
  };

  /** Every manual edit goes through here: apply the op, validate, accept or reject with the reasons. */
  const tryOp = (op: EditOp) => {
    let next: FactorySpec;
    try {
      next = applyOp(draft, op);
    } catch (e) {
      return void setRejected([{ code: 'param', message: (e as Error).message, ids: [] }]);
    }
    const errs = validate(next);
    if (errs.length) setRejected(errs);
    else {
      setRejected([]);
      setDraft(next);
    }
  };
  const onDrag = (id: string, x: number, y: number) => setPreview(applyOp(preview ?? draft, { op: 'move', id, x, y }));
  const onDrop = () => {
    if (preview) {
      if (previewErrors.length) setRejected(previewErrors);
      else {
        setRejected([]);
        setDraft(preview);
      }
    }
    setPreview(null);
  };

  const save = () => {
    if (!evaluation.ok || !dirty) return;
    const v = makeVersion(draft, evaluation.metrics, current, nextN, 'Edited by hand');
    onChange({ versions: [...versions, v], currentId: v.id });
  };

  const sendEdit = async (payload: { text?: string; audio?: { mimeType: string; data: string } }) => {
    const out = await call<{ ops: EditOp[]; spec: FactorySpec; transcript: string; reason: string }>(payload.audio ? 'Listening' : 'Planning the edit', '/api/edit', { spec: draft, ...payload });
    if (!out) return;
    if (!out.ops.length) return void setNotice({ tone: 'error', title: `Nothing changed for “${out.transcript}”`, lines: [out.reason] });
    setDraft(out.spec);
    setRejected([]);
    setCommand('');
    setNotice({ tone: 'ok', title: `“${out.transcript}”`, lines: out.ops.map(describeOp) });
  };

  const toggleMic = async () => {
    if (recording && recorder.current) {
      setRecording(false);
      const rec = recorder.current;
      recorder.current = null;
      try {
        await sendEdit({ audio: await rec.stop() });
      } catch (e) {
        setNotice({ tone: 'error', title: 'Could not process the recording', lines: [(e as Error).message] });
      }
      return;
    }
    try {
      recorder.current = await startRecording();
      setRecording(true);
    } catch (e) {
      setNotice({ tone: 'error', title: 'Microphone unavailable', lines: [(e as Error).message] });
    }
  };

  /** The agent loop. Each change it keeps becomes a version, so the timeline shows how it got there. */
  const improve = async () => {
    setMode('improve');
    setImproved(null);
    setSandbox(null);
    const out = await call<ImproveResult>('Starting', '/api/improve', { spec: draft, goal });
    if (!out) return;
    const added: Version[] = [];
    let parent = current;
    let n = nextN;
    if (dirty && evaluation.ok) {
      parent = makeVersion(draft, evaluation.metrics, current, n++, 'Edited by hand');
      added.push(parent);
    }
    for (const k of out.kept) {
      const ev = evaluate(k.spec);
      if (!ev.ok) continue; // the server validated it; this is belt and braces
      parent = makeVersion(k.spec, ev.metrics, parent, n++, `Agent, round ${k.round}: ${k.name}`);
      added.push(parent);
    }
    setImproved({ ...out, saved: added.filter((v) => v.label.startsWith('Agent')).map((v) => v.id) });
    if (added.length) onChange({ versions: [...versions, ...added], currentId: parent.id });
  };

  const deepSearch = async () => {
    setMode('sandbox');
    setImproved(null);
    setSandbox(null);
    const out = await call<SandboxResult>('Starting the sandbox', '/api/deep-search', { spec: draft });
    if (out) setSandbox(out);
  };

  const applySpec = (name: string, spec: FactorySpec) => {
    const errs = validate(spec);
    if (errs.length) return void setRejected(errs);
    setDraft(spec);
    setRejected([]);
    setNotice({ tone: 'ok', title: `Applied “${name}” to the draft`, lines: ['Save it as a version to keep it.'] });
  };

  const liveErrors = preview ? previewErrors : rejected;
  const sel = selected ? shown.stations.find((s) => s.id === selected) : null;
  const dLead = (v1.metrics.sim.leadTimeSec.median - sim.leadTimeSec.median) / 60;
  const dUnit = v1.metrics.cost.costPerUnit - metrics.cost.costPerUnit;
  const dBuild = v1.metrics.cost.buildCost - metrics.cost.buildCost;
  const versus = (v: number, f: (x: number) => string) => (
    <b className={Math.abs(v) < 1e-9 ? '' : v > 0 ? 'good' : 'warn'}>
      {f(Math.abs(v))} {v >= 0 ? 'less' : 'more'}
    </b>
  );
  const bill = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; price: number; checkoutUrl?: string; listingUrl?: string }>();
    for (const s of draft.stations) {
      const key = s.catalogId ?? s.type;
      const row = map.get(key) ?? { name: s.name ?? s.type, qty: 0, price: s.price, checkoutUrl: s.checkoutUrl, listingUrl: s.listingUrl };
      row.qty++;
      map.set(key, row);
    }
    return [...map.values()];
  }, [draft]);
  const cmpA = cmp && versions.find((v) => v.id === cmp.a);
  const cmpB = cmp && versions.find((v) => v.id === cmp.b);
  const outcomeIcon = { kept: 'check', simulated: 'minus', 'gated out': 'minus', rejected: 'x' } as const;

  return (
    <div className="page workspace">
      <TopBar
        onHome={onHome}
        log={project.trace}
        crumbs={[{ label: 'Brief' }, { label: 'Equipment', onClick: onPlan }, { label: 'Simulation', active: true }]}
        right={
          <a href="/eval/index.html" target="_blank" rel="noreferrer">
            Eval
          </a>
        }
      />
      <div className="stage">
        <Scene
          spec={shown}
          routes={!preview && evaluation.ok ? evaluation.routes : null}
          layers={layers}
          badIds={previewErrors.flatMap((e) => e.ids)}
          bottleneck={hot ? sim.bottleneck.name : undefined}
          selectedId={selected}
          insetRight={narrow ? 0 : PANEL + 14}
          onSelect={setSelected}
          onDrag={onDrag}
          onDrop={onDrop}
        />
      </div>

      <div className="stage-title">
        <h1>{project.name}</h1>
        <p>
          {current.id}
          {dirty ? ', with unsaved changes' : ''} · {draft.floor.width} × {draft.floor.depth} m · {draft.stations.length} stations
        </p>
      </div>

      <div className="layerbar" role="group" aria-label="Show on the floor">
        {(
          [
            ['flow', 'Flow'],
            ['routes', 'Routes'],
            ['power', 'Power'],
            ['water', 'Water'],
            ['labels', 'Labels'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={layers[k] ? 'on' : ''} aria-pressed={layers[k]} onClick={() => setLayers({ ...layers, [k]: !layers[k] })}>
            {label}
          </button>
        ))}
      </div>

      <aside className="panel" style={narrow ? undefined : { width: PANEL }}>
        <nav className="tabs" role="tablist">
          {(['overview', 'improve', 'equipment', 'versions'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
              {t === 'versions' && <em>{versions.length}</em>}
            </button>
          ))}
        </nav>

        <div className="panel-body">
          {tab === 'overview' && (
            <>
              <div className="section">
                <div className="stats">
                  <Stat
                    label="Throughput"
                    value={num(sim.unitsPerHour.median)}
                    unit="an hour"
                    sub={sim.unitsPerHour.median < draft.demandPerHour * 0.97 ? `${num(draft.demandPerHour - sim.unitsPerHour.median)} short of demand` : `demand is ${draft.demandPerHour}`}
                    tone={sim.unitsPerHour.median < draft.demandPerHour * 0.97 ? 'warn' : undefined}
                  />
                  <Stat label="Lead time" value={num(sim.leadTimeSec.median / 60)} unit="min" sub={`${num(sim.wip.median)} units in progress`} />
                  <Stat label="Cost per unit" value={money(metrics.cost.costPerUnit)} sub={`${num(metrics.cost.kwhPerUnit, 2)} kWh a unit`} />
                  <Stat label="Build cost" value={money(metrics.cost.buildCost)} sub={`${money(metrics.cost.utilityRunCost)} is power and water runs`} />
                </div>
                {(versions.length > 1 || dirty) && (
                  <p className="say">
                    Against v1: lead time {versus(dLead, (x) => `${num(x)} min`)}, cost per unit {versus(dUnit, money)}, build cost {versus(dBuild, money)}.
                  </p>
                )}
              </div>
              <div className="section">
                <h3>How busy each step is</h3>
                <div className="utils">
                  {Object.entries(sim.utilisation).map(([name, u]) => (
                    <div key={name} className="util">
                      <span>{name}</span>
                      <div className="bar">
                        <i style={{ width: `${Math.min(100, u * 100)}%` }} className={u >= 0.85 ? 'hot' : ''} />
                      </div>
                      <em>{num(u * 100, 0)}%</em>
                    </div>
                  ))}
                </div>
                {hot && (
                  <p className="say">
                    <b className="warn">{sim.bottleneck.name === 'forklift' ? 'The forklift' : sim.bottleneck.name[0].toUpperCase() + sim.bottleneck.name.slice(1)}</b> is the bottleneck
                    {sim.bottleneck.name === 'forklift' ? `: it carries each unit ${num(metrics.routeTotals.forkliftM, 0)} m.` : '.'}
                  </p>
                )}
              </div>
              <div className="section">
                <h3>What if</h3>
                <label className="slider">
                  <span>
                    Demand <b>{draft.demandPerHour} an hour</b>
                  </span>
                  <input type="range" min={5} max={Math.max(80, current.spec.demandPerHour * 2)} step={1} value={draft.demandPerHour} onChange={(e) => tryOp({ op: 'setParam', path: 'demandPerHour', value: Number(e.target.value) })} />
                </label>
                <label className="slider">
                  <span>
                    Forklifts <b>{draft.forklifts ?? 1}</b>
                  </span>
                  <input type="range" min={1} max={4} step={1} value={draft.forklifts ?? 1} onChange={(e) => tryOp({ op: 'setParam', path: 'forklifts', value: Number(e.target.value) })} />
                </label>
              </div>
              {sel && (
                <div className="section">
                  <h3>Selected</h3>
                  <p className="say">
                    <b>{sel.name ?? sel.type}</b>
                    <br />
                    {sel.w} × {sel.d} m · {sel.cycleTimeSec} s a unit · {money(sel.price)}
                    {sel.listingUrl && (
                      <>
                        {' · '}
                        <a href={sel.listingUrl} target="_blank" rel="noreferrer">
                          listing
                        </a>
                      </>
                    )}
                  </p>
                  <div className="row">
                    <button className="ghost sm" onClick={() => tryOp({ op: 'rotate', id: sel.id, rot: sel.rot === 0 ? 90 : 0 })}>
                      <Icon name="rotate" size={14} /> Turn
                    </button>
                    <button
                      className="ghost sm"
                      onClick={() => {
                        tryOp({ op: 'remove', id: sel.id });
                        setSelected(null);
                      }}
                    >
                      <Icon name="trash" size={14} /> Remove
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'improve' && (
            <>
              <div className="section">
                <h3>Meet demand, then go for the lowest</h3>
                <div className="segmented" role="radiogroup" aria-label="Goal">
                  {GOALS.map((g) => (
                    <button key={g.id} role="radio" aria-checked={goal === g.id} className={goal === g.id ? 'on' : ''} disabled={busy} onClick={() => setGoal(g.id)}>
                      {g.label}
                    </button>
                  ))}
                </div>
                <div className="row">
                  <button className="primary" disabled={busy} onClick={() => void improve()}>
                    Improve this layout
                  </button>
                  <button className="text" disabled={busy} onClick={() => void deepSearch()} title="A managed agent runs eight seeded searches in a remote sandbox">
                    Search in a sandbox
                  </button>
                </div>
              </div>

              {busy && mode && (
                <div className="section">
                  <div className="live">
                    <span className="spinner ink" />
                    {run.live ?? 'Working'}
                  </div>
                  {run.events.map((e, i) => (
                    <div key={i} className={`tried ${e.status === 'fail' ? 'rejected' : /: kept “/.test(e.title) ? 'kept' : ''}`}>
                      <Icon name={e.status === 'fail' ? 'x' : 'check'} size={14} />
                      <div>
                        <b>{e.title}</b>
                        {e.detail && <span>{e.detail}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!busy && improved && (
                <>
                  <div className="section">
                    <p className="say">
                      {improved.kept.length ? (
                        <>
                          Kept <b>{improved.kept.length}</b> change{improved.kept.length > 1 ? 's' : ''} over {improved.rounds.length} rounds, saved as {improved.saved.join(' and ')}. Stopped because {improved.stopped}.
                        </>
                      ) : (
                        <>Nothing beat the layout you have. Stopped because {improved.stopped}.</>
                      )}
                      {!improved.meetsDemand && <b className="warn"> It still falls short of demand.</b>}
                    </p>
                    {improved.kept.length > 0 && <DeltaLine d={improved.deltas} />}
                    {improved.explanation && <p className="muted small">{improved.explanation}</p>}
                  </div>
                  {improved.rounds.map((r) => (
                    <div key={r.n} className="section round">
                      <header>
                        <b>Round {r.n}</b>
                        <span className="muted small">{(r.ms / 1000).toFixed(0)} s</span>
                      </header>
                      {r.tried.map((t, i) => (
                        <div key={i} className={`tried ${t.outcome === 'kept' ? 'kept' : t.outcome === 'rejected' ? 'rejected' : ''}`}>
                          <Icon name={outcomeIcon[t.outcome]} size={14} />
                          <div>
                            <b>
                              {t.name}
                              {t.outcome === 'kept' ? ' · kept' : ''}
                            </b>
                            <span>
                              {t.source === 'search' ? 'Search' : 'Neon'}
                              {t.gate !== undefined ? ` · pre-check ${Math.round(t.gate * 100)}%` : ''}
                              {t.outcome === 'gated out' ? ' · not simulated' : ''}
                              {t.outcome === 'rejected' ? ` · broke a rule: ${(t.errors ?? [])[0] ?? ''}` : ''}
                            </span>
                            {t.deltas && <DeltaLine d={t.deltas} />}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </>
              )}

              {!busy && sandbox && (
                <div className="section round">
                  <p className="muted small">{sandbox.explanation}</p>
                  {sandbox.candidates.map((c, i) => (
                    <div key={i} className={`tried ${c.status === 'invalid' ? 'rejected' : ''}`}>
                      <Icon name={c.status === 'invalid' ? 'x' : 'minus'} size={14} />
                      <div>
                        <b>{c.name}</b>
                        {c.deltas && <DeltaLine d={c.deltas} />}
                        {c.status === 'invalid' && <span>Broke a rule: {(c.errors ?? [])[0]}</span>}
                        {c.spec && (
                          <div className="row" style={{ marginTop: 4 }}>
                            <button className="ghost sm" onClick={() => applySpec(c.name, c.spec!)}>
                              Apply to draft
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'equipment' && (
            <div className="section">
              {bill.map((r, i) => (
                <div key={i} className="bill-row">
                  <span>
                    {r.qty} × {r.name}
                  </span>
                  <span>{money(r.qty * r.price)}</span>
                  {r.checkoutUrl || r.listingUrl ? (
                    <a className="small" href={r.checkoutUrl ? r.checkoutUrl.replace(/:1(?=\?|$)/, `:${r.qty}`) : r.listingUrl} target="_blank" rel="noreferrer">
                      {r.checkoutUrl ? 'Buy' : 'Listing'}
                    </a>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
              <div className="bill-row">
                <b>Total</b>
                <b>{money(bill.reduce((t, r) => t + r.qty * r.price, 0))}</b>
                <span />
              </div>
              <div className="row">
                <button className="ghost sm" onClick={onPlan}>
                  Change equipment
                </button>
              </div>
            </div>
          )}

          {tab === 'versions' && (
            <>
              {versions.map((v) => (
                <button key={v.id} className={`version${v.id === current.id ? ' on' : ''}`} onClick={() => onChange({ currentId: v.id })} title={v.diff.join('\n')}>
                  <span className="version-id">{v.id}</span>
                  <span className="version-body">
                    <b>{v.label}</b>
                    <span>
                      {num(v.metrics.sim.unitsPerHour.median)} an hour · {num(v.metrics.sim.leadTimeSec.median / 60)} min · {money(v.metrics.cost.costPerUnit)} a unit
                    </span>
                  </span>
                </button>
              ))}
              <div className="section">
                <div className="row">
                  <button className="ghost sm" disabled={versions.length < 2} onClick={() => setCmp({ a: v1.id, b: current.id === v1.id ? versions[versions.length - 1].id : current.id })}>
                    Compare two versions
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {dirty && (
          <div className="panel-foot">
            <span>Unsaved changes</span>
            <button className="text sm" onClick={() => setDraft(current.spec)}>
              Discard
            </button>
            <button className="primary sm" onClick={save}>
              Save as v{nextN}
            </button>
          </div>
        )}
      </aside>

      <div className="dock" style={narrow ? undefined : { right: PANEL + 40 }}>
        {liveErrors.length > 0 && (
          <Notice tone="error" title={preview ? 'It cannot go here' : 'That change breaks a layout rule'} lines={liveErrors.slice(0, 3).map((e) => e.message)} onClose={preview ? undefined : () => setRejected([])} />
        )}
        {notice && !liveErrors.length && <Notice tone={notice.tone} title={notice.title} lines={notice.lines} onClose={() => setNotice(null)} />}
        <RunStatus state={run} />
        <form
          className="prompt"
          onSubmit={(e) => {
            e.preventDefault();
            if (command.trim()) void sendEdit({ text: command.trim() });
          }}
        >
          <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Say what to change, like move shipping to the south wall" disabled={busy} aria-label="Change the layout in words" />
          <button type="button" className={recording ? 'ghost rec sm' : 'icon-btn'} disabled={busy && !recording} onClick={() => void toggleMic()} aria-label={recording ? 'Stop recording and apply' : 'Speak a change'} title={recording ? 'Stop and apply' : 'Speak a change'}>
            <Icon name={recording ? 'stop' : 'mic'} /> {recording ? 'Stop' : ''}
          </button>
          <button className="primary" disabled={busy || !command.trim()} aria-label="Apply the change">
            <Icon name="arrowUp" />
          </button>
        </form>
      </div>

      {cmp && cmpA && cmpB && <CompareModal versions={versions} a={cmpA} b={cmpB} onPick={(k, id) => setCmp({ ...cmp, [k]: id })} onClose={() => setCmp(null)} />}
    </div>
  );
}
