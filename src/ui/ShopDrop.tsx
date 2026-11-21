// Procurement add-on: the "Add from Shop" section of the simulation's Equipment tab. Listings can be dragged
// onto the floor (the scene accepts SHOP_DRAG) or added beside the step's other stations with one press.
// Drawn with Dry Run's own classes (section, search, listing, ghost/primary sm, muted small).

import { useState } from 'react';
import type { ShopListing } from '../contracts';
import type { BudgetStatus } from '../procurement';
import { api, money } from '../store';
import { ShopAttribution, SizeCheck, SwapCost } from './Procurement';
import type { useShopDrop } from './useShopDrop';

export function AddFromShop({
  shop,
  defaultQuery,
  budgetAfter,
  disabled,
}: {
  shop: ReturnType<typeof useShopDrop>;
  defaultQuery: (type: string) => string;
  budgetAfter: (price: number) => BudgetStatus | null;
  disabled: boolean;
}) {
  const [query, setQuery] = useState(() => defaultQuery(shop.stepType));
  const [listings, setListings] = useState<ShopListing[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = shop.label(shop.stepType);

  const search = async () => {
    setSearching(true);
    setError(null);
    try {
      setListings((await api<{ listings: ShopListing[] }>('/api/catalog/search', { query })).listings);
    } catch (e) {
      setError((e as Error).message);
    }
    setSearching(false);
  };

  return (
    <div className="section">
      <h3>Add from Shop</h3>
      <label className="proc-step">
        <span className="muted small">For</span>
        <select
          value={shop.stepType}
          onChange={(e) => {
            shop.setStepType(e.target.value);
            setQuery(defaultQuery(e.target.value));
            setListings(null);
          }}
          aria-label="Process step the new equipment serves"
        >
          {shop.steps.map((s) => (
            <option key={s.type} value={s.type}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="packing table" aria-label="Search Shop for equipment to add" />
        <button className="primary sm" disabled={searching || !query.trim()}>
          {searching ? 'Searching' : 'Search'}
        </button>
      </form>
      {error && <span className="small warn">{error}</span>}
      {shop.pending && (
        <SizeCheck
          key={`${shop.pending.listing.variantId}@${shop.pending.at.x},${shop.pending.at.y}`}
          listing={shop.pending.listing}
          initial={shop.pending.item ? shop.pending.item.footprint : shop.pending.listing.dims}
          reason={
            shop.pending.item
              ? 'The listing does not state a size, so this one is estimated. Check it against the seller’s page.'
              : `The specs could not be read automatically. Enter the size from the listing; time, staff, power and water stay as for ${shop.label(shop.pending.type)}.`
          }
          onCancel={shop.cancelPending}
          onConfirm={shop.confirmSize}
        />
      )}
      {listings !== null && (
        <>
          <ShopAttribution />
          <p className="muted small">
            Drag one onto the floor, or press Add to put it beside the other {step} stations. If the spot breaks a layout rule, it goes to the nearest one that does not.
          </p>
        </>
      )}
      {listings?.length === 0 && <p className="muted small">Nothing found for that search.</p>}
      <div>
        {listings?.map((l) => (
          <div
            key={l.variantId}
            className={`listing proc-drag${disabled ? ' off' : ''}`}
            draggable={!disabled}
            onDragStart={(e) => shop.startDrag(e, l)}
            onDragEnd={shop.dragEnd}
            title={disabled ? undefined : 'Drag onto the floor'}
          >
            {l.image ? <img src={l.image} alt="" draggable={false} /> : <div className="listing-blank" />}
            <div className="listing-body">
              <b>{l.title.slice(0, 70)}</b>
              <span>
                {l.seller}
                {l.dims ? ` · ${l.dims.w} × ${l.dims.d} m` : ''}
              </span>
              <SwapCost delta={l.price} qty={1} after={budgetAfter(l.price)} />
              <div className="listing-foot">
                <strong>{money(l.price)}</strong>
                <a className="small" href={l.url} target="_blank" rel="noreferrer" draggable={false}>
                  Listing
                </a>
                <button className="ghost sm" disabled={disabled} onClick={() => shop.addNearStep(l)}>
                  Add
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {listings !== null && <p className="muted small">Added items belong to this layout, so save it as a version to keep them. Laying it out again from the Equipment step starts from the plan, without them.</p>}
    </div>
  );
}
