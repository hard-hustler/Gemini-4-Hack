// The landing page. Structure borrowed from the best engineering-software sites: one claim,
// the problem, what it does in numbered steps, proof with real numbers, then the ask.
import { useEffect, useMemo, useState } from 'react';
import { runDeterministicAdvocateAudit } from '../engines/advocate';
import { evaluate } from '../engines/versions';
import { money, num, type Project } from '../store';
import '../ui/home.css';
import { Icon } from '../ui/icons';
import { Scene } from '../ui/Scene';
import { demoProject } from './Landing';

interface EvalResults {
  validity?: { oneCallValidShare: number; placerValidShare: number; n: number };
  qap?: { instance: string; oneCall?: { gapPct?: number }; harness?: { gapPct?: number } }[];
  queue?: { errorPct: number }[];
}

const STEPS = [
  ['Turn a brief into a plan.', 'A prompt, a photo of a floor sketch, a PDF or a voice note is read into process steps and equipment. Anything it had to assume is listed for you to correct.'],
  ['Research what you did not say.', 'A large project is researched on the web first, so a car plant is planned the way car plants are built: stamping, body, paint, assembly, inspection.'],
  ['Build the machines.', 'A swarm of agents, one per step, finds real listings or designs the equipment part by part. Code checks each model holds together and an inspector judges every render.'],
  ['Simulate, then improve.', 'Thirty shifts are simulated. An agent proposes changes toward your goal, and a change is kept only if the simulator says it beats the layout you have.'],
];

const STACK = [
  ['gemini-4-hydrogen', 'Reads the brief, researches the process, edits by voice, and models each machine.'],
  ['gemini-4-neon', 'Proposes layout changes, round after round, learning from what the simulator said.'],
  ['gemini-decision-1', 'The independent checker: is this step in the brief, does this render match the photo, is this change worth simulating.'],
  ['Managed agent', 'Clones the repo into a sandbox and runs the layout search eight ways at once.'],
];

export function Home({ projects, onNew, onCatalog, onOpen, onDemo, onDelete }: { projects: Project[]; onNew: () => void; onCatalog: () => void; onOpen: (p: Project) => void; onDemo: () => void; onDelete: (id: string) => void }) {
  const hero = useMemo(() => {
    const p = demoProject();
    const spec = p.versions[0].spec;
    const ev = evaluate(spec, 4);
    const routes = ev.ok ? ev.routes : null;
    const walkPlans = routes ? runDeterministicAdvocateAudit(spec, p.versions[0].metrics, routes).walkPlans : [];
    return { spec, routes, metrics: p.versions[0].metrics, walkPlans };
  }, []);
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

  return (
    <div className="home">
      <div className="home-strip">
        <span className="mono">Built at the Gemini 4 hackathon</span>
        <span>Every number on this page comes from a run you can repeat.</span>
        <a href="/eval/index.html" target="_blank" rel="noreferrer">
          See the eval <Icon name="arrowRight" size={14} />
        </a>
      </div>

      <header className="home-nav">
        <span className="wordmark">
          dry run<i>.</i>
        </span>
        <nav>
          <button className="home-link" onClick={onCatalog}>
            Catalog
          </button>
          <a className="home-link" href="/eval/index.html" target="_blank" rel="noreferrer">
            Eval
          </a>
          <button className="btn-line" onClick={onDemo}>
            Open the demo
          </button>
          <button className="btn-ink" onClick={onNew}>
            Start a project
          </button>
        </nav>
      </header>

      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="mono tag">
            <i className="dot" /> Factory planning, simulated before it is built
          </span>
          <h1>
            Test the factory
            <br />
            before you
            <br />
            build it.
          </h1>
          <div className="home-hero-foot">
            <p>Describe the line or photograph a sketch. Dry Run plans it, builds the machines, and simulates it.</p>
            <div className="home-cta">
              <button className="btn-ink lg" onClick={onNew}>
                Start a project <Icon name="arrowRight" />
              </button>
              <button className="btn-line lg" onClick={onDemo}>
                Open the demo floor
              </button>
            </div>
          </div>
        </div>
        <div className="home-hero-art" aria-hidden="true">
          <figure className="shard a">
            <div className="shard-clip">
              <img src="/sample-sketch.png" alt="" />
            </div>
            <figcaption className="mono">The sketch</figcaption>
          </figure>
          <figure className="shard b">
            <div className="shard-clip live">
              <Scene spec={hero.spec} routes={hero.routes} layers={{ flow: true, routes: false, power: false, water: false, labels: false, crew: true }} walkPlans={hero.walkPlans} interactive={false} />
            </div>
            <figcaption className="mono">The simulation, live</figcaption>
          </figure>
        </div>
      </section>

      <section className="home-band">
        <span className="mono num">01 · The problem</span>
        <h2>
          A layout mistake is cheap on paper
          <br />
          and expensive in concrete.
        </h2>
        <p>
          Where the benches, the racks and the docks go decides how far every unit travels, where work piles up, and what each unit costs. Most floors are settled on a whiteboard and tested only once the equipment is bolted down.
        </p>
      </section>

      <section className="home-does">
        <span className="mono num">02 · What it does</span>
        <div className="home-does-grid">
          <ol>
            {STEPS.map(([title, text], i) => (
              <li key={title}>
                <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="home-screen">
            <div className="home-screen-bar mono">
              <span>demo floor</span>
              <span>
                {num(hero.metrics.sim.unitsPerHour.median)} units / h · {money(hero.metrics.cost.costPerUnit)} a unit
              </span>
            </div>
            <div className="home-screen-view">
              <Scene spec={hero.spec} routes={hero.routes} layers={{ flow: true, routes: false, power: false, water: false, labels: true, crew: true }} walkPlans={hero.walkPlans} interactive={false} />
            </div>
          </div>
        </div>
      </section>

      <section className="home-proof">
        <span className="mono num">03 · Proof</span>
        <h2>
          The model proposes.
          <br />
          The simulator decides.
        </h2>
        <p>
          Models read, research, design and suggest. Code decides what is real: a layout must pass every rule, a machine must hold together, and a change must win in simulation before you ever see it.
        </p>
        {results && (
          <div className="home-stats">
            {results.validity && (
              <div>
                <b>{Math.round(results.validity.placerValidShare * 100)}%</b>
                <span>of layouts valid with the harness, against {Math.round(results.validity.oneCallValidShare * 100)}% from one model call, on {results.validity.n} unseen briefs</span>
              </div>
            )}
            {worstHarness !== null && worstOneCall !== null && (
              <div>
                <b>{num(worstHarness)}%</b>
                <span>worst gap to the best-known layout on four public benchmark problems, against {num(worstOneCall)}% for one model call</span>
              </div>
            )}
            {worstQueue !== null && (
              <div>
                <b>{num(worstQueue)}%</b>
                <span>largest error of the simulator against textbook queueing theory, across four test cases</span>
              </div>
            )}
          </div>
        )}
        <a className="btn-line" href="/eval/index.html" target="_blank" rel="noreferrer">
          Read where it breaks <Icon name="arrowRight" size={14} />
        </a>
      </section>

      <section className="home-stack">
        <span className="mono num">04 · What runs it</span>
        <div className="home-stack-rows">
          {STACK.map(([name, job]) => (
            <div key={name}>
              <span className="mono">{name}</span>
              <p>{job}</p>
            </div>
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
        <h2>
          Bring one real floor.
          <br />
          We will lay it out with you.
        </h2>
        <div className="home-cta">
          <button className="btn-ink lg" onClick={onNew}>
            Start a project <Icon name="arrowRight" />
          </button>
          <button className="btn-line lg" onClick={onDemo}>
            Open the demo floor
          </button>
        </div>
      </section>

      <footer className="home-foot mono">
        <span>
          dry run<i>.</i>
        </span>
        <span>TypeScript · react-three-fiber · Gemini 4</span>
      </footer>
    </div>
  );
}
