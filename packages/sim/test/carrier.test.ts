import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Production,
  Resource,
  Settler,
  Stockpile,
} from '../src/components/index.js';
import type { Entity } from '../src/ecs/world.js';
import { ONE, Simulation, type TerrainMap, fx } from '../src/index.js';
import { type SystemContext, aiSystem } from '../src/systems/index.js';
import { testContent } from './fixtures/content.js';

/**
 * Tests for the minimal CARRIER: an idle settler with nothing to harvest hauls a workplace's
 * finished output goods out to a store that can stock them (goods never teleport — the source
 * stockpile loses exactly what the carrier gains, then the existing carry→pileup chain deposits it).
 *
 * Fixture wiring (see fixtures/content.ts): the SAWMILL (buildingType 2) has recipe wood→plank and a
 * plank output slot; the HEADQUARTERS (buildingType 1) is a passive store with a plank slot (cap 150)
 * and no recipe. So a sawmill that has produced planks is hauled FROM, and the HQ is the delivery TO.
 */

const GRASS = 0;
const WOOD = 1;
const PLANK = 2;
const CARRIER = 36; // fixture job with NO allowedAtomics — it can't harvest, only haul
const SAWMILL = 2; // workplace: recipe wood->plank
const HEADQUARTERS = 1; // passive store with a plank slot
const VIKING = 1;

beforeEach(() => {
  Position.store.clear();
  Settler.store.clear();
  Resource.store.clear();
  Building.store.clear();
  Stockpile.store.clear();
  Carrying.store.clear();
  CurrentAtomic.store.clear();
  MoveGoal.store.clear();
  PathFollow.store.clear();
  PathRequest.store.clear();
  Production.store.clear();
});

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

function carrierAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: CARRIER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    experience: new Map(),
  });
  return e;
}

/** A sawmill (workplace) holding `planks` finished planks ready to be hauled away. */
function sawmillAt(sim: Simulation, x: number, y: number, planks: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: SAWMILL, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[PLANK, planks]]) });
  return e;
}

function hqAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

describe('carrier — choosing what to haul', () => {
  it('sets a MoveGoal to a workplace holding haulable output when empty-handed and not on it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const carrier = carrierAt(sim, 0, 0);
    const mill = sawmillAt(sim, 3, 0, 2); // 2 planks waiting
    hqAt(sim, 4, 0); // a place to deliver them

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(carrier, MoveGoal)).toBe(true);
    expect(sim.world.get(carrier, MoveGoal).cell).toBe(sim.terrain?.cellAt(3, 0));
    void mill;
  });

  it('starts a pickup atomic when standing on a workplace with haulable output', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const carrier = carrierAt(sim, 3, 0);
    const mill = sawmillAt(sim, 3, 0, 2); // same cell
    hqAt(sim, 4, 0);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(carrier, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'pickup', goodType: PLANK, amount: 1, from: mill });
  });

  it('does not haul when there is nowhere to deliver the good', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const carrier = carrierAt(sim, 0, 0);
    sawmillAt(sim, 3, 0, 2); // planks present, but no store to take them
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(carrier, MoveGoal)).toBe(false);
    expect(sim.world.has(carrier, CurrentAtomic)).toBe(false);
  });

  it('never delivers a workplace output back into the producing workplace (no livelock)', () => {
    // The sawmill could nominally stock a plank (it has a plank slot), but it is the PRODUCER, so a
    // carrier carrying planks must not pick the sawmill as the deposit target. With only the sawmill
    // present (no HQ), there is nowhere valid to deliver → nothing is hauled.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const carrier = carrierAt(sim, 0, 0);
    sawmillAt(sim, 3, 0, 2);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(carrier, MoveGoal)).toBe(false);
  });
});

describe('carrier — end-to-end haul through the real schedule', () => {
  it('a carrier moves planks from the sawmill to the HQ (goods conserved)', () => {
    // Strip: carrier@0, sawmill@1 (2 planks), HQ@2. Short hops keep it fast.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const carrier = carrierAt(sim, 0, 0);
    const mill = sawmillAt(sim, 1, 0, 2);
    const hq = hqAt(sim, 2, 0);

    let delivered = 0;
    for (let i = 0; i < 80 && delivered === 0; i++) {
      sim.step();
      delivered = sim.world.get(hq, Stockpile).amounts.get(PLANK) ?? 0;
    }

    expect(delivered).toBe(1); // one unit hauled out and deposited
    // Goods are conserved: 2 planks total — one now in the HQ, one still at the sawmill.
    const atMill = sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0;
    expect(atMill + delivered).toBe(2);
    expect(sim.world.has(carrier, Carrying)).toBe(false); // unloaded at the HQ
  });

  it('empties the sawmill over a longer run — all planks reach the HQ, none created or lost', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const carrier = carrierAt(sim, 0, 0);
    const mill = sawmillAt(sim, 1, 0, 3);
    const hq = hqAt(sim, 2, 0);

    for (let i = 0; i < 400; i++) sim.step();

    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0).toBe(0); // sawmill drained
    expect(sim.world.get(hq, Stockpile).amounts.get(PLANK) ?? 0).toBe(3); // exactly the 3 it held
    expect(sim.world.has(carrier, Carrying)).toBe(false);
  });
});

describe('carrier — determinism', () => {
  it('two same-seed runs of the haul reach the same state hash', () => {
    const run = (): string => {
      Position.store.clear();
      Settler.store.clear();
      Resource.store.clear();
      Building.store.clear();
      Stockpile.store.clear();
      Carrying.store.clear();
      CurrentAtomic.store.clear();
      MoveGoal.store.clear();
      PathFollow.store.clear();
      PathRequest.store.clear();
      Production.store.clear();
      const sim = new Simulation({ seed: 13, content: testContent(), map: grassMap(4, 1) });
      carrierAt(sim, 0, 0);
      sawmillAt(sim, 1, 0, 3);
      hqAt(sim, 2, 0);
      for (let i = 0; i < 120; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
