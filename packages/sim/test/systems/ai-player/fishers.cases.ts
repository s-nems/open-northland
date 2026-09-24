import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { FishSwarm, Position } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../../src/index.js';
import { AI_DECISION_INTERVAL_TICKS } from '../../../src/systems/ai-player/cadence.js';
import { BUILDER_CAP } from '../../../src/systems/ai-player/index.js';
import { addFishSwarms } from '../../../src/systems/economy/fish.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  BUILDER,
  collectModule,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  placeHq,
  SEAT,
  spawnMen,
} from './support.js';

/** The fishers: store-employed while fish swim within a fisher's shore search of the store's door. */

const FISHER = 22;
const FISH = 22;
/** A swarm a few nodes off the headquarters, well inside the shore search. */
const NEAR_SWARM = { hx: HQ_X + 4, hy: HQ_Y };
/** A swarm across the map, far beyond the search from the headquarters door. */
const FAR_SWARM = { hx: 120, hy: 60 };
/** A diagonal swarm close by hex distance but outside the search's Manhattan rings. */
const DIAGONAL_SWARM = { hx: HQ_X + 14, hy: HQ_Y + 14 };
/** Decisions the catch test runs: long enough for a walk to the shore and several casts. */
const FISHING_DECISIONS = 120;

/** Content whose headquarters offers the fisher seats, as the extracted stores do, with the fish good
 *  and the fisher's cast and catch atomics. The trade must be spelled `fisher`: the job role is read off
 *  the id slug. */
function fishingContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: FISH, id: 'fish', weight: 1 }],
    jobs: [...base.jobs, { typeId: FISHER, id: 'fisher', allowedAtomics: [36, 37, 38] }],
    buildings: base.buildings.map((b) =>
      b.typeId === HQ_TYPE
        ? {
            ...b,
            workers: [...b.workers, { jobType: FISHER, count: 3 }],
            stock: [...b.stock, { goodType: FISH, capacity: 50, initial: 0 }],
          }
        : b,
    ),
  });
}

function fishingSeat(men: number, swarm: { hx: number; hy: number }, count = 5): Simulation {
  const content = fishingContent();
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(128, 64) });
  placeHq(sim);
  spawnMen(sim, men);
  sim.step();
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain');
  addFishSwarms(sim.world, terrain, [{ ...swarm, count, continent: 0 }]);
  return sim;
}

function decide(sim: Simulation) {
  return [...collectModule.run(sim.world, { ...ctxOf(sim), content: fishingContent() }, SEAT)];
}

function fisherPosts(sim: Simulation) {
  return decide(sim).flatMap((c) => (c.kind === 'assignWorker' && c.jobPriority.includes(FISHER) ? [c] : []));
}

function fishLeft(sim: Simulation): number {
  let left = 0;
  for (const e of sim.world.query(FishSwarm)) left += sim.world.get(e, FishSwarm).count;
  return left;
}

function hireFisher(sim: Simulation): Entity {
  const [post] = fisherPosts(sim);
  if (post === undefined) throw new Error('expected a fisher post');
  sim.enqueueSetup(post);
  sim.step();
  return post.entity;
}

describe('workforce module - the fishers', () => {
  it('posts one headquarters fisher early, the second only out of the top-ups', () => {
    const early = fishingSeat(4, NEAR_SWARM);
    expect(fisherPosts(early)).toEqual([
      expect.objectContaining({ building: entityOfBuilding(early, HQ_TYPE), jobPriority: [FISHER] }),
    ]);
    // Beyond the scout and the builder reserve the pool has men to spare for the second.
    expect(fisherPosts(fishingSeat(BUILDER_CAP + 6, NEAR_SWARM))).toHaveLength(2);
  });

  it('hires no fisher while no fish swim within the search from the door', () => {
    expect(fisherPosts(fishingSeat(BUILDER_CAP + 6, FAR_SWARM))).toEqual([]);
    expect(fisherPosts(fishingSeat(BUILDER_CAP + 6, DIAGONAL_SWARM))).toEqual([]);
    expect(fisherPosts(fishingSeat(BUILDER_CAP + 6, NEAR_SWARM, 0))).toEqual([]);
  });

  it('gets a fisher hired far from the water fishing', () => {
    // The spawned men stand across the map from the headquarters, outside the fisher's own search.
    const sim = fishingSeat(4, NEAR_SWARM);
    const before = fishLeft(sim);
    for (let i = 0; i < FISHING_DECISIONS && fishLeft(sim) === before; i++) {
      for (const c of decide(sim)) sim.enqueueSetup(c);
      for (let t = 0; t < AI_DECISION_INTERVAL_TICKS; t++) sim.step();
    }
    expect(fishLeft(sim)).toBeLessThan(before);
  });

  it('walks an idle fisher who strayed out of reach back to his store', () => {
    const sim = fishingSeat(4, NEAR_SWARM);
    const fisher = hireFisher(sim);
    sim.world.add(fisher, Position, positionOfNode(FAR_SWARM.hx, FAR_SWARM.hy));
    expect(decide(sim).filter((c) => c.kind === 'moveUnit' && c.entity === fisher)).toHaveLength(1);
  });

  it('hands a fisher back as a builder once his water is fished out', () => {
    const sim = fishingSeat(4, NEAR_SWARM);
    const fisher = hireFisher(sim);
    expect(fisherPosts(sim)).toEqual([]);

    for (const e of sim.world.query(FishSwarm)) sim.world.mut(e, FishSwarm).count = 0;
    expect(decide(sim).filter((c) => c.kind === 'setJob' && c.entity === fisher)).toEqual([
      { kind: 'setJob', entity: fisher, jobType: BUILDER },
    ]);
  });
});
