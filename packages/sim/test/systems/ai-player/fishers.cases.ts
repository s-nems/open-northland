import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { FishSwarm, Position, Settler, WALK_RANGE_NODES } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import type { TerrainMap } from '../../../src/index.js';
import { nodeOfPosition, positionOfNode, Simulation } from '../../../src/index.js';
import { AI_DECISION_INTERVAL_TICKS } from '../../../src/systems/ai-player/cadence.js';
import { BUILDER_CAP } from '../../../src/systems/ai-player/index.js';
import { FISHER_FLAG_MAX_DISTANCE_NODES } from '../../../src/systems/ai-player/workforce/fisher.js';
import { addFishSwarms } from '../../../src/systems/economy/fish.js';
import { liveWorkFlag } from '../../../src/systems/economy/work-flag.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap, waterColumnMap } from '../../fixtures/terrain.js';
import { BUILDER, collectModule, ctxOf, HQ_TYPE, HQ_X, HQ_Y, placeHq, SEAT, spawnMen } from './support.js';

/** The fishers: flag-bound beside fished water within a fishing trip of a store's door. */

const FISHER = 22;
const FISH = 22;
/** A swarm a few nodes off the headquarters, well inside the shore search. */
const NEAR_SWARM = { hx: HQ_X + 4, hy: HQ_Y };
/** A swarm across the map, beyond a fishing trip from the headquarters door. */
const FAR_SWARM = { hx: 120, hy: 60 };
/** A swarm outside the fisher's own search from the door but inside a fishing trip. */
const TRIP_SWARM = { hx: HQ_X + 14, hy: HQ_Y + 14 };
/** A swarm inside a fishing trip along the headquarters row, but past a settler's signpost walk range. */
const REMOTE_SWARM = { hx: HQ_X + WALK_RANGE_NODES + 10, hy: HQ_Y };
/** The cell column of a river between the headquarters and {@link REMOTE_SWARM}, in the 64 x 32 cell map
 *  that matches the fishing seat's node lattice. */
const RIVER_CELL_COLUMN = 36;
/** Decisions the catch test runs: long enough for a walk to the shore and several casts. */
const FISHING_DECISIONS = 120;

/** Content with the fish good, the fisher's cast and catch atomics, and the headquarters stocking the
 *  catch. The trade must be spelled `fisher`: the job role is read off the id slug. */
function fishingContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: FISH, id: 'fish', weight: 1 }],
    jobs: [...base.jobs, { typeId: FISHER, id: 'fisher', allowedAtomics: [36, 37, 38] }],
    buildings: base.buildings.map((b) =>
      b.typeId === HQ_TYPE ? { ...b, stock: [...b.stock, { goodType: FISH, capacity: 50, initial: 0 }] } : b,
    ),
  });
}

function fishingSeat(
  men: number,
  swarms: readonly { hx: number; hy: number }[],
  count = 5,
  map: TerrainMap = grassNodeMap(128, 64),
): Simulation {
  const content = fishingContent();
  const sim = new Simulation({ seed: 1, content, map });
  placeHq(sim);
  spawnMen(sim, men);
  sim.step();
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: no terrain');
  addFishSwarms(
    sim.world,
    terrain,
    swarms.map((swarm) => ({ ...swarm, count, continent: 0 })),
  );
  return sim;
}

function decide(sim: Simulation) {
  return [...collectModule.run(sim.world, { ...ctxOf(sim), content: fishingContent() }, SEAT)];
}

/** The decision's fisher hires: each a `setJob` to the trade with its flag planted by the next command. */
function fisherPosts(sim: Simulation) {
  const commands = decide(sim);
  return commands.flatMap((c, i) => {
    if (c.kind !== 'setJob' || c.jobType !== FISHER) return [];
    const flag = commands[i + 1];
    if (flag?.kind !== 'setWorkFlag' || flag.entity !== c.entity) throw new Error('a hire plants its flag');
    return [{ entity: c.entity, flag: { hx: flag.x, hy: flag.y } }];
  });
}

function shoreOf(sim: Simulation, swarm: { hx: number; hy: number }): { hx: number; hy: number } {
  const terrain = sim.terrain;
  const e = [...sim.world.query(FishSwarm)].find((s) => {
    const at = sim.world.get(s, Position);
    return positionOfNode(swarm.hx, swarm.hy).x === at.x && positionOfNode(swarm.hx, swarm.hy).y === at.y;
  });
  const shore = e === undefined ? null : sim.world.get(e, FishSwarm).shore;
  if (shore === null || terrain === undefined) throw new Error('setup: the swarm has a shore');
  const { x, y } = terrain.coordsOf(shore);
  return { hx: x, hy: y };
}

function distance(a: { hx: number; hy: number }, b: { hx: number; hy: number }): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}

function fishLeft(sim: Simulation): number {
  let left = 0;
  for (const e of sim.world.query(FishSwarm)) left += sim.world.get(e, FishSwarm).count;
  return left;
}

function drySwarms(sim: Simulation, swarms: readonly { hx: number; hy: number }[]): void {
  for (const e of sim.world.query(FishSwarm)) {
    const at = sim.world.get(e, Position);
    if (swarms.some((s) => positionOfNode(s.hx, s.hy).x === at.x && positionOfNode(s.hx, s.hy).y === at.y))
      sim.world.mut(e, FishSwarm).count = 0;
  }
}

function hireFisher(sim: Simulation): Entity {
  const [post] = fisherPosts(sim);
  if (post === undefined) throw new Error('expected a fisher post');
  for (const c of decide(sim)) sim.enqueueSetup(c);
  sim.step();
  return post.entity;
}

function flagNodeOf(sim: Simulation, e: Entity): { hx: number; hy: number } {
  const flag = liveWorkFlag(sim.world, e);
  if (flag === undefined) throw new Error('a fisher holds a live flag');
  const at = sim.world.get(flag.flag, Position);
  return nodeOfPosition(at.x, at.y);
}

describe('workforce module - the fishers', () => {
  it('posts one flag fisher early beside the water, the second only out of the top-ups', () => {
    const early = fishingSeat(4, [NEAR_SWARM]);
    const posts = fisherPosts(early);
    expect(posts).toHaveLength(1);
    const shore = shoreOf(early, NEAR_SWARM);
    for (const post of posts)
      expect(distance(post.flag, shore)).toBeLessThanOrEqual(FISHER_FLAG_MAX_DISTANCE_NODES);
    // Beyond the scout and the builder reserve the pool has men to spare for the second, on its own node.
    const two = fisherPosts(fishingSeat(BUILDER_CAP + 6, [NEAR_SWARM]));
    expect(two).toHaveLength(2);
    expect(two[0]?.flag).not.toEqual(two[1]?.flag);
  });

  it('hires no fisher while no fish swim within a trip of the door', () => {
    expect(fisherPosts(fishingSeat(BUILDER_CAP + 6, [FAR_SWARM]))).toEqual([]);
    expect(fisherPosts(fishingSeat(BUILDER_CAP + 6, [NEAR_SWARM], 0))).toEqual([]);
  });

  it('posts the flag on the store side of a shore a trip away', () => {
    const sim = fishingSeat(4, [TRIP_SWARM]);
    const [post] = fisherPosts(sim);
    const shore = shoreOf(sim, TRIP_SWARM);
    if (post === undefined) throw new Error('expected a fisher post');
    expect(distance(post.flag, shore)).toBeLessThanOrEqual(FISHER_FLAG_MAX_DISTANCE_NODES);
    expect(distance(post.flag, { hx: HQ_X, hy: HQ_Y })).toBeLessThanOrEqual(
      distance(shore, { hx: HQ_X, hy: HQ_Y }),
    );
  });

  it.each([
    ['near the door', NEAR_SWARM],
    ['a trip away', TRIP_SWARM],
  ])('gets a fisher hired far from water %s fishing', (_, swarm) => {
    // The spawned men stand across the map from the headquarters, outside the fisher's own search.
    const sim = fishingSeat(4, [swarm]);
    const before = fishLeft(sim);
    for (let i = 0; i < FISHING_DECISIONS && fishLeft(sim) === before; i++) {
      for (const c of decide(sim)) sim.enqueueSetup(c);
      for (let t = 0; t < AI_DECISION_INTERVAL_TICKS; t++) sim.step();
    }
    expect(fishLeft(sim)).toBeLessThan(before);
  });

  it('sends no fisher to a shore across water or past the signpost walk range', () => {
    expect(fisherPosts(fishingSeat(4, [REMOTE_SWARM]))).toHaveLength(1);
    expect(fisherPosts(fishingSeat(4, [REMOTE_SWARM], 5, waterColumnMap(64, 32, RIVER_CELL_COLUMN)))).toEqual(
      [],
    );
    const confined = fishingSeat(4, [REMOTE_SWARM]);
    confined.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    confined.step();
    expect(fisherPosts(confined)).toEqual([]);
  });

  it('keeps a posted fisher and his flag while fish swim in its reach, wherever he stands', () => {
    const sim = fishingSeat(4, [NEAR_SWARM]);
    const fisher = hireFisher(sim);
    sim.world.add(fisher, Position, positionOfNode(FAR_SWARM.hx, FAR_SWARM.hy));
    expect(decide(sim).filter((c) => 'entity' in c && c.entity === fisher)).toEqual([]);
    expect(fisherPosts(sim)).toEqual([]);
  });

  it('moves the flag of a fisher whose water ran dry to the next fished shore, then hands him back as a builder', () => {
    const sim = fishingSeat(4, [NEAR_SWARM, TRIP_SWARM]);
    const fisher = hireFisher(sim);
    expect(distance(flagNodeOf(sim, fisher), shoreOf(sim, NEAR_SWARM))).toBeLessThanOrEqual(
      FISHER_FLAG_MAX_DISTANCE_NODES,
    );

    drySwarms(sim, [NEAR_SWARM]);
    const moved = decide(sim).filter((c) => 'entity' in c && c.entity === fisher);
    expect(moved).toHaveLength(1);
    const [move] = moved;
    if (move?.kind !== 'setWorkFlag') throw new Error('expected the flag to move');
    expect(distance({ hx: move.x, hy: move.y }, shoreOf(sim, TRIP_SWARM))).toBeLessThanOrEqual(
      FISHER_FLAG_MAX_DISTANCE_NODES,
    );
    sim.enqueueSetup(move);
    sim.step();

    drySwarms(sim, [TRIP_SWARM]);
    expect(decide(sim).filter((c) => 'entity' in c && c.entity === fisher)).toEqual([
      { kind: 'setJob', entity: fisher, jobType: BUILDER },
    ]);
    expect(sim.world.get(fisher, Settler).jobType).toBe(FISHER);
  });
});
