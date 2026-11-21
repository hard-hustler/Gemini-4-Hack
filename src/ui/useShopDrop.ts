// Procurement add-on: drag a Shop product onto the 3D floor, or press Add. A drop goes through the same rules as
// every other edit: the item's specs are read from the listing the way the Replace drawer reads them, then
// placeNear() puts it at the drop point, or the nearest spot that passes validate().

import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { CatalogItem, EquipmentLine, ShopListing, TraceEvent } from '../contracts';
import type { ValidationError } from '../engines/validate';
import { itemFromListing, nextStationId, placeNear, stationAt, stationFromItem, withSize, type Size } from '../procurement';
import { applyOp, centre, type FactorySpec, type Point, type Station } from '../spec';
import type { Project } from '../store';

/** dataTransfer type of a Shop listing dragged from the panel; the scene only reacts to drags of this type */
export const SHOP_DRAG = 'application/x-dryrun-listing';

type Note = { tone: 'ok' | 'error'; title: string; lines: string[] } | null;

export interface ShopDropDeps {
  draft: FactorySpec;
  versionId: string;
  project: Project;
  /** the workspace's streamed call: shows the run in the tracker and reports errors */
  call: <T>(label: string, path: string, body: unknown) => Promise<T | null>;
  setDraft: (spec: FactorySpec) => void;
  setPreview: (spec: FactorySpec | null) => void;
  setRejected: (errors: ValidationError[]) => void;
  setNotice: (note: Note) => void;
  onChange: (patch: Partial<Project>) => void;
}

/** A dropped listing waiting for its size to be checked; `item` is absent when the specs could not be read. */
export interface PendingDrop {
  listing: ShopListing;
  type: string;
  at: Point;
  item?: CatalogItem;
}

export function useShopDrop(deps: ShopDropDeps) {
  // placement happens after an await; it must use the draft as it is then, not as it was at the drop
  const latest = useRef(deps);
  latest.current = deps;
  const routing = deps.draft.routing;
  const [stepType, setStepType] = useState(routing[0] ?? '');
  const [pending, setPending] = useState<PendingDrop | null>(null);
  const dragging = useRef<{ listing: ShopListing; type: string } | null>(null);
  const ghostAt = useRef('');

  useEffect(() => {
    if (!routing.includes(stepType)) setStepType(routing[0] ?? '');
  }, [routing.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  // a size check left open belongs to the version it was dropped on
  useEffect(() => setPending(null), [deps.versionId]);

  const label = (type: string) => latest.current.project.requirements.steps.find((s) => s.type === type)?.label ?? type;
  const template = (spec: FactorySpec, type: string): Station | undefined => spec.stations.find((s) => s.type === type);

  /** The step's process numbers as a plan line: what an item gets when its specs cannot be read from the listing. */
  const lineFor = (spec: FactorySpec, type: string): EquipmentLine => {
    const t = template(spec, type);
    return {
      stepType: type,
      label: label(type),
      qty: 1,
      item: {
        id: `step-${type}`,
        name: t?.name ?? label(type),
        stationType: type,
        footprint: { w: t?.w ?? 1, d: t?.d ?? 1, h: t?.height ?? 1 },
        cycleTimeSec: t?.cycleTimeSec ?? 60,
        operators: t?.operators ?? 1,
        powerKw: t?.powerKw ?? 0,
        needsWater: t?.needsWater ?? false,
        price: t?.price ?? 0,
        source: 'builtin',
        shape: t?.shape,
      },
    };
  };

  /** Put a finished item at, or near, the point; keep the item on the project so the export has its exact ids. */
  const place = (item: CatalogItem, at: Point, how?: string) => {
    const { draft, setDraft, setRejected, setNotice, project, onChange } = latest.current;
    const r = placeNear(draft, stationFromItem(item, nextStationId(draft, item.stationType), draft.floor.cellSize), at);
    if ('errors' in r) {
      setNotice(null);
      setRejected(r.errors);
      return;
    }
    setRejected([]);
    setDraft(r.spec);
    onChange({ shopItems: [...(project.shopItems ?? []).filter((i) => i.id !== item.id), item] });
    setNotice({
      tone: 'ok',
      title: `Added ${item.name}`,
      lines: [
        `${r.station.id} for ${label(item.stationType)} at ${r.station.x}, ${r.station.y} m${r.moved ? ', the nearest spot to the drop that passes every layout rule' : ''}.`,
        how ?? '',
        'Save the layout as a version to keep it.',
      ].filter(Boolean),
    });
  };

  /** Read the listing's specs, then place it; a size the listing does not state is checked by the user first. */
  const add = async (listing: ShopListing, type: string, at: Point) => {
    const { draft, call, versionId } = latest.current;
    const t = template(draft, type);
    setPending(null);
    const step = { type, label: label(type), cycleTimeSec: t?.cycleTimeSec ?? 60, operators: t?.operators ?? 1 };
    const out = await call<{ item: CatalogItem; dimsStated?: boolean; trace: TraceEvent[] }>('Reading the listing', '/api/catalog/convert', { listing, step });
    // reading a listing takes a while; a drop belongs to the version it was dropped on
    if (latest.current.versionId !== versionId) {
      latest.current.setNotice({ tone: 'error', title: 'The version changed while the listing was read', lines: ['Drop it again on the version you want it in.'] });
      return;
    }
    if (!out) return setPending({ listing, type, at });
    if (out.dimsStated === false) return setPending({ listing, type, at, item: out.item });
    place(out.dimsStated ? { ...out.item, sizeSource: 'listing' } : out.item, at);
  };

  const confirmSize = (size: Size) => {
    if (!pending) return;
    const item = pending.item ? withSize(pending.item, size) : itemFromListing(pending.listing, lineFor(latest.current.draft, pending.type), size);
    setPending(null);
    place(item, pending.at, pending.item ? 'Size checked by you.' : 'Specs entered by hand; time, staff, power and water are the step’s.');
  };

  /** Where the dragged listing would land: its stated footprint, else the step's current size. */
  const ghost = (spec: FactorySpec, drag: { listing: ShopListing; type: string }, p: Point): Station => {
    const base = lineFor(spec, drag.type).item;
    const item: CatalogItem = { ...base, name: drag.listing.title, footprint: { ...base.footprint, w: drag.listing.dims?.w ?? base.footprint.w, d: drag.listing.dims?.d ?? base.footprint.d }, price: drag.listing.price };
    return stationAt(stationFromItem(item, nextStationId(spec, drag.type), spec.floor.cellSize), p, 0, spec.floor.cellSize);
  };

  const startDrag = (e: DragEvent, listing: ShopListing) => {
    e.dataTransfer.setData(SHOP_DRAG, listing.variantId);
    e.dataTransfer.effectAllowed = 'copy';
    dragging.current = { listing, type: stepType };
    ghostAt.current = '';
  };

  /** Over the floor: show the item there through the scene's usual preview, red where a rule fails. */
  const dragOver = (p: Point | null) => {
    const drag = dragging.current;
    if (!drag) return;
    const { draft, setPreview } = latest.current;
    if (!p) {
      if (ghostAt.current) setPreview(null);
      ghostAt.current = '';
      return;
    }
    const g = ghost(draft, drag, p);
    const key = `${g.x},${g.y}`;
    if (key === ghostAt.current) return;
    ghostAt.current = key;
    setPreview(applyOp(draft, { op: 'add', station: g }));
  };

  const drop = (p: Point) => {
    const drag = dragging.current;
    dragging.current = null;
    ghostAt.current = '';
    latest.current.setPreview(null);
    if (drag) void add(drag.listing, drag.type, p);
  };

  /** The drag ended without a drop on the floor (Esc, or let go elsewhere): clear the preview. */
  const dragEnd = () => {
    if (ghostAt.current) latest.current.setPreview(null);
    dragging.current = null;
    ghostAt.current = '';
  };

  /** The Add button: beside the step's other stations, or the middle of the floor. */
  const addNearStep = (listing: ShopListing) => {
    const spec = latest.current.draft;
    const same = spec.stations.filter((s) => s.type === stepType).map(centre);
    const at = same.length ? { x: same.reduce((t, c) => t + c.x, 0) / same.length, y: same.reduce((t, c) => t + c.y, 0) / same.length } : { x: spec.floor.width / 2, y: spec.floor.depth / 2 };
    void add(listing, stepType, at);
  };

  return {
    steps: routing.map((type) => ({ type, label: label(type) })),
    stepType,
    setStepType,
    label,
    pending,
    cancelPending: () => setPending(null),
    confirmSize,
    startDrag,
    dragOver,
    drop,
    dragEnd,
    addNearStep,
  };
}
