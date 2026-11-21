// The landing page. It opens on the product itself: a brief being typed and the plant that
// one sentence produced. Every picture is a render of something the harness built.
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEMOS, type Demo } from '../demos';
import { runDeterministicAdvocateAudit } from '../engines/advocate';
import { evaluate } from '../engines/versions';
import { num } from '../store';
import '../ui/home.css';
import { Icon } from '../ui/icons';
import { Scene } from '../ui/Scene';
import { demoProject } from './Landing';

interface EvalResults {
  validity?: { oneCallValidShare: number; placerValidShare: number; n: number };
  qap?: { oneCall?: { gapPct?: number }; harness?: { gapPct?: number } }[];
  queue?: { errorPct: number }[];
}

const EXAMPLES = [
  'Plan a car assembly plant that builds 30 compact electric cars an hour, from steel coils to cars driving off the line.',
  'A machine shop that makes 60 aluminium bike-light housings an hour on CNC lathes and mills, on a 30 by 20 metre floor.',
  'A workshop that assembles 40 espresso grinders an hour on a 16 by 12 metre floor.',
  'A cold brew bottling line for 2,000 bottles an hour, with a cold room and two docks.',
];

const MACHINES: [file: string, name: string, parts: number][] = [
  ['drawing', 'Deep drawing press', 59],
  ['underbody', 'Underbody welding cell', 83],
  ['ecoat', 'E-coat dip tank', 87],
  ['spraybooth', 'Primer and coat booth', 93],
  ['marriage', 'Battery and motor marriage', 74],
  ['curingoven', 'Paint curing oven', 64],
  ['coilblanking', 'Coil blanking line', 101],
  ['bodyside', 'Body-side framing cell', 82],
  ['trimline', 'Trim line', 88],
  ['chassisdyno', 'Chassis dyno', 55],
  ['flanging', 'Flanging and hemming press', 99],
  ['closurehang', 'Closure hanging cell', 80],
  ['seamseal', 'Seam sealing cell', 74],
  ['watertest', 'Water-leak test booth', 61],
  ['alignment', 'Wheel alignment', 59],
  ['visualcheck', 'Inspection tunnel', 79],
];

const QUERIES = ['stamping press line cycle time', 'welding robot cell footprint, kW', 'paint shop oven dwell time', 'EV plant floor area at 30 an hour'];
const ZONES: [name: string, share: number][] = [
  ['Stamping', 34],
  ['Body shop', 62],
  ['Paint shop', 100],
  ['General assembly', 78],
  ['Final inspection', 46],
];

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Adds .in to anything with .reveal once it scrolls into view. */
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll('.home .reveal:not(.in)')];
    if (!('IntersectionObserver' in window)) return void els.forEach((el) => el.classList.add('in'));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  });
}

function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

/** A number that counts up the first time it is seen. */
function Count({ to, digits = 0, suffix = '' }: { to: number; digits?: number; suffix?: string }) {
  const [ref, seen] = useInView<HTMLElement>();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (still()) return void setV(to);
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 1100);
      setV(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, to]);
  return (
    <b ref={ref}>
      {v.toFixed(digits)}
      {suffix}
    </b>
  );
}

/** The brief box. Until you type, it types example briefs for you; Plan it carries the text on. */
function Prompt({ onGo }: { onGo: (text: string) => void }) {
  const [value, setValue] = useState('');
  const [focus, setFocus] = useState(false);
  const [ex, setEx] = useState(0);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (value || focus) return;
    const full = EXAMPLES[ex].length;
    if (still()) return void setN(full);
    const t = n < full ? setTimeout(() => setN(n + 2), 26) : setTimeout(() => (setEx((ex + 1) % EXAMPLES.length), setN(0)), 2800);
    return () => clearTimeout(t);
  }, [n, ex, value, focus]);
  const go = () => onGo(value.trim() || EXAMPLES[ex]);
  return (
    <form
      className="ask"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <div className="ask-field">
        <textarea
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              go();
            }
          }}
          aria-label="Describe your factory"
        />
        {!value && (
          <span className={`ask-ghost${focus ? ' idle' : ''}`} aria-hidden="true">
            {focus ? 'Describe your factory' : EXAMPLES[ex].slice(0, n)}
            {!focus && <i className="caret" />}
          </span>
        )}
      </div>
      <div className="ask-bar">
        <span className="ask-hint">
          <Icon name="clip" size={15} /> Sketch, PDF
          <Icon name="mic" size={15} /> Voice
        </span>
        <button className="btn accent" type="submit">
          Plan it <Icon name="arrowRight" size={16} />
        </button>
      </div>
    </form>
  );
}

export function Home({
  hasProjects,
  onNew,
  onCatalog,
  onDemos,
  onOpenDemo,
}: {
  hasProjects: boolean;
  onNew: (text?: string) => void;
  onCatalog: () => void;
  onDemos: () => void;
  onOpenDemo: (d: Demo) => void;
}) {
  useReveal();

  const [results, setResults] = useState<EvalResults | null>(null);
  useEffect(() => {
    fetch('/eval/results.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setResults)
      .catch(() => setResults(null));
  }, []);
  const worstOneCall = results?.qap?.length ? Math.max(...results.qap.map((q) => q.oneCall?.gapPct ?? 0)) : null;
  const worstHarness = results?.qap?.length ? Math.max(...results.qap.map((q) => q.harness?.gapPct ?? 0)) : null;
  const worstQueue = results?.queue?.length ? Math.max(...results.queue.map((q) => Math.abs(q.errorPct))) : null;

  // one floor runs live, in the page: the inspectors walking it are computed, not filmed
  const [liveRef, liveSeen] = useInView<HTMLDivElement>();
  const live = useMemo(() => {
    if (!liveSeen) return null;
    const p = demoProject();
    const spec = p.versions[0].spec;
    const ev = evaluate(spec, 4);
    const routes = ev.ok ? ev.routes : null;
    const walkPlans = routes ? runDeterministicAdvocateAudit(spec, p.versions[0].metrics, routes).walkPlans : [];
    return { spec, routes, walkPlans, uph: p.versions[0].metrics.sim.unitsPerHour.median };
  }, [liveSeen]);

  return (
    <div className="home">
      <header className="hn">
        <span className="wordmark">
          dry run<i>.</i>
        </span>
        <nav>
          <button className="hn-link" onClick={onDemos}>
            {hasProjects ? 'Projects' : 'Demos'}
          </button>
          <button className="hn-link" onClick={onCatalog}>
            Catalog
          </button>
          <a className="hn-link" href="/eval/index.html" target="_blank" rel="noreferrer">
            Eval
          </a>
          <button className="btn ink" onClick={() => onNew()}>
            Start a project
          </button>
        </nav>
      </header>

      <section className="top">
        <h1 className="rise">
          Test the factory
          <br />
          before you <em>build</em> it.
        </h1>
        <p className="top-sub rise r1">One sentence in. A planned, equipped and simulated factory out.</p>
        <div className="rise r2">
          <Prompt onGo={onNew} />
        </div>

        <div className="top-plant rise r3">
          <button className="plant-img" onClick={() => onOpenDemo(DEMOS[0])} title="Open this plant">
            <img src="/img/car-plant.jpg?v=3" alt="A simulated electric car plant: five departments and sixty stations linked by conveyors" />
          </button>
          <figure className="chip c1">
            <img src="/img/machine-drawing.png" alt="" />
            <figcaption>
              <b>Deep drawing press</b>
              <span>59 parts, 11 moving</span>
            </figcaption>
          </figure>
          <figure className="chip c2">
            <img src="/img/machine-underbody.png" alt="" />
            <figcaption>
              <b>Welding cell</b>
              <span>83 parts, built by an agent</span>
            </figcaption>
          </figure>
          <figure className="chip c3">
            <img src="/img/machine-spraybooth.png" alt="" />
            <figcaption>
              <b>Coat booth</b>
              <span>Likeness 86%</span>
            </figcaption>
          </figure>
          <button className="plant-open" onClick={() => onOpenDemo(DEMOS[0])}>
            Built from the first sentence above. Open it <Icon name="arrowRight" size={14} />
          </button>
        </div>

        <div className="top-stats reveal">
          <div>
            <Count to={60} />
            <span>stations placed</span>
          </div>
          <div>
            <Count to={20} />
            <span>machines designed by agents</span>
          </div>
          <div>
            <Count to={5} />
            <span>departments, from research</span>
          </div>
          <div>
            <Count to={26.9} digits={1} />
            <span>cars an hour, 30 asked</span>
          </div>
        </div>
      </section>

      <section className="how">
        <h2 className="reveal">From a sentence to a running floor.</h2>
        <div className="bento">
          <article className="tile t4 reveal">
            <div className="tile-art sketch">
              <img src="/img/machine-shop-sketch.jpg?v=2" alt="A hand-drawn floor sketch of a machine shop" />
            </div>
            <div className="tile-text">
              <h3>
                <i>1</i> Brief
              </h3>
              <p>Text, a sketch photo, a PDF or a voice note.</p>
            </div>
          </article>
          <article className="tile t4 reveal">
            <div className="tile-art queries">
              {QUERIES.map((q, k) => (
                <span key={q} style={{ animationDelay: `${k * 0.9}s` }}>
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  {q}
                </span>
              ))}
            </div>
            <div className="tile-text">
              <h3>
                <i>2</i> Research
              </h3>
              <p>Real cycle times and footprints, looked up first.</p>
            </div>
          </article>
          <article className="tile t4 reveal">
            <div className="tile-art zones">
              {ZONES.map(([z, share], k) => (
                <span key={z}>
                  {z}
                  <i>
                    <b style={{ width: `${share}%`, animationDelay: `${k * 0.14}s` }} />
                  </i>
                </span>
              ))}
            </div>
            <div className="tile-text">
              <h3>
                <i>3</i> Plan
              </h3>
              <p>Departments and station counts, checked against your brief.</p>
            </div>
          </article>
          <article className="tile t7 reveal">
            <div className="tile-art built">
              {MACHINES.slice(0, 8).map(([f, name], k) => (
                <img key={f} src={`/img/machine-${f}.png`} alt={name} loading="lazy" style={{ animationDelay: `${k * 0.35}s` }} />
              ))}
            </div>
            <div className="tile-text">
              <h3>
                <i>4</i> Build
              </h3>
              <p>One agent per machine. An inspector judges every render.</p>
            </div>
          </article>
          <article className="tile t5 reveal">
            <div className="tile-art pan">
              <img src="/img/car-plant-close.jpg?v=3" alt="Close view of the paint shop with conveyors" loading="lazy" />
            </div>
            <div className="tile-text">
              <h3>
                <i>5</i> Simulate
              </h3>
              <p>Thirty shifts on a layout that passes every rule.</p>
            </div>
          </article>
          <article className="tile t12 wide reveal">
            <div className="tile-text">
              <h3>
                <i>6</i> Improve
              </h3>
              <p>Five inspectors walk the floor and argue with it. Agents propose changes. Only what wins in simulation is kept.</p>
              {live && <span className="live-tag">Running in this page: {num(live.uph)} units an hour</span>}
            </div>
            <div className="tile-art floor" ref={liveRef}>
              {live && <Scene spec={live.spec} routes={live.routes} layers={{ flow: true, routes: false, power: false, water: false, labels: false, crew: true }} walkPlans={live.walkPlans} interactive={false} />}
            </div>
          </article>
        </div>
      </section>

      <section className="wall">
        <h2 className="reveal">Every machine designed by an agent.</h2>
        {[MACHINES.slice(0, 8), MACHINES.slice(8)].map((row, r) => (
          <div key={r} className={`marquee${r ? ' back' : ''}`} aria-hidden={r > 0}>
            <div className="marquee-track">
              {[...row, ...row].map(([f, name, parts], k) => (
                <figure key={k}>
                  <img src={`/img/machine-${f}.png`} alt={k < row.length ? name : ''} loading="lazy" />
                  <figcaption>
                    <b>{name}</b>
                    <span>{parts} parts</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="proof">
        <div className="proof-panel reveal">
          <h2>
            The model proposes.
            <br />
            The simulator decides.
          </h2>
          {results && (
            <div className="proof-stats">
              {results.validity && (
                <div>
                  <Count to={Math.round(results.validity.placerValidShare * 100)} suffix="%" />
                  <span>of layouts valid. A single model call manages {Math.round(results.validity.oneCallValidShare * 100)}%.</span>
                </div>
              )}
              {worstHarness !== null && worstOneCall !== null && (
                <div>
                  <Count to={worstHarness} digits={1} suffix="%" />
                  <span>from the best-known answer on public layout benchmarks. One call: {num(worstOneCall)}%.</span>
                </div>
              )}
              {worstQueue !== null && (
                <div>
                  <Count to={worstQueue} digits={1} suffix="%" />
                  <span>largest gap between the simulator and queueing theory.</span>
                </div>
              )}
            </div>
          )}
          <a className="proof-link" href="/eval/index.html" target="_blank" rel="noreferrer">
            Read where it breaks <Icon name="arrowRight" size={14} />
          </a>
        </div>
      </section>

      <section className="open">
        <div className="open-head">
          <h2 className="reveal">Open one.</h2>
          <button className="btn line reveal" onClick={onDemos}>
            All demos <Icon name="arrowRight" size={14} />
          </button>
        </div>
        <div className="demo-grid">
          {DEMOS.slice(0, 3).map((d, k) => (
            <button key={d.id} className="demo-card reveal" style={{ transitionDelay: `${k * 0.08}s` }} onClick={() => onOpenDemo(d)}>
              <span className="demo-img">
                <img src={d.image} alt="" loading="lazy" />
                <span className="demo-scale">{d.scale}</span>
              </span>
              <span className="demo-body">
                <b>{d.name}</b>
                <span className="demo-stats">
                  {d.stats.slice(0, 3).map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="close">
        <div className="close-panel reveal">
          <h2>Bring one real floor.</h2>
          <div className="close-cta">
            <button className="btn white lg" onClick={() => onNew()}>
              Start a project <Icon name="arrowRight" />
            </button>
            <button className="btn clear lg" onClick={onDemos}>
              See the demos
            </button>
          </div>
        </div>
      </section>

      <footer className="hf">
        <span className="wordmark">
          dry run<i>.</i>
        </span>
        <span>Gemini 4 Hydrogen, Neon, Decisions API, Managed Agents, Shop</span>
      </footer>
    </div>
  );
}
