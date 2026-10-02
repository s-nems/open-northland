import { describe, expect, it } from 'vitest';
import { Building, Owner, Position, sameSideAs } from '../../src/components/index.js';
import { contentIndex } from '../../src/core/content-index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, positionOfNode, type Simulation } from '../../src/index.js';
import type { SpatialGate } from '../../src/nav/node-circle.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import {
  InteractionCellIndex,
  nearestByCell,
  type Qualified,
} from '../../src/systems/settlers/targets/cell-index.js';
import { interactionCell } from '../../src/systems/settlers/targets/index.js';
import { STONE, STONE_ATOMIC, TEST_HUT, VIKING } from '../footprint/resource-footprint/content.js';
import {
  ctxOf,
  grassMap,
  mappedSim,
  placeGroundDrop,
  placeResource,
  terrainOf,
} from '../footprint/resource-footprint/support.js';

// The ring index against the linear scan it accelerates: door-bucketed huts and loose piles (some lying
// on a stone, so their cell is the stone's work cell) past the small-list threshold, on a map wider than
// the ring cap, under random filters, gates, vetoes and owner sides.

const MAP_CELLS_W = 64;
const MAP_CELLS_H = 40;
const NODES_W = MAP_CELLS_W * 2;
const NODES_H = MAP_CELLS_H * 2;
const STONES = 40;
const PILES = 260;
const HUTS = 110;
const QUERIES = 400;
const PLAYERS = 3;

/** A deterministic LCG, so a failure replays. */
function rng(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
}

function hutAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  sim.world.add(e, Building, { buildingType: TEST_HUT, tribe: VIKING, built: ONE, level: 0 });
  return e;
}

function world(seed: number) {
  const sim = mappedSim(grassMap(MAP_CELLS_W, MAP_CELLS_H));
  const terrain = terrainOf(sim);
  const roll = rng(seed);
  const stones: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < STONES; i++) {
    const at = { x: 2 + roll(NODES_W - 4), y: 2 + roll(NODES_H - 4) };
    placeResource(sim, STONE, STONE_ATOMIC, at.x, at.y);
    stones.push(at);
  }
  for (let i = 0; i < PILES; i++) {
    const stone = roll(4) === 0 ? stones[roll(stones.length)] : undefined;
    const at = stone ?? { x: roll(NODES_W), y: roll(NODES_H) };
    placeGroundDrop(sim, STONE, 1, at.x, at.y);
  }
  for (let i = 0; i < HUTS; i++) hutAt(sim, 1 + roll(NODES_W - 2), roll(NODES_H - 2));
  const candidates = sim.world.canonicalQuery(Position);
  for (const e of candidates) {
    const player = roll(PLAYERS + 1);
    if (player < PLAYERS) sim.world.add(e, Owner, { player });
  }
  const ctx = ctxOf(sim);
  const index = new InteractionCellIndex(sim.world, ctx, terrain, candidates);
  return { sim, terrain, ctx, candidates, roll, index };
}

function boxGate(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  xOf: (n: NodeId) => number,
  yOf: (n: NodeId) => number,
): SpatialGate {
  return {
    bounds: { minX, maxX, minY, maxY },
    allowsNode: (n) => xOf(n) >= minX && xOf(n) <= maxX && yOf(n) >= minY && yOf(n) <= maxY,
  };
}

/** The linear scan every index query must match, over `candidates` in ascending id. */
function linearWinner(
  sim: Simulation,
  candidates: readonly Entity[],
  here: NodeId,
  accept: (e: Entity) => Qualified<number> | null,
  gate: SpatialGate | undefined,
  avoid: ((cell: NodeId) => boolean) | undefined,
  onSide: ((e: Entity) => boolean) | undefined,
) {
  const terrain = terrainOf(sim);
  return nearestByCell(
    terrain,
    candidates,
    here,
    (e) => {
      const hit = accept(e);
      if (hit === null) return null;
      const cell = interactionCell(sim.world, ctxOf(sim), terrain, e, here);
      if (gate !== undefined && !gate.allowsNode(cell)) return null;
      if (avoid !== undefined && cell !== here && avoid(cell)) return null;
      return { cell, payload: hit.payload };
    },
    onSide,
  );
}

/** Random queries: sparse acceptance so some searches run past the ring cap into the far fallback, and
 *  an optional box gate, cell veto and owner side. */
function checkQueries(
  sim: Simulation,
  index: InteractionCellIndex,
  candidates: readonly Entity[],
  roll: (n: number) => number,
): void {
  const terrain = terrainOf(sim);
  const xOf = (n: NodeId) => terrain.xOf(n);
  const yOf = (n: NodeId) => terrain.yOf(n);
  for (let q = 0; q < QUERIES; q++) {
    const here = terrain.nodeAt(roll(NODES_W), roll(NODES_H));
    const keep = [1, 2, 7, 40][roll(4)] ?? 1;
    const salt = roll(1000);
    const accept = (e: Entity): Qualified<number> | null =>
      (e * 31 + salt) % keep === 0 ? { payload: e } : null;
    let gate: SpatialGate | undefined;
    if (roll(3) === 0) {
      const x = roll(NODES_W);
      const y = roll(NODES_H);
      gate = boxGate(x - roll(30), x + roll(30), y - roll(20), y + roll(20), xOf, yOf);
    }
    const avoidCell = roll(2) === 0 ? terrain.nodeAt(roll(NODES_W), roll(NODES_H)) : undefined;
    const avoid = avoidCell === undefined ? undefined : (cell: NodeId) => (cell & 3) === (avoidCell & 3);
    const onSide = roll(2) === 0 ? sameSideAs(sim.world, roll(PLAYERS)) : undefined;

    const expected = linearWinner(sim, candidates, here, accept, gate, avoid, onSide);
    expect(index.nearest(here, accept, gate, avoid, onSide), `query ${q}`).toEqual(expected);
    const loose = candidates.filter((e) => !sim.world.has(e, Building));
    expect(index.nearestLoose(here, accept, gate, avoid, onSide), `loose query ${q}`).toEqual(
      linearWinner(sim, loose, here, accept, gate, avoid, onSide),
    );
    const doors = candidates.filter((e) => sim.world.has(e, Building));
    expect(index.nearestDoor(here, accept, gate, avoid, onSide), `door query ${q}`).toEqual(
      linearWinner(sim, doors, here, accept, gate, avoid, onSide),
    );
  }
}

describe('InteractionCellIndex', () => {
  it.each([1, 2, 3])('picks the linear scan winner for loose and door candidates alike (seed %i)', (seed) => {
    const { sim, candidates, roll, index } = world(seed);
    checkQueries(sim, index, candidates, roll);
  });

  it.each([4, 5])(
    'keeps the same answers when filled and thinned one candidate at a time (seed %i)',
    (seed) => {
      const { sim, terrain, ctx, candidates, roll, index: built } = world(seed);
      const live = new InteractionCellIndex(sim.world, ctx, terrain);
      // Out of id order, with a query between, so the loose grid exists before the later inserts land.
      const order = [...candidates].sort((a, b) => ((a * 7919) % 101) - ((b * 7919) % 101));
      for (const [i, e] of order.entries()) {
        live.add(e);
        if (i === order.length >> 1) live.nearest(terrain.nodeAt(0, 0), () => null);
      }
      expect(live.divergence(built)).toEqual([]);
      const kept = candidates.filter(() => roll(3) !== 0);
      for (const e of candidates) if (!kept.includes(e)) live.remove(e);
      expect(live.divergence(new InteractionCellIndex(sim.world, ctx, terrain, kept))).toEqual([]);
      checkQueries(sim, live, kept, roll);
    },
  );

  it('rejects a loose pile its gate rules out near its node without resolving its cell', () => {
    const { sim, terrain, ctx, candidates, roll } = world(6);
    const loose = candidates.filter((e) => !sim.world.has(e, Building));
    const index = new InteractionCellIndex(sim.world, ctx, terrain, loose);
    const slack = contentIndex(ctx.content).maxResourceWorkOffset;
    const area = { minX: 10, maxX: 30, minY: 10, maxY: 24 };
    const near = (x: number, y: number, radius: number): boolean =>
      x >= area.minX - radius &&
      x <= area.maxX + radius &&
      y >= area.minY - radius &&
      y <= area.maxY + radius;
    const inArea = boxGate(
      area.minX,
      area.maxX,
      area.minY,
      area.maxY,
      (n) => terrain.xOf(n),
      (n) => terrain.yOf(n),
    );
    const resolved: NodeId[] = [];
    const gate: SpatialGate = {
      bounds: { minX: 0, maxX: NODES_W, minY: 0, maxY: NODES_H }, // loose, so the search falls to its tail
      allowsNode: (n) => {
        resolved.push(n);
        return inArea.allowsNode(n);
      },
      mayAllowNear: near,
    };
    const accept = (e: Entity): Qualified<number> => ({ payload: e });
    for (let q = 0; q < QUERIES; q++) {
      const here = terrain.nodeAt(
        area.minX + roll(area.maxX - area.minX),
        area.minY + roll(area.maxY - area.minY),
      );
      resolved.length = 0;
      expect(index.nearestLoose(here, accept, gate), `query ${q}`).toEqual(
        linearWinner(sim, loose, here, accept, inArea, undefined, undefined),
      );
      // Only piles whose own node lies near the area reach the per-seeker resolution.
      expect(resolved.every((n) => near(terrain.xOf(n), terrain.yOf(n), 2 * slack))).toBe(true);
    }
  });
});
