import { useState } from 'react';
import type { CatalogItem, EquipmentLine, ShopListing, TraceEvent } from '../contracts';
import { evaluate, makeVersion } from '../engines/versions';
import type { FactorySpec } from '../spec';
import { api, apiStream, ApiError, money, pct, type Project } from '../store';
import { Notice, RunStatus, TopBar, useRun } from '../ui/common';
import { Icon } from '../ui/icons';
import { featureText } from '../machines';
import { MachineThumb } from '../ui/thumbs';
import { Swarm } from './Swarm';
import { CommerceDrawer, ShopifyAttribution, ShopProductCard } from '../ui/Commerce';
import { formatPrice, priceSubtotals } from '../commerce';

const WALL = { N: 'north', S: 'south', E: 'east', W: 'west' } as const;

function Replace({ line, onClose, onPick }: { line: EquipmentLine; onClose: () => void; onPick: (item: CatalogItem, trace: TraceEvent[]) => void }) {
  const initialQuery = line.item.listing?.currency && line.item.listing.currency !== 'USD' ? 'heavy duty steel shelving rack' : line.item.name;
  const [query, setQuery] = useState(initialQuery);
  const [listings, setListings] = useState<ShopListing[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy('search');
    setError(null);
    setListings(null);
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
    <CommerceDrawer title={`Replace ${line.label}`} onClose={onClose}>
        <ShopifyAttribution />
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="steel workbench" aria-label="Search Shop" maxLength={200} />
          <button className="primary" disabled={!!busy || !query.trim()}>
            {busy === 'search' ? 'Searching' : 'Search Shop'}
          </button>
        </form>
        {error && <Notice tone="error" title={error} />}
        {listings === null && !busy && <p className="muted">Choosing a listing reads its size and power from the listing text and checks that it suits this step.</p>}
        {listings?.length === 0 && <p className="muted">Nothing found for that search.</p>}
        <div>
          {listings?.map((listing) => (
            <ShopProductCard key={listing.variantId} listing={listing} busy={!!busy} onUse={(chosen) => void use(chosen)} />
          ))}
        </div>
    </CommerceDrawer>
  );
}

/** What sits behind the equipment window before a project has a floor: the brief it came from. */
export function BriefBackdrop({ project, onHome }: { project: Project; onHome: () => void }) {
  return (
    <div className="page">
      <TopBar onHome={onHome} crumbs={[{ label: 'Brief' }, { label: 'Equipment', active: true }, { label: 'Simulation' }]} />
      <main className="brief" aria-hidden="true">
        <h1>What are you building, and where?</h1>
        <div className="composer">
          <p className="backdrop-brief">{project.brief.text || 'Brief given as attachments.'}</p>
        </div>
      </main>
    </div>
  );
}

/**
 * The equipment window: review what the plan will use, source real equipment without leaving it,
 * then lay the floor out. A popup over the brief (new project) or the simulation (existing one).
 */
export function PlanReview({
  project,
  onClose,
  onChange,
  onLayout,
}: {
  project: Project;
  /** leave without laying out: back to the simulation if there is one, otherwise home */
  onClose: () => void;
  onChange: (patch: Partial<Project>) => void;
  onLayout: (patch: Partial<Project>) => void;
}) {
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);
  const [replacing, setReplacing] = useState<number | null>(null);
  const [swarm, setSwarm] = useState<'open' | 'hidden' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useRun();
  const req = project.requirements;
  const lines = project.equipment;
  const totalText = priceSubtotals(lines.map((line) => ({ listing: line.item.listing, price: line.item.price, quantity: line.qty })))
    .map((subtotal) => `${formatPrice({ price: 0, ...subtotal })}${subtotal.estimated ? ' (includes estimates)' : ''}`).join(' + ') || 'USD 0.00';
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

  const sourcing = swarm === 'open';
  // a plant's machines are not sold on Shop, so they are designed from the process; anything smaller is sourced first
  const concept = req.scale ? req.scale === 'plant' : !!req.research;
  return (
    <div className="scrim center plan-scrim">
      <section className="plan-dialog" role="dialog" aria-modal="true" aria-label={`Equipment for ${project.name}`}>
        <header className="pd-head">
          <div>
            <span className="muted small">{sourcing ? (concept ? 'Designing the equipment' : 'Sourcing real equipment') : 'Equipment'}</span>
            <h1>{project.name}</h1>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title={project.versions.length ? 'Back to the simulation' : 'Close'}>
            <Icon name="x" size={18} />
          </button>
        </header>

        {!sourcing && (
          <div className="facts">
            <label className="fact">
              <span>Floor</span>
              <span className="fact-inputs">
                <input type="number" min={4} max={600} step={0.5} value={req.floor.width} onChange={(e) => setReq({ floor: { ...req.floor, width: Number(e.target.value) } })} aria-label="Floor width in metres" />
                ×
                <input type="number" min={4} max={600} step={0.5} value={req.floor.depth} onChange={(e) => setReq({ floor: { ...req.floor, depth: Number(e.target.value) } })} aria-label="Floor depth in metres" />m
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
            <div className="fact">
              <span>Moves by</span>
              <b>{req.transport === 'conveyor' ? 'conveyor' : 'forklift'}</b>
            </div>
          </div>
        )}

        <div className="pd-body">
          {/* the swarm keeps working while hidden, so it stays mounted */}
          {swarm && (
            <div style={sourcing ? undefined : { display: 'none' }}>
              <Swarm
                lines={lines}
                concept={concept}
                context={req.summary}
                actionsHost={actionsHost}
                visible={sourcing}
                onClose={(discard) => setSwarm(discard ? null : 'hidden')}
                onApply={(items, events) => {
                  const models = { ...(project.models ?? {}) };
                  for (const item of Object.values(items)) if (item.model) models[item.id] = item.model;
                  onChange({ equipment: lines.map((l) => (items[l.stepType] ? { ...l, item: items[l.stepType] } : l)), models, trace: [...project.trace, ...events] });
                  setSwarm(null);
                }}
              />
            </div>
          )}

          {!sourcing && (
            <div className="pd-grid">
              <div>
                {checked && (
                  <p className={`checkline${doubtful.length ? ' warn' : ''}`}>
                    <Icon name={doubtful.length ? 'warn' : 'check'} />
                    <span>
                      {doubtful.length
                        ? `A second model checked this plan against your brief and could not find ${doubtful.map((l) => l.label).join(', ')} in it. Remove ${doubtful.length > 1 ? 'them' : 'it'} if that is wrong.`
                        : `A second model checked this plan against your brief and found all ${lines.length} steps in it.`}
                      {project.coverage !== undefined && project.coverage < 0.7 ? ` It rates the overall match at ${pct(project.coverage)}, so read the list closely.` : ''}
                    </span>
                  </p>
                )}
                <div className="equipment">
                  {lines.map((l, i) => {
                    const zone = req.steps.find((x) => x.type === l.stepType)?.zone;
                    const prev = i > 0 ? req.steps.find((x) => x.type === lines[i - 1].stepType)?.zone : undefined;
                    return (
                      <div key={l.stepType}>
                        {zone && zone !== prev && <h3 className="zone-head">{zone}</h3>}
                        <article className={`equip${l.qty === 0 ? ' off' : ''}`}>
                          <MachineThumb item={l.item} />
                          <div className="equip-body">
                            <span>
                              {i + 1}. {l.label}
                            </span>
                            <b>{l.item.name}</b>
                            <span className="muted small">
                              {l.item.footprint.w} × {l.item.footprint.d} m · {l.item.cycleTimeSec} s a unit{l.item.powerKw ? ` · ${l.item.powerKw} kW` : ''}
                              {l.item.needsWater ? ' · needs water' : ''}
                              {l.item.source === 'shopify' && (
                                <>
                                  {' · from '}
                                  {l.item.listing?.url ? (
                                    <a href={l.item.listing.url} target="_blank" rel="noreferrer" title="Open the listing">
                                      {l.item.listing.seller || 'Shop'}
                                    </a>
                                  ) : (
                                    (l.item.listing?.seller ?? 'Shop')
                                  )}
                                </>
                              )}
                            </span>
                            {l.item.model && l.item.modelChecks && (
                              <span className="muted small">
                                {l.item.modelChecks.parts} parts, modelled {l.item.listing ? `from the listing${l.item.modelChecks.sawPhoto ? ' photo' : ''}` : 'from what the step does'}. Likeness {pct(l.item.modelChecks.likeness)}.
                                {l.item.listing && !l.item.modelChecks.dimsStated ? ' Size is estimated.' : ''}
                              </span>
                            )}
                            {l.item.source === 'shopify' && l.item.recipe && !l.item.model && (
                              <span className="muted small">
                                Built from the listing as a {l.item.recipe.archetype}
                                {l.item.recipe.features.length ? ` with ${featureText(l.item.recipe.features)}` : ''}.
                              </span>
                            )}
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
                          <span className="equip-price">{l.item.listing ? formatPrice(l.item.listing) : `${money(l.item.price)} est.`}</span>
                          <div className="stepper" role="group" aria-label={`Quantity of ${l.label}`}>
                            <button onClick={() => setLine(i, { qty: Math.max(0, l.qty - 1) })} aria-label="One fewer">
                              <Icon name="minus" size={14} />
                            </button>
                            <span>{l.qty}</span>
                            <button onClick={() => setLine(i, { qty: Math.min(40, l.qty + 1) })} aria-label="One more">
                              <Icon name="plus" size={14} />
                            </button>
                          </div>
                          <button className="ghost sm" onClick={() => setReplacing(i)}>
                            Replace
                          </button>
                        </article>
                      </div>
                    );
                  })}
                </div>
              </div>

              <aside className="pd-side">
                {req.research && (
                  <details open>
                    <summary>Research</summary>
                    <p className="muted small">
                      Researched before planning.{req.research.queries.length ? ` Searched: ${req.research.queries.slice(0, 3).join('; ')}.` : ''}
                    </p>
                    {req.research.sources.length > 0 && (
                      <p className="small">
                        {req.research.sources.slice(0, 6).map((src, k) => (
                          <span key={src.url}>
                            {k > 0 ? ', ' : ''}
                            <a href={src.url} target="_blank" rel="noreferrer">
                              {src.title}
                            </a>
                          </span>
                        ))}
                      </p>
                    )}
                  </details>
                )}
                <details open>
                  <summary>Assumed</summary>
                  {req.assumptions.length ? (
                    <ul>
                      {req.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted small">Nothing. The brief covered everything.</p>
                  )}
                </details>
                <details>
                  <summary>Your brief</summary>
                  <p className="brief-text">{project.brief.text || 'No text.'}</p>
                  {project.brief.files.length > 0 && <p className="muted small">Attached: {project.brief.files.map((f) => f.name).join(', ')}</p>}
                </details>
              </aside>
            </div>
          )}
          {error && <Notice tone="error" title={error.message} lines={error.lines} onClose={() => setError(null)} />}
        </div>

        <footer className="pd-foot">
          <span className="num">
            {stations} stations · {totalText}
          </span>
          <RunStatus state={run} />
          <div className="pd-actions" ref={setActionsHost}>
            {!sourcing && (
              <>
                <button className="ghost lg" onClick={() => setSwarm('open')} disabled={run.busy || stations === 0}>
                  {swarm === 'hidden' ? 'Show the agents' : concept ? 'Design the equipment' : 'Source real equipment'}
                </button>
                <button className="primary lg" disabled={run.busy || stations === 0} onClick={() => void generate()}>
                  {project.versions.length ? 'Lay it out again' : 'Lay it out and simulate'} <Icon name="arrowRight" />
                </button>
              </>
            )}
          </div>
        </footer>
      </section>

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
