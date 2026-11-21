import { useState } from 'react';
import type { CatalogItem, EquipmentLine, ShopListing, TraceEvent } from '../contracts';
import { evaluate, makeVersion } from '../engines/versions';
import type { FactorySpec } from '../spec';
import { api, apiStream, ApiError, money, pct, type Project } from '../store';
import { Notice, RunStatus, TopBar, useRun } from '../ui/common';
import { Icon } from '../ui/icons';
import { useThumb } from '../ui/thumbs';

const WALL = { N: 'north', S: 'south', E: 'east', W: 'west' } as const;

function Thumb({ item }: { item: CatalogItem }) {
  const rendered = useThumb(item);
  if (item.listing?.image) return <img className="equip-img photo" src={item.listing.image} alt="" />;
  return rendered ? <img className="equip-img" src={rendered} alt="" /> : <span className="equip-img" />;
}

function Replace({ line, onClose, onPick }: { line: EquipmentLine; onClose: () => void; onPick: (item: CatalogItem, trace: TraceEvent[]) => void }) {
  const [query, setQuery] = useState(line.item.name);
  const [listings, setListings] = useState<ShopListing[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy('search');
    setError(null);
    try {
      setListings((await api<{ listings: ShopListing[] }>('/api/catalog/search', { query })).listings);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  };
  const use = async (l: ShopListing) => {
    setBusy(l.variantId);
    setError(null);
    try {
      const step = { type: line.stepType, label: line.label, cycleTimeSec: line.item.cycleTimeSec, operators: line.item.operators };
      const out = await apiStream<{ item: CatalogItem; trace: TraceEvent[] }>('/api/catalog/convert', { listing: l, step }, () => undefined);
      onPick(out.item, out.trace);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Replace equipment">
        <header>
          <div>
            <span className="muted small">Replace the equipment for</span>
            <h2>{line.label}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="steel workbench" aria-label="Search Shop" autoFocus />
          <button className="primary" disabled={!!busy || !query.trim()}>
            {busy === 'search' ? 'Searching' : 'Search Shop'}
          </button>
        </form>
        {error && <Notice tone="error" title={error} />}
        {listings === null && !busy && <p className="muted">Choosing a listing reads its size and power from the listing text and checks that it suits this step.</p>}
        {listings?.length === 0 && <p className="muted">Nothing found for that search.</p>}
        <div>
          {listings?.map((l) => (
            <div key={l.variantId} className="listing">
              {l.image ? <img src={l.image} alt="" /> : <div className="listing-blank" />}
              <div className="listing-body">
                <b>{l.title.slice(0, 84)}</b>
                <span>
                  {l.seller}
                  {l.rating ? ` · rated ${l.rating}` : ''}
                  {l.dims ? ` · ${l.dims.w} × ${l.dims.d} m` : ''}
                </span>
                <div className="listing-foot">
                  <strong>{money(l.price)}</strong>
                  <a className="small" href={l.url} target="_blank" rel="noreferrer">
                    Listing
                  </a>
                  <button className="ghost sm" disabled={!!busy} onClick={() => void use(l)}>
                    {busy === l.variantId ? (
                      <>
                        <span className="spinner ink" /> Reading specs
                      </>
                    ) : (
                      'Use this'
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

export function PlanReview({
  project,
  onHome,
  onChange,
  onLayout,
  onOpenSim,
}: {
  project: Project;
  onHome: () => void;
  onChange: (patch: Partial<Project>) => void;
  onLayout: (patch: Partial<Project>) => void;
  onOpenSim?: () => void;
}) {
  const [replacing, setReplacing] = useState<number | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useRun();
  const req = project.requirements;
  const lines = project.equipment;
  const total = lines.reduce((t, l) => t + l.qty * l.item.price, 0);
  const stations = lines.reduce((t, l) => t + l.qty, 0);
  const doubtful = lines.filter((l) => l.inBrief !== undefined && l.inBrief < 0.5);
  const checked = lines.some((l) => l.inBrief !== undefined);

  const setLine = (i: number, patch: Partial<EquipmentLine>) => onChange({ equipment: lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const setReq = (patch: Partial<typeof req>) => onChange({ requirements: { ...req, ...patch } });

  const generate = async () => {
    setError(null);
    try {
      const { value: out } = await run.run('Placing the equipment', (onEvent) => apiStream<{ spec: FactorySpec; trace: TraceEvent[] }>('/api/project/layout', { requirements: req, equipment: lines }, onEvent));
      const ev = evaluate(out.spec);
      if (!ev.ok) throw new ApiError('The server returned a layout that fails validation', ev.errors.map((e) => e.message));
      const n = project.versions.length ? Math.max(...project.versions.map((v) => v.n)) + 1 : 1;
      const parent = project.versions.find((v) => v.id === project.currentId) ?? null;
      const v = makeVersion(out.spec, ev.metrics, parent, n, n === 1 ? 'First layout' : 'New layout from the plan');
      onLayout({ versions: [...project.versions, v], currentId: v.id, trace: [...project.trace, ...out.trace] });
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError((e as Error).message));
    }
  };

  return (
    <div className="page">
      <TopBar
        onHome={onHome}
        log={project.trace}
        crumbs={[{ label: 'Brief' }, { label: 'Equipment', active: true }, { label: 'Simulation', onClick: project.versions.length ? onOpenSim : undefined }]}
      />
      <main className="plan">
        <section className="plan-head">
          <h1>{project.name}</h1>
          <p className="lede">{req.summary}</p>
        </section>

        <div className="facts">
          <label className="fact">
            <span>Floor</span>
            <span className="fact-inputs">
              <input type="number" min={4} max={200} step={0.5} value={req.floor.width} onChange={(e) => setReq({ floor: { ...req.floor, width: Number(e.target.value) } })} aria-label="Floor width in metres" />
              ×
              <input type="number" min={4} max={200} step={0.5} value={req.floor.depth} onChange={(e) => setReq({ floor: { ...req.floor, depth: Number(e.target.value) } })} aria-label="Floor depth in metres" />m
            </span>
          </label>
          <label className="fact">
            <span>Demand</span>
            <span className="fact-inputs">
              <input type="number" min={1} max={2000} value={req.demandPerHour} onChange={(e) => setReq({ demandPerHour: Number(e.target.value) })} aria-label="Demand per hour" />
              an hour
            </span>
          </label>
          <div className="fact">
            <span>Receiving</span>
            <b>{WALL[req.dockIn]} wall</b>
          </div>
          <div className="fact">
            <span>Shipping</span>
            <b>{WALL[req.dockOut]} wall</b>
          </div>
        </div>

        {checked && (
          <p className={`checkline${doubtful.length ? ' warn' : ''}`}>
            <Icon name={doubtful.length ? 'warn' : 'check'} />
            <span>
              {doubtful.length
                ? `A second model checked this plan against your brief and could not find ${doubtful.map((l) => l.label).join(', ')} in it. Remove ${doubtful.length > 1 ? 'them' : 'it'} if that is wrong.`
                : `A second model checked this plan against your brief and found all ${lines.length} steps in it.`}
              {project.coverage !== undefined && project.coverage < 0.7 ? ` It rates the plan's overall match at ${pct(project.coverage)}, so read the list below closely.` : ''}
            </span>
          </p>
        )}

        <div className="plan-grid">
          <section>
            <h2>Equipment</h2>
            <p className="muted" style={{ marginBottom: 12 }}>
              {stations} stations in process order, {money(total)} in total.
            </p>
            <div className="equipment">
              {lines.map((l, i) => (
                <article key={l.stepType} className={`equip${l.qty === 0 ? ' off' : ''}`}>
                  <Thumb item={l.item} />
                  <div className="equip-body">
                    <span>
                      {i + 1}. {l.label}
                    </span>
                    <b>{l.item.name}</b>
                    <span className="muted small">
                      {l.item.footprint.w} × {l.item.footprint.d} m · {l.item.cycleTimeSec} s a unit{l.item.powerKw ? ` · ${l.item.powerKw} kW` : ''}
                      {l.item.needsWater ? ' · needs water' : ''}
                      {l.item.source === 'shopify' ? ` · from ${l.item.listing?.seller ?? 'Shop'}` : ''}
                    </span>
                    {l.inBrief !== undefined && l.inBrief < 0.5 && (
                      <span className="flag">
                        <Icon name="warn" size={14} /> Not clearly in your brief
                      </span>
                    )}
                    {l.item.source === 'shopify' && l.item.confidence !== undefined && l.item.confidence < 0.5 && (
                      <span className="flag">
                        <Icon name="warn" size={14} /> This listing may not suit the step
                      </span>
                    )}
                  </div>
                  <span className="equip-price">{money(l.item.price)}</span>
                  <div className="stepper" role="group" aria-label={`Quantity of ${l.label}`}>
                    <button onClick={() => setLine(i, { qty: Math.max(0, l.qty - 1) })} aria-label="One fewer">
                      <Icon name="minus" size={14} />
                    </button>
                    <span>{l.qty}</span>
                    <button onClick={() => setLine(i, { qty: Math.min(12, l.qty + 1) })} aria-label="One more">
                      <Icon name="plus" size={14} />
                    </button>
                  </div>
                  <button className="ghost sm" onClick={() => setReplacing(i)}>
                    Replace
                  </button>
                </article>
              ))}
            </div>
          </section>

          <aside className="plan-side">
            <div>
              <h2>Assumed</h2>
              {req.assumptions.length ? (
                <ul>
                  {req.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Nothing. The brief covered everything.</p>
              )}
            </div>
            <div>
              <h2>Your brief</h2>
              <p className="brief-text">{project.brief.text || 'No text.'}</p>
              {project.brief.files.length > 0 && <p className="muted small">Attached: {project.brief.files.map((f) => f.name).join(', ')}</p>}
            </div>
          </aside>
        </div>

        {error && <Notice tone="error" title={error.message} lines={error.lines} onClose={() => setError(null)} />}
      </main>

      <footer className="actionbar">
        <span className="num">
          {stations} stations · {money(total)}
        </span>
        <RunStatus state={run} />
        {project.versions.length > 0 && onOpenSim && (
          <button className="text" onClick={onOpenSim}>
            Back to the simulation
          </button>
        )}
        <button className="primary lg" disabled={run.busy || stations === 0} onClick={() => void generate()}>
          {project.versions.length ? 'Lay it out again' : 'Lay it out and simulate'} <Icon name="arrowRight" />
        </button>
      </footer>

      {replacing !== null && (
        <Replace
          line={lines[replacing]}
          onClose={() => setReplacing(null)}
          onPick={(item, trace) => {
            onChange({ equipment: lines.map((l, k) => (k === replacing ? { ...l, item } : l)), trace: [...project.trace, ...trace] });
            setReplacing(null);
          }}
        />
      )}
    </div>
  );
}
