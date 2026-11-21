import { useEffect, useState } from 'react';
import { loadDemo } from './demos';
import { Catalog } from './screens/Catalog';
import { Demos } from './screens/Demos';
import { Home } from './screens/Home';
import { NewProject } from './screens/NewProject';
import { PlanReview } from './screens/PlanReview';
import { Workspace } from './screens/Workspace';
import { loadProjects, saveProjects, type Project } from './store';
import { ThumbRenderer } from './ui/thumbs';

type Route = { name: 'landing' } | { name: 'new' } | { name: 'catalog' } | { name: 'demos' } | { name: 'plan' | 'sim'; id: string };

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
  if (route.name === 'new') screen = <NewProject onHome={home} onCreated={(p) => add(p, 'plan')} />;
  else if (route.name === 'catalog') screen = <Catalog onHome={home} />;
  else if (route.name === 'demos') screen = <Demos onHome={home} onOpen={(p) => add(p, 'sim')} />;
  else if (route.name === 'plan' && project) {
    screen = (
      <PlanReview
        project={project}
        onHome={home}
        onChange={(patch) => update(project.id, patch)}
        onLayout={(patch) => {
          update(project.id, patch);
          setRoute({ name: 'sim', id: project.id });
        }}
        onOpenSim={() => setRoute({ name: 'sim', id: project.id })}
      />
    );
  } else if (route.name === 'sim' && project && project.versions.length) {
    screen = <Workspace key={project.id} project={project} onHome={home} onPlan={() => setRoute({ name: 'plan', id: project.id })} onChange={(patch) => update(project.id, patch)} />;
  } else {
    screen = (
      <Home
        projects={projects}
        onNew={() => setRoute({ name: 'new' })}
        onCatalog={() => setRoute({ name: 'catalog' })}
        onOpen={(p) => setRoute({ name: p.versions.length ? 'sim' : 'plan', id: p.id })}
        onDemos={() => setRoute({ name: 'demos' })}
        onOpenDemo={(d) => void loadDemo(d).then((p) => add(p, 'sim'))}
        onDelete={(id) => setProjects((cur) => cur.filter((p) => p.id !== id))}
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
