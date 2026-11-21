import { useEffect, useState } from 'react';
import { demoProject, Landing } from './screens/Landing';
import { NewProject } from './screens/NewProject';
import { PlanReview } from './screens/PlanReview';
import { Workspace } from './screens/Workspace';
import { loadProjects, saveProjects, type Project } from './store';
import { ThumbRenderer } from './ui/thumbs';

type Route = { name: 'landing' } | { name: 'new' } | { name: 'plan' | 'sim'; id: string };

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

  if (route.name === 'new') return <NewProject onHome={home} onCreated={(p) => add(p, 'plan')} />;
  if (route.name === 'plan' && project) {
    return (
      <>
        <ThumbRenderer />
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
      </>
    );
  }
  if (route.name === 'sim' && project && project.versions.length) {
    return <Workspace key={project.id} project={project} onHome={home} onPlan={() => setRoute({ name: 'plan', id: project.id })} onChange={(patch) => update(project.id, patch)} />;
  }
  return (
    <Landing
      projects={projects}
      onNew={() => setRoute({ name: 'new' })}
      onOpen={(p) => setRoute({ name: p.versions.length ? 'sim' : 'plan', id: p.id })}
      onDemo={() => add(demoProject(), 'sim')}
      onDelete={(id) => setProjects((cur) => cur.filter((p) => p.id !== id))}
    />
  );
}
