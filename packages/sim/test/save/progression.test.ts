import { parseContentSet } from '@open-northland/data';
import { expect, it } from 'vitest';
import { Settler } from '../../src/components/index.js';
import { exportSaveGame, restoreSimulation, Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { settlerAt } from '../fixtures/settler.js';

it('migrates old specialization XP into the general track once when restoring newer content', () => {
  const base = testContent();
  const older = parseContentSet({ ...base, manifest: { ...base.manifest, contentRevision: 10 } });
  const current = parseContentSet({ ...base, manifest: { ...base.manifest, contentRevision: 11 } });
  const sim = new Simulation({ seed: 1, content: older });
  const worker = settlerAt(sim, { tribe: 1, jobType: 1 });
  sim.world.mut(worker, Settler).experience.set(1, 50);
  sim.world.mut(worker, Settler).experience.set(2, 3);
  const migrated = restoreSimulation(exportSaveGame(sim), { content: current }).sim;
  expect(migrated.world.get(worker, Settler).experience.get(1)).toBe(50);
  expect(migrated.world.get(worker, Settler).experience.get(2)).toBe(8);
  const resumed = restoreSimulation(exportSaveGame(migrated), { content: current }).sim;
  expect(resumed.hashState()).toBe(migrated.hashState());
});
