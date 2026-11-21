// Listing -> machine recipe. The catalog stage of the harness:
//
//   Shop listing (photo + text)
//     -> DESIGN  Hydrogen   -> a recipe: archetype, size, colours, features  (never geometry)
//     -> code checks the recipe can be built (checkRecipe); errors go back, up to 3 attempts
//     -> CHECK   Decisions  -> is it really that archetype? is each claimed feature in the photo?
//        a contradicted archetype goes back to the designer once; unseen features are dropped
//     -> BUILD   code       -> buildParts() turns the recipe into positioned parts
//
// A conversion never fails outright: if the designer cannot produce a buildable recipe,
// repairRecipe() drops what does not fit and the result says so.

import type { CatalogItem, Emit, RecipeChecks, ShopListing, TraceEvent } from '../src/contracts';
import { ARCHETYPE_NAMES, ARCHETYPES, checkRecipe, FEATURES, normaliseRecipe, repairRecipe, TONES, type FeatureKind, type MachineRecipe } from '../src/machines';
import { decide, interact, MODELS, type Answer, type Block, type Question, type Step } from './gemini';

const MAX_ATTEMPTS = 3;
const UNSEEN = 0.3;
const TALL: FeatureKind[] = ['backboard', 'overShelf', 'lamp', 'monitor'];

const recipeSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'short product name, at most six words, no brand slogans' },
    archetype: { type: 'string', enum: ARCHETYPE_NAMES },
    w: { type: 'number', description: 'overall width in metres: the longer horizontal side, along the front' },
    d: { type: 'number', description: 'overall depth in metres, front to back' },
    h: { type: 'number', description: 'overall height in metres, floor to the top of the tallest part' },
    workHeight: { type: ['number', 'null'], description: 'height of the work surface or conveyor bed in metres; null for other archetypes' },
    levels: { type: ['integer', 'null'], description: 'number of shelf levels for a rack; null otherwise' },
    frame: { type: 'string', enum: [...TONES], description: 'colour of legs and frame' },
    surface: { type: 'string', enum: [...TONES], description: 'colour of the top, doors or deck' },
    body: { type: 'string', enum: [...TONES], description: 'colour of the main housing or drawers' },
    accent: { type: 'string', enum: [...TONES], description: 'colour of the back panel, trim or guards' },
    features: {
      type: 'array',
      items: { type: 'object', properties: { kind: { type: 'string', enum: Object.keys(FEATURES) }, count: { type: 'integer', description: 'how many, for drawers, doors and shelves; otherwise 1' } }, required: ['kind', 'count'] },
    },
    operatorSide: { type: 'string', enum: ['front', 'back', 'left', 'right', 'none'] },
    powerKw: { type: 'number', description: 'electrical draw in kW; 0 if it is not powered' },
    needsWater: { type: 'boolean' },
    dimsStated: { type: 'boolean', description: 'true only if the listing states the dimensions you used' },
  },
  required: ['name', 'archetype', 'w', 'd', 'h', 'workHeight', 'levels', 'frame', 'surface', 'body', 'accent', 'features', 'operatorSide', 'powerKw', 'needsWater', 'dimsStated'],
};

const SYSTEM = `You are the machine designer in a factory-planning harness. You look at one product listing (a photo when there is one, and its text) and describe the product as a recipe that code will build in 3D. You decide what the product is and what it has. You never give positions or shapes; code places every part.

Archetypes, and the only features each can carry:
${ARCHETYPE_NAMES.map((a) => `- ${a}: ${ARCHETYPES[a].is}. Features: ${ARCHETYPES[a].features.join(', ')}.`).join('\n')}

What each feature means:
${Object.entries(FEATURES).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Rules:
- Pick the single archetype that best matches what the product is.
- List a feature only if you can see it in the photo or the listing text states it. Do not add features because they are typical.
- Sizes are in metres. Convert inches (1 in = 0.0254 m). w is the longer horizontal side. h is the top of the tallest part, so a bench with a pegboard has h at the top of the pegboard and workHeight at the work surface.
- If the listing does not state a dimension, estimate it from the product type and what you see, and set dimsStated false.
- Colours come from the fixed palette. Choose the closest: black or dark grey is ink, white or cream is bone, bare metal or grey is steel, wood or tan is wood.`;

async function fetchPhoto(url: string | undefined): Promise<Block | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    // Shopify's CDN resizes on request; a small photo is plenty for this
    const sized = /cdn\.shopify\.com/.test(url) ? url + (url.includes('?') ? '&' : '?') + 'width=900' : url;
    const res = await fetch(sized, { signal: AbortSignal.timeout(10_000) });
    const mime = (res.headers.get('content-type') ?? '').split(';')[0];
    if (!res.ok || !/^image\/(png|jpeg|webp|gif)$/.test(mime)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 6_000_000) return null;
    return { type: 'image', data: bytes.toString('base64'), mime_type: mime };
  } catch {
    return null;
  }
}

const describe = (r: MachineRecipe) =>
  `${r.archetype}, ${r.size.w} × ${r.size.d} × ${r.size.h} m${r.features.length ? `, with ${r.features.map((f) => (f.count > 1 ? `${f.count} ${f.kind}` : f.kind)).join(', ')}` : ', no extra features'}`;

/** A bench whose tall features are all gone is only as tall as its work surface. */
function settle(r: MachineRecipe): MachineRecipe {
  if ((r.archetype === 'bench' || r.archetype === 'table') && r.workHeight && !r.features.some((f) => TALL.includes(f.kind))) {
    return { ...r, size: { ...r.size, h: r.workHeight } };
  }
  return r;
}

export async function convertListing(listing: ShopListing, step: { type: string; label: string; cycleTimeSec: number; operators: number }, emit?: Emit) {
  const trace: TraceEvent[] = [];
  const log = (e: TraceEvent) => {
    trace.push(e);
    emit?.(e);
  };
  const running = (stage: TraceEvent['stage'], actor: TraceEvent['actor'], title: string) => emit?.({ stage, actor, title, ms: 0, status: 'running' });

  running('convert', 'shop', 'Fetching the listing photo');
  const photo = await fetchPhoto(listing.image);
  const text = `Title: ${listing.title}\nSeller: ${listing.seller}\nPrice: ${listing.price} ${listing.currency}\n${listing.dims ? `Size option: ${listing.dims.text}\n` : ''}Description: ${(listing.description ?? '').slice(0, 4000)}`;
  const evidence: Block[] = [...(photo ? [photo] : []), { type: 'text', text }];

  // 1. design, with the code checks as the gate
  const steps: Step[] = [{ type: 'user_input', content: [...evidence, { type: 'text', text: `\nThis will stand in for a "${step.label}" (${step.type}) station. Emit the recipe for the product in this listing.` }] }];
  let recipe: MachineRecipe | null = null;
  let raw: any = {};
  let errs: string[] = [];
  let attempts = 0;
  for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
    running('convert', 'hydrogen', attempts === 1 ? (photo ? 'Designing the machine from the photo' : 'Designing the machine from the listing text') : 'Fixing the design');
    const res = await interact<any>({ model: MODELS.hydrogen, input: steps, system: SYSTEM, schema: recipeSchema, thinking: 'low' });
    raw = res.json ?? {};
    const candidate = normaliseRecipe({ ...raw, size: { w: raw.w, d: raw.d, h: raw.h } });
    errs = checkRecipe(candidate);
    log({ stage: 'convert', actor: 'hydrogen', title: errs.length ? 'Design cannot be built yet' : 'Designed the machine', detail: errs.length ? errs.join('; ') : describe(candidate), ms: res.ms, status: errs.length ? 'retry' : 'ok' });
    recipe = candidate;
    if (!errs.length) break;
    steps.push({ type: 'model_output', content: [{ type: 'text', text: res.text }] });
    steps.push({ type: 'user_input', content: [{ type: 'text', text: `That recipe cannot be built. Fix every problem and emit the full recipe again.\n${errs.map((e) => `- ${e}`).join('\n')}` }] });
  }
  attempts = Math.min(attempts, MAX_ATTEMPTS);
  const dropped: RecipeChecks['dropped'] = [];
  if (errs.length) {
    const fixed = repairRecipe(recipe!);
    recipe = fixed.recipe;
    fixed.dropped.forEach((kind) => dropped.push({ kind, why: 'could not be built' }));
    log({ stage: 'convert', actor: 'engine', title: 'Repaired the design in code', detail: fixed.dropped.length ? `dropped ${fixed.dropped.join(', ')}` : 'clamped sizes to what can be built', ms: 0, status: 'ok' });
  }

  // 2. independent check against the same evidence
  const ask = async (r: MachineRecipe) => {
    const questions: Record<string, Question> = {
      arch: { type: 'choice', instructions: 'The input is a product listing. Which of these best describes what the product is?', criteria: Object.fromEntries(ARCHETYPE_NAMES.map((a) => [a, ARCHETYPES[a].is])) },
      fit: { type: 'noul', instructions: `The input is a product listing. Is this product suitable equipment for a "${step.label}" (${step.type}) station in a small light-manufacturing workshop?` },
    };
    r.features.forEach((f, i) => {
      questions[`f${i}`] = { type: 'noul', instructions: `The input is a product listing${photo ? ' with a photo' : ''}. Does the product have ${FEATURES[f.kind]}?` };
    });
    return decide(evidence, questions);
  };
  let archetypeP = 0;
  let confidence: number | undefined;
  const kept: RecipeChecks['features'] = [];
  try {
    running('check', 'decisions', 'Checking the design against the listing');
    let d = await ask(recipe!);
    let arch = d.answers.arch as Extract<Answer, { type: 'choice' }> | undefined;

    // the checker contradicts the archetype: send it back to the designer once
    if (arch?.type === 'choice' && arch.choice !== recipe!.archetype && (arch.probabilities[arch.choice] ?? 0) >= 0.6 && ARCHETYPE_NAMES.includes(arch.choice as never)) {
      log({ stage: 'check', actor: 'decisions', title: `Check says this is a ${arch.choice}, not a ${recipe!.archetype}`, detail: `${Math.round((arch.probabilities[arch.choice] ?? 0) * 100)}% sure`, ms: d.ms, status: 'retry' });
      running('convert', 'hydrogen', `Redesigning as a ${arch.choice}`);
      steps.push({ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(raw) }] });
      steps.push({ type: 'user_input', content: [{ type: 'text', text: `An independent check of the same listing says this product is a ${arch.choice} (${ARCHETYPES[arch.choice as keyof typeof ARCHETYPES].is}), not a ${recipe!.archetype}. Emit the recipe again as a ${arch.choice}, using only the features a ${arch.choice} can carry.` }] });
      const res = await interact<any>({ model: MODELS.hydrogen, input: steps, system: SYSTEM, schema: recipeSchema, thinking: 'low' });
      const revised = normaliseRecipe({ ...res.json, size: { w: res.json?.w, d: res.json?.d, h: res.json?.h } });
      const bad = checkRecipe(revised);
      attempts++;
      log({ stage: 'convert', actor: 'hydrogen', title: bad.length ? 'Redesign rejected, keeping the first design' : 'Redesigned the machine', detail: bad.length ? bad.join('; ') : describe(revised), ms: res.ms, status: bad.length ? 'fail' : 'ok' });
      if (!bad.length) {
        recipe = revised;
        raw = res.json;
        running('check', 'decisions', 'Checking the new design');
        d = await ask(recipe);
        arch = d.answers.arch as typeof arch;
      }
    }

    if (arch?.type === 'choice') archetypeP = arch.probabilities[recipe!.archetype] ?? 0;
    const fit = d.answers.fit;
    if (fit?.type === 'noul') confidence = fit.noul;
    const survivors: MachineRecipe['features'] = [];
    recipe!.features.forEach((f, i) => {
      const a = d.answers[`f${i}`];
      const seen = a?.type === 'noul' ? a.noul : 1;
      if (seen < UNSEEN) dropped.push({ kind: f.kind, why: `not seen in the listing (${Math.round(seen * 100)}%)` });
      else {
        survivors.push(f);
        kept.push({ kind: f.kind, seen });
      }
    });
    recipe = settle({ ...recipe!, features: survivors });
    const unseen = dropped.filter((x) => x.why.startsWith('not seen'));
    log({
      stage: 'check',
      actor: 'decisions',
      title: 'Checked the design against the listing',
      detail: `${recipe.archetype} ${Math.round(archetypeP * 100)}%; ${kept.length} feature${kept.length === 1 ? '' : 's'} confirmed${unseen.length ? `; dropped ${unseen.map((x) => x.kind).join(', ')}` : ''}; ${Math.round((confidence ?? 0) * 100)}% suitable for ${step.label}`,
      ms: d.ms,
      status: 'ok',
    });
  } catch (e) {
    recipe!.features.forEach((f) => kept.push({ kind: f.kind, seen: -1 }));
    log({ stage: 'check', actor: 'decisions', title: 'Check against the listing failed; design is unchecked', detail: (e as Error).message, ms: 0, status: 'fail' });
  }

  // belt and braces: whatever happened above, what leaves here can be built
  const final = checkRecipe(recipe!).length ? repairRecipe(recipe!).recipe : recipe!;
  const item: CatalogItem = {
    id: `shop-${listing.variantId.split('/').pop()}`,
    name: String(raw.name ?? listing.title).slice(0, 60),
    stationType: step.type,
    footprint: { ...final.size },
    cycleTimeSec: step.cycleTimeSec,
    operators: step.operators,
    powerKw: typeof raw.powerKw === 'number' && raw.powerKw >= 0 ? raw.powerKw : 0,
    needsWater: Boolean(raw.needsWater),
    price: listing.price,
    source: 'shopify',
    listing: { ...listing, description: undefined },
    recipe: final,
    recipeChecks: { sawPhoto: !!photo, archetype: archetypeP, features: kept, dropped, dimsStated: Boolean(raw.dimsStated), attempts },
    confidence,
    // modelUrl: set by the listing -> mesh converter if one exists; the recipe is drawn otherwise
  };
  return { item, dimsStated: Boolean(raw.dimsStated), trace };
}
