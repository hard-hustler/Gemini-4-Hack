import { useEffect, useMemo, useRef, useState } from 'react';
import { compare, evaluate, makeVersion, type Metrics, type Version } from './engines/versions';
import { validate, type ValidationError } from './engines/validate';
import { workshop } from './fixtures/workshop';
import { applyOp, type EditOp, type FactorySpec } from './spec';
import { fileToBase64, startRecording, type Recorder } from './ui/audio';
import { Scene, type Layers } from './ui/Scene';

const STORE_KEY = 'dryrun.versions.v1';

interface Confidence {
  confidence: number;
  readAs: string;
}
interface Notice {
  tone: 'ok' | 'error';
  title: string;
  lines: string[];
}

async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
  if (!res.ok) {
    const tried = Array.isArray(json.attempts) ? ` (${json.attempts.length} attempts)` : '';
    const errs = Array.isArray(json.errors) ? json.errors.map((e: { message: string }) => e.message) : [];
    throw Object.assign(new Error(`${json.error ?? 'Request failed'}${tried}`), { lines: errs });
  }
  return json as T;
}

interface Candidate {
  name: string;
  reason: string;
  ops: EditOp[];
  status: 'evaluated' | 'invalid' | 'gated_out';
  errors?: string[];
  gate?: number;
  repaired?: boolean;
  spec?: FactorySpec;
  score?: number;
  deltas?: { uph: number; leadMin: number; costPerUnit: number; buildCost: number; forkliftM: number };
}
interface Proposal {
  explanation: string;
  candidates: Candidate[];
  stats: { proposed: number; firstPassValid: number; validAfterRepair: number; gateError?: string; ms: { propose: number; repair: number; gate: number; simulate: number; total: number } };
}

const describeOp = (op: EditOp): string => {
  switch (op.op) {
    case 'move':
      return `move ${op.id} to ${op.x},${op.y}`;
    case 'rotate':
      return `rotate ${op.id} to ${op.rot}`;
    case 'add':
      return `add ${op.station.id} (${op.station.type})`;
    case 'remove':
      return `remove ${op.id}`;
    case 'moveDock':
      return `move dock ${op.index} to ${op.wall} wall at ${op.offset} m`;
    case 'setParam':
      return `set ${op.path} = ${op.value}`;
  }
};

function loadVersions(): Version[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Version[]) : [];
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* fall through to the fixture */
  }
  const ev = evaluate(workshop);
  if (!ev.ok) throw new Error('Fixture spec is invalid: ' + ev.errors.map((e) => e.message).join('; '));
  return [makeVersion(workshop, ev.metrics, null, 1, 'Fixture plan')];
}

const money = (v: number) => (Number.isFinite(v) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: v < 100 ? 2 : 0 })}` : 'n/a');
const num = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'good' }) {
  return (
    <div className={`metric ${tone ?? ''}`}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      {sub && <span className="metric-sub">{sub}</span>}
    </div>
  );
}

function Saved({ base, now }: { base: Metrics; now: Metrics }) {
  const dLead = (base.sim.leadTimeSec.median - now.sim.leadTimeSec.median) / 60;
  const dUnit = base.cost.costPerUnit - now.cost.costPerUnit;
  const dBuild = base.cost.buildCost - now.cost.buildCost;
  const fmt = (v: number, f: (x: number) => string) => `${v >= 0 ? '' : '+'}${f(Math.abs(v))}${v >= 0 ? ' saved' : ' more'}`;
  const tone = dLead + dUnit + dBuild > 0 ? 'good' : dLead + dUnit + dBuild < 0 ? 'warn' : undefined;
  return (
    <Metric
      label="vs v1"
      tone={tone}
      value={fmt(dLead, (x) => `${num(x)} min`)}
      sub={`${fmt(dUnit, money)}/unit · build ${fmt(dBuild, money)}`}
    />
  );
}

function ComparePanel({ a, b, layers, onClose }: { a: Version; b: Version; layers: Layers; onClose: () => void }) {
  const rows = compare(a.metrics, b.metrics);
  const evA = useMemo(() => evaluate(a.spec, 1), [a]);
  const evB = useMemo(() => evaluate(b.spec, 1), [b]);
  return (
    <div className="compare">
      <header>
        <h2>
          {a.id} vs {b.id}
        </h2>
        <button onClick={onClose}>Close</button>
      </header>
      <div className="compare-views">
        {[
          { v: a, ev: evA },
          { v: b, ev: evB },
        ].map(({ v, ev }) => (
          <div key={v.id} className="compare-view">
            <span className="tag">
              {v.id} · {v.label}
            </span>
            <Scene spec={v.spec} routes={ev.ok ? ev.routes : null} layers={layers} bottleneck={v.metrics.sim.bottleneck.name} interactive={false} />
          </div>
        ))}
      </div>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
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
              <td className={r.better === null ? '' : r.better ? 'good' : 'warn'}>
                {r.delta > 0 ? '+' : ''}
                {r.unit === '$' ? money(r.delta).replace('$-', '-$') : num(r.delta, 2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="diff">
        <b>Changes in {b.id}:</b> {b.diff.join(' · ') || 'none'}
      </div>
    </div>
  );
}

export default function App() {
  const [versions, setVersions] = useState<Version[]>(loadVersions);
  const [currentId, setCurrentId] = useState(() => versions[versions.length - 1].id);
  const current = versions.find((v) => v.id === currentId) ?? versions[versions.length - 1];
  // draft is always a validated spec; preview is whatever is under the cursor mid-drag
  const [draft, setDraft] = useState<FactorySpec>(current.spec);
  const [preview, setPreview] = useState<FactorySpec | null>(null);
  const [rejected, setRejected] = useState<ValidationError[]>([]);
  const [layers, setLayers] = useState<Layers>({ flow: true, forklift: true, power: false, water: false, docks: true });
  const [cmp, setCmp] = useState<{ a: string; b: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confidence, setConfidence] = useState<Record<string, Confidence>>({});
  const [command, setCommand] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<Recorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    setNotice(null);
    try {
      await job();
    } catch (e) {
      const err = e as Error & { lines?: string[] };
      setNotice({ tone: 'error', title: err.message, lines: err.lines ?? [] });
    } finally {
      setBusy(null);
    }
  };

  /** Hydrogen reads the plan, the server validates it, and it becomes v1 of a new timeline. */
  const readPlan = (blob: Blob, mimeType: string) =>
    run('Reading plan with Hydrogen', async () => {
      const out = await api<{ spec: FactorySpec; notes: string; attempts: { errors: string[] }[]; confidence: Record<string, Confidence>; confidenceError?: string; ms: number }>(
        '/api/read',
        { mimeType, data: await fileToBase64(blob) },
      );
      const ev = evaluate(out.spec);
      if (!ev.ok) throw Object.assign(new Error('Server returned a layout that fails validation'), { lines: ev.errors.map((x) => x.message) });
      const v = makeVersion(out.spec, ev.metrics, null, 1, 'Read from plan');
      setVersions([v]);
      setCurrentId(v.id);
      setDraft(v.spec);
      setRejected([]);
      setConfidence(out.confidence);
      const unsure = Object.entries(out.confidence).filter(([, c]) => c.confidence < 0.7);
      setNotice({
        tone: 'ok',
        title: `Plan read in ${(out.ms / 1000).toFixed(1)} s, ${out.attempts.length} attempt${out.attempts.length > 1 ? 's' : ''}`,
        lines: [
          `${out.spec.stations.length} stations, ${out.spec.docks.length} docks`,
          unsure.length ? `Check: ${unsure.map(([id, c]) => `${id} (${Math.round(c.confidence * 100)}%, looks like ${c.readAs})`).join(', ')}` : 'Decisions API is confident in every element',
          ...(out.confidenceError ? [`Confidence check failed: ${out.confidenceError}`] : []),
          out.notes,
        ].filter(Boolean),
      });
    });

  /** Hydrogen turns a typed or spoken instruction into ops; the server only returns ops that validate. */
  const sendEdit = (payload: { text?: string; audio?: { mimeType: string; data: string } }) =>
    run(payload.audio ? 'Listening with Hydrogen' : 'Planning edit with Hydrogen', async () => {
      const out = await api<{ ops: EditOp[]; spec: FactorySpec; transcript: string; reason: string; attempts: unknown[] }>('/api/edit', { spec: draft, ...payload });
      if (!out.ops.length) {
        setNotice({ tone: 'error', title: 'No change made', lines: [`"${out.transcript}"`, out.reason] });
        return;
      }
      setDraft(out.spec);
      setRejected([]);
      setCommand('');
      setNotice({ tone: 'ok', title: `"${out.transcript}"`, lines: [...out.ops.map(describeOp), out.attempts.length > 1 ? `took ${out.attempts.length} attempts to validate` : ''].filter(Boolean) });
    });

  /** Neon proposes, the server validates, gates and simulates; we only ever see validated candidates' specs. */
  const improve = () =>
    run('Neon is proposing improvements', async () => {
      setProposal(await api<Proposal>('/api/optimise', { spec: draft }));
    });

  const applyCandidate = (c: Candidate) => {
    if (!c.spec) return;
    const errs = validate(c.spec);
    if (errs.length) return void setRejected(errs);
    setDraft(c.spec);
    setRejected([]);
    setNotice({ tone: 'ok', title: `Applied "${c.name}"`, lines: c.ops.map(describeOp) });
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

  const readSample = async () => readPlan(await (await fetch('/sample-sketch.png')).blob(), 'image/png');

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(versions));
    } catch {
      /* storage is a convenience only */
    }
  }, [versions]);

  const evaluation = useMemo(() => evaluate(draft), [draft]);
  const previewErrors = useMemo(() => (preview ? validate(preview) : []), [preview]);
  const metrics = evaluation.ok ? evaluation.metrics : current.metrics;
  const dirty = JSON.stringify(draft) !== JSON.stringify(current.spec);
  const shown = preview ?? draft;

  /** Every edit goes through here: apply op, validate, accept or reject with the specific errors. */
  const tryOp = (op: EditOp) => {
    let next: FactorySpec;
    try {
      next = applyOp(draft, op);
    } catch (e) {
      setRejected([{ code: 'param', message: (e as Error).message, ids: [] }]);
      return;
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
    const n = Math.max(...versions.map((v) => v.n)) + 1;
    const v = makeVersion(draft, evaluation.metrics, current, n, 'Manual edit');
    setVersions([...versions, v]);
    setCurrentId(v.id);
  };
  const open = (v: Version) => {
    setCurrentId(v.id);
    setDraft(v.spec);
    setRejected([]);
  };
  const reset = () => {
    localStorage.removeItem(STORE_KEY);
    const fresh = loadVersions();
    setVersions(fresh);
    setCurrentId(fresh[0].id);
    setDraft(fresh[0].spec);
    setRejected([]);
    setCmp(null);
    setConfidence({});
    setNotice(null);
    setProposal(null);
  };

  const sim = metrics.sim;
  const v1 = versions[0];
  const liveErrors = preview ? previewErrors : rejected;
  const cmpA = cmp && versions.find((v) => v.id === cmp.a);
  const cmpB = cmp && versions.find((v) => v.id === cmp.b);

  return (
    <div className="app">
      <div className="stage">
        <Scene
          spec={shown}
          routes={!preview && evaluation.ok ? evaluation.routes : null}
          layers={layers}
          badIds={previewErrors.flatMap((e) => e.ids)}
          bottleneck={sim.bottleneck.name}
          confidence={confidence}
          onDrag={onDrag}
          onDrop={onDrop}
        />
      </div>

      <header className="topbar">
        <div className="brand">
          <h1>Dry Run</h1>
          <span>{draft.name ?? 'Untitled plan'}</span>
        </div>
        <div className="strip">
          <Metric label="Units / hour" value={num(sim.unitsPerHour.median)} sub={`${num(sim.unitsPerHour.low)} to ${num(sim.unitsPerHour.high)} · demand ${draft.demandPerHour}`} />
          <Metric label="Bottleneck" value={sim.bottleneck.name} sub={`${num(sim.bottleneck.utilisation * 100, 0)}% busy`} tone={sim.bottleneck.utilisation > 0.85 ? 'warn' : undefined} />
          <Metric label="Lead time" value={`${num(sim.leadTimeSec.median / 60)} min`} sub={`WIP ${num(sim.wip.median)} units`} />
          <Metric label="Cost / unit" value={money(metrics.cost.costPerUnit)} sub={`${num(metrics.cost.kwhPerUnit, 3)} kWh/unit`} />
          <Metric label="Build cost" value={money(metrics.cost.buildCost)} sub={`runs ${money(metrics.cost.utilityRunCost)}`} />
          <Metric label="Forklift travel" value={`${num(metrics.cost.forkliftMPerHour / 1000, 2)} km/h`} sub={`${num(metrics.routeTotals.forkliftM)} m per unit`} />
          <Saved base={v1.metrics} now={metrics} />
        </div>
      </header>

      <aside className="tools">
        <div className="group">
          <span className="group-title">Plan in</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readPlan(f, f.type || 'image/jpeg');
              e.target.value = '';
            }}
          />
          <button disabled={!!busy} onClick={() => fileInput.current?.click()}>
            Sketch photo or PDF
          </button>
          <button disabled={!!busy} onClick={() => void readSample()}>
            Try the sample sketch
          </button>
          <span className="group-title">Edit by voice or text</span>
          <button className={recording ? 'rec' : ''} disabled={!!busy && !recording} onClick={() => void toggleMic()}>
            {recording ? 'Stop and apply' : 'Voice edit'}
          </button>
          <form
            className="command"
            onSubmit={(e) => {
              e.preventDefault();
              if (command.trim()) void sendEdit({ text: command.trim() });
            }}
          >
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="move the dock to the north wall" disabled={!!busy} />
            <button disabled={!!busy || !command.trim()}>Go</button>
          </form>
        </div>
        <div className="group">
          <span className="group-title">Improve</span>
          <button className="primary" disabled={!!busy} onClick={() => void improve()}>
            Improve with Neon
          </button>
        </div>
        <div className="group">
          <span className="group-title">Layers</span>
          {(
            [
              ['flow', 'Process flow'],
              ['forklift', 'Forklift routes'],
              ['power', 'Power'],
              ['water', 'Water'],
              ['docks', 'Docks'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className={`toggle ${key}`}>
              <input type="checkbox" checked={layers[key]} onChange={(e) => setLayers({ ...layers, [key]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
        <div className="group">
          <span className="group-title">Test</span>
          <label className="field">
            Demand / hour <b>{draft.demandPerHour}</b>
            <input type="range" min={5} max={60} step={1} value={draft.demandPerHour} onChange={(e) => tryOp({ op: 'setParam', path: 'demandPerHour', value: Number(e.target.value) })} />
          </label>
          <label className="field">
            Forklifts <b>{draft.forklifts ?? 1}</b>
            <input type="range" min={1} max={4} step={1} value={draft.forklifts ?? 1} onChange={(e) => tryOp({ op: 'setParam', path: 'forklifts', value: Number(e.target.value) })} />
          </label>
        </div>
        <div className="group">
          <span className="group-title">Utilisation</span>
          {Object.entries(sim.utilisation).map(([name, u]) => (
            <div key={name} className="util">
              <span>{name}</span>
              <div className="bar">
                <i style={{ width: `${Math.min(100, u * 100)}%` }} className={u > 0.85 ? 'hot' : ''} />
              </div>
              <em>{num(u * 100, 0)}%</em>
            </div>
          ))}
        </div>
        <p className="hint">Drag a station to move it. Drag the floor to orbit.</p>
      </aside>

      {liveErrors.length > 0 && (
        <div className="errors" role="alert">
          <b>{preview ? 'Not valid here' : 'Edit rejected'}</b>
          {liveErrors.slice(0, 4).map((e, i) => (
            <span key={i}>{e.message}</span>
          ))}
          {!preview && <button onClick={() => setRejected([])}>Dismiss</button>}
        </div>
      )}

      {proposal && (
        <aside className="proposal">
          <header>
            <b>Neon's read</b>
            <button onClick={() => setProposal(null)}>Close</button>
          </header>
          <p>{proposal.explanation}</p>
          <span className="fine">
            {proposal.stats.proposed} proposed · {proposal.stats.firstPassValid} valid first pass · {proposal.stats.validAfterRepair} valid after repair ·{' '}
            {(proposal.stats.ms.total / 1000).toFixed(0)} s (gate {proposal.stats.ms.gate} ms)
            {proposal.stats.gateError ? ` · gate failed: ${proposal.stats.gateError}` : ''}
          </span>
          {proposal.candidates.map((c, i) => (
            <div key={i} className={`cand ${c.status}`}>
              <div className="cand-head">
                <b>{c.name}</b>
                {c.gate !== undefined && <em title="Decisions API score before simulation">gate {Math.round(c.gate * 100)}%</em>}
              </div>
              <span>{c.reason}</span>
              {c.deltas && (
                <div className="deltas">
                  <i className={c.deltas.leadMin < 0 ? 'good' : 'warn'}>{c.deltas.leadMin > 0 ? '+' : ''}{num(c.deltas.leadMin)} min lead</i>
                  <i className={c.deltas.costPerUnit <= 0 ? 'good' : 'warn'}>{c.deltas.costPerUnit > 0 ? '+' : '-'}${num(Math.abs(c.deltas.costPerUnit), 2)}/unit</i>
                  <i className={c.deltas.buildCost <= 0 ? 'good' : 'warn'}>{c.deltas.buildCost > 0 ? '+' : '-'}${num(Math.abs(c.deltas.buildCost), 0)} build</i>
                  <i className={c.deltas.uph >= -0.3 ? '' : 'warn'}>{c.deltas.uph > 0 ? '+' : ''}{num(c.deltas.uph)} u/h</i>
                </div>
              )}
              {c.status === 'invalid' && <span className="warn">Rejected by validate(): {(c.errors ?? []).slice(0, 2).join('; ')}</span>}
              {c.status === 'gated_out' && <span className="fine">Gate ranked this below the cut; simulated anyway so you can audit the gate.</span>}
              {c.repaired && <span className="fine">Repaired after a failed first attempt.</span>}
              {c.spec && (
                <button disabled={!!busy} onClick={() => applyCandidate(c)}>
                  Apply to draft
                </button>
              )}
            </div>
          ))}
        </aside>
      )}

      {(busy || notice) && (
        <div className={`notice ${busy ? 'busy' : notice!.tone}`} role="status">
          {busy ? (
            <b>{busy}…</b>
          ) : (
            <>
              <b>{notice!.title}</b>
              {notice!.lines.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
              <button onClick={() => setNotice(null)}>Dismiss</button>
            </>
          )}
        </div>
      )}

      <footer className="timeline">
        <div className="versions">
          {versions.map((v) => (
            <button key={v.id} className={`version ${v.id === current.id ? 'active' : ''}`} onClick={() => open(v)} title={v.diff.join('\n')}>
              <b>{v.id}</b>
              <span>{num(v.metrics.sim.unitsPerHour.median)} u/h</span>
              <span>{money(v.metrics.cost.costPerUnit)}/unit</span>
            </button>
          ))}
          {dirty && <div className="version draft">draft</div>}
        </div>
        <div className="actions">
          <button className="primary" disabled={!dirty} onClick={save}>
            Save as v{Math.max(...versions.map((v) => v.n)) + 1}
          </button>
          <button disabled={!dirty} onClick={() => open(current)}>
            Discard draft
          </button>
          <button disabled={versions.length < 2} onClick={() => setCmp({ a: v1.id, b: current.id === v1.id ? versions[versions.length - 1].id : current.id })}>
            Compare
          </button>
          <button onClick={reset}>Reset</button>
        </div>
      </footer>

      {cmp && cmpA && cmpB && (
        <div className="overlay">
          <div className="pickers">
            {(['a', 'b'] as const).map((k) => (
              <select key={k} value={cmp[k]} onChange={(e) => setCmp({ ...cmp, [k]: e.target.value })}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id} · {v.label}
                  </option>
                ))}
              </select>
            ))}
          </div>
          <ComparePanel a={cmpA} b={cmpB} layers={layers} onClose={() => setCmp(null)} />
        </div>
      )}
    </div>
  );
}
