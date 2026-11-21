import { useState } from 'react';
import { BUILTIN } from '../catalog';
import type { CatalogItem, ShopListing } from '../contracts';
import { ARCHETYPE_NAMES, ARCHETYPES, featureText, repairRecipe, type Archetype, type MachineRecipe } from '../machines';
import { api, money } from '../store';
import { Notice, TopBar } from '../ui/common';
import { ShopifyAttribution, ShopProductCard } from '../ui/Commerce';
import { MachineThumb } from '../ui/thumbs';

const SIZES: Record<Archetype, { w: number; d: number; h: number }> = {
  bench: { w: 1.8, d: 0.8, h: 1.6 },
  table: { w: 1.8, d: 0.8, h: 0.9 },
  rack: { w: 2.4, d: 0.9, h: 2.2 },
  cabinet: { w: 1, d: 0.5, h: 1.1 },
  machine: { w: 1.6, d: 1, h: 1.7 },
  enclosure: { w: 2.4, d: 1.8, h: 2.3 },
  conveyor: { w: 3, d: 0.6, h: 0.9 },
  cart: { w: 1, d: 0.6, h: 0.95 },
  tank: { w: 1, d: 1, h: 1.6 },
  press: { w: 0.7, d: 0.7, h: 1.7 },
  kiosk: { w: 0.7, d: 0.6, h: 1.4 },
  robot: { w: 1.4, d: 1.4, h: 1.5 },
};

/** Every archetype with everything it can carry: the full vocabulary a recipe can use. */
const SAMPLES: CatalogItem[] = ARCHETYPE_NAMES.map((archetype) => {
  const raw: MachineRecipe = {
    archetype,
    size: SIZES[archetype],
    workHeight: 0.9,
    colors: { frame: 'ink', surface: archetype === 'bench' ? 'wood' : 'steel', body: 'bone', accent: 'orange' },
    features: ARCHETYPES[archetype].features.map((kind) => ({ kind, count: kind === 'drawers' ? 3 : 2 })),
    operatorSide: 'front',
  };
  const recipe = repairRecipe(raw).recipe;
  return { id: `sample-${archetype}`, name: archetype, stationType: archetype, footprint: recipe.size, cycleTimeSec: 60, operators: 1, powerKw: 0, needsWater: false, price: 0, source: 'builtin', recipe };
});

function Card({ item, sub }: { item: CatalogItem; sub: string }) {
  return (
    <article className="cat-card">
      <MachineThumb item={item} />
      <b>{item.name}</b>
      <span className="muted small">{sub}</span>
    </article>
  );
}

function LiveCatalog() {
  const [query, setQuery] = useState('steel workbench');
  const [listings, setListings] = useState<ShopListing[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = async () => {
    setBusy(true);
    setError(null);
    setListings(null);
    try { setListings((await api<{ listings: ShopListing[] }>('/api/catalog/search', { query })).listings); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="commerce-search" aria-label="Live Shopify equipment catalog">
    <div className="section-head"><h2>Shop real equipment</h2><ShopifyAttribution /></div>
    <p className="muted small">Live merchant photos, variants and prices from Shop MCP. Adding products to your cart is separate from placing equipment in a plan. Each merchant has its own approved checkout.</p>
    <form className="search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
      <input aria-label="Search Shopify equipment" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200} placeholder="steel workbench" />
      <button className="primary" disabled={busy || query.trim().length < 2}>{busy ? 'Searching…' : 'Search Shop'}</button>
    </form>
    {error && <Notice tone="error" title={error} />}
    {busy && <p className="muted small" role="status">Searching the live Shopify catalog…</p>}
    {listings?.length === 0 && <p className="muted small" role="status">No products found. Try another search.</p>}
    <div className="commerce-results">{listings?.map((listing) => <ShopProductCard key={listing.variantId} listing={listing} />)}</div>
  </section>;
}

export function Catalog({ onHome }: { onHome: () => void }) {
  return (
    <div className="page">
      <TopBar onHome={onHome} />
      <main className="catalog">
        <h1>Machine catalog</h1>
        <p className="lede">
          Every machine is a recipe: one of {ARCHETYPE_NAMES.length} archetypes, a size, colours and a list of features. Code builds the 3D from that, so each one is exactly its stated size. Listings from Shop are converted into the same recipes.
        </p>

        <LiveCatalog />

        <h2>Built in</h2>
        <div className="cat-grid">
          {BUILTIN.map((item) => (
            <Card
              key={item.id}
              item={item}
              sub={`${item.stationType} · ${item.footprint.w} × ${item.footprint.d} m · ${money(item.price)}${item.recipe?.features.length ? ` · ${featureText(item.recipe.features)}` : ''}`}
            />
          ))}
        </div>

        <h2>Archetypes, with every feature each can carry</h2>
        <div className="cat-grid">
          {SAMPLES.map((item) => (
            <Card key={item.id} item={item} sub={`${ARCHETYPES[item.stationType as Archetype].is}. ${featureText(item.recipe!.features)}.`} />
          ))}
        </div>
      </main>
    </div>
  );
}
