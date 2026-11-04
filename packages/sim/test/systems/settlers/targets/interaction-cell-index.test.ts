import { describe, expect, it } from 'vitest';
import { Building, Owner, Position, sameSideAs } from '../../../../src/components/index.js';
import { contentIndex } from '../../../../src/core/content-index.js';
import { GENERATION_JOURNAL_LIMIT } from '../../../../src/ecs/generation-journal.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { ONE, positionOfNode, type Simulation } from '../../../../src/index.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../../src/nav/halfcell.js';
import type { SpatialGate } from '../../../../src/nav/node-circle.js';
import type { NodeId } from '../../../../src/nav/terrain/index.js';
import {
  FILED_STRIDE,
  InteractionCellIndex,
  nearestByCell,
  type Qualified,
} from '../../../../src/systems/settlers/targets/cell-index.js';
import { interactionCell } from '../../../../src/systems/settlers/targets/index.js';
import { manhattan } from '../../../../src/systems/spatial/metric.js';
import { STONE, STONE_ATOMIC, TEST_HUT, VIKING } from '../../footprint/resource-footprint/content.js';
import {
  ctxOf,
  grassMap,
  mappedSim,
  placeGroundDrop,
  placeResource,
  terrainOf,
} from '../../footprint/resource-footprint/support.js';

// The ring index against the linear scan it accelerates: door-bucketed huts and loose piles (some lying
// on a stone, so their cell is the stone's work cell) past the small-list threshold, on a map wider than
// the ring cap, under random filters, gates, vetoes and owner sides.

interface Layout {
  readonly cellsW: number;
  readonly cellsH: number;
  readonly stones: number;
  readonly piles: number;
  readonly huts: number;
}

const SMALL: Layout = { cellsW: 64, cellsH: 40, stones: 40, piles: 260, huts: 110 };
/** Many search blocks wide and sparse, so the searches past the ring cap cross several blocks. */
const WIDE: Layout = { cellsW: 200, cellsH: 150, stones: 60, piles: 220, huts: 120 };
const NODES_W = SMALL.cellsW * 2;
const NODES_H = SMALL.cellsH * 2;
const QUERIES = 400;
/** Owner changes between two rounds of queries, short of the journal window. */
const OWNER_HANDOVERS = 40;
/** Manhattan offsets of a probe from its lone target: from a few nodes inside the ring cap to past it. */
const RING_CAP_PROBE_MIN = 40;
const RING_CAP_PROBE_SPAN = 30;
const PLAYERS = 3;
/** Random box reads, and the most nodes a box spans past its corner on each axis. */
const BOX_READS = 200;
const BOX_SPAN = 120;
/** A candidate list short enough for the index's linear scan. */
const SHORT_LIST = 40;

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

function world(seed: number, layout: Layout = SMALL) {
  const nodesW = layout.cellsW * 2;
  const nodesH = layout.cellsH * 2;
  const sim = mappedSim(grassMap(layout.cellsW, layout.cellsH));
  const terrain = terrainOf(sim);
  const roll = rng(seed);
  const stones: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < layout.stones; i++) {
    const at = { x: 2 + roll(nodesW - 4), y: 2 + roll(nodesH - 4) };
    placeResource(sim, STONE, STONE_ATOMIC, at.x, at.y);
    stones.push(at);
  }
  for (let i = 0; i < layout.piles; i++) {
    const stone = roll(4) === 0 ? stones[roll(stones.length)] : undefined;
    const at = stone ?? { x: roll(nodesW), y: roll(nodesH) };
    placeGroundDrop(sim, STONE, 1, at.x, at.y);
  }
  for (let i = 0; i < layout.huts; i++) hutAt(sim, 1 + roll(nodesW - 2), roll(nodesH - 2));
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
  rank: NodeId = here,
) {
  const terrain = terrainOf(sim);
  return nearestByCell(
    terrain,
    candidates,
    rank,
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

/** Random queries: sparse acceptance so some searches run past the ring cap into the block search, and
 *  an optional box gate, cell veto and owner side, each also ranked from a random origin. */
function checkQueries(
  sim: Simulation,
  index: InteractionCellIndex,
  candidates: readonly Entity[],
  roll: (n: number) => number,
): void {
  const terrain = terrainOf(sim);
  const xOf = (n: NodeId) => terrain.xOf(n);
  const yOf = (n: NodeId) => terrain.yOf(n);
  const nodesW = terrain.width;
  const nodesH = terrain.height;
  for (let q = 0; q < QUERIES; q++) {
    const here = terrain.nodeAt(roll(nodesW), roll(nodesH));
    const keep = [1, 2, 7, 40][roll(4)] ?? 1;
    const salt = roll(1000);
    const accept = (e: Entity): Qualified<number> | null =>
      (e * 31 + salt) % keep === 0 ? { payload: e } : null;
    let gate: SpatialGate | undefined;
    if (roll(3) === 0) {
      const x = roll(nodesW);
      const y = roll(nodesH);
      // Half the boxes span past the ring cap, so the block search runs under a gate too.
      const [w, h] = roll(2) === 0 ? [30, 20] : [90, 60];
      gate = boxGate(x - roll(w), x + roll(w), y - roll(h), y + roll(h), xOf, yOf);
    }
    const avoidCell = roll(2) === 0 ? terrain.nodeAt(roll(nodesW), roll(nodesH)) : undefined;
    const avoid = avoidCell === undefined ? undefined : (cell: NodeId) => (cell & 3) === (avoidCell & 3);
    const onSide = roll(2) === 0 ? sameSideAs(sim.world, roll(PLAYERS)) : undefined;

    const expected = linearWinner(sim, candidates, here, accept, gate, avoid, onSide);
    expect(index.nearest(here, accept, gate, avoid, onSide), `query ${q}`).toEqual(expected);
    const field = candidates
      .filter((e) => (onSide === undefined || onSide(e)) && accept(e) !== null)
      .sort((a, b) => a - b);
    expect(index.nearestAmong(field, field.length, here, accept, gate, avoid), `narrowed query ${q}`).toEqual(
      expected,
    );
    const rank = terrain.nodeAt(roll(nodesW), roll(nodesH));
    expect(index.nearest(here, accept, gate, avoid, onSide, rank), `ranked query ${q}`).toEqual(
      linearWinner(sim, candidates, here, accept, gate, avoid, onSide, rank),
    );
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
  it.each([1])('picks the linear scan winner for loose and door candidates alike (seed %i)', (seed) => {
    const { sim, candidates, roll, index } = world(seed);
    checkQueries(sim, index, candidates, roll);
  });

  it.each([7])('picks the linear scan winner across many search blocks (seed %i)', (seed) => {
    const { sim, candidates, roll, index } = world(seed, WIDE);
    checkQueries(sim, index, candidates, roll);
  });

  it.each([9])('finds a lone candidate just past the ring cap (seed %i)', (seed) => {
    const { sim, terrain, candidates, roll, index } = world(seed, WIDE);
    for (let q = 0; q < QUERIES; q++) {
      const target = candidates[roll(candidates.length)] as Entity;
      const cell = interactionCell(sim.world, ctxOf(sim), terrain, target, terrain.nodeAt(0, 0));
      // Offsets straddling the cap, so a search that drops the nodes right past it misses the target.
      const offset = RING_CAP_PROBE_MIN + roll(RING_CAP_PROBE_SPAN);
      const dx = roll(offset + 1);
      const sx = roll(2) === 0 ? 1 : -1;
      const sy = roll(2) === 0 ? 1 : -1;
      const x = terrain.xOf(cell) + sx * dx;
      const y = terrain.yOf(cell) + sy * (offset - dx);
      if (!terrain.inBounds(x, y)) continue;
      const here = terrain.nodeAt(x, y);
      const accept = (e: Entity): Qualified<number> | null => (e === target ? { payload: e } : null);
      expect(index.nearest(here, accept), `query ${q}`).toEqual(
        linearWinner(sim, candidates, here, accept, undefined, undefined, undefined),
      );
    }
  });

  it.each([3])(
    'hands a box read every loose candidate filed in the box, and only those (seed %i)',
    (seed) => {
      const { sim, terrain, candidates, roll, index } = world(seed, WIDE);
      const loose = candidates.filter((e) => !sim.world.has(e, Building));
      for (let q = 0; q < BOX_READS; q++) {
        const minX = roll(terrain.width);
        const minY = roll(terrain.height);
        const box = { minX, maxX: minX + roll(BOX_SPAN), minY, maxY: minY + roll(BOX_SPAN) };
        const read: Entity[] = [];
        index.forEachLooseIn(box, (e, x, y) => {
          const p = sim.world.get(e, Position);
          expect(terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y))).toBe(
            terrain.nodeAt(x, y),
          );
          read.push(e);
        });
        const inBox = loose.filter((e) => {
          const p = sim.world.get(e, Position);
          const node = terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y));
          const x = terrain.xOf(node);
          const y = terrain.yOf(node);
          return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
        });
        expect(
          read.sort((a, b) => a - b),
          `read ${q}`,
        ).toEqual(inBox);
      }
    },
  );

  it.each([4])('keeps the same answers when filled and thinned one candidate at a time (seed %i)', (seed) => {
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
  });

  it.each([11])('keeps its owner sides current as candidates change hands (seed %i)', (seed) => {
    const { sim, terrain, ctx, candidates, roll, index } = world(seed);
    checkQueries(sim, index, candidates, roll); // splits the sides
    for (const handovers of [1, OWNER_HANDOVERS, GENERATION_JOURNAL_LIMIT + 1]) {
      for (let i = 0; i < handovers; i++) {
        const e = candidates[roll(candidates.length)] as Entity;
        const player = roll(PLAYERS + 1);
        const owned = sim.world.has(e, Owner);
        if (player === PLAYERS) {
          if (owned) sim.world.remove(e, Owner);
        } else if (owned && roll(2) === 0)
          sim.world.mut(e, Owner).player = player; // an in-place write
        else sim.world.add(e, Owner, { player });
      }
      checkQueries(sim, index, candidates, roll);
      expect(index.divergence(new InteractionCellIndex(sim.world, ctx, terrain, candidates))).toEqual([]);
    }
  });

  it.each([15])(
    'keeps its per-side filed candidates current through edits and handovers (seed %i)',
    (seed) => {
      const { sim, terrain, ctx, candidates, roll, index } = world(seed);
      /** A side's filed candidates as sorted `entity@x,y` keys, so the read order does not matter. */
      const filedKeys = (from: InteractionCellIndex, player: number): string[] => {
        const filed = from.filedOnSide(player);
        const keys: string[] = [];
        for (let i = 0; i < filed.length; i += FILED_STRIDE)
          keys.push(`${filed[i]}@${filed[i + 1]},${filed[i + 2]}`);
        return keys.sort();
      };
      const live = [...candidates];
      for (let round = 0; round < PLAYERS * 2; round++) {
        for (let player = 0; player < PLAYERS; player++) {
          const fresh = new InteractionCellIndex(sim.world, ctx, terrain, live);
          expect(filedKeys(index, player), `round ${round} player ${player}`).toEqual(
            filedKeys(fresh, player),
          );
        }
        // A candidate leaves on even rounds; on odd ones only owners change, which the index learns from
        // the Owner journals alone. Each must reach the held reads.
        if (round % 2 === 0) index.remove(live.splice(roll(live.length), 1)[0] as Entity);
        const handed = live[roll(live.length)] as Entity;
        sim.world.add(handed, Owner, { player: roll(PLAYERS) });
        const freed = live[roll(live.length)] as Entity;
        if (sim.world.has(freed, Owner)) sim.world.remove(freed, Owner);
      }
    },
  );

  it.each([13])(
    "asks a short list's gate only for a candidate that beats the best so far (seed %i)",
    (seed) => {
      const { sim, terrain, ctx, candidates, roll } = world(seed);
      // Under the ring threshold, so the linear scan answers both kinds.
      const doors = candidates.filter((e) => sim.world.has(e, Building)).slice(0, SHORT_LIST);
      const loose = candidates.filter((e) => !sim.world.has(e, Building)).slice(0, SHORT_LIST);
      const index = new InteractionCellIndex(sim.world, ctx, terrain, [...doors, ...loose]);
      const asked: NodeId[] = [];
      const gate: SpatialGate = {
        bounds: { minX: 0, maxX: NODES_W, minY: 0, maxY: NODES_H },
        allowsNode: (n) => {
          asked.push(n);
          return true;
        },
      };
      const accept = (e: Entity): Qualified<number> => ({ payload: e });
      for (let q = 0; q < QUERIES; q++) {
        const here = terrain.nodeAt(roll(NODES_W), roll(NODES_H));
        for (const [kind, list] of [
          ['door', doors],
          ['loose', loose],
        ] as const) {
          asked.length = 0;
          const found =
            kind === 'door' ? index.nearestDoor(here, accept, gate) : index.nearestLoose(here, accept, gate);
          // Every gate passes, so each asked cell became the best: strictly nearer by (distance, cell).
          const order = asked.map((n) => [manhattan(terrain, here, n), n] as const);
          for (let i = 1; i < order.length; i++) {
            const [d, n] = order[i] as readonly [number, NodeId];
            const [pd, pn] = order[i - 1] as readonly [number, NodeId];
            expect(d < pd || (d === pd && n < pn), `${kind} query ${q} ask ${i}`).toBe(true);
          }
          expect(found, `${kind} query ${q}`).toEqual(
            linearWinner(sim, list, here, accept, gate, undefined, undefined),
          );
        }
      }
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
