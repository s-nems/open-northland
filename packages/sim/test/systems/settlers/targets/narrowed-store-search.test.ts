import { describe, expect, it } from 'vitest';
import { Owner, Position, Stockpile, sameSideAs } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition, positionOfNode } from '../../../../src/nav/halfcell.js';
import type { NodeBox, SpatialGate } from '../../../../src/nav/node-circle.js';
import type { NodeId } from '../../../../src/nav/terrain/index.js';
import { Simulation } from '../../../../src/simulation.js';
import { nearBox, QUALIFIES, RING_MIN_BUCKETS } from '../../../../src/systems/settlers/targets/cell-index.js';
import {
  collectTargets,
  firstUnvetoed,
  nearestStoreHolding,
  nearestStoreHoldingWithin,
  storesHoldingRanked,
} from '../../../../src/systems/settlers/targets/index.js';
import { collectSupplyTally } from '../../../../src/systems/stores/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';

// The narrowed equip store search (lending stores filed near the gate, scanned exactly) against the ring
// search it replaces, over the seeker's own, neutral and rival piles, some just inside and just outside
// the gate's box by the filing slack, with fields on both sides of the ring threshold.

const PLAYER = 0;
const RIVAL = 1;
const GOOD = 1;
const NODES_W = 160;
const NODES_H = 100;
const QUERIES = 60;
/** Pile counts per round: a field under the ring threshold, and one past it inside a wide gate. */
const ROUNDS = [
  { piles: 40, boxW: 30, boxH: 20 },
  { piles: 400, boxW: 140, boxH: 90 },
] as const;

function rng(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
}

interface Round {
  readonly sim: Simulation;
  readonly box: NodeBox;
  readonly field: number;
  /** A node inside the box, or a pile's own node, so a seeker may stand on its source. */
  readonly seeker: () => NodeId;
  readonly gate: () => SpatialGate;
}

function buildRound(seed: number, roll: (n: number) => number, round: (typeof ROUNDS)[number]): Round {
  const sim = new Simulation({ seed, content: testContent(), map: grassNodeMap(NODES_W, NODES_H) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('terrain');
  const ctx = ctxOf(sim);
  const cx = 10 + roll(NODES_W - 20);
  const cy = 10 + roll(NODES_H - 20);
  const box: NodeBox = {
    minX: Math.max(0, cx - round.boxW / 2),
    maxX: Math.min(NODES_W - 1, cx + round.boxW / 2),
    minY: Math.max(0, cy - round.boxH / 2),
    maxY: Math.min(NODES_H - 1, cy + round.boxH / 2),
  };
  const slack = collectTargets(sim.world, ctx, terrain).bands.holding(GOOD).filedSlack;
  const pileNodes: NodeId[] = [];
  for (let i = 0; i < round.piles; i++) {
    // Half hug the box edge within a few nodes of the slack; the rest lie anywhere.
    const edge = roll(2) === 0;
    const spread = slack + 2;
    const x = edge ? (roll(2) === 0 ? box.minX : box.maxX) + roll(2 * spread + 1) - spread : roll(NODES_W);
    const y = edge ? box.minY + roll(box.maxY - box.minY + 1) : roll(NODES_H);
    const pile = sim.world.create();
    const nx = Math.min(NODES_W - 1, Math.max(0, x));
    sim.world.add(pile, Position, positionOfNode(nx, y));
    sim.world.add(pile, Stockpile, { amounts: new Map([[GOOD, 1 + roll(3)]]) });
    const side = roll(3);
    if (side < 2) sim.world.add(pile, Owner, { player: side === 0 ? PLAYER : RIVAL });
    if (nearBox(box, nx, y, 0)) pileNodes.push(terrain.nodeAt(nx, y));
  }
  const field = sim.world.canonicalQuery(Stockpile, Position).filter((e) => {
    const p = sim.world.get(e, Position);
    const node = terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y));
    return (
      sim.world.tryGet(e, Owner)?.player !== RIVAL &&
      nearBox(box, terrain.xOf(node), terrain.yOf(node), slack)
    );
  }).length;
  const inBox = (n: NodeId): boolean => nearBox(box, terrain.xOf(n), terrain.yOf(n), 0);
  return {
    sim,
    box,
    field,
    seeker: () =>
      pileNodes.length > 0 && roll(4) === 0
        ? (pileNodes[roll(pileNodes.length)] as NodeId)
        : terrain.nodeAt(box.minX + roll(box.maxX - box.minX + 1), box.minY + roll(box.maxY - box.minY + 1)),
    gate: () =>
      roll(2) === 0
        ? { bounds: box, allowsNode: inBox, mayAllowNear: (x, y, r) => nearBox(box, x, y, r) }
        : { bounds: box, allowsNode: inBox },
  };
}

describe('the narrowed equip store search', () => {
  it.each([1])('picks the ring search winner under a bounded gate (seed %i)', (seed) => {
    const roll = rng(seed);
    for (const round of ROUNDS) {
      const { sim, field, seeker, gate } = buildRound(seed, roll, round);
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('terrain');
      const bands = collectTargets(sim.world, ctxOf(sim), terrain).bands;
      const supply = collectSupplyTally(sim.world);
      const holders = bands.holding(GOOD);
      // The wide round's field is past the ring threshold, so its search takes the rings.
      expect(field > RING_MIN_BUCKETS).toBe(round.piles > RING_MIN_BUCKETS);
      let found = 0;
      const lends = (e: Entity) =>
        (sim.world.get(e, Stockpile).amounts.get(GOOD) ?? 0) > 0 ? QUALIFIES : null;
      for (let q = 0; q < QUERIES; q++) {
        const here = seeker();
        const g = gate();
        const ring = holders.nearest(here, lends, g, undefined, sameSideAs(sim.world, PLAYER));
        expect(nearestStoreHoldingWithin(bands, sim.world, here, GOOD, PLAYER, supply, g), `query ${q}`).toBe(
          ring?.entity ?? null,
        );
        if (ring !== null) found++;
      }
      expect(found).toBeGreaterThan(0);
    }
  });

  // A builder asks once per site which store serves it: each site's own cell veto over one ranking must
  // name the store a fresh search under that veto would.
  it.each([2])(
    'ranks the stores so the first a veto passes is the search winner under it (seed %i)',
    (seed) => {
      const roll = rng(seed);
      for (const round of ROUNDS) {
        const { sim, seeker, gate } = buildRound(seed, roll, round);
        const terrain = sim.terrain;
        if (terrain === undefined) throw new Error('terrain');
        const bands = collectTargets(sim.world, ctxOf(sim), terrain).bands;
        const supply = collectSupplyTally(sim.world);
        let found = 0;
        let vetoedNearest = 0;
        for (let q = 0; q < QUERIES; q++) {
          const here = seeker();
          const g = gate();
          const ranked = storesHoldingRanked(bands, sim.world, here, GOOD, PLAYER, supply, g);
          // Vetoes of growing strength, the strongest passing only a few cells.
          for (const keep of [2, 4, 16]) {
            const salt = roll(keep);
            const avoid = (cell: NodeId): boolean => (cell + salt) % keep !== 0;
            const fresh = nearestStoreHolding(bands, sim.world, here, GOOD, PLAYER, supply, g, avoid);
            expect(firstUnvetoed(ranked, here, avoid)?.entity ?? null, `query ${q} keep ${keep}`).toBe(fresh);
            if (fresh !== null) found++;
            if (fresh !== null && fresh !== ranked[0]?.entity) vetoedNearest++;
          }
        }
        expect(found).toBeGreaterThan(0);
        expect(vetoedNearest).toBeGreaterThan(0);
      }
    },
  );
});
