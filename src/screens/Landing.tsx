import { useMemo } from 'react';
import { pickItem } from '../catalog';
import type { EquipmentLine, ProcessStep, Requirements } from '../contracts';
import { buildLayout } from '../engines/place';
import { evaluate, makeVersion } from '../engines/versions';
import { money, num, type Project } from '../store';
import { TopBar } from '../ui/common';
import { Icon } from '../ui/icons';
import { Scene } from '../ui/Scene';

const step = (type: string, label: string, count: number): ProcessStep => ({ type, label, count, cycleTimeSec: 0, operators: 1, powerKw: 0, needsWater: false, w: 2, d: 1 });

/** A small built-in project so the product can be seen without a key or a network call. */
export function demoProject(): Project {
  const steps = [step('storage', 'Receiving rack', 1), step('prep', 'Prep', 1), step('assembly', 'Assembly', 2), step('test', 'Test', 1), step('pack', 'Pack', 1)];
  const requirements: Requirements = {
    name: 'Light assembly workshop',
    summary: 'Parts are received, prepped, assembled on two benches, tested and packed.',
    floor: { width: 18, depth: 12 },
    demandPerHour: 30,
    steps: steps.map((s) => ({ ...s, cycleTimeSec: pickItem(s).cycleTimeSec })),
    dockIn: 'W',
    dockOut: 'E',
    powerWall: 'N',
    waterWall: 'S',
    sketch: [],
    assumptions: ['This is the built-in demo. Nothing in it came from a model.'],
  };
  const equipment: EquipmentLine[] = steps.map((s) => ({ stepType: s.type, label: s.label, qty: s.count, item: pickItem(s) }));
  const placed = buildLayout(requirements, equipment, { polish: false });
  const ev = evaluate(placed.spec);
  if (!ev.ok) throw new Error('Demo layout is invalid');
  const v1 = makeVersion(placed.spec, ev.metrics, null, 1, 'First layout');
  return { id: `demo-${Date.now()}`, name: requirements.name, createdAt: Date.now(), brief: { text: 'Built-in demo', files: [] }, requirements, equipment, trace: [], versions: [v1], currentId: v1.id };
}

export function Landing({ projects, onNew, onCatalog, onOpen, onDemo, onDelete }: { projects: Project[]; onNew: () => void; onCatalog: () => void; onOpen: (p: Project) => void; onDemo: () => void; onDelete: (id: string) => void }) {
  const hero = useMemo(() => {
    const p = demoProject();
    const spec = p.versions[0].spec;
    const ev = evaluate(spec, 4);
    return { spec, routes: ev.ok ? ev.routes : null, metrics: p.versions[0].metrics };
  }, []);

  return (
    <div className="page">
      <TopBar
        onHome={() => undefined}
        right={
          <>
            <button className="text" onClick={onCatalog}>
              Catalog
            </button>
            <a href="/eval/index.html" target="_blank" rel="noreferrer">
              Eval
            </a>
            <button className="ghost" onClick={onNew}>
              New project
            </button>
          </>
        }
      />
      <main className="landing">
        <section className="hero">
          <div className="hero-copy">
            <h1>Test the factory before you build it.</h1>
            <p>Describe the line, or photograph a sketch of the floor. Dry Run picks the equipment, lays it out and simulates it, so you can compare layouts on throughput and cost before you buy anything.</p>
            <div className="row">
              <button className="primary lg" onClick={onNew}>
                Start a project
              </button>
              <button className="text lg" onClick={onDemo}>
                Open the demo floor <Icon name="arrowRight" />
              </button>
            </div>
          </div>
          <figure>
            <div className="hero-stage">
              <Scene spec={hero.spec} routes={hero.routes} layers={{ flow: true, routes: false, power: false, water: false, labels: false }} interactive={false} />
            </div>
            <figcaption>
              The demo floor, simulated live in your browser: {num(hero.metrics.sim.unitsPerHour.median)} units an hour at {money(hero.metrics.cost.costPerUnit)} a unit.
            </figcaption>
          </figure>
        </section>

        {projects.length > 0 && (
          <section className="projects">
            <h2>Projects</h2>
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
      </main>
    </div>
  );
}
