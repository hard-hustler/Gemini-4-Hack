import { useState, type ReactNode } from 'react';
import type { TraceEvent } from '../contracts';

export function Wordmark({ onClick }: { onClick?: () => void }) {
  return (
    <button className="wordmark" onClick={onClick} aria-label="Dry Run home">
      dry run<i>.</i>
    </button>
  );
}

export function TopBar({ onHome, crumbs, right }: { onHome: () => void; crumbs?: { label: string; onClick?: () => void; active?: boolean }[]; right?: ReactNode }) {
  return (
    <header className="topbar">
      <Wordmark onClick={onHome} />
      {crumbs && (
        <nav className="crumbs" aria-label="Project steps">
          {crumbs.map((c, i) => (
            <span key={c.label} className="crumb-wrap">
              {i > 0 && <span className="crumb-sep">/</span>}
              <button className={`crumb${c.active ? ' active' : ''}`} disabled={!c.onClick} onClick={c.onClick}>
                <em>{String(i + 1).padStart(2, '0')}</em>
                {c.label}
              </button>
            </span>
          ))}
        </nav>
      )}
      <div className="topbar-right">{right}</div>
    </header>
  );
}

const ACTOR: Record<TraceEvent['actor'], string> = { hydrogen: 'Hydrogen', neon: 'Neon', decisions: 'Decisions', agent: 'Managed agent', engine: 'Engine', shop: 'Shop' };
const STAGE: Record<TraceEvent['stage'], string> = { read: 'Read', plan: 'Plan', check: 'Check', equip: 'Equip', place: 'Place', simulate: 'Simulate', improve: 'Improve', convert: 'Convert' };

/** The dark step tracker: what the harness is doing, or what it just did. Click to open the run log. */
export function Tracker({ events, running, stages }: { events: TraceEvent[]; running?: string | null; stages?: string[] }) {
  const [open, setOpen] = useState(false);
  if (!running && !events.length) return null;
  const done = events.filter((e, i, a) => a.findIndex((x) => x.stage === e.stage) === i || e.status === 'fail');
  return (
    <div className="tracker-wrap">
      {open && !running && (
        <div className="runlog" role="log">
          <header>
            <span className="eyebrow">Run log</span>
            <button className="ghost small" onClick={() => setOpen(false)}>
              Close
            </button>
          </header>
          {events.map((e, i) => (
            <div key={i} className={`runlog-row ${e.status}`}>
              <span className="runlog-actor">{ACTOR[e.actor]}</span>
              <span className="runlog-body">
                <b>{e.title}</b>
                {e.detail && <span>{e.detail}</span>}
              </span>
              <span className="runlog-ms">{e.ms >= 1000 ? `${(e.ms / 1000).toFixed(1)} s` : `${e.ms} ms`}</span>
            </div>
          ))}
        </div>
      )}
      <button className={`tracker${running ? ' running' : ''}`} onClick={() => !running && setOpen(!open)} title={running ? undefined : 'Show the run log'}>
        {running ? (
          <>
            <span className="spinner" />
            <span className="tracker-step on">{running}</span>
            {stages?.map((s) => (
              <span key={s} className="tracker-step dim">
                {s}
              </span>
            ))}
          </>
        ) : (
          done.map((e, i) => (
            <span key={i} className={`tracker-step ${e.status}`}>
              <i>{e.status === 'fail' ? '×' : '✓'}</i>
              {STAGE[e.stage]}
            </span>
          ))
        )}
      </button>
    </div>
  );
}

export function Notice({ tone, title, lines, onClose }: { tone: 'ok' | 'error'; title: string; lines?: string[]; onClose?: () => void }) {
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div>
        <b>{title}</b>
        {lines?.filter(Boolean).map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
      {onClose && (
        <button className="ghost small" onClick={onClose}>
          Dismiss
        </button>
      )}
    </div>
  );
}
