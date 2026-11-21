// Procurement add-on UI: budget, size check and export. Drawn with Dry Run's own classes
// (fact, fact-inputs, row, ghost/primary sm, muted small, Icon); procurement.css only lays out the new pieces.

import { useState } from 'react';
import type { ShopListing } from '../contracts';
import { sizeError, SIZE_MAX, SIZE_MIN, type BudgetStatus, type Size } from '../procurement';
import { money } from '../store';
import { Icon } from './icons';
import './procurement.css';

/** Budget input, shaped like the floor and demand facts on the plan screen. */
export function BudgetFact({ budget, onChange }: { budget?: number; onChange: (budget: number | undefined) => void }) {
  return (
    <label className="fact">
      <span>Budget</span>
      <span className="fact-inputs">
        $
        <input
          className="proc-budget-input"
          type="number"
          min={0}
          step={100}
          value={budget ?? ''}
          placeholder="none"
          onChange={(e) => onChange(e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)))}
          aria-label="Equipment budget in dollars"
        />
      </span>
    </label>
  );
}

export function BudgetMeter({ status }: { status: BudgetStatus }) {
  return (
    <div className="proc-budget">
      <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={status.budget} aria-valuenow={status.spend} aria-label="Equipment budget used">
        <i style={{ width: `${status.used * 100}%` }} className={status.over ? 'over' : ''} />
      </div>
      <span className={`small num ${status.over ? 'warn' : 'muted'}`}>
        {money(status.spend)} of {money(status.budget)} · {status.over ? `${money(-status.left)} over` : `${money(status.left)} left`}
      </span>
    </div>
  );
}

/** What choosing this listing does to the plan's spend, and to the budget when there is one. */
export function SwapCost({ delta, qty, after }: { delta: number; qty: number; after: BudgetStatus | null }) {
  const change = (Math.abs(delta) < 0.005 ? 'Same price' : `${money(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'}`) + (qty > 1 ? ` for ${qty}` : '');
  const budget = after ? (after.over ? ` · ${money(-after.left)} over budget` : ` · ${money(after.left)} left in budget`) : '';
  return (
    <span className={`proc-cost${after?.over ? ' over' : ''}`} title="Plan spend if you use this listing">
      {after?.over && <Icon name="warn" size={14} />}
      {change}
      {budget}
    </span>
  );
}

const field = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '' : String(v));

/**
 * Check a listing's size before it goes on the floor: shown when the size was estimated rather
 * than stated, or when the specs could not be read automatically.
 */
export function SizeCheck({ listing, initial, reason, onCancel, onConfirm }: { listing: ShopListing; initial?: Partial<Size>; reason: string; onCancel: () => void; onConfirm: (size: Size) => void }) {
  const [w, setW] = useState(field(initial?.w));
  const [d, setD] = useState(field(initial?.d));
  const [h, setH] = useState(field(initial?.h));
  const size: Size = { w: Number(w), d: Number(d), h: Number(h) };
  const error = w && d && h ? sizeError(size) : 'Enter width, depth and height';
  const input = (label: string, value: string, set: (v: string) => void) => (
    <label className="fact">
      <span>{label}</span>
      <span className="fact-inputs">
        <input type="number" min={SIZE_MIN} max={SIZE_MAX} step="any" value={value} onChange={(e) => set(e.target.value)} aria-label={`${label} in metres`} required />m
      </span>
    </label>
  );
  return (
    <form
      className="proc-size"
      onSubmit={(e) => {
        e.preventDefault();
        if (!error) onConfirm(size);
      }}
    >
      <span className="muted small">Check the size before it goes on the floor</span>
      <b>{listing.title.slice(0, 84)}</b>
      <p className="muted small">
        {reason}{' '}
        <a href={listing.url} target="_blank" rel="noreferrer">
          Listing
        </a>
      </p>
      <div className="proc-size-fields">
        {input('Width', w, setW)}
        {input('Depth', d, setD)}
        {input('Height', h, setH)}
      </div>
      {error && (w || d || h) ? <span className="small warn">{error}</span> : null}
      <div className="row">
        <button type="button" className="ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary sm" disabled={!!error}>
          Use this size
        </button>
      </div>
    </form>
  );
}

/**
 * Text attribution for Shopify Catalog results. Shopify's brand page says its logo needs written permission,
 * so this names Shopify in text, linked to shopify.com as its trademark guidelines ask.
 */
export function ShopAttribution({ checkout }: { checkout?: boolean }) {
  const shopify = (
    <a href="https://www.shopify.com" target="_blank" rel="noreferrer">
      Shopify
    </a>
  );
  return checkout ? (
    <p className="muted small">Buy opens the seller’s checkout on {shopify}, where you review and pay. Nothing is charged in Dry Run.</p>
  ) : (
    <p className="muted small">Products and prices from {shopify}. Prices can change at checkout.</p>
  );
}

function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Downloads the layout as a studioforge.procurement.snapshot; `snapshot` is built on click. */
export function ExportButton({ filename, snapshot }: { filename: string; snapshot: () => unknown }) {
  return (
    <button className="ghost sm" onClick={() => downloadJson(filename, snapshot())} title="Equipment with exact Shop ids, prices in cents, sizes and placement, for the checkout step">
      Export procurement JSON
    </button>
  );
}
