import { describe, expect, it } from 'vitest';
import { CurrentAtomic, MoveGoal, Owner, Settler } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, type Fixed, type NodeId, Simulation } from '../../src/index.js';
import type { TerrainGraph } from '../../src/nav/terrain/index.js';
import { planNeeds } from '../../src/systems/agents/drives-needs.js';
import { PlannerSpacing } from '../../src/systems/agents/planner-spacing.js';
import { restingCell } from '../../src/systems/agents/rest-spot.js';
import { collectTargets } from '../../src/systems/agents/targets/index.js';
import { NodeBuckets } from '../../src/systems/spatial.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, grassMap, justAbove, NEED_THRESHOLD, needsSettlerAt } from './needs/support.js';

/**
 * The REST SPOT rule — where a tired settler beds down. The original's settlers step off the workplace
 * doorstep into open ground before lying down (observed original), so a rest spot must be clear of
 * buildings/resources AND of their immediate ring, and free of other resting settlers.
 *
 * The blocked overlay is seeded directly on the {@link PlannerSpacing} rather than grown from real
 * footprints: the rule under test is "which node is a bed", not how the walk-block is derived.
 */

const TIRED: Fixed = justAbove(NEED_THRESHOLD);
const MAP_W = 8;
const MAP_H = 6;

function terrainOf(sim: Simulation): TerrainGraph {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('rest-spot test: no terrain');
  return terrain;
}

function nodeAt(sim: Simulation, cx: number, cy: number): NodeId {
  const anchor = cellAnchorNode(cx, cy);
  return terrainOf(sim).nodeAt(anchor.hx, anchor.hy);
}

/** One walkable neighbour of `node` — the stand-in for a building body abutting a settler. */
function aNeighbourOf(sim: Simulation, node: NodeId): NodeId {
  const [first] = terrainOf(sim).walkableNeighbours(node);
  if (first === undefined) throw new Error('rest-spot test: node has no walkable neighbour');
  return first;
}

/** A planner-tick spacing state with the walk-block pre-seeded and `settlers` bucketed as stationary. */
function spacingWith(
  sim: Simulation,
  blocked: readonly NodeId[],
  settlers: readonly Entity[],
): PlannerSpacing {
  return PlannerSpacing.overExplicit(
    sim.world,
    ctxOf(sim),
    terrainOf(sim),
    new NodeBuckets(sim.world, settlers),
    new Set(blocked),
  );
}

/** A tired, player-owned settler standing on cell `(cx, cy)`. */
function tiredAt(sim: Simulation, cx: number, cy: number): Entity {
  const e = needsSettlerAt(sim, cx, cy, { fatigue: TIRED });
  sim.world.add(e, Owner, { player: 0 });
  return e;
}

function simWithMap(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(MAP_W, MAP_H) });
}

/** Every walkable neighbour of `node` that the overlay blocks — zero means the node is out in the open. */
function blockedNeighbourCount(sim: Simulation, node: NodeId, blocked: ReadonlySet<NodeId>): number {
  return terrainOf(sim)
    .walkableNeighbours(node)
    .filter((n) => blocked.has(n)).length;
}

describe('restingCell — choosing where to lie down', () => {
  it('keeps a settler already in the open on the spot (so an arriving sleeper actually beds down)', () => {
    const sim = simWithMap();
    const e = tiredAt(sim, 3, 2);
    const here = nodeAt(sim, 3, 2);

    const bed = restingCell(sim.world, ctxOf(sim), terrainOf(sim), e, here, spacingWith(sim, [], [e]), null);

    expect(bed).toBe(here);
  });

  it('steps off a doorstep — a node with a blocked neighbour is no bed', () => {
    const sim = simWithMap();
    const e = tiredAt(sim, 3, 2);
    const here = nodeAt(sim, 3, 2);
    const doorstep = aNeighbourOf(sim, here); // pretend a building body abuts the settler
    const spacing = spacingWith(sim, [doorstep], [e]);

    const bed = restingCell(sim.world, ctxOf(sim), terrainOf(sim), e, here, spacing, null);

    expect(bed).not.toBe(here);
    expect(spacing.blockedCells().has(bed)).toBe(false);
    expect(blockedNeighbourCount(sim, bed, new Set([doorstep]))).toBe(0);
    expect(spacing.isClaimed(bed)).toBe(true); // reserved for this tick
  });

  it('does not bed down on a node another settler is standing on', () => {
    const sim = simWithMap();
    const sleeper = tiredAt(sim, 3, 2);
    const squatter = tiredAt(sim, 3, 2); // same cell, so the sleeper must move off it
    const here = nodeAt(sim, 3, 2);

    const spacing = spacingWith(sim, [], [sleeper, squatter]);
    const bed = restingCell(sim.world, ctxOf(sim), terrainOf(sim), sleeper, here, spacing, null);

    expect(bed).not.toBe(here);
  });

  it('gives two settlers turning in together different beds (the tick claim)', () => {
    const sim = simWithMap();
    const a = tiredAt(sim, 3, 2);
    const b = tiredAt(sim, 3, 2);
    const here = nodeAt(sim, 3, 2);
    const spacing = spacingWith(sim, [], [a, b]);
    const ctx = ctxOf(sim);

    const bedA = restingCell(sim.world, ctx, terrainOf(sim), a, here, spacing, null);
    const bedB = restingCell(sim.world, ctx, terrainOf(sim), b, here, spacing, null);

    expect(bedA).not.toBe(bedB);
  });

  it('honours a signpost confinement — a bed outside the allowed area is skipped', () => {
    const sim = simWithMap();
    const e = tiredAt(sim, 3, 2);
    const here = nodeAt(sim, 3, 2);
    const terrain = terrainOf(sim);
    const spacing = spacingWith(sim, [aNeighbourOf(sim, here)], [e]);
    const allowed = nodeAt(sim, 5, 2);
    const limit = {
      allowsNode: (n: NodeId) => n === allowed,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };

    const bed = restingCell(sim.world, ctxOf(sim), terrain, e, here, spacing, limit);

    expect(bed).toBe(allowed);
  });

  it('sleeps where it stands when nothing within reach is clear', () => {
    const sim = simWithMap();
    const e = tiredAt(sim, 3, 2);
    const here = nodeAt(sim, 3, 2);
    const terrain = terrainOf(sim);
    // Block the whole lattice: no node passes the open-ground test, so the search exhausts.
    const everything: NodeId[] = [];
    for (let hx = 0; hx < MAP_W * 2; hx++) {
      for (let hy = 0; hy < MAP_H * 2; hy++) {
        if (terrain.inBounds(hx, hy)) everything.push(terrain.nodeAt(hx, hy));
      }
    }
    const spacing = spacingWith(sim, everything, [e]);

    expect(restingCell(sim.world, ctxOf(sim), terrain, e, here, spacing, null)).toBe(here);
  });
});

describe('sleep drive — walking aside before bedding down', () => {
  /** Run the needs ladder for the settler standing on `here`, with a pre-seeded spacing state (the
   *  planner builds its own per tick; this test pins the walk-block instead of growing footprints). */
  function runNeeds(sim: Simulation, e: Entity, here: NodeId, spacing: PlannerSpacing): boolean {
    const terrain = terrainOf(sim);
    const ctx = ctxOf(sim);
    const settler = sim.world.get(e, Settler);
    const targets = collectTargets(sim.world, ctx, terrain);
    return planNeeds(sim.world, ctx, terrain, e, settler, here, undefined, targets, null, spacing);
  }

  it('walks to a bed instead of sleeping on a doorstep', () => {
    const sim = simWithMap();
    const e = tiredAt(sim, 3, 2);
    const here = nodeAt(sim, 3, 2);
    const doorstep = aNeighbourOf(sim, here);

    expect(runNeeds(sim, e, here, spacingWith(sim, [doorstep], [e]))).toBe(true);

    expect(sim.world.has(e, CurrentAtomic)).toBe(false); // walking off, not yet asleep
    expect(sim.world.get(e, MoveGoal).cell).not.toBe(here);
  });

  it('sleeps on the spot once it is standing on open ground', () => {
    const sim = simWithMap();
    const e = tiredAt(sim, 3, 2);
    const here = nodeAt(sim, 3, 2);

    expect(runNeeds(sim, e, here, spacingWith(sim, [], [e]))).toBe(true);

    expect(sim.world.has(e, MoveGoal)).toBe(false);
    expect(sim.world.get(e, CurrentAtomic).effect).toEqual({ kind: 'sleep' });
  });
});
