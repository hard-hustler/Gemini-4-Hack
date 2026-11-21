import { BUILTIN } from '../catalog';
import type { CatalogItem } from '../contracts';
import { ARCHETYPE_NAMES, ARCHETYPES, featureText, repairRecipe, type Archetype, type MachineRecipe } from '../machines';
import { money } from '../store';
import { TopBar } from '../ui/common';
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

export function Catalog({ onHome }: { onHome: () => void }) {
  return (
    <div className="page">
      <TopBar onHome={onHome} />
      <main className="catalog">
        <h1>Machine catalog</h1>
        <p className="lede">
          Every machine is a recipe: one of {ARCHETYPE_NAMES.length} archetypes, a size, colours and a list of features. Code builds the 3D from that, so each one is exactly its stated size. Listings from Shop are converted into the same recipes.
        </p>

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
