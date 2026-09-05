import { describe, expect, it } from 'vitest';
import { Settler } from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import type { Simulation } from '../../../src/index.js';
import { type BuildOrderEntry, buildOrderModule } from '../../../src/systems/ai-player/index.js';
import { CONTESTED_GROUND_RADIUS_NODES } from '../../../src/systems/conflict/contested-ground.js';
import { razeBuilding } from '../../../src/systems/lifecycle/cleanup.js';
import { aiSim, BAKERY_TYPE, ctxOf, entityOfBuilding, MILL_TYPE, placeHq, SEAT, VIKING } from './support.js';

/**
 * Rebuilding under the enemy: a razed building is re-placed like any other unmet entry, but never onto
 * the ground the army that razed it still stands on - the command would refuse it, and the band would
 * flatten the site again the tick it rose.
 */

const FOE = 3;
const SPEARMAN = 32;
const BAKERY = { x: 34, y: 16 };
const ORDER: readonly BuildOrderEntry[] = [
  { kind: 'place', building: 'work_bakery_00', count: 1 },
  { kind: 'place', building: 'work_mill_00', count: 1 },
];

interface Spot {
  readonly x: number;
  readonly y: number;
}

function place(sim: Simulation, buildingType: number, at: Spot): void {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner: SEAT });
}

function placementOf(commands: readonly Command[]): (Spot & { buildingType: number }) | null {
  const first = commands[0];
  if (first?.kind !== 'placeBuilding') return null;
  return { x: first.x, y: first.y, buildingType: first.buildingType };
}

/** The seat with its bakery just razed, so the next decision is its rebuild. */
function razedBakerySim(): Simulation {
  const sim = aiSim();
  placeHq(sim);
  place(sim, BAKERY_TYPE, BAKERY);
  place(sim, MILL_TYPE, { x: 38, y: 16 });
  sim.step();
  razeBuilding(sim.world, ctxOf(sim), entityOfBuilding(sim, BAKERY_TYPE));
  return sim;
}

/** A hostile band camped over `at`, as the wave that razed it would be. */
function campOn(sim: Simulation, at: Spot, count = 3): { men: Entity[]; spots: Spot[] } {
  const before = new Set(sim.world.query(Settler));
  const spots = Array.from({ length: count }, (_, i) => ({ x: at.x + 2 * i, y: at.y }));
  for (const spot of spots) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: SPEARMAN,
      x: spot.x,
      y: spot.y,
      tribe: VIKING,
      owner: FOE,
    });
  }
  sim.step();
  return { men: [...sim.world.query(Settler)].filter((e) => !before.has(e)), spots };
}

function manhattan(a: Spot, b: Spot): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

describe('build-order module - rebuilding under the enemy', () => {
  const module = buildOrderModule(ORDER);

  it('re-places the razed building off the ground the band holds, and back on its plot once they leave', () => {
    const sim = razedBakerySim();
    const home = placementOf(module.run(sim.world, ctxOf(sim), SEAT));
    expect(home?.buildingType).toBe(BAKERY_TYPE);
    if (home === null) return;
    expect(manhattan(home, BAKERY)).toBeLessThanOrEqual(CONTESTED_GROUND_RADIUS_NODES);

    const band = campOn(sim, BAKERY);
    const elsewhere = placementOf(module.run(sim.world, ctxOf(sim), SEAT));
    expect(elsewhere?.buildingType).toBe(BAKERY_TYPE);
    if (elsewhere === null) return;
    // The search walks on past the band's ground rather than stalling the entry on it.
    for (const spot of band.spots) {
      expect(manhattan(elsewhere, spot)).toBeGreaterThan(CONTESTED_GROUND_RADIUS_NODES);
    }

    for (const man of band.men) sim.world.destroy(man);
    expect(placementOf(module.run(sim.world, ctxOf(sim), SEAT))).toEqual(home);
  });
});
