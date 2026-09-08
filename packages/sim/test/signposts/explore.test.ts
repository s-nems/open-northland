import { describe, expect, it } from 'vitest';
import {
  addPerson,
  ExploreOrder,
  FOG_MODE,
  Health,
  MoveGoal,
  Owner,
  Position,
  Stance,
} from '../../src/components/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { FOG_STATE } from '../../src/systems/vision/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * The scout's "Explore" order: it sweeps the unexplored ground around a chosen centre, one leg at a
 * time, and retires once nothing inside the circle is hidden any more.
 */

const VIKING = 1;
const SCOUT_JOB = 27;
const WOODCUTTER = 1;
const P0 = 0;

function simWithFog(w = 24, h = 8): Simulation {
  const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(w, h) });
  sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.REVEAL });
  return sim;
}

function scoutAt(sim: Simulation, x: number, y: number, jobType: number = SCOUT_JOB): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, Health, { hitpoints: 2000, max: 2000 });
  sim.world.add(e, Owner, { player: P0 });
  sim.world.add(e, Stance, { mode: MILITARY_MODE.IGNORE, anchorCell: null });
  return e;
}

/** How many cells of the map `P0` has never seen. */
function unexploredCells(sim: Simulation): number {
  const fog = sim.fog;
  if (fog === undefined) throw new Error('mapless sim');
  let count = 0;
  for (let r = 0; r < fog.cellsHigh; r++) {
    for (let c = 0; c < fog.cellsWide; c++) {
      if (fog.stateAt(P0, c, r) === FOG_STATE.UNEXPLORED) count++;
    }
  }
  return count;
}

describe('exploreArea - the scout sweep', () => {
  it('walks the scout at unexplored ground and reveals it', () => {
    const sim = simWithFog();
    const scout = scoutAt(sim, 1, 1);
    sim.step();
    const before = unexploredCells(sim);

    sim.enqueueSetup({ kind: 'exploreArea', entity: scout, x: 30, y: 6 });
    sim.step();
    expect(sim.world.has(scout, ExploreOrder)).toBe(true);
    expect(sim.world.has(scout, MoveGoal)).toBe(true);

    for (let i = 0; i < 400 && sim.world.has(scout, ExploreOrder); i++) sim.step();
    expect(unexploredCells(sim)).toBeLessThan(before);
  });

  it('retires the order once the circle holds nothing unseen', () => {
    const sim = simWithFog(6, 4);
    const scout = scoutAt(sim, 2, 1);
    sim.step(); // the first tick is what switches the fog on, and an unlit map hides nothing

    sim.enqueueSetup({ kind: 'exploreArea', entity: scout, x: 4, y: 2 });
    for (let i = 0; i < 400 && sim.world.has(scout, ExploreOrder); i++) sim.step();

    expect(sim.world.has(scout, ExploreOrder)).toBe(false);
    expect(unexploredCells(sim)).toBe(0);
  });

  it('refuses a trade that is not a scout, and a walk order calls the sweep off', () => {
    const sim = simWithFog();
    const digger = scoutAt(sim, 1, 1, WOODCUTTER);
    sim.step();
    sim.enqueueSetup({ kind: 'exploreArea', entity: digger, x: 20, y: 6 });
    sim.step();
    expect(sim.world.has(digger, ExploreOrder)).toBe(false);

    const scout = scoutAt(sim, 1, 1);
    sim.enqueueSetup({ kind: 'exploreArea', entity: scout, x: 20, y: 6 });
    sim.step();
    expect(sim.world.has(scout, ExploreOrder)).toBe(true);
    sim.enqueueSetup({ kind: 'moveUnit', entity: scout, x: 2, y: 2 });
    sim.step();
    expect(sim.world.has(scout, ExploreOrder)).toBe(false);
  });
});
