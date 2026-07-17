import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Carrying, Position, Settler, Stockpile } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { housingCapacity } from '../../src/systems/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap as grassMap } from '../fixtures/terrain.js';

/**
 * GAME-LEVEL (e2e) — the housing → upgrade loop under the real `Simulation.step()` schedule: the
 * `upgradeBuilding` command re-opens a built level-0 home as an upgrade site, carriers deliver the
 * level DIFFERENCE and a builder hammers it out, and the tribe's housing capacity grows with the
 * finished tier. (Births are no longer capacity-driven — they come from the family mechanics, proven
 * in test/family/ — so this covers the command→delivery→build→capacity half of the old loop.)
 *
 * Built with `parseContentSet` (not the shared fixture) so the home chain + per-tier `construction`
 * cost are explicit; the golden slice (no `home`-kind building) is untouched.
 */

const VIKING = 1;
const STONE = 1;
const GRASS = 0;
const CARRIER = 36; // a job with no harvest atomics — it only hauls a load it already carries
const BUILDER = 7; // the builder trade (jobtypes.ini type 7); permitted to run the build-house atomic
const BUILD_HOUSE_ATOMIC = 39; // setatomic 7 39 "..._builder_build_house" (tribetypes.ini)

// The home level chain: HOME_L0 (capacity 3) upgrades to HOME_L1 (capacity 5) at L1's own cost (2 stone).
const HOME_L0 = 2;
const HOME_L1 = 3;

function loopContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: CARRIER, id: 'carrier' },
      { typeId: BUILDER, id: 'builder', allowedAtomics: [BUILD_HOUSE_ATOMIC] },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: HOME_L0,
        id: 'home_level_00',
        kind: 'home',
        homeSize: 3,
        construction: [{ goodType: STONE, amount: 1 }],
        upgradeTarget: HOME_L1,
      },
      {
        typeId: HOME_L1,
        id: 'home_level_01',
        kind: 'home',
        homeSize: 5,
        // Upgrading into L1 costs 2 stone (its own per-tier cost — the difference).
        construction: [{ goodType: STONE, amount: 2 }],
      },
    ],
  });
}

/** A fully-BUILT level-0 home at a map tile (the upgrade-materials delivery sink). */
function builtHomeAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HOME_L0, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map<number, number>() });
  return e;
}

/** A builder settler placed at a tile — the trade that hammers the upgrade site out. */
function builderAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: BUILDER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  return e;
}

/** A carrier already holding a unit of `goodType` — the haul a producing workplace would have handed it. */
function loadedCarrierAt(sim: Simulation, x: number, y: number, goodType: number, amount: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: CARRIER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Carrying, { goodType, amount });
  return e;
}

describe('e2e: the housing → upgrade loop (full step schedule)', () => {
  it('the upgrade command turns a level-0 home into a served site and its capacity grows on completion', () => {
    const sim = new Simulation({ seed: 2, content: loopContent(), map: grassMap(8, 1) });
    const home = builtHomeAt(sim, 3, 0); // L0: shelters 3
    // Two carriers each holding one stone — together L1's 2-stone difference — and a builder to hammer.
    loadedCarrierAt(sim, 0, 0, STONE, 1);
    loadedCarrierAt(sim, 5, 0, STONE, 1);
    builderAt(sim, 7, 0);

    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(3); // L0 capacity
    sim.enqueue({ kind: 'upgradeBuilding', building: home });
    sim.step();
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(0); // a site shelters no one

    // Run the real schedule: carriers deliver the difference, the builder hammers, the site finishes.
    let upgraded = false;
    for (let i = 0; i < 600 && !upgraded; i++) {
      sim.step();
      upgraded = sim.world.get(home, Building).buildingType === HOME_L1;
    }

    expect(upgraded).toBe(true);
    expect(sim.world.get(home, Building).level).toBe(1);
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(5); // L1 shelters 5 (was 3)

    // The upgrade consumed the delivered stone; both carriers unloaded (no undeliverable load left).
    expect(sim.world.get(home, Stockpile).amounts.get(STONE) ?? 0).toBe(0);
    for (const e of sim.world.query(Settler)) {
      if (sim.world.get(e, Settler).jobType === CARRIER) expect(sim.world.has(e, Carrying)).toBe(false);
    }
  });

  it('is deterministic — two same-seed loop runs reach the same final state hash', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 9, content: loopContent(), map: grassMap(8, 1) });
      const home = builtHomeAt(sim, 3, 0);
      loadedCarrierAt(sim, 0, 0, STONE, 1);
      loadedCarrierAt(sim, 5, 0, STONE, 1);
      builderAt(sim, 7, 0);
      sim.enqueue({ kind: 'upgradeBuilding', building: home });
      for (let i = 0; i < 250; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
