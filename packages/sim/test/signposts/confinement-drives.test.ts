import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  JobAssignment,
  MoveGoal,
  Owner,
  Position,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import { type Fixed, fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * Signpost confinement over the AUTONOMOUS drives: with `setSignpostNavigation` on, every searched
 * target — a needs satisfier (food store / temple), a hauler pickup (ground pile / workplace output),
 * a carried-load sink, and a job opening — is gated to the settler's allowed area, while an in-area
 * twin of the same target is still taken. Source basis: observed original guidepost behaviour
 * (settlers do not act outside the network); each drive's confinement is the same shared
 * `navigationLimitFor` rule the move-order/gatherer tests pin (see navigation.test.ts).
 *
 * Geometry: LOCAL radius 24 nodes = 12 tiles E/W. IN-AREA fixtures sit at tile 6; OUT-OF-AREA ones at
 * tile 40 on a 192-tile strip, far beyond the local circle with no signposts to extend it.
 */

const VIKING = 1;
const WOODCUTTER = 1;
const CARPENTER = 2; // the sawmill's worker job
const CARRIER = 24; // the original's real carrier id — 36 (the golden fixture's) sits inside the
// soldier band 31..41 and would be confinement-EXEMPT as a fighter, defeating these tests
const HEADQUARTERS = 1; // passive store: food + plank slots, a carrier transport slot
const SAWMILL = 2; // workplace: recipe wood→plank, one carpenter slot
const TEMPLE_TYPE = 3;
const PLANK = 2;
const FOOD = 3;
const IN_AREA = 6;
const OUT_OF_AREA = 40;
// Just over the ¾·ONE needs threshold — enough to trigger the eat/pray drive on the next tick.
const URGENT: Fixed = fx.add(fx.div(fx.mul(ONE, fx.fromInt(3)), fx.fromInt(4)), fx.fromInt(1) as Fixed);

function confinedSim(): Simulation {
  const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(192, 8) });
  sim.enqueue({ kind: 'setSignpostNavigation', enabled: true });
  sim.step();
  return sim;
}

function ownedSettler(
  sim: Simulation,
  x: number,
  y: number,
  jobType: number | null,
  needs: { hunger?: Fixed; piety?: Fixed } = {},
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: needs.hunger ?? fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: needs.piety ?? fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player: 0 });
  return e;
}

function buildingAt(sim: Simulation, buildingType: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  return e;
}

function storeAt(sim: Simulation, x: number, y: number, amounts: readonly [number, number][]): Entity {
  const e = buildingAt(sim, HEADQUARTERS, x, y);
  sim.world.add(e, Stockpile, { amounts: new Map(amounts) });
  return e;
}

/** A sawmill workplace (its planner rungs read a Stockpile, so every fixture mill carries one). */
function sawmillAt(sim: Simulation, x: number, y: number, planks = 0): Entity {
  const e = buildingAt(sim, SAWMILL, x, y);
  sim.world.add(e, Stockpile, { amounts: new Map(planks > 0 ? [[PLANK, planks]] : []) });
  return e;
}

/** A loose ground pile (Stockpile + Position, no Building) — a porter's pickup target. */
function pileAt(sim: Simulation, x: number, y: number, goodType: number, amount: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map([[goodType, amount]]) });
  return e;
}

/** Whether the settler committed to anything this tick — a walk or an atomic. */
function acted(sim: Simulation, e: Entity): boolean {
  return sim.world.has(e, MoveGoal) || sim.world.has(e, CurrentAtomic);
}

describe('confinement gates the needs satisfiers', () => {
  it('a hungry settler ignores an out-of-area food store but reaches an in-area one', () => {
    const sim = confinedSim();
    const u = ownedSettler(sim, 2, 2, WOODCUTTER, { hunger: URGENT });
    storeAt(sim, OUT_OF_AREA, 2, [[FOOD, 5]]);
    sim.step();
    expect(acted(sim, u)).toBe(false); // no known food — the need falls through to (absent) work

    storeAt(sim, IN_AREA, 2, [[FOOD, 5]]);
    sim.step();
    expect(acted(sim, u)).toBe(true); // the in-area larder is a known target
  });

  it('a devout settler ignores an out-of-area temple but reaches an in-area one', () => {
    const sim = confinedSim();
    const u = ownedSettler(sim, 2, 2, WOODCUTTER, { piety: URGENT });
    buildingAt(sim, TEMPLE_TYPE, OUT_OF_AREA, 2);
    sim.step();
    expect(acted(sim, u)).toBe(false);

    buildingAt(sim, TEMPLE_TYPE, IN_AREA, 2);
    sim.step();
    expect(acted(sim, u)).toBe(true);
  });
});

describe('confinement gates the hauler pickups', () => {
  it('a porter leaves an out-of-area ground pile but fetches an in-area one', () => {
    const sim = confinedSim();
    const hq = storeAt(sim, 2, 2, []);
    const porter = ownedSettler(sim, 2, 2, CARRIER);
    sim.world.add(porter, JobAssignment, { workplace: hq });
    pileAt(sim, OUT_OF_AREA, 2, PLANK, 3);
    sim.step();
    expect(sim.world.has(porter, MoveGoal)).toBe(false);

    pileAt(sim, IN_AREA, 2, PLANK, 3);
    sim.step();
    expect(sim.world.has(porter, MoveGoal)).toBe(true);
  });

  it('a store carrier leaves an out-of-area workplace output but hauls an in-area one', () => {
    const sim = confinedSim();
    const hq = storeAt(sim, 2, 2, []); // the plank sink (its slot makes the output deliverable)
    const carrier = ownedSettler(sim, 2, 2, CARRIER);
    sim.world.add(carrier, JobAssignment, { workplace: hq });
    sawmillAt(sim, OUT_OF_AREA, 2, 2);
    sim.step();
    expect(sim.world.has(carrier, MoveGoal)).toBe(false);

    sawmillAt(sim, IN_AREA, 2, 2);
    sim.step();
    expect(sim.world.has(carrier, MoveGoal)).toBe(true);
  });
});

describe('confinement gates the carried-load delivery sink', () => {
  it('a loaded settler holds its load when the only capable store is out of area', () => {
    const sim = confinedSim();
    const u = ownedSettler(sim, 2, 2, WOODCUTTER);
    sim.world.add(u, Carrying, { goodType: PLANK, amount: 1 });
    storeAt(sim, OUT_OF_AREA, 2, []);
    sim.step();
    expect(sim.world.has(u, MoveGoal)).toBe(false); // no in-area sink — the no-sink branch holds the load
    expect(sim.world.get(u, Carrying).amount).toBe(1);

    storeAt(sim, IN_AREA, 2, []);
    sim.step();
    expect(sim.world.has(u, MoveGoal)).toBe(true); // the in-area store is a known sink
  });
});

describe('confinement gates job assignment', () => {
  it('an idle settler is not employed by an out-of-area workplace, but takes an in-area one', () => {
    const sim = confinedSim();
    const idle = ownedSettler(sim, 2, 2, null);
    sawmillAt(sim, OUT_OF_AREA, 2);
    sim.step();
    expect(sim.world.get(idle, Settler).jobType).toBeNull();

    sawmillAt(sim, IN_AREA, 2);
    sim.step();
    expect(sim.world.get(idle, Settler).jobType).toBe(CARPENTER);
  });

  it('assignWorker to an out-of-area building is refused like an out-of-area move order', () => {
    const sim = confinedSim();
    const u = ownedSettler(sim, 2, 2, WOODCUTTER);
    const far = sawmillAt(sim, OUT_OF_AREA, 2);
    sim.enqueue({ kind: 'assignWorker', entity: u, building: far, jobPriority: [CARPENTER] });
    sim.step();
    expect(sim.world.has(u, JobAssignment)).toBe(false);

    const near = sawmillAt(sim, IN_AREA, 2);
    sim.enqueue({ kind: 'assignWorker', entity: u, building: near, jobPriority: [CARPENTER] });
    sim.step();
    expect(sim.world.get(u, JobAssignment).workplace).toBe(near);
  });
});
