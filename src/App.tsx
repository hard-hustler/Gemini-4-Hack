import { useEffect, useMemo, useState } from 'react';
import { compare, evaluate, makeVersion, type Metrics, type Version } from './engines/versions';
import { validate, type ValidationError } from './engines/validate';
import { workshop } from './fixtures/workshop';
import { applyOp, type EditOp, type FactorySpec } from './spec';
import { Scene, type Layers } from './ui/Scene';

const STORE_KEY = 'dryrun.versions.v1';

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
          <button disabled title="Arrives with the Gemini milestone">Sketch photo</button>
          <button disabled title="Arrives with the Gemini milestone">Voice edit</button>
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
