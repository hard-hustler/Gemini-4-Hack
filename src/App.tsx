import { useEffect, useState } from 'react';
import { loadDemo } from './demos';
import { Catalog } from './screens/Catalog';
import { Demos } from './screens/Demos';
import { Home } from './screens/Home';
import { NewProject } from './screens/NewProject';
import { BriefBackdrop, PlanReview } from './screens/PlanReview';
import { Workspace } from './screens/Workspace';
import { loadProjects, saveProjects, type Project } from './store';
import { ThumbRenderer } from './ui/thumbs';

type Route = { name: 'landing' } | { name: 'new'; text?: string } | { name: 'catalog' } | { name: 'demos' } | { name: 'plan' | 'sim'; id: string };

export default function App() {
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [route, setRoute] = useState<Route>({ name: 'landing' });
  useEffect(() => saveProjects(projects), [projects]);

  const home = () => setRoute({ name: 'landing' });
  const update = (id: string, patch: Partial<Project>) => setProjects((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = (p: Project, to: 'plan' | 'sim') => {
    setProjects((cur) => [p, ...cur]);
    setRoute({ name: to, id: p.id });
  };
  const project = route.name === 'plan' || route.name === 'sim' ? projects.find((p) => p.id === route.id) : undefined;

  let screen;
  if (route.name === 'new') screen = <NewProject onHome={home} initialText={route.text} onCreated={(p) => add(p, 'plan')} />;
  else if (route.name === 'catalog') screen = <Catalog onHome={home} />;
  else if (route.name === 'demos')
    screen = (
      <Demos
        onHome={home}
        onOpen={(p) => add(p, 'sim')}
        projects={projects}
        onOpenProject={(p) => setRoute({ name: p.versions.length ? 'sim' : 'plan', id: p.id })}
        onDelete={(id) => setProjects((cur) => cur.filter((p) => p.id !== id))}
        onNew={() => setRoute({ name: 'new' })}
      />
    );
  else if (route.name === 'plan' && project) {
    // the equipment window is a popup: over the simulation when there is one, over the brief when not
    const toSim = () => setRoute({ name: 'sim', id: project.id });
    screen = (
      <>
        {project.versions.length ? (
          <Workspace key={project.id} project={project} onHome={home} onPlan={() => undefined} onChange={(patch) => update(project.id, patch)} />
        ) : (
          <BriefBackdrop project={project} onHome={home} />
        )}
        <PlanReview
          project={project}
          onClose={project.versions.length ? toSim : home}
          onChange={(patch) => update(project.id, patch)}
          onLayout={(patch) => {
            update(project.id, patch);
            toSim();
          }}
        />
      </>
    );
  } else if (route.name === 'sim' && project && project.versions.length) {
    screen = <Workspace key={project.id} project={project} onHome={home} onPlan={() => setRoute({ name: 'plan', id: project.id })} onChange={(patch) => update(project.id, patch)} />;
  } else {
    screen = (
      <Home
        hasProjects={projects.length > 0}
        onNew={(text) => setRoute({ name: 'new', text })}
        onCatalog={() => setRoute({ name: 'catalog' })}
        onDemos={() => setRoute({ name: 'demos' })}
        onOpenDemo={(d) => void loadDemo(d).then((p) => add(p, 'sim'))}
      />
    );
  }
  return (
    <>
      <ThumbRenderer />
      {screen}
    </>
  );
}
