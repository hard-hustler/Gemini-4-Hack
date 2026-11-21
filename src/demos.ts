// Projects the harness generated, saved with the repo so anyone can open them without a key.
// To add one: open the project with ?capture in the URL and save it through /api/dev/save.

import type { MachineModel } from './model3d';
import { demoProject } from './screens/Landing';
import type { Project } from './store';

export interface Demo {
  id: string;
  name: string;
  /** one sentence: what was asked for and what came back */
  blurb: string;
  image: string;
  /** JSON under /public, or absent for the demo built in code */
  file?: string;
  stats: string[];
  scale: 'Workshop' | 'Plant';
}

export const DEMOS: Demo[] = [
  {
    id: 'car-plant',
    name: 'Electric car plant',
    blurb: 'One sentence asking for 30 cars an hour became a researched, five-department plant with every machine designed by an agent.',
    image: '/img/car-plant.jpg',
    file: '/demos/car-plant.json',
    stats: ['60 stations', '180 × 120 m', '20 machines designed', '26.6 cars an hour'],
    scale: 'Plant',
  },
  {
    id: 'espresso-workshop',
    name: 'Espresso grinder workshop',
    blurb: 'A short brief, equipped from real Shop listings: each machine modelled from its listing photo and checked against it.',
    image: '/img/espresso-workshop.jpg',
    file: '/demos/espresso-workshop.json',
    stats: ['10 stations', '16 × 12 m', 'real listings', 'forklift'],
    scale: 'Workshop',
  },
  {
    id: 'light-assembly',
    name: 'Light assembly floor',
    blurb: 'The built-in starting point: six stations from the house catalog, no model calls involved.',
    image: '/img/light-assembly.jpg',
    stats: ['6 stations', '18 × 12 m', 'house catalog', 'forklift'],
    scale: 'Workshop',
  },
];

/** A fresh copy of a demo as a project of your own. */
export async function loadDemo(demo: Demo): Promise<Project> {
  if (!demo.file) return demoProject();
  const res = await fetch(demo.file);
  if (!res.ok) throw new Error(`Could not load the ${demo.name} demo`);
  const project = (await res.json()) as Project;
  // agent-built models travel on the equipment; the scene looks them up by catalog id
  const models: Record<string, MachineModel> = {};
  for (const line of project.equipment) if (line.item.model) models[line.item.id] = line.item.model;
  return { ...project, id: `${demo.id}-${Date.now()}`, createdAt: Date.now(), models };
}
