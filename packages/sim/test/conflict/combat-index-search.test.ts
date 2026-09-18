import { describe, expect, it } from 'vitest';
import { Health, Owner, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { CombatIndex } from '../../src/systems/conflict/combat-index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../../src/systems/spatial/metric.js';
import { entityNode, NodeBuckets } from '../../src/systems/spatial/nodes.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap } from '../fixtures/terrain.js';
import { combatantAtNode, P0, P1 } from './stances/support.js';

/**
 * The combat index answers a nearest-target query by scanning the members of the coarse cells its box
 * overlaps. Its contract is the canonical walk over every node of the band, ring by ring: same winner (min
 * Manhattan distance, then min entity id), same distance, the same `accept` verdicts honoured, and for the
 * garrison's `nearestFew` the same (distance, id) order and tail bound. These tests pin that equivalence
 * against a node-by-node reference over randomised crowds, then the garrison order on named cases.
 */

/** 64×64 cells is 128×128 half-cell nodes - eight coarse cells per axis, so boxes straddle cell edges. */
const MAP_CELLS = 64;
const MAP_NODES = MAP_CELLS * 2;
const CROWD = 60;
const QUERIES = 40;
const MAX_RADIUS = 24;
const FEW = 4;
/** The rings past the first hit `nearestFew` keeps taking, mirrored from the index. */
const TAIL_RINGS = 3;
/** A deterministic LCG so a failing draw can be replayed. */
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const LCG_MODULUS = 2 ** 32;

type Found = { entity: Entity; distance: number };
type Accept = (e: Entity) => boolean;

function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
    return state / LCG_MODULUS;
  };
}

function mappedSim(seed: number): Simulation {
  return new Simulation({ seed, content: testContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
}

function terrainOf(sim: Simulation) {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  return terrain;
}

function crowd(sim: Simulation, draw: () => number): Entity[] {
  const ids: Entity[] = [];
  for (let i = 0; i < CROWD; i++) {
    const x = Math.floor(draw() * MAP_NODES);
    const y = Math.floor(draw() * MAP_NODES);
    // Alternate owners so the presence tallies, the owner skip and the accept filters have both sides.
    ids.push(combatantAtNode(sim, x, y, i % 2 === 0 ? P0 : P1, MILITARY_MODE.ATTACK));
  }
  return ids;
}

/** The reference: every combatant bucketed at its own node, in canonical order. */
function referenceBuckets(sim: Simulation, ids: readonly Entity[]): NodeBuckets {
  const terrain = terrainOf(sim);
  const buckets = new NodeBuckets(sim.world, []);
  for (const e of [...ids].sort((a, b) => a - b)) {
    const node = entityNode(sim.world, terrain, e);
    buckets.insert(e, terrain.xOf(node), terrain.yOf(node));
  }
  return buckets;
}

/** The reference `nearestFew`: walk the rings, take every acceptor in (ring, id) order, stop at `limit`, the
 *  band's end, or {@link TAIL_RINGS} past the first hit. */
function ringNearestFew(
  buckets: NodeBuckets,
  x: number,
  y: number,
  minDist: number,
  maxDist: number,
  accept: Accept,
  limit: number,
): Found[] {
  const found: Found[] = [];
  const taken = new Set<Entity>();
  let lastRing = maxDist;
  for (let d = minDist; d <= lastRing && found.length < limit; d++) {
    const ring: Entity[] = [];
    for (let i = 0; i < ringOffsetCount(d); i++) {
      for (const e of buckets.at(x + ringOffsetDx(d, i), y + ringOffsetDy(d, i))) {
        if (!taken.has(e) && accept(e)) {
          taken.add(e);
          ring.push(e);
        }
      }
    }
    ring.sort((a, b) => a - b);
    for (const entity of ring) found.push({ entity, distance: d });
    if (found.length > 0) lastRing = Math.min(lastRing, d + TAIL_RINGS);
  }
  return found.slice(0, limit);
}

describe('CombatIndex nearest search - equivalent to the node ring walk', () => {
  for (const seed of [1, 2, 3]) {
    it(`agrees with the ring walk on nearest and nearestFew over a random crowd (seed ${seed})`, () => {
      const draw = lcg(seed);
      const sim = mappedSim(seed);
      const ids = crowd(sim, draw);
      const index = new CombatIndex(sim.world, ctxOf(sim), terrainOf(sim), ids, []);
      const reference = referenceBuckets(sim, ids);
      const ownedBy = (e: Entity, player: number): boolean => sim.world.get(e, Owner).player === player;
      const accepts: ReadonlyArray<Accept> = [
        () => true,
        (e) => e % 2 === 0,
        (e) => sim.world.get(e, Health).hitpoints > 0 && sim.world.has(e, Settler) && e % 3 !== 0,
      ];
      for (let q = 0; q < QUERIES; q++) {
        const x = Math.floor(draw() * MAP_NODES);
        const y = Math.floor(draw() * MAP_NODES);
        const minDist = Math.floor(draw() * 3);
        const maxDist = minDist + Math.floor(draw() * MAX_RADIUS);
        const accept = accepts[q % accepts.length] ?? accepts[0];
        if (accept === undefined) throw new Error('unreachable');
        expect(index.nearest(x, y, minDist, maxDist, accept, null)).toEqual(
          reference.nearest(x, y, minDist, maxDist, accept),
        );
        expect(index.nearestFew(x, y, minDist, maxDist, accept, FEW, null)).toEqual(
          ringNearestFew(reference, x, y, minDist, maxDist, accept, FEW),
        );
        // Skipping an owner is exactly a filter that rejects that owner, so the winner cannot move.
        const skip = q % 2 === 0 ? P0 : P1;
        const notMine: Accept = (e) => !ownedBy(e, skip) && accept(e);
        expect(index.nearest(x, y, minDist, maxDist, accept, skip)).toEqual(
          reference.nearest(x, y, minDist, maxDist, notMine),
        );
        expect(index.nearestFew(x, y, minDist, maxDist, accept, FEW, skip)).toEqual(
          ringNearestFew(reference, x, y, minDist, maxDist, notMine, FEW),
        );
      }
    });
  }

  it('reuses one band scan across the two target tiers without staling another band', () => {
    const sim = mappedSim(1);
    const near = combatantAtNode(sim, 10, 10, P1, MILITARY_MODE.ATTACK);
    const far = combatantAtNode(sim, 20, 10, P1, MILITARY_MODE.ATTACK);
    const index = new CombatIndex(sim.world, ctxOf(sim), terrainOf(sim), [near, far], []);
    const all: Accept = () => true;
    expect(index.nearest(12, 10, 0, MAX_RADIUS, (e) => e === far, null)).toEqual({
      entity: far,
      distance: 8,
    });
    expect(index.nearest(12, 10, 0, MAX_RADIUS, all, null)).toEqual({ entity: near, distance: 2 });
    expect(index.nearest(12, 10, 3, MAX_RADIUS, all, null)).toEqual({ entity: far, distance: 8 });
    expect(index.nearest(19, 10, 0, MAX_RADIUS, all, null)).toEqual({ entity: far, distance: 1 });
  });
});

/**
 * `nearestFew` - the nearest several. Seekers stacked on one node (a tower's garrison) take an offset into
 * this band instead of all choosing its first entry, so the ORDER is the contract, not just the membership.
 */
describe('CombatIndex.nearestFew - the nearest several', () => {
  const all: Accept = () => true;

  function indexOver(sim: Simulation, ids: readonly Entity[]): CombatIndex {
    return new CombatIndex(sim.world, ctxOf(sim), terrainOf(sim), ids, []);
  }

  it('orders by distance, then by ascending id, and leads with what nearest would pick', () => {
    const sim = mappedSim(1);
    const ids = [
      combatantAtNode(sim, 14, 10, P1, MILITARY_MODE.ATTACK), // dist 4
      combatantAtNode(sim, 8, 10, P1, MILITARY_MODE.ATTACK), // dist 2, the lower id of the pair
      combatantAtNode(sim, 12, 10, P1, MILITARY_MODE.ATTACK), // dist 2
      combatantAtNode(sim, 10, 11, P1, MILITARY_MODE.ATTACK), // dist 1 - the nearest
    ];
    const index = indexOver(sim, ids);
    expect(index.nearestFew(10, 10, 0, 10, all, FEW, null)).toEqual([
      { entity: ids[3], distance: 1 },
      { entity: ids[1], distance: 2 },
      { entity: ids[2], distance: 2 },
      { entity: ids[0], distance: 4 },
    ]);
    expect(index.nearestFew(10, 10, 0, 10, all, FEW, null)[0]).toEqual(
      index.nearest(10, 10, 0, 10, all, null),
    );
  });

  it('truncates to `limit`, keeping the nearest', () => {
    const sim = mappedSim(1);
    const ids = [11, 12, 13, 14].map((x) => combatantAtNode(sim, x, 10, P1, MILITARY_MODE.ATTACK));
    expect(indexOver(sim, ids).nearestFew(10, 10, 0, 10, all, 2, null)).toEqual([
      { entity: ids[0], distance: 1 },
      { entity: ids[1], distance: 2 },
    ]);
  });

  it('stops a few rings past the first hit instead of walking the whole band for alternatives', () => {
    // The bound that keeps a garrison's fan cheap: one raider at the door and one straggler far behind it
    // cost the near rings, not the house bow's whole reach.
    const sim = mappedSim(1);
    const door = combatantAtNode(sim, 11, 10, P1, MILITARY_MODE.ATTACK);
    const straggler = combatantAtNode(sim, 22, 10, P1, MILITARY_MODE.ATTACK);
    const index = indexOver(sim, [door, straggler]);
    expect(index.nearestFew(10, 10, 0, 29, all, FEW, null)).toEqual([{ entity: door, distance: 1 }]);
    // The straggler is still findable - it is the tail bound, not the band, that dropped it.
    expect(index.nearest(10, 10, 2, 29, all, null)).toEqual({ entity: straggler, distance: 12 });
  });

  it('returns everything the band holds when that is fewer than `limit`, and empty when it holds none', () => {
    const sim = mappedSim(1);
    const lone = combatantAtNode(sim, 12, 10, P1, MILITARY_MODE.ATTACK);
    const index = indexOver(sim, [lone]);
    expect(index.nearestFew(10, 10, 0, 10, all, FEW, null)).toEqual([{ entity: lone, distance: 2 }]);
    expect(index.nearestFew(10, 10, 3, 10, all, FEW, null)).toEqual([]);
  });
});
