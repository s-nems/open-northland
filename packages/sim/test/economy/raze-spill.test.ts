import { describe, expect, it } from 'vitest';
import {
  Building,
  Health,
  Position,
  Stockpile,
  setStockAmount,
  Upgrading,
  Vehicle,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import { manhattan } from '../../src/systems/spatial/nodes.js';
import { MAX_GROUND_STACK } from '../../src/systems/stores/index.js';
import { HUT, HUT_FOOTPRINT, mappedSim, terrainOf, VIKING } from '../footprint/building-placement/support.js';

/**
 * A destroyed building leaves its contents on the ground under it, in the ordinary max-5 heaps the ground
 * holds. `razeBuilding` is the one teardown seam the player's demolish and a combat kill share, so both
 * spill alike.
 *
 * The HUT fixture is a footprinted workplace stocking goods 1 and 2; anchored at (5,5) its body is
 * (5,5)+(6,5) with the door at (4,5).
 */

const WOOD = 1;
const PLANK = 2;
const ANCHOR = { x: 5, y: 5 };

interface Heap {
  readonly node: NodeId;
  readonly good: number;
  readonly amount: number;
}

/** Every loose ground heap in the world (a positioned stockpile that is no persistent store), keyed by
 *  its half-cell node - the canonical shape each assertion below reads. */
function heaps(sim: Simulation): Heap[] {
  const terrain = terrainOf(sim);
  const out: Heap[] = [];
  for (const e of sim.world.query(Stockpile, Position)) {
    if (sim.world.has(e, Building) || sim.world.has(e, Vehicle)) continue;
    const p = sim.world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    for (const [good, amount] of sim.world.get(e, Stockpile).amounts) {
      if (amount > 0) out.push({ node: terrain.nodeAt(n.hx, n.hy), good, amount });
    }
  }
  return out.sort((a, b) => a.node - b.node || a.good - b.good);
}

function unitsOf(list: readonly Heap[], good: number): number {
  return list.filter((h) => h.good === good).reduce((sum, h) => sum + h.amount, 0);
}

/** A HUT standing at `at` holding `stock` - placed through the command path, then stocked directly
 *  (the fixture writes past the type's slot capacity to stage a full store). */
function stockedHut(
  sim: Simulation,
  at: { x: number; y: number },
  stock: ReadonlyArray<[number, number]>,
): Entity {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: at.x, y: at.y, tribe: VIKING });
  sim.step();
  const placed = [...sim.world.query(Building)].sort((a, b) => a - b).at(-1);
  if (placed === undefined) throw new Error('the hut was not placed');
  for (const [good, amount] of stock) setStockAmount(sim.world, placed, good, amount);
  return placed;
}

function demolish(sim: Simulation, building: Entity): void {
  sim.enqueueSetup({ kind: 'demolish', building });
  sim.step();
}

describe('a razed building spills its contents on the ground', () => {
  it('leaves every unit it held under it, in heaps of at most MAX_GROUND_STACK', () => {
    const sim = mappedSim();
    const hut = stockedHut(sim, ANCHOR, [
      [WOOD, 7],
      [PLANK, 3],
    ]);

    demolish(sim, hut);

    const spilled = heaps(sim);
    expect(unitsOf(spilled, WOOD)).toBe(7); // nothing goes down with the building
    expect(unitsOf(spilled, PLANK)).toBe(3);
    for (const h of spilled) expect(h.amount).toBeLessThanOrEqual(MAX_GROUND_STACK);
    // One heap per tile, and they lie on the razed plot itself: the anchor tile is taken.
    expect(new Set(spilled.map((h) => h.node)).size).toBe(spilled.length);
    expect(spilled.some((h) => h.node === terrainOf(sim).nodeAt(ANCHOR.x, ANCHOR.y))).toBe(true);
  });

  it('brings a full store down as a field of max-5 heaps, one good per tile', () => {
    const sim = mappedSim();
    const hut = stockedHut(sim, ANCHOR, [
      [WOOD, 23],
      [PLANK, 17],
    ]);

    demolish(sim, hut);

    const spilled = heaps(sim);
    expect(unitsOf(spilled, WOOD)).toBe(23);
    expect(unitsOf(spilled, PLANK)).toBe(17);
    // Each good packs into the fewest whole stacks the per-tile cap allows.
    expect(spilled.filter((h) => h.good === WOOD)).toHaveLength(5);
    expect(spilled.filter((h) => h.good === PLANK)).toHaveLength(4);
    expect(new Set(spilled.map((h) => h.node)).size).toBe(spilled.length);
  });

  it('spills the same way when the building is razed in combat', () => {
    const sim = mappedSim();
    const hut = stockedHut(sim, ANCHOR, [[WOOD, 6]]);
    sim.world.add(hut, Health, { hitpoints: 0, max: 10 }); // the CleanupSystem reaps a drained pool

    sim.step();

    expect(sim.world.isAlive(hut)).toBe(false);
    expect(unitsOf(heaps(sim), WOOD)).toBe(6);
  });

  it("spills an upgrading building's stashed inventory along with its build hold", () => {
    const sim = mappedSim();
    const hut = stockedHut(sim, ANCHOR, [[WOOD, 2]]); // mid-upgrade the live stockpile IS the build hold
    sim.world.add(hut, Upgrading, { savedStock: new Map([[PLANK, 4]]), seeded: new Map() });

    demolish(sim, hut);

    const spilled = heaps(sim);
    expect(unitsOf(spilled, WOOD)).toBe(2);
    expect(unitsOf(spilled, PLANK)).toBe(4); // the stash would otherwise vanish with the entity
  });

  it("never buries a heap inside a neighbouring building's walls", () => {
    const sim = mappedSim();
    // A neighbour just outside the first hut's reserved ring, and a load big enough to scatter past it.
    const at = { x: ANCHOR.x + 5, y: ANCHOR.y };
    const neighbour = stockedHut(sim, at, []);
    const hut = stockedHut(sim, ANCHOR, [[WOOD, 400]]);
    const terrain = terrainOf(sim);
    const ruin = terrain.nodeAt(ANCHOR.x, ANCHOR.y);
    // The neighbour's own walls, read off the fixture footprint rather than the overlay the spill uses.
    const walls = HUT_FOOTPRINT.blocked.map((c) => terrain.nodeAt(at.x + c.dx, at.y + c.dy));
    const nearestWall = Math.min(...walls.map((n) => manhattan(terrain, ruin, n)));

    demolish(sim, hut);

    expect(sim.world.isAlive(neighbour)).toBe(true);
    const spilled = heaps(sim);
    expect(unitsOf(spilled, WOOD)).toBe(400); // the whole load still reaches the ground
    // Non-vacuous: the scatter reached past the neighbour, so its walls were candidates to skip.
    expect(Math.max(...spilled.map((h) => manhattan(terrain, ruin, h.node)))).toBeGreaterThan(nearestWall);
    for (const h of spilled) expect(walls).not.toContain(h.node);
  });

  it('places the heaps identically on a repeated run (same seed, same layout)', () => {
    const layout = (): Heap[] => {
      const sim = mappedSim();
      demolish(
        sim,
        stockedHut(sim, ANCHOR, [
          [WOOD, 18],
          [PLANK, 12],
        ]),
      );
      return heaps(sim);
    };
    expect(layout()).toEqual(layout());
  });
});
