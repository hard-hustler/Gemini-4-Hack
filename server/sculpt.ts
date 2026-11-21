// The sculptor: one agent builds one detailed machine model from one Shop listing.
//
//   SCOUT    Shop search + Decisions   -> the listing that best suits the process step
//   DESIGN   Hydrogen                  -> a free-form part list (shapes, materials, motion)
//            code (checkModel)         -> fits the envelope? every part connected to the floor?
//                                         errors go back to the designer, up to 3 attempts
//   RENDER   the browser               -> a picture of the model as built (the server has no GPU)
//   INSPECT  Decisions                 -> does the render look like the listing photo? is it coherent?
//            Hydrogen                  -> if not: a short list of concrete problems
//   CORRECT  Hydrogen                  -> a revised model, through the same code checks
//
// The browser drives the loop (it owns the renderer); these are the stateless steps it calls.
// Many agents run at once, one per process step.

import type { Emit, ShopListing, TraceEvent } from '../src/contracts';
import { checkModel, describeModel, fitModel, MATERIAL_NAMES, MATERIALS, MOTIONS, normaliseModel, SHAPES, type MachineModel } from '../src/model3d';
import { decide, interact, MODELS, type Block, type Question, type Step } from './gemini';
import { searchListings } from './shop';

const MAX_ATTEMPTS = 3;
const DESIGNER = process.env.SCULPT_MODEL === 'neon' ? MODELS.neon : MODELS.hydrogen;

export interface StepBrief {
  type: string;
  label: string;
  /** what the plan currently uses for this step, e.g. "Assembly workbench" */
  itemName: string;
  cycleTimeSec: number;
  operators: number;
  /** planned footprint in metres, used when there is no listing to take a size from */
  w?: number;
  d?: number;
  /** what the plant makes, so a concept model suits it */
  context?: string;
}

const triple = { type: 'array', items: { type: 'number' }, description: 'exactly three numbers' };
const modelSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'short product name, at most six words' },
    w: { type: 'number', description: 'overall width in metres (x)' },
    d: { type: 'number', description: 'overall depth in metres (z)' },
    h: { type: 'number', description: 'overall height in metres (y)' },
    dimsStated: { type: 'boolean', description: 'true only if the listing states the dimensions you used' },
    powerKw: { type: 'number' },
    needsWater: { type: 'boolean' },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'what this part is, a few words' },
          shape: { type: 'string', enum: [...SHAPES] },
          size: triple,
          at: triple,
          rot: triple,
          material: { type: 'string', enum: MATERIAL_NAMES },
          motion: { type: 'string', enum: [...MOTIONS] },
        },
        required: ['label', 'shape', 'size', 'at', 'rot', 'material', 'motion'],
      },
    },
  },
  required: ['name', 'w', 'd', 'h', 'dimsStated', 'powerKw', 'needsWater', 'parts'],
};

const EXAMPLE = `Example (a pedestal bench grinder, w 0.40, d 0.40, h 1.28). Study how parts stack and touch:
{"label":"floor plate","shape":"box","size":[0.40,0.02,0.40],"at":[0,0.01,0],"rot":[0,0,0],"material":"castIron","motion":"none"}
{"label":"pedestal column","shape":"cylinder","size":[0.09,0.80,0.09],"at":[0,0.42,0],"rot":[0,0,0],"material":"paintGrey","motion":"none"}
{"label":"top mounting plate","shape":"box","size":[0.30,0.02,0.24],"at":[0,0.83,0],"rot":[0,0,0],"material":"darkSteel","motion":"none"}
{"label":"motor foot","shape":"box","size":[0.22,0.03,0.18],"at":[0,0.855,0],"rot":[0,0,0],"material":"paintBlue","motion":"none"}
{"label":"motor housing","shape":"cylinder","size":[0.20,0.26,0.20],"at":[0,0.95,0],"rot":[0,0,90],"material":"paintBlue","motion":"none"}
{"label":"left grinding wheel","shape":"cylinder","size":[0.20,0.03,0.20],"at":[-0.17,0.95,0],"rot":[0,0,90],"material":"castIron","motion":"spin_x"}
{"label":"right grinding wheel","shape":"cylinder","size":[0.20,0.03,0.20],"at":[0.17,0.95,0],"rot":[0,0,90],"material":"castIron","motion":"spin_x"}
{"label":"left wheel guard","shape":"box","size":[0.05,0.12,0.24],"at":[-0.17,1.03,0],"rot":[0,0,0],"material":"paintBlue","motion":"none"}
{"label":"right wheel guard","shape":"box","size":[0.05,0.12,0.24],"at":[0.17,1.03,0],"rot":[0,0,0],"material":"paintBlue","motion":"none"}
{"label":"left tool rest","shape":"box","size":[0.06,0.01,0.08],"at":[-0.17,0.93,0.13],"rot":[0,0,0],"material":"steel","motion":"none"}
{"label":"right tool rest","shape":"box","size":[0.06,0.01,0.08],"at":[0.17,0.93,0.13],"rot":[0,0,0],"material":"steel","motion":"none"}
{"label":"left eye shield","shape":"box","size":[0.07,0.07,0.006],"at":[-0.17,1.10,0.10],"rot":[-30,0,0],"material":"glass","motion":"none"}
{"label":"right eye shield","shape":"box","size":[0.07,0.07,0.006],"at":[0.17,1.10,0.10],"rot":[-30,0,0],"material":"glass","motion":"none"}
{"label":"switch box","shape":"box","size":[0.06,0.05,0.03],"at":[0,0.95,0.105],"rot":[0,0,0],"material":"plasticBlack","motion":"none"}
{"label":"power indicator","shape":"box","size":[0.02,0.02,0.012],"at":[0,0.95,0.124],"rot":[0,0,0],"material":"ledGreen","motion":"pulse"}
{"label":"quench tray","shape":"box","size":[0.12,0.03,0.07],"at":[0,0.855,0.155],"rot":[0,0,0],"material":"plasticBlack","motion":"none"}
{"label":"lamp arm","shape":"cylinder","size":[0.012,0.20,0.012],"at":[0.06,1.15,-0.04],"rot":[0,0,0],"material":"chrome","motion":"none"}
{"label":"lamp head","shape":"cone","size":[0.07,0.05,0.03],"at":[0.06,1.255,-0.03],"rot":[60,0,0],"material":"paintBlack","motion":"none"}`;

const SYSTEM = `You are a 3D modeller in a factory-planning harness. You look at one product listing (a photo when there is one, and its text) and build a detailed, recognisable 3D model of that exact product out of simple solids. Your model is drawn in a factory simulation next to hand-built machines, so it must look like the real product, not a generic box.

Coordinates: metres. x runs across the front (left is negative), y is up from the floor (the floor is y = 0), z runs front to back (the front, where a person stands, is positive z). The model is centred on x = 0, z = 0. "at" is a part's centre. "rot" is degrees about x, y, z.

Shapes and what "size" means:
- box: [x, y, z] side lengths.
- cylinder: [diameter, height, diameter]. Its axis points up. Use rot [0,0,90] to lay it along x, or [90,0,0] to lay it along z.
- cone: [bottom diameter, height, top diameter]. Tapered parts: hoppers, lamp shades, feet.
- sphere: [x, y, z] diameters.
- torus: [outer diameter, tube thickness, outer diameter]. A ring lying flat. Rotate it to stand up as a wheel rim or hose loop.

Materials (pick the closest to what you see):
${MATERIAL_NAMES.map((m) => `- ${m}: ${MATERIALS[m].is}`).join('\n')}

Motion: "none" for almost everything. "spin_x", "spin_y" or "spin_z" for a part that rotates in use about that axis through its own centre (wheels in use, fans, chucks, rollers, spindles). "bob" for a part that moves up and down in use (a press ram). "pulse" for indicator lights.

How to build a good model:
1. Work out the overall size first (convert inches: 1 in = 0.0254 m). If the listing does not state a dimension, estimate from the product type and photo and set dimsStated false.
2. Build bottom up, the way the product is made: feet or casters, then frame or base, then the main body, then the working parts, then controls and details.
3. Use ${30}-${70} parts. Model the sub-assemblies a real one has: individual legs and cross-braces, each drawer front with its handle, each shelf, each wheel with its bracket, motor housings, guards, control boxes with a screen and buttons, cables and hoses as thin cylinders, hinges, feet, bins, lamps, labels plates. Symmetric parts come in explicit pairs.
4. EVERY part must sit on the floor or touch another part. Compute it: a part's bottom is at[1] - size[1]/2 and must equal the top of what it stands on. Nothing floats. A handle touches its drawer; a lamp is on an arm that is on a post that is on the top.
5. Thin panels are thin boxes (0.02 to 0.04 m), never zero. No side under 0.005 m.
6. Stay inside the envelope: x within -w/2..w/2, y within 0..h, z within -d/2..d/2.
7. Match the colours and materials in the photo.

${EXAMPLE}`;

// ---------- photo cache ----------
const photos = new Map<string, Block | null>();
async function photoOf(url: string | undefined): Promise<Block | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  if (photos.has(url)) return photos.get(url)!;
  let block: Block | null = null;
  try {
    const sized = /cdn\.shopify\.com/.test(url) ? url + (url.includes('?') ? '&' : '?') + 'width=900' : url;
    const res = await fetch(sized, { signal: AbortSignal.timeout(10_000) });
    const mime = (res.headers.get('content-type') ?? '').split(';')[0];
    if (res.ok && /^image\/(png|jpeg|webp|gif)$/.test(mime)) {
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length <= 6_000_000) block = { type: 'image', data: bytes.toString('base64'), mime_type: mime };
    }
  } catch {
    /* no photo: the agent works from text */
  }
  if (photos.size > 60) photos.delete(photos.keys().next().value as string);
  photos.set(url, block);
  return block;
}

const listingText = (l: ShopListing) => `Title: ${l.title}\nSeller: ${l.seller}\nPrice: ${l.price} ${l.currency}\n${l.dims ? `Size option: ${l.dims.text}\n` : ''}Description: ${(l.description ?? '').slice(0, 3500)}`;
const ev = (emit: Emit | undefined, e: TraceEvent) => emit?.(e);
const running = (emit: Emit | undefined, stage: TraceEvent['stage'], actor: TraceEvent['actor'], title: string) => emit?.({ stage, actor, title, ms: 0, status: 'running' });

// ---------- SCOUT ----------
const GOOD_FIT = 0.75;

export async function scout(step: StepBrief, emit?: Emit) {
  const queries = [...new Set([step.itemName, `${step.label} ${step.type}`, `industrial ${step.type} workstation`, `${step.type} table`].map((q) => q.trim().toLowerCase()).filter(Boolean))];
  const context = `${step.context ? `${step.context} ` : ''}A workshop or small factory is being equipped. The process step is "${step.label}" (${step.type}); the plan calls for: ${step.itemName}. Complete units of industrial or workshop equipment are wanted, not spare parts, accessories, toys, camping or household furniture.`;
  const seen = new Set<string>();
  let ranked: { l: ShopListing; s: number }[] = [];

  // widen the search until something really fits, rather than settling for the first page
  for (const q of queries) {
    const t0 = Date.now();
    running(emit, 'convert', 'shop', `Searching Shop for “${q}”`);
    let found: ShopListing[] = [];
    try {
      found = (await searchListings(q, 12)).filter((l) => l.image && !seen.has(l.variantId));
    } catch {
      found = [];
    }
    found.forEach((l) => seen.add(l.variantId));
    ev(emit, { stage: 'convert', actor: 'shop', title: `Found ${found.length} listings for “${q}”`, ms: Date.now() - t0, status: found.length ? 'ok' : 'retry' });
    if (!found.length) continue;

    running(emit, 'check', 'decisions', 'Ranking listings for the step');
    const pool = found.slice(0, 10);
    try {
      const questions: Record<string, Question> = {};
      pool.forEach((l, i) => {
        questions[`l${i}`] = { type: 'noul', instructions: `Is this product the right equipment to use as a ${step.itemName} for the "${step.label}" step: "${l.title.slice(0, 160)}" (${l.price} ${l.currency})?` };
      });
      const d = await decide(context, questions);
      pool.forEach((l, i) => {
        const a = d.answers[`l${i}`];
        ranked.push({ l, s: a?.type === 'noul' ? a.noul : 0.5 });
      });
      ranked.sort((x, y) => y.s - x.s || x.l.price - y.l.price);
      const best = ranked[0].s;
      ev(emit, { stage: 'check', actor: 'decisions', title: `Ranked the listings: best fit ${Math.round(best * 100)}%`, detail: best < GOOD_FIT ? 'not good enough yet, widening the search' : undefined, ms: d.ms, status: best < GOOD_FIT ? 'retry' : 'ok' });
      if (best >= GOOD_FIT) break;
    } catch (e) {
      pool.forEach((l) => ranked.push({ l, s: 0.5 }));
      ev(emit, { stage: 'check', actor: 'decisions', title: 'Ranking failed; keeping search order', detail: (e as Error).message, ms: 0, status: 'fail' });
      break;
    }
  }
  if (!ranked.length) throw new Error(`Shop has no listings with a photo for ${step.label}`);
  return { listing: ranked[0].l, fit: ranked[0].s, considered: ranked.slice(0, 5).map((x) => ({ title: x.l.title.slice(0, 70), price: x.l.price, fit: x.s })) };
}

// ---------- DESIGN and CORRECT ----------
async function designLoop(steps: Step[], fallback: { w: number; d: number; h: number }, emit: Emit | undefined, firstTitle: string) {
  let model: MachineModel | null = null;
  let raw: any = {};
  let errs: string[] = [];
  let attempts = 0;
  for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
    running(emit, 'convert', 'hydrogen', attempts === 1 ? firstTitle : `Fixing ${errs.length} structural problem${errs.length > 1 ? 's' : ''}`);
    const res = await interact<any>({ model: DESIGNER, input: steps, system: SYSTEM, schema: modelSchema, thinking: 'low', maxOutputTokens: 30000 });
    raw = res.json ?? {};
    const candidate = normaliseModel(raw, fallback);
    errs = checkModel(candidate);
    ev(emit, {
      stage: 'convert',
      actor: 'hydrogen',
      title: errs.length ? `Model has ${errs.length} structural problem${errs.length > 1 ? 's' : ''}` : `Built a ${candidate.parts.length}-part model`,
      detail: errs.length ? errs.join(' | ').slice(0, 400) : `${candidate.size.w} × ${candidate.size.d} × ${candidate.size.h} m; ${new Set(candidate.parts.map((p) => p.material)).size} materials; ${candidate.parts.filter((p) => p.motion !== 'none').length} moving parts`,
      ms: res.ms,
      status: errs.length ? 'retry' : 'ok',
    });
    model = candidate;
    if (!errs.length) break;
    steps.push({ type: 'model_output', content: [{ type: 'text', text: res.text }] });
    steps.push({ type: 'user_input', content: [{ type: 'text', text: `That model was rejected by the structural check. Fix every problem below and emit the full model again (all parts, not just the changed ones).\n${errs.map((e) => `- ${e}`).join('\n')}` }] });
  }
  return { model: errs.length ? null : fitModel(model!), errors: errs, raw, attempts: Math.min(attempts, MAX_ATTEMPTS) };
}

/** A listing with no photo and a concept id: equipment nobody sells on Shop, designed from what the step does. */
const isConcept = (l: ShopListing) => l.variantId.startsWith('concept-');

export async function design(listing: ShopListing, step: StepBrief, emit?: Emit) {
  const concept = isConcept(listing);
  if (!concept) running(emit, 'convert', 'shop', 'Fetching the listing photo');
  const photo = concept ? null : await photoOf(listing.image);
  const ask = concept
    ? `There is no product listing for this. Build a detailed 3D model of a typical modern industrial ${step.itemName}, the equipment used for the "${step.label}" step${step.context ? ` in this plant: ${step.context}` : ''}. Model it as it really looks on a factory floor: its frame or housing, the working parts that do the step, guarding, the operator panel, cable trays, extraction, access platforms and steps where a machine this size has them. Its footprint is about ${step.w ?? 3} m wide by ${step.d ?? 2} m deep; choose a realistic height. Use 40 to 80 parts.`
    : `${listingText(listing)}\n\nThis will stand at the "${step.label}" step of a workshop. Build the detailed 3D model of this product.`;
  const content: Block[] = [...(photo ? [photo] : []), { type: 'text', text: ask }];
  const out = await designLoop([{ type: 'user_input', content }], { w: step.w ?? listing.dims?.w ?? 1.5, d: step.d ?? listing.dims?.d ?? 0.8, h: 1.2 }, emit, concept ? `Designing a ${step.itemName} from the process` : photo ? 'Modelling the product from its photo' : 'Modelling the product from the listing text');
  return {
    model: out.model,
    errors: out.errors,
    attempts: out.attempts,
    sawPhoto: !!photo,
    meta: { name: String(out.raw.name ?? listing.title).slice(0, 60), powerKw: typeof out.raw.powerKw === 'number' && out.raw.powerKw >= 0 ? out.raw.powerKw : 0, needsWater: Boolean(out.raw.needsWater), dimsStated: Boolean(out.raw.dimsStated) },
  };
}

export async function revise(listing: ShopListing, step: StepBrief, model: MachineModel, render: string, problems: string[], emit?: Emit) {
  const photo = await photoOf(listing.image);
  const content: Block[] = [
    ...(photo ? [{ type: 'text', text: 'Image 1, the product photo:' } as Block, photo] : []),
    { type: 'text', text: `${photo ? 'Image 2' : 'This image'}, a render of your current model:` },
    { type: 'image', data: render, mime_type: 'image/png' },
    {
      type: 'text',
      text: `${listingText(listing)}\n\nYour current model (${model.size.w} × ${model.size.d} × ${model.size.h} m), one part per line:\n${describeModel(model)}\n\nAn inspector compared the render with the product and found these problems:\n${problems.map((p) => `- ${p}`).join('\n')}\n\nFix them and emit the full corrected model for the "${step.label}" step. Keep what is already right.`,
    },
  ];
  const out = await designLoop([{ type: 'user_input', content }], model.size, emit, 'Correcting the model');
  return { model: out.model, errors: out.errors, attempts: out.attempts };
}

// ---------- INSPECT ----------
const critiqueSchema = {
  type: 'object',
  properties: {
    problems: { type: 'array', items: { type: 'string' }, description: 'up to five concrete problems, most important first. Each names the part and says what to change, e.g. "The back panel is missing: add a pegboard panel rising 0.6 m above the top at the rear"' },
  },
  required: ['problems'],
};

export async function inspect(listing: ShopListing, model: MachineModel, render: string, emit?: Emit) {
  const photo = await photoOf(listing.image);
  const renderBlock: Block = { type: 'image', data: render, mime_type: 'image/png' };
  const input: Block[] = photo
    ? [{ type: 'text', text: 'Image 1 is a photo of a real product. Image 2 is a 3D model built to represent that product in a factory simulation.\nImage 1:' }, photo, { type: 'text', text: '\nImage 2:' }, renderBlock, { type: 'text', text: `\nProduct: ${listing.title}` }]
    : [{ type: 'text', text: `The image is a 3D model built to represent this product in a factory simulation: ${listing.title}` }, renderBlock];
  running(emit, 'check', 'decisions', 'Comparing the render with the product');
  const d = await decide(input, {
    likeness: {
      type: 'score',
      instructions: photo ? 'How well does the 3D model in image 2 represent the product in image 1?' : 'How well does the 3D model in the image represent the named product?',
      criteria: ['an unrelated object', 'the right category of thing but the wrong shape', 'the right general shape, with key parts missing or wrong', 'recognisably this product, with minor differences', 'a faithful simplified model of this product'],
    },
    coherent: { type: 'noul', instructions: `Does the 3D model${photo ? ' in image 2' : ''} look like one solid, connected object, with no parts floating in the air or sticking out in odd places?` },
    proportions: { type: 'noul', instructions: photo ? 'Are the overall proportions of the 3D model in image 2 (how wide, deep and tall it is) consistent with the product in image 1?' : 'Are the proportions of the 3D model plausible for the named product?' },
  });
  const a = d.answers;
  const likeness = a.likeness?.type === 'score' ? a.likeness.score / 4 : 0;
  const coherent = a.coherent?.type === 'noul' ? a.coherent.noul : 0;
  const proportions = a.proportions?.type === 'noul' ? a.proportions.noul : 0;
  // "recognisably this product" is 0.75; asking for a little more sends borderline models round again
  const accepted = likeness >= (photo ? 0.8 : 0.74) && coherent >= 0.5 && proportions >= 0.4;
  ev(emit, {
    stage: 'check',
    actor: 'decisions',
    title: accepted ? `Inspection passed: ${Math.round(likeness * 100)}% likeness` : `Inspection: ${Math.round(likeness * 100)}% likeness, needs work`,
    detail: `coherent ${Math.round(coherent * 100)}%, proportions ${Math.round(proportions * 100)}%`,
    ms: d.ms,
    status: accepted ? 'ok' : 'retry',
  });

  let problems: string[] = [];
  if (!accepted) {
    running(emit, 'check', 'hydrogen', 'Listing what is wrong');
    try {
      const res = await interact<any>({
        model: MODELS.hydrogen,
        input: [...input, { type: 'text', text: `\nThe model's parts, one per line:\n${describeModel(model)}\n\nYou are the inspector. List what is wrong with the model compared with the real product, so the modeller can fix it.` }],
        schema: critiqueSchema,
        thinking: 'low',
      });
      problems = (Array.isArray(res.json?.problems) ? res.json.problems : []).map(String).slice(0, 5);
      ev(emit, { stage: 'check', actor: 'hydrogen', title: `Inspector found ${problems.length} problem${problems.length === 1 ? '' : 's'}`, detail: problems.join(' | ').slice(0, 400), ms: res.ms, status: 'ok' });
    } catch (e) {
      ev(emit, { stage: 'check', actor: 'hydrogen', title: 'Could not list the problems', detail: (e as Error).message, ms: 0, status: 'fail' });
    }
  }
  return { likeness, coherent, proportions, accepted, problems, sawPhoto: !!photo };
}
