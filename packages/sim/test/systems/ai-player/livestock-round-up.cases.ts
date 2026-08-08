import { describe, expect, it } from 'vitest';
import { Owner, Settler } from '../../../src/components/index.js';
import { positionOfNode, Simulation } from '../../../src/index.js';
import {
  SCOUT_CATCH_RADIUS_NODES,
  scoutModule,
  signpostLatticeOffset,
} from '../../../src/systems/ai-player/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  aiSim,
  BARRACKS_TYPE,
  BUILDER,
  collectModule,
  ctxOf,
  makeAiSeat,
  placeAnimal,
  placeHq,
  plantPost,
  SCOUT,
  SEAT,
  spawnMen,
  VIKING,
  WOMAN,
  wallOver,
} from './support.js';

/** The scout's second duty: walking into nearby un-owned livestock so contact claims it. */

describe('scout module (guideBuild) - the livestock round-up', () => {
  const CENTER = { x: 128, y: 128 };

  /** A seat whose always-wanted lattice already stands, so the scout has dropped to its round-up. */
  function tiledSim(): Simulation {
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(sim, CENTER.x, CENTER.y);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x: 100, y: 100, tribe: VIKING, owner: SEAT });
    sim.step();
    plantPost(sim, positionOfNode(CENTER.x, CENTER.y));
    for (const [q, r] of [
      [1, 0],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [0, -1],
      [1, -1],
    ] as const) {
      const o = signpostLatticeOffset(q, r);
      plantPost(sim, positionOfNode(CENTER.x + o.dx, CENTER.y + o.dy));
    }
    return sim;
  }

  it('walks the scout into the nearest un-owned animal in range, its own stock aside', () => {
    const sim = tiledSim();
    placeAnimal(sim, CENTER.x + 4, CENTER.y, SEAT); // already claimed - no heart to change
    placeAnimal(sim, CENTER.x + 20, CENTER.y);
    const near = placeAnimal(sim, CENTER.x + 10, CENTER.y);

    const order = [...scoutModule.run(sim.world, ctxOf(sim), SEAT)][0];
    if (order?.kind !== 'moveUnit') throw new Error('expected a round-up walk');
    expect({ x: order.x, y: order.y }).toEqual({ x: CENTER.x + 10, y: CENTER.y });
    expect(sim.world.has(near, Owner)).toBe(false); // contact does the claiming, not the module
  });

  it('finishes the signpost lattice before rounding anything up', () => {
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(sim, CENTER.x, CENTER.y);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x: 100, y: 100, tribe: VIKING, owner: SEAT });
    sim.step();
    placeAnimal(sim, CENTER.x + 4, CENTER.y);

    expect([...scoutModule.run(sim.world, ctxOf(sim), SEAT)][0]?.kind).toBe('placeSignpost');
  });

  it('leaves an animal beyond the round-up radius alone', () => {
    const sim = tiledSim();
    placeAnimal(sim, CENTER.x + SCOUT_CATCH_RADIUS_NODES + 1, CENTER.y);
    expect([...scoutModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
  });

  it('skips an animal sealed away from the settlement, and retires the scout for it', () => {
    // Without the sealed-pocket veto the unreachable animal wins the pick every decision: the walk
    // fails, the order clears, and `hasScoutWork` pins a man as a scout for the rest of the game.
    const sim = tiledSim();
    const pen = { x: CENTER.x + 10, y: CENTER.y };
    const walls: { x: number; y: number }[] = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 3) continue;
        walls.push({ x: pen.x + dx, y: pen.y + dy });
      }
    }
    wallOver(sim, walls);
    placeAnimal(sim, pen.x, pen.y);

    expect([...scoutModule.run(sim.world, ctxOf(sim), SEAT)]).toEqual([]);
    const scout = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === SCOUT);
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter(
        (c) => c.kind === 'setJob' && c.entity === scout,
      ),
    ).toEqual([{ kind: 'setJob', entity: scout, jobType: BUILDER }]);
  });

  it('breaks a distance tie on the lower entity id', () => {
    // The comparator's second term: two animals the same walk away must not resolve on store order.
    const sim = tiledSim();
    const first = placeAnimal(sim, CENTER.x + 10, CENTER.y);
    placeAnimal(sim, CENTER.x - 10, CENTER.y);
    const order = [...scoutModule.run(sim.world, ctxOf(sim), SEAT)][0];
    if (order?.kind !== 'moveUnit') throw new Error('expected a round-up walk');
    expect({ x: order.x, y: order.y }).toEqual({ x: CENTER.x + 10, y: CENTER.y });
    expect(sim.world.has(first, Owner)).toBe(false);
  });

  it('never counts the claimed herd as a bachelor the garrison may draft', () => {
    // The same not-manpower rule, one rung further on: `bachelorSurplus` caps the standing
    // `trainSoldiers` order, and a claimed animal carries no `Female`, so an unfiltered count reads
    // every head as a spare bachelor and publishes a want the brides were holding men for.
    const standingOrder = (cows: number): number => {
      const sim = aiSim();
      placeHq(sim);
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: BARRACKS_TYPE,
        x: 40,
        y: 16,
        tribe: VIKING,
        owner: SEAT,
      });
      spawnMen(sim, 20, BUILDER);
      for (let i = 0; i < 20; i++) {
        sim.enqueueSetup({
          kind: 'spawnSettler',
          jobType: WOMAN,
          x: 4 + 2 * i,
          y: 28,
          tribe: VIKING,
          owner: SEAT,
        });
      }
      makeAiSeat(sim, SEAT);
      sim.step();
      for (let i = 0; i < cows; i++) placeAnimal(sim, 6 + 2 * i, 30, SEAT);
      const counters = [...collectModule.run(sim.world, ctxOf(sim), SEAT)].flatMap((c) =>
        c.kind === 'setAssistantCounter' ? [c] : [],
      );
      return counters[0]?.value ?? 0; // no command = the counter stays at its default zero
    };
    // A bride waits for every bachelor, so the order stays empty - whatever the size of the herd.
    expect(standingOrder(0)).toBe(0);
    expect(standingOrder(5)).toBe(0);
  });

  it('never counts the claimed herd as manpower', () => {
    // The regression the round-up makes reachable: an animal is an owned `Settler` with no trade and
    // no `Age`, so it reads as an adult civilian. Left in, the allocator drafts the cow it just
    // claimed - as a builder, a garrison recruit, or a `BUILDER_CAP` seat - and `setSettlerJob` puts
    // the trade into its animal tribe's alive-job set, which the tech gate reads.
    const sim = tiledSim();
    const cow = placeAnimal(sim, CENTER.x + 2, CENTER.y, SEAT);
    const commands = [...collectModule.run(sim.world, ctxOf(sim), SEAT)];
    expect(commands.filter((c) => 'entity' in c && c.entity === cow)).toEqual([]);
  });

  it('keeps the scout while only the round-up has work, and retires him when it runs out', () => {
    const sim = tiledSim();
    const scout = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === SCOUT);
    if (scout === undefined) throw new Error('expected a spawned scout');
    // Nothing left to erect and nothing left to catch: the scout goes back to the builder pool.
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter(
        (c) => c.kind === 'setJob' && c.entity === scout,
      ),
    ).toEqual([{ kind: 'setJob', entity: scout, jobType: BUILDER }]);

    placeAnimal(sim, CENTER.x + 10, CENTER.y);
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter(
        (c) => c.kind === 'setJob' && c.entity === scout,
      ),
    ).toEqual([]);
  });
});
