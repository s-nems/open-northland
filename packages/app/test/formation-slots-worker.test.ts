import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import { bundleTestWorker, startTestSession } from './support/session-worker/start-worker.js';

it('returns legal formation groups through the real worker RPC without advancing the paused world', async () => {
  const scene = SCENES.find((candidate) => candidate.id === 'army-passage');
  if (scene === undefined) throw new Error('missing army passage scene');
  const sim = createSceneSim(scene);
  const members = [...sim.world.query(components.Settler, components.Position)].slice(0, 40);
  expect(members).toHaveLength(40);
  const target = { hx: 112, hy: 12 };
  const expected = sim.formationSlots(target, members, 2);
  const worker = await bundleTestWorker();
  try {
    const session = await startTestSession(worker.path, { kind: 'scene', id: scene.id });
    try {
      const before = await session.host.hashState();
      expect(await session.host.formationSlots(target, members, 2)).toEqual(expected);
      expect(await session.host.hashState()).toEqual(before);
      expect(await session.host.formationSlots(target, [], 2)).toEqual([]);
      await expect(session.host.formationSlots({ hx: Number.NaN, hy: 0 }, members)).rejects.toThrow(
        'invalid formation query',
      );
    } finally {
      session.dispose();
    }
  } finally {
    await worker.dispose();
  }
}, 30000);
