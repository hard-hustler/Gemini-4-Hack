import { useEffect, useMemo, useRef, useState } from 'react';
import type { TraceEvent } from '../contracts';
import { compare, evaluate, makeVersion, type Version } from '../engines/versions';
import { validate, type ValidationError } from '../engines/validate';
import { applyOp, type EditOp, type FactorySpec } from '../spec';
import { api, ApiError, money, num, type Project } from '../store';
import { startRecording, type Recorder } from '../ui/audio';
import { Notice, TopBar, Tracker } from '../ui/common';
import { Scene, type Layers } from '../ui/Scene';

interface Candidate {
  name: string;
  reason: string;
  ops: EditOp[];
  status: 'evaluated' | 'invalid' | 'gated_out';
  errors?: string[];
  gate?: number;
  repaired?: boolean;
  spec?: FactorySpec;
  deltas?: { uph: number; leadMin: number; costPerUnit: number; buildCost: number; forkliftM: number };
}
interface Proposal {
  explanation: string;
  candidates: Candidate[];
  stats: { proposed: number; firstPassValid: number; validAfterRepair: number; gateError?: string; ms: { propose: number; gate: number; total: number } };
}

const describeOp = (op: EditOp): string => {
  switch (op.op) {
    case 'move':
      return `Move ${op.id} to ${op.x}, ${op.y}`;
    case 'rotate':
      return `Rotate ${op.id} to ${op.rot}°`;
    case 'add':
      return `Add ${op.station.id} (${op.station.type})`;
    case 'remove':
      return `Remove ${op.id}`;
    case 'moveDock':
      return `Move dock ${op.index} to the ${op.wall} wall at ${op.offset} m`;
    case 'setParam':
      return `Set ${op.path} to ${op.value}`;
  }
};

const PANEL = 392;
type Tab = 'overview' | 'improve' | 'equipment' | 'versions';

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'good' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="eyebrow">{label}</span>
      <b>{value}</b>
      {sub && <span>{sub}</span>}
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
      <div className="compare" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Compare versions</h2>
          <button className="ghost small" onClick={onClose}>
            Close
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
              <select value={v.id} onChange={(e) => onPick(k, e.target.value)} aria-label={`Version ${k.toUpperCase()}`}>
                {versions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.id} · {x.label}
                  </option>
                ))}
              </select>
              <Scene spec={v.spec} routes={ev.ok ? ev.routes : null} layers={layers} bottleneck={v.metrics.sim.bottleneck.name} interactive={false} animate={false} />
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
                  {r.delta > 0 ? '+' : r.delta < 0 ? '−' : ''}
                  {r.unit === '$' ? money(Math.abs(r.delta)) : num(Math.abs(r.delta), 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          <b>Changed in {b.id}:</b> {b.diff.join(' · ') || 'nothing'}
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
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; title: string; lines: string[] } | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>(project.trace);
  const [command, setCommand] = useState('');
  const [recording, setRecording] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [cmp, setCmp] = useState<{ a: string; b: string } | null>(null);
  const recorder = useRef<Recorder | null>(null);

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

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    setNotice(null);
    try {
      await job();
    } catch (e) {
      const err = e as ApiError;
      setNotice({ tone: 'error', title: err.message, lines: err.lines ?? [] });
    } finally {
      setBusy(null);
    }
  };
  const log = (e: TraceEvent) => setEvents((cur) => [...cur, e]);

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

  const save = (label = 'Edited layout') => {
    if (!evaluation.ok || !dirty) return;
    const v = makeVersion(draft, evaluation.metrics, current, nextN, label);
    onChange({ versions: [...versions, v], currentId: v.id });
  };

  const sendEdit = (payload: { text?: string; audio?: { mimeType: string; data: string } }) =>
    run(payload.audio ? 'Hydrogen is listening' : 'Hydrogen is planning the edit', async () => {
      const t = Date.now();
      const out = await api<{ ops: EditOp[]; spec: FactorySpec; transcript: string; reason: string; attempts: unknown[] }>('/api/edit', { spec: draft, ...payload });
      if (!out.ops.length) {
        log({ stage: 'plan', actor: 'hydrogen', title: `No change for "${out.transcript}"`, detail: out.reason, ms: Date.now() - t, status: 'fail' });
        return void setNotice({ tone: 'error', title: 'No change made', lines: [`“${out.transcript}”`, out.reason] });
      }
      setDraft(out.spec);
      setRejected([]);
      setCommand('');
      log({ stage: 'plan', actor: 'hydrogen', title: `Edit: "${out.transcript}"`, detail: `${out.ops.length} op${out.ops.length > 1 ? 's' : ''}, valid after ${out.attempts.length} attempt${out.attempts.length > 1 ? 's' : ''}`, ms: Date.now() - t, status: out.attempts.length > 1 ? 'retry' : 'ok' });
      setNotice({ tone: 'ok', title: `“${out.transcript}”`, lines: out.ops.map(describeOp) });
    });

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

  const propose = (path: '/api/optimise' | '/api/deep-search', label: string, actor: TraceEvent['actor']) =>
    run(label, async () => {
      const out = await api<Proposal>(path, { spec: draft });
      setProposal(out);
      setTab('improve');
      const ok = out.candidates.filter((c) => c.status !== 'invalid').length;
      log({ stage: 'improve', actor, title: actor === 'neon' ? 'Neon proposed improvements' : 'Agent searched in its sandbox', detail: `${out.stats.proposed} proposed, ${ok} valid and simulated`, ms: out.stats.ms.total, status: 'ok' });
    });

  const applyCandidate = (c: Candidate) => {
    if (!c.spec) return;
    const errs = validate(c.spec);
    if (errs.length) return void setRejected(errs);
    // keep display fields the model never sees
    const withLook: FactorySpec = { ...c.spec, stations: c.spec.stations.map((s) => ({ ...draft.stations.find((d) => d.id === s.id), ...s })) };
    setDraft(withLook);
    setRejected([]);
    setNotice({ tone: 'ok', title: `Applied “${c.name}” to the draft`, lines: c.ops.map(describeOp) });
  };

  const liveErrors = preview ? previewErrors : rejected;
  const sel = selected ? shown.stations.find((s) => s.id === selected) : null;
  const dLead = (v1.metrics.sim.leadTimeSec.median - sim.leadTimeSec.median) / 60;
  const dUnit = v1.metrics.cost.costPerUnit - metrics.cost.costPerUnit;
  const dBuild = v1.metrics.cost.buildCost - metrics.cost.buildCost;
  const saved = (v: number, f: (x: number) => string) => `${f(Math.abs(v))} ${v >= 0 ? 'less' : 'more'}`;
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

  return (
    <div className="page workspace">
      <TopBar
        onHome={onHome}
        crumbs={[{ label: 'Brief' }, { label: 'Equipment', onClick: onPlan }, { label: 'Simulation', active: true }]}
        right={
          <a className="link" href="/eval/index.html" target="_blank" rel="noreferrer">
            Eval results
          </a>
        }
      />
      <div className="stage">
        <Scene
          spec={shown}
          routes={!preview && evaluation.ok ? evaluation.routes : null}
          layers={layers}
          badIds={previewErrors.flatMap((e) => e.ids)}
          bottleneck={sim.bottleneck.utilisation >= 0.85 ? sim.bottleneck.name : undefined}
          selectedId={selected}
          insetRight={PANEL + 24}
          onSelect={setSelected}
          onDrag={onDrag}
          onDrop={onDrop}
        />
      </div>

      <div className="stage-title">
        <span className="eyebrow">
          {current.id}
          {dirty ? ' · unsaved draft' : ''} · {draft.floor.width} × {draft.floor.depth} m
        </span>
        <h1>{project.name}</h1>
        <p>
          {num(sim.unitsPerHour.median)} units / h against a demand of {draft.demandPerHour}
        </p>
      </div>

      <div className="layerbar" role="group" aria-label="Layers">
        {(
          [
            ['flow', 'Flow'],
            ['routes', 'All routes'],
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

      <aside className="panel" style={{ width: PANEL }}>
        <nav className="tabs" role="tablist">
          {(['overview', 'improve', 'equipment', 'versions'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'versions' ? `Versions ${versions.length}` : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>

        <div className="panel-body">
          {tab === 'overview' && (
            <>
              <div className="stats">
                <Stat label="Throughput" value={`${num(sim.unitsPerHour.median)} / h`} sub={`${num(sim.unitsPerHour.low)} to ${num(sim.unitsPerHour.high)} across 30 shifts`} tone={sim.unitsPerHour.median < draft.demandPerHour * 0.95 ? 'warn' : undefined} />
                <Stat label="Lead time" value={`${num(sim.leadTimeSec.median / 60)} min`} sub={`${num(sim.wip.median)} units in progress`} />
                <Stat label="Cost per unit" value={money(metrics.cost.costPerUnit)} sub={`${num(metrics.cost.kwhPerUnit, 3)} kWh per unit`} />
                <Stat label="Build cost" value={money(metrics.cost.buildCost)} sub={`${money(metrics.cost.utilityRunCost)} of it utility runs`} />
              </div>
              <div className="card flat">
                <span className="eyebrow">{sim.bottleneck.utilisation >= 0.85 ? 'Bottleneck' : 'Busiest resource'}</span>
                <p className="callout">
                  <b className={sim.bottleneck.utilisation > 0.85 ? 'warn' : ''}>{sim.bottleneck.name === 'forklift' ? 'The forklift' : sim.bottleneck.name}</b> is busy {num(sim.bottleneck.utilisation * 100, 0)}% of the time
                  {sim.bottleneck.name === 'forklift' ? `, carrying each unit ${num(metrics.routeTotals.forkliftM, 0)} m.` : '.'}
                </p>
                <div className="utils">
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
              </div>
              {versions.length > 1 || dirty ? (
                <div className="card flat">
                  <span className="eyebrow">Against v1</span>
                  <p className="callout">
                    Lead time <b className={dLead >= 0 ? 'good' : 'warn'}>{saved(dLead, (x) => `${num(x)} min`)}</b>, cost per unit <b className={dUnit >= 0 ? 'good' : 'warn'}>{saved(dUnit, money)}</b>, build cost{' '}
                    <b className={dBuild >= 0 ? 'good' : 'warn'}>{saved(dBuild, money)}</b>.
                  </p>
                </div>
              ) : null}
              <div className="card flat">
                <span className="eyebrow">What if</span>
                <label className="slider">
                  <span>
                    Demand <b>{draft.demandPerHour} / h</b>
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
                <div className="card flat">
                  <span className="eyebrow">Selected · {sel.id}</span>
                  <p className="callout">
                    <b>{sel.name ?? sel.type}</b>
                  </p>
                  <p className="muted">
                    {sel.w} × {sel.d} m · {sel.cycleTimeSec} s per unit · {money(sel.price)}
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
                    <button className="ghost small" onClick={() => tryOp({ op: 'rotate', id: sel.id, rot: sel.rot === 0 ? 90 : 0 })}>
                      Rotate
                    </button>
                    <button
                      className="ghost small"
                      onClick={() => {
                        tryOp({ op: 'remove', id: sel.id });
                        setSelected(null);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'improve' && (
            <>
              <div className="card flat">
                <span className="eyebrow">Ask for improvements</span>
                <p className="muted">Proposals are checked against every layout rule and simulated before you see them. Nothing changes until you apply one.</p>
                <div className="row">
                  <button className="primary" disabled={!!busy} onClick={() => void propose('/api/optimise', 'Neon is proposing improvements', 'neon')}>
                    Ask Neon
                  </button>
                  <button className="ghost" disabled={!!busy} onClick={() => void propose('/api/deep-search', 'A managed agent is searching in its sandbox', 'agent')}>
                    Deep search
                  </button>
                </div>
              </div>
              {proposal && (
                <>
                  <p className="callout">{proposal.explanation}</p>
                  <span className="fine">
                    {proposal.stats.proposed} proposed · {proposal.stats.validAfterRepair} valid · {(proposal.stats.ms.total / 1000).toFixed(0)} s
                    {proposal.stats.gateError ? ` · gate failed: ${proposal.stats.gateError}` : ''}
                  </span>
                  {proposal.candidates.map((c, i) => (
                    <div key={i} className={`cand ${c.status}`}>
                      <div className="cand-head">
                        <b>{c.name}</b>
                        {c.gate !== undefined && <span className="chip" title="Decisions API score before simulation">gate {Math.round(c.gate * 100)}%</span>}
                      </div>
                      <span className="muted">{c.reason}</span>
                      {c.deltas && (
                        <div className="deltas">
                          <span className={c.deltas.leadMin < 0 ? 'good' : 'warn'}>
                            {c.deltas.leadMin > 0 ? '+' : '−'}
                            {num(Math.abs(c.deltas.leadMin))} min lead
                          </span>
                          <span className={c.deltas.costPerUnit <= 0 ? 'good' : 'warn'}>
                            {c.deltas.costPerUnit > 0 ? '+' : '−'}
                            {money(Math.abs(c.deltas.costPerUnit))} / unit
                          </span>
                          <span className={c.deltas.buildCost <= 0 ? 'good' : 'warn'}>
                            {c.deltas.buildCost > 0 ? '+' : '−'}
                            {money(Math.abs(c.deltas.buildCost))} build
                          </span>
                          <span className={c.deltas.uph >= -0.3 ? '' : 'warn'}>
                            {c.deltas.uph >= 0 ? '+' : '−'}
                            {num(Math.abs(c.deltas.uph))} / h
                          </span>
                        </div>
                      )}
                      {c.status === 'invalid' && <span className="warn">Rejected by the layout rules: {(c.errors ?? []).slice(0, 2).join('; ')}</span>}
                      {c.status === 'gated_out' && <span className="fine">Ranked below the cut by the pre-simulation gate; simulated anyway so you can judge the gate.</span>}
                      {c.repaired && <span className="fine">First attempt broke a rule; this is the repaired version.</span>}
                      {c.spec && (
                        <button className="ghost small" disabled={!!busy} onClick={() => applyCandidate(c)}>
                          Apply to draft
                        </button>
                      )}
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {tab === 'equipment' && (
            <>
              <div className="card flat">
                <div className="cand-head">
                  <span className="eyebrow">Bill of equipment</span>
                  <b>{money(bill.reduce((t, r) => t + r.qty * r.price, 0))}</b>
                </div>
                {bill.map((r, i) => (
                  <div key={i} className="bill-row">
                    <span>
                      <b>{r.qty} ×</b> {r.name}
                    </span>
                    <span>{money(r.qty * r.price)}</span>
                    {(r.checkoutUrl || r.listingUrl) && (
                      <a href={r.checkoutUrl ? r.checkoutUrl.replace(/:1(?=\?|$)/, `:${r.qty}`) : r.listingUrl} target="_blank" rel="noreferrer">
                        {r.checkoutUrl ? 'Checkout' : 'Listing'}
                      </a>
                    )}
                  </div>
                ))}
                <p className="fine">Items picked from Shop keep their seller's checkout link. Nothing is ordered from here.</p>
              </div>
              <button className="ghost" onClick={onPlan}>
                Change equipment
              </button>
            </>
          )}

          {tab === 'versions' && (
            <>
              <div className="versions">
                {versions.map((v) => (
                  <button key={v.id} className={`version${v.id === current.id ? ' on' : ''}`} onClick={() => onChange({ currentId: v.id })} title={v.diff.join('\n')}>
                    <span className="version-id">{v.id}</span>
                    <span className="version-body">
                      <b>{v.label}</b>
                      <span>
                        {num(v.metrics.sim.unitsPerHour.median)} / h · {num(v.metrics.sim.leadTimeSec.median / 60)} min · {money(v.metrics.cost.costPerUnit)} per unit
                      </span>
                    </span>
                  </button>
                ))}
                {dirty && <div className="version draft">Unsaved draft</div>}
              </div>
              <div className="row">
                <button className="primary" disabled={!dirty} onClick={() => save()}>
                  Save as v{nextN}
                </button>
                <button className="ghost" disabled={!dirty} onClick={() => setDraft(current.spec)}>
                  Discard draft
                </button>
                <button className="ghost" disabled={versions.length < 2} onClick={() => setCmp({ a: v1.id, b: current.id === v1.id ? versions[versions.length - 1].id : current.id })}>
                  Compare
                </button>
              </div>
            </>
          )}
        </div>

        {dirty && tab !== 'versions' && (
          <div className="panel-foot">
            <span>Unsaved draft</span>
            <button className="ghost small" onClick={() => setDraft(current.spec)}>
              Discard
            </button>
            <button className="primary small" onClick={() => save()}>
              Save as v{nextN}
            </button>
          </div>
        )}
      </aside>

      <div className="dock" style={{ right: PANEL + 24 }}>
        {liveErrors.length > 0 && (
          <Notice tone="error" title={preview ? 'Not valid here' : 'That change was rejected'} lines={liveErrors.slice(0, 3).map((e) => e.message)} onClose={preview ? undefined : () => setRejected([])} />
        )}
        {notice && !liveErrors.length && <Notice tone={notice.tone} title={notice.title} lines={notice.lines} onClose={() => setNotice(null)} />}
        <Tracker events={events} running={busy} />
        <form
          className="prompt"
          onSubmit={(e) => {
            e.preventDefault();
            if (command.trim()) void sendEdit({ text: command.trim() });
          }}
        >
          <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Tell the floor what to change: “move shipping to the south wall”" disabled={!!busy} aria-label="Edit the layout in words" />
          <button type="button" className={`ghost${recording ? ' rec' : ''}`} disabled={!!busy && !recording} onClick={() => void toggleMic()}>
            {recording ? 'Stop' : 'Speak'}
          </button>
          <button className="primary" disabled={!!busy || !command.trim()}>
            Apply
          </button>
        </form>
      </div>

      {cmp && cmpA && cmpB && <CompareModal versions={versions} a={cmpA} b={cmpB} onPick={(k, id) => setCmp({ ...cmp, [k]: id })} onClose={() => setCmp(null)} />}
    </div>
  );
}
