import { useMemo } from 'react';
import { pickItem } from '../catalog';
import type { EquipmentLine, ProcessStep, Requirements } from '../contracts';
import { buildLayout } from '../engines/place';
import { evaluate, makeVersion } from '../engines/versions';
import { money, num, type Project } from '../store';
import { TopBar } from '../ui/common';
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
    assumptions: ['Built-in demo project: nothing here came from a model.'],
  };
  const equipment: EquipmentLine[] = steps.map((s) => ({ stepType: s.type, label: s.label, qty: s.count, item: pickItem(s) }));
  const placed = buildLayout(requirements, equipment, { polish: false });
  const ev = evaluate(placed.spec);
  if (!ev.ok) throw new Error('Demo layout is invalid');
  const v1 = makeVersion(placed.spec, ev.metrics, null, 1, 'First layout');
  return { id: `demo-${Date.now()}`, name: requirements.name, createdAt: Date.now(), brief: { text: 'Built-in demo', files: [] }, requirements, equipment, trace: [], versions: [v1], currentId: v1.id };
}

export function Landing({ projects, onNew, onOpen, onDemo, onDelete }: { projects: Project[]; onNew: () => void; onOpen: (p: Project) => void; onDemo: () => void; onDelete: (id: string) => void }) {
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
            <a className="link" href="/eval/index.html" target="_blank" rel="noreferrer">
              Eval results
            </a>
            <button className="primary" onClick={onNew}>
              New project
            </button>
          </>
        }
      />
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Factory planning, simulated</span>
          <h1>
            Test the factory
            <br />
            <em>before you build it.</em>
          </h1>
          <p>Describe the line, photograph a floor sketch or say it out loud. Dry Run plans the equipment, lays it out and simulates thirty shifts, so every version is compared on throughput and cost before anything is bought.</p>
          <div className="hero-actions">
            <button className="primary large" onClick={onNew}>
              Start a project
            </button>
            <button className="ghost large" onClick={onDemo}>
              Open the demo floor
            </button>
          </div>
          <div className="tracker static">
            {['Plan', 'Check', 'Place', 'Simulate'].map((s) => (
              <span key={s} className="tracker-step ok">
                <i>✓</i>
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className="hero-stage">
          <Scene spec={hero.spec} routes={hero.routes} layers={{ flow: true, routes: false, power: false, water: false, labels: false }} interactive={false} />
          <div className="float-card a">
            <span className="eyebrow">Throughput</span>
            <b>{num(hero.metrics.sim.unitsPerHour.median)} units / h</b>
          </div>
          <div className="float-card b">
            <span className="eyebrow">Cost per unit</span>
            <b>{money(hero.metrics.cost.costPerUnit)}</b>
          </div>
        </div>
      </section>

      <section className="how">
        {[
          ['01', 'Brief', 'A prompt, a sketch photo, a PDF or a voice note. One model reads it into a plan; a second, independent check confirms every step is really in your brief.'],
          ['02', 'Equipment', 'Review the machines the plan will use. Swap any of them for a real listing and its price and footprint come with it.'],
          ['03', 'Simulation', 'A layout that passes every rule, simulated over thirty shifts. Drag, speak or ask for improvements, and compare versions side by side.'],
        ].map(([n, t, d]) => (
          <div key={n} className="how-card">
            <span className="eyebrow">{n}</span>
            <h3>{t}</h3>
            <p>{d}</p>
          </div>
        ))}
      </section>

      {projects.length > 0 && (
        <section className="recent">
          <span className="eyebrow">Your projects</span>
          <div className="recent-grid">
            {projects.map((p) => {
              const v = p.versions[p.versions.length - 1];
              return (
                <div key={p.id} className="project-card">
                  <button className="project-open" onClick={() => onOpen(p)}>
                    <h3>{p.name}</h3>
                    <span>
                      {p.requirements.floor.width} × {p.requirements.floor.depth} m · {p.equipment.reduce((t, l) => t + l.qty, 0)} stations
                    </span>
                    <span>{v ? `${p.versions.length} version${p.versions.length > 1 ? 's' : ''} · ${num(v.metrics.sim.unitsPerHour.median)} units/h` : 'Plan ready, no layout yet'}</span>
                  </button>
                  <button className="ghost small" onClick={() => onDelete(p.id)} aria-label={`Delete ${p.name}`}>
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
