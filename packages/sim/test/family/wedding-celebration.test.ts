import { parseContentSet } from '@open-northland/data';
import { expect, it } from 'vitest';
import {
  addCurrentAtomic,
  Carrying,
  CurrentAtomic,
  Engagement,
  Health,
  Owner,
  Resting,
} from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { celebrateWedding } from '../../src/systems/family/celebration.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';

it('celebrates only with living, free adult civilian neighbours of the wedding owner', () => {
  const content = parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [],
    buildings: [],
    jobs: [
      { typeId: 6, id: 'civilist' },
      { typeId: 31, id: 'soldier_unarmed' },
      { typeId: 4, id: 'child_male' },
    ],
    tribes: [{ typeId: 1, id: 'viking', atomicBindings: [{ jobType: 6, atomicId: 17, animation: 'enjoy' }] }],
    atomicAnimations: [{ id: 'enjoy', name: 'enjoy', length: 25 }],
  });
  const sim = new Simulation({ content, seed: 7 });
  const guest = (hx: number, hy: number, jobType = 6, owner = 0) => {
    const e = settlerAt(sim, { jobType, position: positionOfNode(hx, hy) });
    sim.world.add(e, Owner, { player: owner });
    sim.world.add(e, Health, { hitpoints: 100, max: 100 });
    return e;
  };
  const a = guest(10, 10);
  const b = guest(11, 10);
  const nearby = guest(12, 10);
  const boundary = guest(18, 10);
  const excluded = [a, b, guest(19, 10), guest(12, 11, 31), guest(12, 11, 4), guest(12, 11, 6, 1)];
  const worker = guest(12, 11);
  addCurrentAtomic(sim.world, worker, {
    atomicId: 39,
    duration: 50,
    effect: { kind: 'idle' },
    targetEntity: null,
    targetTile: null,
  });
  const carrying = guest(12, 11);
  sim.world.add(carrying, Carrying, { goodType: 1, amount: 1 });
  const indoors = guest(12, 11);
  sim.world.add(indoors, Resting, { at: a });
  const fighting = guest(12, 11);
  sim.world.add(fighting, Engagement, { target: b, repathAt: 0 });
  const dead = guest(12, 11);
  sim.world.mut(dead, Health).hitpoints = 0;
  excluded.push(worker, carrying, indoors, fighting, dead);

  celebrateWedding(sim.world, ctxOf(sim), a, b);
  expect(sim.world.get(nearby, CurrentAtomic)).toMatchObject({ atomicId: 17, duration: 25 });
  expect(sim.world.get(boundary, CurrentAtomic)).toMatchObject({ atomicId: 17, duration: 25 });
  for (const e of excluded) expect(sim.world.tryGet(e, CurrentAtomic)?.atomicId).not.toBe(17);
  expect(sim.world.get(worker, CurrentAtomic).atomicId).toBe(39);
});
