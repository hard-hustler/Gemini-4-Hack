// The landing page, built as a pitch: show the thing, say little. Every picture on it is a
// render of something the harness itself produced; none are stock or mock-ups.
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEMOS, type Demo } from '../demos';
import { runDeterministicAdvocateAudit } from '../engines/advocate';
import { evaluate } from '../engines/versions';
import { num, type Project } from '../store';
import '../ui/home.css';
import { Icon } from '../ui/icons';
import { Scene } from '../ui/Scene';
import { demoProject } from './Landing';

interface EvalResults {
  validity?: { oneCallValidShare: number; placerValidShare: number; n: number };
  qap?: { oneCall?: { gapPct?: number }; harness?: { gapPct?: number } }[];
  queue?: { errorPct: number }[];
}

const BRIEF = 'Plan a car assembly plant that builds 30 compact electric cars an hour, from steel coils to cars driving off the line.';

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

const STEPS: { title: string; line: string }[] = [
  { title: 'Brief', line: 'A sentence, a sketch photo, a PDF or a voice note.' },
  { title: 'Research', line: 'Big projects are researched on the web before anything is planned.' },
  { title: 'Plan', line: 'Departments, steps and station counts, checked against what you asked for.' },
  { title: 'Build', line: 'One agent per machine. Code checks it holds together; an inspector checks the render.' },
  { title: 'Simulate', line: 'A layout that passes every rule, run for thirty shifts.' },
  { title: 'Improve', line: 'Agents propose changes and inspectors walk the floor. Only what wins in simulation is kept.' },
];

/** Adds .in to anything with .reveal once it scrolls into view. */
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll('.home .reveal')];
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
      { threshold: 0.18 },
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
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return void setV(to);
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

/** Types the brief out once it is on screen. */
function Typed({ text }: { text: string }) {
  const [ref, seen] = useInView<HTMLParagraphElement>();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return void setN(text.length);
    const t = setInterval(() => setN((c) => (c >= text.length ? (clearInterval(t), c) : c + 2)), 28);
    return () => clearInterval(t);
  }, [seen, text]);
  return (
    <p ref={ref} className="typed" aria-label={text}>
      {text.slice(0, n)}
      <i className={n >= text.length ? 'caret done' : 'caret'} />
    </p>
  );
}

function StepVisual({ i }: { i: number }) {
  switch (i) {
    case 0:
      return <img className="how-img" src="/sample-sketch.png" alt="A hand-drawn floor sketch" />;
    case 1:
      return (
        <div className="how-search">
          {['automotive stamping press line cycle time footprint', 'body shop welding robot cell footprint power kW', 'automotive paint shop cycle time footprint', 'EV assembly plant floor area, 30 jobs per hour'].map((q, k) => (
            <span key={q} style={{ animationDelay: `${k * 0.22}s` }}>
              <Icon name="arrowRight" size={14} /> {q}
            </span>
          ))}
        </div>
      );
    case 2:
      return (
        <div className="how-zones">
          {['Stamping', 'Body shop', 'Paint shop', 'General assembly', 'Final inspection'].map((z, k) => (
            <span key={z} style={{ animationDelay: `${k * 0.16}s` }}>
              <em>{String(k + 1).padStart(2, '0')}</em>
              {z}
            </span>
          ))}
        </div>
      );
    case 3:
      return (
        <div className="how-grid">
          {MACHINES.slice(0, 6).map(([f, name], k) => (
            <img key={f} src={`/img/machine-${f}.png`} alt={name} style={{ animationDelay: `${k * 0.12}s` }} />
          ))}
        </div>
      );
    case 4:
      return <img className="how-img pan" src="/img/car-plant-close.jpg" alt="Close view of the paint shop with conveyors" />;
    default:
      return <img className="how-img" src="/img/espresso-workshop.jpg" alt="A workshop floor with inspectors walking it" />;
  }
}

export function Home({
  projects,
  onNew,
  onCatalog,
  onOpen,
  onDemos,
  onOpenDemo,
  onDelete,
}: {
  projects: Project[];
  onNew: () => void;
  onCatalog: () => void;
  onOpen: (p: Project) => void;
  onDemos: () => void;
  onOpenDemo: (d: Demo) => void;
  onDelete: (id: string) => void;
}) {
  useReveal();
  const [step, setStep] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 3600);
    return () => clearInterval(t);
  }, [held]);

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
      <header className="home-nav">
        <span className="wordmark">
          dry run<i>.</i>
        </span>
        <nav>
          <button className="home-link" onClick={onDemos}>
            Demos
          </button>
          <button className="home-link" onClick={onCatalog}>
            Catalog
          </button>
          <a className="home-link" href="/eval/index.html" target="_blank" rel="noreferrer">
            Eval
          </a>
          <button className="btn-ink" onClick={onNew}>
            Start a project
          </button>
        </nav>
      </header>

      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="mono tag">
            <i className="dot" /> Factory planning, simulated
          </span>
          <h1>
            Test the
            <br />
            factory before
            <br />
            you build it.
          </h1>
          <p>Describe a factory. Agents plan it, build every machine and simulate it, before you spend a dollar.</p>
          <div className="home-cta">
            <button className="btn-ink lg" onClick={onNew}>
              Start a project <Icon name="arrowRight" />
            </button>
            <button className="btn-line lg" onClick={onDemos}>
              See the demos
            </button>
          </div>
        </div>
        <div className="home-hero-art">
          <div className="hero-frame">
            <img src="/img/car-plant-close.jpg" alt="A simulated car plant: paint ovens linked by conveyors" />
          </div>
          <figure className="hero-chip a">
            <img src="/img/machine-underbody.png" alt="" />
            <figcaption>
              <b>Welding cell</b>
              <span className="mono">83 parts · agent-built</span>
            </figcaption>
          </figure>
          <figure className="hero-chip b">
            <img src="/img/machine-drawing.png" alt="" />
            <figcaption>
              <b>Drawing press</b>
              <span className="mono">59 parts · 11 moving</span>
            </figcaption>
          </figure>
          <span className="hero-caption mono">Not a mock-up. A plant the harness built from one sentence.</span>
        </div>
      </section>

      <section className="home-one">
        <span className="mono num reveal">One sentence in</span>
        <h2 className="reveal">A car plant out.</h2>
        <div className="one-grid">
          <div className="one-brief reveal">
            <span className="mono">The whole brief</span>
            <Typed text={BRIEF} />
          </div>
          <div className="one-arrow reveal" aria-hidden="true">
            <Icon name="arrowRight" size={28} />
          </div>
          <button className="one-result reveal" onClick={() => onOpenDemo(DEMOS[0])} title="Open this plant">
            <img src="/img/car-plant.jpg" alt="The whole plant: five departments and sixty stations" />
            <span className="mono">
              Open this plant <Icon name="arrowRight" size={14} />
            </span>
          </button>
        </div>
        <div className="one-stats reveal">
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
            <Count to={27.9} digits={1} />
            <span>cars an hour, against 30 asked</span>
          </div>
        </div>
      </section>

      <section className="home-how" onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}>
        <span className="mono num reveal">How it works</span>
        <div className="how-rail reveal" role="tablist" aria-label="Steps">
          {STEPS.map((s, i) => (
            <button key={s.title} role="tab" aria-selected={step === i} className={step === i ? 'on' : i < step ? 'done' : ''} onClick={() => setStep(i)}>
              <span className="mono">{String(i + 1).padStart(2, '0')}</span>
              {s.title}
              {step === i && !held && <i className="how-timer" />}
            </button>
          ))}
        </div>
        <div className="how-stage reveal">
          <div className="how-copy" key={`c${step}`}>
            <h3>{STEPS[step].title}</h3>
            <p>{STEPS[step].line}</p>
          </div>
          <div className="how-visual" key={`v${step}`}>
            <StepVisual i={step} />
          </div>
        </div>
      </section>

      <section className="home-wall">
        <div className="wall-head">
          <span className="mono num reveal">The machines</span>
          <h2 className="reveal">
            Each one designed,
            <br />
            checked and inspected.
          </h2>
        </div>
        {[MACHINES.slice(0, 8), MACHINES.slice(8)].map((row, r) => (
          <div key={r} className={`marquee${r ? ' back' : ''}`} aria-hidden={r > 0}>
            <div className="marquee-track">
              {[...row, ...row].map(([f, name, parts], k) => (
                <figure key={k}>
                  <img src={`/img/machine-${f}.png`} alt={k < row.length ? name : ''} loading="lazy" />
                  <figcaption>
                    <b>{name}</b>
                    <span className="mono">{parts} parts</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="home-live">
        <div className="live-copy">
          <span className="mono num reveal">Running now, in this page</span>
          <h2 className="reveal">Then it gets argued with.</h2>
          <p className="reveal">Five inspectors walk the finished floor and challenge it: bottlenecks, safety, cost, compliance, maintenance.</p>
        </div>
        <div className="live-view reveal" ref={liveRef}>
          {live && <Scene spec={live.spec} routes={live.routes} layers={{ flow: true, routes: false, power: false, water: false, labels: false, crew: true }} walkPlans={live.walkPlans} interactive={false} />}
          {live && <span className="mono live-tag">Live · {num(live.uph)} units an hour</span>}
        </div>
      </section>

      <section className="home-proof">
        <span className="mono num reveal">Why believe it</span>
        <h2 className="reveal">
          The model proposes.
          <br />
          The simulator decides.
        </h2>
        {results && (
          <div className="home-stats reveal">
            {results.validity && (
              <div>
                <Count to={Math.round(results.validity.placerValidShare * 100)} suffix="%" />
                <span>
                  of layouts valid, against {Math.round(results.validity.oneCallValidShare * 100)}% from a single model call
                </span>
              </div>
            )}
            {worstHarness !== null && worstOneCall !== null && (
              <div>
                <Count to={worstHarness} digits={1} suffix="%" />
                <span>from the best-known answer on public layout benchmarks, against {num(worstOneCall)}% for one call</span>
              </div>
            )}
            {worstQueue !== null && (
              <div>
                <Count to={worstQueue} digits={1} suffix="%" />
                <span>largest gap between the simulator and textbook queueing theory</span>
              </div>
            )}
          </div>
        )}
        <a className="btn-line reveal" href="/eval/index.html" target="_blank" rel="noreferrer">
          Read where it breaks <Icon name="arrowRight" size={14} />
        </a>
      </section>

      <section className="home-demos">
        <div className="demos-head">
          <div>
            <span className="mono num reveal">Open one</span>
            <h2 className="reveal">Built by the harness.</h2>
          </div>
          <button className="btn-line reveal" onClick={onDemos}>
            All demos <Icon name="arrowRight" size={14} />
          </button>
        </div>
        <div className="demo-grid">
          {DEMOS.map((d, k) => (
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

      {projects.length > 0 && (
        <section className="home-projects">
          <span className="mono num">Your projects</span>
          <div className="project-list">
            {projects.map((p) => {
              const v = p.versions[p.versions.length - 1];
              return (
                <div key={p.id} className="project-row">
                  <button onClick={() => onOpen(p)}>{p.name}</button>
                  <span>
                    {p.requirements.floor.width} × {p.requirements.floor.depth} m
                  </span>
                  <span>{p.equipment.reduce((t, l) => t + l.qty, 0)} stations</span>
                  <span>{v ? `v${p.versions.length} · ${num(v.metrics.sim.unitsPerHour.median)} / h` : 'No layout yet'}</span>
                  <button className="icon-btn" onClick={() => onDelete(p.id)} aria-label={`Delete ${p.name}`} title="Delete project">
                    <Icon name="trash" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="home-close">
        <h2 className="reveal">
          Bring one
          <br />
          real floor.
        </h2>
        <div className="home-cta reveal">
          <button className="btn-ink lg" onClick={onNew}>
            Start a project <Icon name="arrowRight" />
          </button>
          <button className="btn-line lg" onClick={onDemos}>
            See the demos
          </button>
        </div>
      </section>

      <footer className="home-foot mono">
        <span>
          dry run<i>.</i>
        </span>
        <span>Gemini 4 Hydrogen · Neon · Decisions API · Managed Agents · Shop</span>
      </footer>
    </div>
  );
}
