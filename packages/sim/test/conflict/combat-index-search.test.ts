import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  diplomacyStance,
  Health,
  Owner,
  Position,
  Settler,
  setDiplomacyStance,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, positionOfNode, Simulation } from '../../src/index.js';
import { CombatIndex } from '../../src/systems/conflict/combat-index.js';
import { buildingBodyNodes } from '../../src/systems/conflict/target-node.js';
import { isFleeThreat, isValidTarget } from '../../src/systems/conflict/targeting.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../../src/systems/spatial/metric.js';
import { canonicalById, entityNode, NodeBuckets } from '../../src/systems/spatial/nodes.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap } from '../fixtures/terrain.js';
import { combatantAtNode, P0, P1, VIKING } from './stances/support.js';

/**
 * The combat index answers a nearest-target query by scanning the members of the coarse cells its box
 * overlaps. Its contract is the canonical walk over every node of the band, ring by ring: same winner (min
 * Manhattan distance, then min entity id), same distance, the same `accept` verdicts honoured, and for the
 * `nearestFew` the same (distance, id) order and tail bound. These tests pin that equivalence against a
 * node-by-node reference over randomised crowds, then the order on named cases.
 *
 * Buildings are in the crowd throughout, because they are the members admitted at SEVERAL nodes: a search
 * finds one at the distance to its nearest wall, and lists it once however many of its walls the band
 * holds.
 */

/** 64×64 cells is 128×128 half-cell nodes - eight coarse cells per axis, so boxes straddle cell edges. */
const MAP_CELLS = 64;
const MAP_NODES = MAP_CELLS * 2;
const CROWD = 60;
const KEEPS = 10;
const QUERIES = 40;
const MAX_RADIUS = 24;
const FEW = 4;
/** The rings past the first hit `nearestFew` is asked to keep taking. */
const TAIL_RINGS = 3;
/** The fixture keep: a four-node wall row on `dy` 0, whose `dx` offsets hold on either row parity. Long
 *  enough that one band can cut through it, leaving walls on both sides of a `minDist` floor. */
const KEEP = 30;
const KEEP_WALLS = [0, 1, 2, 3].map((dx) => ({ dx, dy: 0 }));
const KEEP_HP = 1000;
/** A keep retyped in place: a wall row twice as long, so the retype moves its body. */
const LONG_KEEP = 31;
const LONG_KEEP_WALLS = [0, 1, 2, 3, 4, 5, 6, 7].map((dx) => ({ dx, dy: 0 }));
/** The anchor of the keep the across-builds test retypes. */
const RETYPED_AT = { x: 20, y: 20 };
/** A third player: at peace with P0 both ways, while P1 holds `enemy` toward it one way only. */
const P2 = 2;
const OWNERS = [P0, P1, P2];

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

/** The fixture content plus the walled {@link KEEP} and {@link LONG_KEEP}, the building types here with a
 *  real body. */
function indexContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      { typeId: KEEP, id: 'keep', kind: 'tower', hitpoints: KEEP_HP, footprint: { blocked: KEEP_WALLS } },
      {
        typeId: LONG_KEEP,
        id: 'long_keep',
        kind: 'tower',
        hitpoints: KEEP_HP,
        footprint: { blocked: LONG_KEEP_WALLS },
      },
    ],
  });
}

function mappedSim(seed: number): Simulation {
  return new Simulation({ seed, content: indexContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
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
    // Cycle owners so the presence tallies, the owner skip and the accept filters see every diplomacy.
    ids.push(combatantAtNode(sim, x, y, OWNERS[i % OWNERS.length] ?? P0, MILITARY_MODE.ATTACK));
  }
  return ids;
}

/** An enemy keep with its anchor on half-cell node (hx, hy) - a direct spawn, the test-setup exception. */
function keepAtNode(sim: Simulation, hx: number, hy: number, owner: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Building, { buildingType: KEEP, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Health, { hitpoints: KEEP_HP, max: KEEP_HP });
  sim.world.add(e, Owner, { player: owner });
  return e;
}

/** Keeps drawn clear of the east edge, so a wall row is never clipped down to a single node. */
function keeps(sim: Simulation, draw: () => number): Entity[] {
  const ids: Entity[] = [];
  for (let i = 0; i < KEEPS; i++) {
    const x = Math.floor(draw() * (MAP_NODES - KEEP_WALLS.length));
    const y = Math.floor(draw() * MAP_NODES);
    ids.push(keepAtNode(sim, x, y, OWNERS[i % OWNERS.length] ?? P0));
  }
  return ids;
}

/** The reference: every member bucketed at each node the index admits it at - a combatant at its own, a
 *  building at every wall of its body - in canonical order. */
function referenceBuckets(
  sim: Simulation,
  ids: readonly Entity[],
  buildings: readonly Entity[],
): NodeBuckets {
  const terrain = terrainOf(sim);
  const buckets = new NodeBuckets(sim.world, []);
  for (const e of canonicalById(ids)) {
    const node = entityNode(sim.world, terrain, e);
    buckets.insert(e, terrain.xOf(node), terrain.yOf(node));
  }
  for (const b of canonicalById(buildings)) {
    for (const node of buildingBodyNodes(sim.world, ctxOf(sim), terrain, b)) {
      buckets.insert(b, terrain.xOf(node), terrain.yOf(node));
    }
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

/** Build this tick's index over `ids` and the sim's buildings, and hold it to the ring walk over `walled`
 *  on {@link QUERIES} random bands, with and without a seeker's skip. */
function expectRingWalkAgreement(
  sim: Simulation,
  ids: readonly Entity[],
  walled: readonly Entity[],
  draw: () => number,
): void {
  const index = new CombatIndex(sim.world, ctxOf(sim), terrainOf(sim), ids);
  const reference = referenceBuckets(sim, ids, walled);
  const atWar = (e: Entity, seeker: number): boolean => {
    const owner = sim.world.get(e, Owner).player;
    if (owner === seeker) return false;
    return (
      diplomacyStance(sim.world, seeker, owner) === 'enemy' ||
      diplomacyStance(sim.world, owner, seeker) === 'enemy'
    );
  };
  // The last filter rejects every building (no `Settler`), so both sides of the multi-node case run.
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
    expect(index.nearestFew(x, y, minDist, maxDist, accept, FEW, null, TAIL_RINGS)).toEqual(
      ringNearestFew(reference, x, y, minDist, maxDist, accept, FEW),
    );
    // A seeker's skip is exactly a filter admitting only players at war with it either way, so the
    // winner cannot move for any accept that already rejects the rest.
    const seeker = OWNERS[q % OWNERS.length] ?? P0;
    const hostile: Accept = (e) => atWar(e, seeker) && accept(e);
    expect(index.nearest(x, y, minDist, maxDist, accept, seeker)).toEqual(
      reference.nearest(x, y, minDist, maxDist, hostile),
    );
    expect(index.nearestFew(x, y, minDist, maxDist, accept, FEW, seeker, TAIL_RINGS)).toEqual(
      ringNearestFew(reference, x, y, minDist, maxDist, hostile, FEW),
    );
  }
}

describe('CombatIndex nearest search - equivalent to the node ring walk', () => {
  for (const seed of [1, 2, 3]) {
    it(`agrees with the ring walk on nearest and nearestFew over a random crowd (seed ${seed})`, () => {
      const draw = lcg(seed);
      const sim = mappedSim(seed);
      for (const [from, to] of [
        [P0, P2],
        [P2, P0],
        [P2, P1],
      ] as const) {
        setDiplomacyStance(sim.world, from, to, 'neutral');
      }
      expectRingWalkAgreement(sim, crowd(sim, draw), keeps(sim, draw), draw);
    });
  }

  it('keeps agreeing across builds as units leave and buildings are placed, razed, handed over and retyped', () => {
    // The building layer outlives a build and the units do not, so each change must reach the next build.
    const draw = lcg(4);
    const sim = mappedSim(4);
    const ids = crowd(sim, draw);
    const retyped = keepAtNode(sim, RETYPED_AT.x, RETYPED_AT.y, P1);
    const walled = [...keeps(sim, draw), retyped];
    expectRingWalkAgreement(sim, ids, walled, draw);

    const stayed = ids.filter((_, i) => i % 2 === 0);
    expectRingWalkAgreement(sim, stayed, walled, draw);

    // One change per build, so no change rides on another's rebuild.
    const [razed, handed, ...rest] = walled;
    if (razed === undefined || handed === undefined) throw new Error('keeps expected');
    sim.world.mut(handed, Owner).player = (sim.world.get(handed, Owner).player + 1) % OWNERS.length;
    expectRingWalkAgreement(sim, stayed, walled, draw);
    sim.world.add(handed, Owner, { player: (sim.world.get(handed, Owner).player + 1) % OWNERS.length });
    expectRingWalkAgreement(sim, stayed, walled, draw);
    sim.world.mut(retyped, Building).buildingType = LONG_KEEP;
    expectRingWalkAgreement(sim, stayed, walled, draw);
    // The far end of the longer row, which only the retyped body holds.
    const farWall = RETYPED_AT.x + LONG_KEEP_WALLS.length - 1;
    expect(
      new CombatIndex(sim.world, ctxOf(sim), terrainOf(sim), stayed).nearest(
        farWall,
        RETYPED_AT.y,
        0,
        0,
        (e) => e === retyped,
        null,
      ),
    ).toEqual({ entity: retyped, distance: 0 });
    sim.world.destroy(razed);
    expectRingWalkAgreement(sim, stayed, [handed, ...rest], draw);
    const placed = keepAtNode(sim, 40, 40, P1);
    expectRingWalkAgreement(sim, stayed, [handed, ...rest, placed], draw);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('reuses one band scan across the two target tiers without staling another band', () => {
    const sim = mappedSim(1);
    const near = combatantAtNode(sim, 10, 10, P1, MILITARY_MODE.ATTACK);
    const far = combatantAtNode(sim, 20, 10, P1, MILITARY_MODE.ATTACK);
    const index = new CombatIndex(sim.world, ctxOf(sim), terrainOf(sim), [near, far]);
    const all: Accept = () => true;
    expect(index.nearest(12, 10, 0, MAX_RADIUS, (e) => e === far, null)).toEqual({
      entity: far,
      distance: 8,
    });
    expect(index.nearest(12, 10, 0, MAX_RADIUS, all, null)).toEqual({ entity: near, distance: 2 });
    expect(index.nearest(12, 10, 3, MAX_RADIUS, all, null)).toEqual({ entity: far, distance: 8 });
    expect(index.nearest(19, 10, 0, MAX_RADIUS, all, null)).toEqual({ entity: far, distance: 1 });
  });
  it('still offers a building felled after the layer was built, and the target filters turn it down', () => {
    // The layer ignores hitpoints: a building felled this tick is reaped only by the cleanup after combat.
    const sim = mappedSim(1);
    const ctx = ctxOf(sim);
    const seeker = combatantAtNode(sim, 10, 10, P0, MILITARY_MODE.ATTACK);
    const enemy = combatantAtNode(sim, 10, 16, P1, MILITARY_MODE.ATTACK);
    const keep = keepAtNode(sim, 11, 10, P1);
    new CombatIndex(sim.world, ctx, terrainOf(sim), [seeker, enemy]);
    sim.world.mut(keep, Health).hitpoints = 0;
    const index = new CombatIndex(sim.world, ctx, terrainOf(sim), [seeker, enemy]);
    const attacker = sim.world.get(seeker, Settler);
    expect(index.nearest(10, 10, 0, MAX_RADIUS, () => true, P0)).toEqual({ entity: keep, distance: 1 });
    const pastTheKeep = { entity: enemy, distance: 6 };
    expect(
      index.nearest(10, 10, 0, MAX_RADIUS, (t) => isValidTarget(sim.world, ctx, seeker, attacker, t), P0),
    ).toEqual(pastTheKeep);
    // Counted as firing, so only its hitpoints can turn the fleer's filter down.
    const firing = new Set([keep]);
    expect(
      index.nearest(
        10,
        10,
        0,
        MAX_RADIUS,
        (t) => isFleeThreat(sim.world, ctx, seeker, attacker, t, firing),
        P0,
      ),
    ).toEqual(pastTheKeep);
  });

  it('the building layer verifier flags an Owner write that bypassed the tracked seam', () => {
    const sim = mappedSim(1);
    const keep = keepAtNode(sim, 10, 10, P1);
    new CombatIndex(sim.world, ctxOf(sim), terrainOf(sim), []);
    expect(sim.world.verifyCaches()).toEqual([]);
    // Defeating the readonly view is the bug the verifier exists to catch: no generation bump.
    (sim.world.get(keep, Owner) as { player: number }).player = P2;
    expect(sim.world.verifyCaches().join('\n')).toContain('combatBuildingLayer');
  });

  it('scans a query nested in an accept into its own buffer, leaving the outer band intact', () => {
    // The hunter's last-resort gate asks for game from inside its own candidate filter.
    const sim = mappedSim(1);
    const outer = [10, 14, 16].map((x) => combatantAtNode(sim, x, 10, P1, MILITARY_MODE.ATTACK));
    const inner = [60, 61, 62].map((x) => combatantAtNode(sim, x, 10, P1, MILITARY_MODE.ATTACK));
    const index = new CombatIndex(sim.world, ctxOf(sim), terrainOf(sim), [...outer, ...inner]);
    const last = outer[2];
    const innerFinds: Array<Found | null> = [];
    const found = index.nearest(
      12,
      10,
      0,
      10,
      (e) => {
        innerFinds.push(index.nearest(60, 10, 0, 4, () => true, null));
        return e === last;
      },
      null,
    );
    expect(found).toEqual({ entity: last, distance: 4 });
    expect(innerFinds).toEqual(Array(3).fill({ entity: inner[0], distance: 0 }));
  });
});

/**
 * `nearestFew` - the nearest several. A defence-mode building picks among this band, so the ORDER is the
 * contract, not just the membership.
 */
describe('CombatIndex.nearestFew - the nearest several', () => {
  const all: Accept = () => true;

  function indexOver(sim: Simulation, ids: readonly Entity[]): CombatIndex {
    return new CombatIndex(sim.world, ctxOf(sim), terrainOf(sim), ids);
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
    expect(index.nearestFew(10, 10, 0, 10, all, FEW, null, TAIL_RINGS)).toEqual([
      { entity: ids[3], distance: 1 },
      { entity: ids[1], distance: 2 },
      { entity: ids[2], distance: 2 },
      { entity: ids[0], distance: 4 },
    ]);
    expect(index.nearestFew(10, 10, 0, 10, all, FEW, null, TAIL_RINGS)[0]).toEqual(
      index.nearest(10, 10, 0, 10, all, null),
    );
  });

  it('truncates to `limit`, keeping the nearest', () => {
    const sim = mappedSim(1);
    const ids = [11, 12, 13, 14].map((x) => combatantAtNode(sim, x, 10, P1, MILITARY_MODE.ATTACK));
    expect(indexOver(sim, ids).nearestFew(10, 10, 0, 10, all, 2, null, TAIL_RINGS)).toEqual([
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
    expect(index.nearestFew(10, 10, 0, 29, all, FEW, null, TAIL_RINGS)).toEqual([
      { entity: door, distance: 1 },
    ]);
    // The straggler is still findable - it is the tail bound, not the band, that dropped it.
    expect(index.nearest(10, 10, 2, 29, all, null)).toEqual({ entity: straggler, distance: 12 });
  });

  it('lists a building once, at its nearest wall inside the band', () => {
    // The keep's walls run from the seeker's own node outward, so `minDist` cuts the row in two: the two
    // nearest walls are under the floor and must neither list the keep nor hide it.
    const sim = mappedSim(1);
    const keep = keepAtNode(sim, 10, 10, P1); // walls at distance 0, 1, 2 and 3
    const unit = combatantAtNode(sim, 10, 14, P1, MILITARY_MODE.ATTACK); // distance 4
    const index = indexOver(sim, [unit]);
    expect(index.nearestFew(10, 10, 2, 10, all, FEW, null, TAIL_RINGS)).toEqual([
      { entity: keep, distance: 2 },
      { entity: unit, distance: 4 },
    ]);
    expect(index.nearest(10, 10, 2, 10, all, null)).toEqual({ entity: keep, distance: 2 });
  });

  it('returns everything the band holds when that is fewer than `limit`, and empty when it holds none', () => {
    const sim = mappedSim(1);
    const lone = combatantAtNode(sim, 12, 10, P1, MILITARY_MODE.ATTACK);
    const index = indexOver(sim, [lone]);
    expect(index.nearestFew(10, 10, 0, 10, all, FEW, null, TAIL_RINGS)).toEqual([
      { entity: lone, distance: 2 },
    ]);
    expect(index.nearestFew(10, 10, 3, 10, all, FEW, null, TAIL_RINGS)).toEqual([]);
  });
});
