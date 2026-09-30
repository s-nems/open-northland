import { playerCommand } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { GOOD_BREAD } from '../../src/game/sandbox/index.js';
import { IDLE_WORK_NAMES, idleWorkScene, idleWorkWorker } from '../../src/scenes/idle-work.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(idleWorkScene, import.meta.url);

it('resuming a stopped baker reveals the missing ingredients through an ordinary player order', () => {
  const sim = createSceneSim(idleWorkScene);
  sim.run(idleWorkScene.runTicks);
  const worker = idleWorkWorker(sim, IDLE_WORK_NAMES.selection);
  expect(worker).toBeDefined();
  if (worker === undefined) return;
  expect(sim.workStatus(worker)?.kind).toBe('nothingSelected');
  sim.enqueue(
    playerCommand(HUMAN_PLAYER, {
      kind: 'setProductionCount',
      entity: worker,
      goodType: GOOD_BREAD,
      count: 1,
    }),
  );
  sim.run(1);
  expect(sim.workStatus(worker)).toMatchObject({
    kind: 'waitingInput',
    goodType: GOOD_BREAD,
    missingInputs: expect.arrayContaining([
      expect.objectContaining({ required: 1, available: 0, missing: 1 }),
    ]),
  });
});
