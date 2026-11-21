import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TraceEvent } from '../contracts';
import { Icon } from './icons';
import { CommerceCartButton } from './Commerce';

export function Wordmark({ onClick }: { onClick?: () => void }) {
  return (
    <button className="wordmark" onClick={onClick} aria-label="Dry Run home">
      dry run<i>.</i>
    </button>
  );
}

const ACTOR: Record<TraceEvent['actor'], string> = {
  hydrogen: 'Hydrogen',
  neon: 'Neon',
  decisions: 'Decisions',
  agent: 'Managed agent',
  engine: 'Engine',
  shop: 'Shop',
  advocate: 'Advocate panel',
  fixer: 'Elena Vasquez',
};
const STAGE: Record<TraceEvent['stage'], string> = {
  read: 'Read',
  research: 'Research',
  plan: 'Plan',
  check: 'Check',
  equip: 'Equip',
  place: 'Place',
  simulate: 'Simulate',
  improve: 'Improve',
  convert: 'Convert',
  advocate: 'Audit',
  fix: 'Fix',
};
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

export function RunLog({ events }: { events: TraceEvent[] }) {
  if (!events.length) return <p className="muted">Nothing has run yet.</p>;
  return (
    <div className="runlog" role="log">
      {events.map((e, i) => (
        <div key={i} className={`runlog-row ${e.status}`}>
          <span className="runlog-actor">{ACTOR[e.actor]}</span>
          <span className="runlog-body">
            <b>{e.title}</b>
            {e.detail && <span>{e.detail}</span>}
          </span>
          <span className="runlog-ms">{e.ms ? ms(e.ms) : ''}</span>
        </div>
      ))}
    </div>
  );
}

export function TopBar({
  onHome,
  crumbs,
  right,
  log,
}: {
  onHome: () => void;
  crumbs?: { label: string; onClick?: () => void; active?: boolean }[];
  right?: ReactNode;
  /** every step the harness has taken on this project */
  log?: TraceEvent[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="topbar">
      <Wordmark onClick={onHome} />
      {crumbs && (
        <nav className="crumbs" aria-label="Project steps">
          {crumbs.map((c) => (
            <button key={c.label} className={`crumb${c.active ? ' active' : ''}`} disabled={!c.onClick} onClick={c.onClick} aria-current={c.active ? 'step' : undefined}>
              {c.label}
            </button>
          ))}
        </nav>
      )}
      <div className="topbar-right">
        {log && log.length > 0 && (
          <div className="popover-anchor">
            <button className="text" onClick={() => setOpen(!open)} aria-expanded={open}>
              <Icon name="list" /> Run log
            </button>
            {open && (
              <div className="popover">
                <header>
                  <b>Run log</b>
                  <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close run log">
                    <Icon name="x" />
                  </button>
                </header>
                <RunLog events={log} />
              </div>
            )}
          </div>
        )}
        {right}
        <CommerceCartButton />
      </div>
    </header>
  );
}

/** Streaming state for one harness call: what is in flight, and what has finished so far. */
export function useRun() {
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<string | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [recent, setRecent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const collected = useRef<TraceEvent[]>([]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onEvent = (e: TraceEvent) => {
    if (e.status === 'running') return setLive(e.title);
    collected.current.push(e);
    setEvents([...collected.current]);
    setLive(null);
  };
  /** Runs a job, feeding it onEvent. Resolves with the job's value and the steps that completed. */
  const run = async <T,>(label: string, job: (onEvent: (e: TraceEvent) => void) => Promise<T>): Promise<{ value: T; events: TraceEvent[] }> => {
    clearTimeout(timer.current);
    collected.current = [];
    setEvents([]);
    setBusy(true);
    setRecent(false);
    setLive(label);
    try {
      const value = await job(onEvent);
      return { value, events: collected.current };
    } finally {
      setBusy(false);
      setLive(null);
      setRecent(true);
      timer.current = setTimeout(() => setRecent(false), 7000);
    }
  };
  return { busy, live, events, recent, run };
}

/** "Round 2" for improve steps, otherwise the stage name. */
const short = (e: TraceEvent) => /^Round \d+/.exec(e.title)?.[0] ?? STAGE[e.stage];

/** The dark step tracker: finished steps as ticks, the step in flight with a spinner. */
export function RunStatus({ state }: { state: ReturnType<typeof useRun> }) {
  const [open, setOpen] = useState(false);
  const { busy, live, events, recent } = state;
  useEffect(() => {
    if (!busy && !recent) setOpen(false);
  }, [busy, recent]);
  if (!busy && !recent && !open) return null;
  const steps: { label: string; status: TraceEvent['status'] }[] = [];
  for (const e of events) {
    const label = short(e);
    const last = steps[steps.length - 1];
    if (last?.label === label) last.status = e.status === 'fail' ? 'fail' : last.status;
    else steps.push({ label, status: e.status });
  }
  return (
    <div className="runstatus">
      {open && (
        <div className="popover up">
          <RunLog events={events} />
        </div>
      )}
      <button className={`tracker${busy ? ' busy' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} title="Show what ran">
        {steps.slice(-4).map((s, i) => (
          <span key={i} className={`tracker-step ${s.status}`}>
            <Icon name={s.status === 'fail' ? 'x' : 'check'} size={14} />
            {s.label}
          </span>
        ))}
        {busy && (
          <span className="tracker-step on">
            <span className="spinner" />
            {live ?? 'Working'}
          </span>
        )}
      </button>
    </div>
  );
}

export function Notice({ tone, title, lines, onClose }: { tone: 'ok' | 'error'; title: string; lines?: string[]; onClose?: () => void }) {
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'error' ? 'warn' : 'check'} />
      <div>
        <b>{title}</b>
        {lines?.filter(Boolean).map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
      {onClose && (
        <button className="icon-btn" onClick={onClose} aria-label="Dismiss">
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}
