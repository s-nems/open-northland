import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng.js';
import { Simulation } from '../../src/index.js';
import { hexDistanceBetween } from '../../src/nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { nearestFreeInBand } from '../../src/systems/conflict/chase.js';
import type { WeaponBand } from '../../src/systems/conflict/weapon-band.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

// The chase's free-cell search walks the rings around the chaser before the band; its answer must be the
// band walk's: the nearest free cell by (map points from the chaser, cell id), and whether any band cell
// is open and reachable.

const MAP_NODES = 48;
const CASES = 1500;
/** The bands the chase asks for: melee contact, its second rank, and a long bow's standoff. */
const BANDS: readonly WeaponBand[] = [
  { minRange: 1, maxRange: 1 },
  { minRange: 1, maxRange: 2 },
  { minRange: 3, maxRange: 3 },
  { minRange: 4, maxRange: 21 },
];
/** Out of 100: how much of the ground is open, reachable, and already taken. */
const OPEN_PERCENT = 85;
const REACHABLE_PERCENT = 90;
const TAKEN_PERCENT = 60;
/** How far off the lattice a target may sit, so bands clip at the map edge. */
const EDGE_SLACK = 4;
/** How far from the target a chaser may stand, inside the band and well past it. */
const CHASER_SPREAD = 30;
const SEED = 7;

/** Every lattice node, by brute force: the reference the ring walk must agree with. */
function reference(
  terrain: TerrainGraph,
  from: NodeId,
  target: NodeId,
  band: WeaponBand,
  open: (cell: NodeId) => boolean,
  taken: (cell: NodeId) => boolean,
): { free: NodeId | null; anyOpen: boolean } {
  const fx = terrain.xOf(from);
  const fy = terrain.yOf(from);
  const tx = terrain.xOf(target);
  const ty = terrain.yOf(target);
  let free: NodeId | null = null;
  let freeDist = Number.POSITIVE_INFINITY;
  let anyOpen = false;
  for (let hy = 0; hy < terrain.height; hy++) {
    for (let hx = 0; hx < terrain.width; hx++) {
      const reach = hexDistanceBetween(tx, ty, hx, hy);
      const cell = terrain.nodeAt(hx, hy);
      if (reach < band.minRange || reach > band.maxRange || !open(cell)) continue;
      anyOpen = true;
      if (taken(cell)) continue;
      const d = hexDistanceBetween(fx, fy, hx, hy);
      if (d < freeDist || (d === freeDist && free !== null && cell < free)) {
        free = cell;
        freeDist = d;
      }
    }
  }
  return { free, anyOpen };
}

describe('nearestFreeInBand', () => {
  it('answers what a walk over every node of the band answers', () => {
    const s = new Simulation({ seed: SEED, content: testContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('the scene has a map');
    const rng = new Rng(SEED);
    const clamp = (v: number): number => Math.min(MAP_NODES - 1, Math.max(0, v));
    for (let i = 0; i < CASES; i++) {
      const band = BANDS[i % BANDS.length] ?? { minRange: 1, maxRange: 1 };
      const openSet = new Set<NodeId>();
      const reachSet = new Set<NodeId>();
      const takenSet = new Set<NodeId>();
      // Sparse layouts too, so some bands hold no free cell and some no open one.
      const density = rng.int(4) === 0 ? rng.int(OPEN_PERCENT) : OPEN_PERCENT;
      for (let n = 0; n < MAP_NODES * MAP_NODES; n++) {
        const cell = n as NodeId;
        if (rng.int(100) < density) openSet.add(cell);
        if (rng.int(100) < REACHABLE_PERCENT) reachSet.add(cell);
        if (rng.int(100) < TAKEN_PERCENT) takenSet.add(cell);
      }
      const tx = clamp(rng.int(MAP_NODES + 2 * EDGE_SLACK) - EDGE_SLACK);
      const ty = clamp(rng.int(MAP_NODES + 2 * EDGE_SLACK) - EDGE_SLACK);
      const target = terrain.nodeAt(tx, ty);
      const from = terrain.nodeAt(
        clamp(tx + rng.int(2 * CHASER_SPREAD + 1) - CHASER_SPREAD),
        clamp(ty + rng.int(2 * CHASER_SPREAD + 1) - CHASER_SPREAD),
      );
      const goal = rng.int(2) === 0 ? undefined : terrain.nodeAt(rng.int(MAP_NODES), rng.int(MAP_NODES));
      const mine = { goal, standingOn: rng.int(2) === 0 ? undefined : from };
      const slots = {
        isOpen: (cell: NodeId): boolean => openSet.has(cell),
        isTaken: (cell: NodeId, ownGoal: NodeId | undefined, standingOn?: NodeId): boolean =>
          takenSet.has(cell) && cell !== ownGoal && cell !== standingOn,
      };
      const reachable = (cell: NodeId): boolean => reachSet.has(cell);
      const got = nearestFreeInBand(terrain, from, target, band, slots, mine, reachable);
      const want = reference(
        terrain,
        from,
        target,
        band,
        (cell) => slots.isOpen(cell) && reachable(cell),
        (cell) => slots.isTaken(cell, mine.goal, mine.standingOn),
      );
      expect(got, `case ${i}`).toEqual(want);
    }
  });
});
