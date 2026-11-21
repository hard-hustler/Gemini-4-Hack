import { useState } from 'react';
import type { CatalogItem, EquipmentLine, ShopListing, TraceEvent } from '../contracts';
import { evaluate, makeVersion } from '../engines/versions';
import type { FactorySpec } from '../spec';
import { api, ApiError, money, pct, type Project } from '../store';
import { Notice, TopBar, Tracker } from '../ui/common';
import { accentFor } from '../ui/Equipment';

const WALL = { N: 'north', S: 'south', E: 'east', W: 'west' } as const;

function Swap({ line, onClose, onPick }: { line: EquipmentLine; onClose: () => void; onPick: (item: CatalogItem, trace: TraceEvent[]) => void }) {
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
      const out = await api<{ item: CatalogItem; trace: TraceEvent[] }>('/api/catalog/convert', { listing: l, step });
      onPick(out.item, out.trace);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Find equipment">
        <header>
          <div>
            <span className="eyebrow">Find equipment for</span>
            <h2>{line.label}</h2>
          </div>
          <button className="ghost small" onClick={onClose}>
            Close
          </button>
        </header>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="steel workbench" aria-label="Search Shop" />
          <button className="primary" disabled={!!busy || !query.trim()}>
            {busy === 'search' ? 'Searching…' : 'Search Shop'}
          </button>
        </form>
        {error && <Notice tone="error" title={error} />}
        {listings === null && !busy && <p className="muted">Search real listings. Picking one reads its size and power from the listing and checks it suits this step.</p>}
        {listings?.length === 0 && <p className="muted">No listings found for that search.</p>}
        <div className="listings">
          {listings?.map((l) => (
            <div key={l.variantId} className="listing">
              {l.image ? <img src={l.image} alt="" /> : <div className="listing-blank" />}
              <div className="listing-body">
                <b>{l.title.slice(0, 84)}</b>
                <span>
                  {l.seller}
                  {l.rating ? ` · ${l.rating}★` : ''}
                  {l.dims ? ` · ${l.dims.w} × ${l.dims.d} m` : ''}
                </span>
                <div className="listing-foot">
                  <strong>{money(l.price)}</strong>
                  <a href={l.url} target="_blank" rel="noreferrer">
                    View listing
                  </a>
                  <button className="primary small" disabled={!!busy} onClick={() => void use(l)}>
                    {busy === l.variantId ? 'Reading specs…' : 'Use this'}
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
  const [swap, setSwap] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const req = project.requirements;
  const lines = project.equipment;
  const total = lines.reduce((t, l) => t + l.qty * l.item.price, 0);
  const stations = lines.reduce((t, l) => t + l.qty, 0);

  const setLine = (i: number, patch: Partial<EquipmentLine>) => onChange({ equipment: lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const setReq = (patch: Partial<typeof req>) => onChange({ requirements: { ...req, ...patch } });

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ spec: FactorySpec; trace: TraceEvent[] }>('/api/project/layout', { requirements: req, equipment: lines });
      const ev = evaluate(out.spec);
      if (!ev.ok) throw new ApiError('The server returned a layout that fails validation', ev.errors.map((e) => e.message));
      const n = project.versions.length ? Math.max(...project.versions.map((v) => v.n)) + 1 : 1;
      const parent = project.versions.find((v) => v.id === project.currentId) ?? null;
      const v = makeVersion(out.spec, ev.metrics, parent, n, n === 1 ? 'First layout' : 'Re-planned layout');
      onLayout({ versions: [...project.versions, v], currentId: v.id, trace: [...project.trace.filter((e) => e.stage !== 'place' && e.stage !== 'simulate'), ...out.trace] });
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError((e as Error).message));
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <TopBar
        onHome={onHome}
        crumbs={[{ label: 'Brief' }, { label: 'Equipment', active: true }, { label: 'Simulation', onClick: project.versions.length ? onOpenSim : undefined }]}
      />
      <main className="plan">
        <section className="plan-head">
          <span className="eyebrow">Plan</span>
          <h1>{project.name}</h1>
          <p className="lede">{req.summary}</p>
          <div className="facts">
            <label className="fact">
              <span className="eyebrow">Floor, m</span>
              <span className="fact-inputs">
                <input type="number" min={4} max={200} step={0.5} value={req.floor.width} onChange={(e) => setReq({ floor: { ...req.floor, width: Number(e.target.value) } })} aria-label="Floor width in metres" />
                ×
                <input type="number" min={4} max={200} step={0.5} value={req.floor.depth} onChange={(e) => setReq({ floor: { ...req.floor, depth: Number(e.target.value) } })} aria-label="Floor depth in metres" />
              </span>
            </label>
            <label className="fact">
              <span className="eyebrow">Demand, units / h</span>
              <span className="fact-inputs">
                <input type="number" min={1} max={2000} value={req.demandPerHour} onChange={(e) => setReq({ demandPerHour: Number(e.target.value) })} aria-label="Demand per hour" />
              </span>
            </label>
            <div className="fact">
              <span className="eyebrow">Docks</span>
              <b>
                in {WALL[req.dockIn]}, out {WALL[req.dockOut]}
              </b>
            </div>
            <div className="fact">
              <span className="eyebrow">Matches the brief</span>
              <b className={project.coverage !== undefined && project.coverage < 0.6 ? 'warn' : ''}>{pct(project.coverage)}</b>
            </div>
          </div>
        </section>

        <div className="plan-grid">
          <section>
            <div className="section-head">
              <span className="eyebrow">Equipment, in process order</span>
              <span className="muted">
                {stations} stations · {money(total)}
              </span>
            </div>
            <div className="equipment">
              {lines.map((l, i) => (
                <article key={l.stepType} className={`equip${l.qty === 0 ? ' off' : ''}`}>
                  <span className="equip-n">{String(i + 1).padStart(2, '0')}</span>
                  {l.item.listing?.image ? <img className="equip-img" src={l.item.listing.image} alt="" /> : <span className="equip-img glyph" style={{ background: accentFor(l.stepType) }} />}
                  <div className="equip-body">
                    <span className="eyebrow">{l.label}</span>
                    <b>{l.item.name}</b>
                    <span className="muted">
                      {l.item.footprint.w} × {l.item.footprint.d} m · {l.item.cycleTimeSec} s per unit{l.item.powerKw ? ` · ${l.item.powerKw} kW` : ''}
                      {l.item.needsWater ? ' · water' : ''}
                    </span>
                    <span className="chips">
                      <span className={`chip${(l.inBrief ?? 1) < 0.5 ? ' warn' : ''}`} title="Decisions API: is this step really in your brief?">
                        {l.inBrief === undefined ? 'not checked' : (l.inBrief ?? 0) < 0.5 ? `only ${pct(l.inBrief)} sure it is in your brief` : `in your brief · ${pct(l.inBrief)}`}
                      </span>
                      {l.item.source === 'shopify' ? (
                        <span className={`chip${(l.item.confidence ?? 1) < 0.5 ? ' warn' : ' accent'}`}>Shop listing{l.item.confidence !== undefined ? ` · ${pct(l.item.confidence)} suitable` : ''}</span>
                      ) : (
                        <span className="chip">{l.item.id.startsWith('generic-') ? 'placeholder' : 'catalog'}</span>
                      )}
                    </span>
                  </div>
                  <div className="equip-side">
                    <b>{money(l.item.price)}</b>
                    <div className="stepper" role="group" aria-label={`Quantity of ${l.label}`}>
                      <button onClick={() => setLine(i, { qty: Math.max(0, l.qty - 1) })} aria-label="One fewer">
                        −
                      </button>
                      <span>{l.qty}</span>
                      <button onClick={() => setLine(i, { qty: Math.min(12, l.qty + 1) })} aria-label="One more">
                        +
                      </button>
                    </div>
                    <button className="ghost small" onClick={() => setSwap(i)}>
                      Find on Shop
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="plan-side">
            <div className="card">
              <span className="eyebrow">Assumed, because the brief did not say</span>
              {req.assumptions.length ? (
                <ul className="assumptions">
                  {req.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Nothing was assumed.</p>
              )}
            </div>
            <div className="card">
              <span className="eyebrow">Your brief</span>
              <p className="brief-text">{project.brief.text || 'No text.'}</p>
              {project.brief.files.length > 0 && <p className="muted">Attached: {project.brief.files.map((f) => f.name).join(', ')}</p>}
            </div>
          </aside>
        </div>

        {error && <Notice tone="error" title={error.message} lines={error.lines} onClose={() => setError(null)} />}
      </main>

      <footer className="actionbar">
        <span>
          <b>{stations}</b> stations on <b>{req.floor.width} × {req.floor.depth} m</b> · equipment <b>{money(total)}</b>
        </span>
        <span className="spacer" />
        <Tracker events={error?.trace?.length ? error.trace : project.trace} running={busy ? 'Placing equipment and simulating' : null} />
        <span className="spacer" />
        {project.versions.length > 0 && onOpenSim && (
          <button className="ghost" onClick={onOpenSim}>
            Back to simulation
          </button>
        )}
        <button className="primary large" disabled={busy || stations === 0} onClick={() => void generate()}>
          {busy ? 'Placing…' : project.versions.length ? 'Re-plan the layout' : 'Lay it out and simulate'}
        </button>
      </footer>

      {swap !== null && (
        <Swap
          line={lines[swap]}
          onClose={() => setSwap(null)}
          onPick={(item, trace) => {
            onChange({ equipment: lines.map((l, k) => (k === swap ? { ...l, item } : l)), trace: [...project.trace, ...trace] });
            setSwap(null);
          }}
        />
      )}
    </div>
  );
}
