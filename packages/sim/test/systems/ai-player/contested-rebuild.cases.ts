import { describe, expect, it } from 'vitest';
import { AttackOrder, Engagement, Settler } from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import type { Simulation } from '../../../src/index.js';
import {
  type BuildOrderEntry,
  buildOrderModule,
  REBUILD_DELAY_TICKS,
  SIEGE_RADIUS_NODES,
} from '../../../src/systems/ai-player/index.js';
import { razeBuilding } from '../../../src/systems/lifecycle/cleanup.js';
import {
  aiSim,
  BAKERY_TYPE,
  ctxOf,
  entityOfBuilding,
  HOME_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  MILL_TYPE,
  makeAiSeat,
  placeHq,
  SEAT,
  TOWER_TYPE,
  VIKING,
} from './support.js';

/**
 * Rebuilding under the enemy: nothing is placed while a hostile fighter besieges the seat, and a razed
 * building waits out the rebuild delay from the last decision that saw the attack, so the band that
 * razed it cannot flatten the site again as it rises.
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

describe('build-order module - rebuilding under the enemy', () => {
  const module = buildOrderModule(ORDER);

  it('holds the placement while an enemy fighter engages the seat, and places once he is gone', () => {
    const sim = razedBakerySim();
    const home = placementOf(module.run(sim.world, ctxOf(sim), SEAT));
    expect(home?.buildingType).toBe(BAKERY_TYPE);

    const band = campOn(sim, BAKERY, 1);
    for (const man of band.men) sim.world.add(man, Engagement, { repathAt: 0 });
    expect(module.run(sim.world, ctxOf(sim), SEAT)).toEqual([]);

    for (const man of band.men) sim.world.destroy(man);
    expect(placementOf(module.run(sim.world, ctxOf(sim), SEAT))).toEqual(home);
  });

  it('holds while a far fighter carries an attack order on the seat, not while he only stands far off', () => {
    const sim = razedBakerySim();
    const far = { x: HQ_X - SIEGE_RADIUS_NODES - 4, y: HQ_Y };
    const band = campOn(sim, far, 1);
    expect(placementOf(module.run(sim.world, ctxOf(sim), SEAT))?.buildingType).toBe(BAKERY_TYPE);

    for (const man of band.men) {
      sim.world.add(man, AttackOrder, { target: entityOfBuilding(sim, HQ_TYPE) });
    }
    expect(module.run(sim.world, ctxOf(sim), SEAT)).toEqual([]);
  });

  it('waits the full rebuild delay from the last decision that saw the attack', () => {
    const sim = razedBakerySim();
    makeAiSeat(sim, SEAT);
    const decide = (tick: number): readonly Command[] => module.run(sim.world, ctxOf(sim, tick), SEAT);
    // Stand the bakery back up so the list completes and the frontier passes it, then lose it again.
    const home = placementOf(decide(0));
    if (home === null) throw new Error('expected the bakery placed');
    place(sim, BAKERY_TYPE, home);
    sim.step();
    expect(decide(0)).toEqual([]);
    razeBuilding(sim.world, ctxOf(sim), entityOfBuilding(sim, BAKERY_TYPE));

    const band = campOn(sim, BAKERY);
    const lastAttacked = 2 * REBUILD_DELAY_TICKS;
    expect(decide(0)).toEqual([]);
    expect(decide(lastAttacked)).toEqual([]); // past the first delay, but still besieged

    for (const man of band.men) sim.world.destroy(man);
    expect(decide(lastAttacked + REBUILD_DELAY_TICKS - 1)).toEqual([]);
    expect(placementOf(decide(lastAttacked + REBUILD_DELAY_TICKS))).toEqual({
      ...home,
      buildingType: BAKERY_TYPE,
    });
  });

  it('holds a tower coverage placement while the seat is attacked', () => {
    const coverage = buildOrderModule([{ kind: 'towerCoverage', building: 'tower_01' }]);
    const sim = aiSim();
    placeHq(sim);
    // An outlying home outside the HQ's circle arms the coverage entry.
    place(sim, HOME_TYPE, { x: HQ_X + 31, y: HQ_Y });
    sim.step();
    const band = campOn(sim, { x: HQ_X, y: HQ_Y + 4 }, 1);
    expect(coverage.run(sim.world, ctxOf(sim), SEAT)).toEqual([]);

    for (const man of band.men) sim.world.destroy(man);
    expect(placementOf(coverage.run(sim.world, ctxOf(sim), SEAT))?.buildingType).toBe(TOWER_TYPE);
  });
});
