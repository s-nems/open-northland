import { describe, expect, it } from 'vitest';
import { JobAssignment, Settler } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  aiSim,
  BAKERY_TOP_TYPE,
  BUILDER,
  collectModule,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  HUNTER,
  huntingContent,
  placeHq,
  SCOUT,
  SEAT,
  spawnMen,
  VIKING,
} from './support.js';

/** The opening hunt: one headquarters-employed hunter until the level-2 bakery stands. */

describe('workforce module - the opening hunter', () => {
  it('posts one headquarters hunter, then hands him back once the level-2 bakery stands', () => {
    const content = huntingContent();
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(64, 32) });
    placeHq(sim);
    spawnMen(sim, 4);
    sim.step();
    const ctx = { ...ctxOf(sim), content };
    const hq = entityOfBuilding(sim, HQ_TYPE);

    const posts = [...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'assignWorker');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ building: hq, jobPriority: [HUNTER] });
    for (const c of posts) sim.enqueue(c);
    sim.step();

    // One post, not one per decision: the standing hunter is recognized and nobody else is drafted.
    const hunter = [...sim.world.query(Settler, JobAssignment)].find(
      (e) => sim.world.get(e, Settler).jobType === HUNTER,
    );
    if (hunter === undefined) throw new Error('expected a posted hunter');
    expect(sim.world.get(hunter, JobAssignment).workplace).toBe(hq);
    expect([...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'assignWorker')).toEqual([]);

    // The milestone lands: the hunt ends and the man rejoins the pool as a builder.
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: BAKERY_TOP_TYPE,
      x: 36,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect(
      [...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'setJob' && c.entity === hunter),
    ).toEqual([{ kind: 'setJob', entity: hunter, jobType: BUILDER }]);
  });

  it('outranks the scout for the last spare man', () => {
    // The phase sits between the collectors and the scout hire, and neither the map's resources nor
    // the lattice matter to that order - with one man to hand, the hunt takes him and the scout post
    // waits for the next grown son.
    const content = huntingContent();
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(64, 32) });
    placeHq(sim);
    spawnMen(sim, 1);
    sim.step();

    const commands = [...collectModule.run(sim.world, { ...ctxOf(sim), content }, SEAT)];
    expect(commands.filter((c) => c.kind === 'assignWorker')).toHaveLength(1);
    expect(commands.filter((c) => c.kind === 'setJob' && c.jobType === SCOUT)).toEqual([]);
  });

  it('hires nobody when the headquarters offers no hunter seat', () => {
    // The base fixture's HQ carries transport and collector slots only - an assignment that could
    // never take must not be issued every decision.
    const sim = aiSim();
    placeHq(sim);
    spawnMen(sim, 4);
    sim.step();
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind === 'assignWorker'),
    ).toEqual([]);
  });
});
