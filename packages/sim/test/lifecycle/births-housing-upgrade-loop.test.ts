import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import { Building, Carrying, Position, Settler, Stockpile } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  fx,
  ONE,
  populationWithinHousing,
  type SimEvent,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import {
  housingCapacity,
  NEWBORN_AGE_CLASS,
  type SystemContext,
  tribePopulation,
} from '../../src/systems/index.js';

/**
 * GAME-LEVEL (e2e) — the full births → housing → upgrade → more-births loop, the Phase-3 exit ("a
 * self-sustaining, progressing single-tribe settlement you can grow"). Every slice (births fill spare
 * housing; a built home accumulating its next-tier cost levels up; carriers deliver that cost) is
 * proven in isolation elsewhere, each calling ONE system directly. This proves they COMPOSE under the
 * real `Simulation.step()` schedule over many ticks: a level-0 home (capacity 3) births into its spare
 * slot; carriers haul the next tier's cost in; the home upgrades to level 1 (capacity 5); and the
 * ReproductionSystem then fills the NEW slots — the loop closing on itself, end-to-end, with the
 * population-within-housing invariant never breached at any tick.
 *
 * Built with `parseContentSet` (not the shared fixture) so the home chain + per-tier `construction`
 * cost are explicit; the golden slice (no `home`-kind building) is untouched.
 */

const VIKING = 1;
const STONE = 1;
const GRASS = 0;
const CARRIER = 36; // a job with no harvest atomics — it only hauls a load it already carries

// The home level chain: two consecutive `home` typeIds. HOME_L0 (capacity 3) upgrades to HOME_L1
// (capacity 5) by accumulating L1's construction cost (2 stone). HOME_L1 is the top tier here.
// Capacities exceed the two seeded carrier-settlers (every settler is a housed mouth, carriers
// included), leaving spare room for births at each tier so the loop is visible — and the
// population-within-housing invariant holds throughout (it never overshoots the growing ceiling).
const HOME_L0 = 2;
const HOME_L1 = 3;

function loopContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: CARRIER, id: 'carrier' },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: HOME_L0,
        id: 'home_level_00',
        kind: 'home',
        homeSize: 3,
        construction: [{ goodType: STONE, amount: 1 }],
      },
      {
        typeId: HOME_L1,
        id: 'home_level_01',
        kind: 'home',
        homeSize: 5,
        // Upgrading INTO L1 costs 2 stone (the next-tier cost a built L0 must accumulate).
        construction: [{ goodType: STONE, amount: 2 }],
      },
    ],
  });
}

function grassMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
}

// Clear EVERY component store — the module-level singleton stores are shared across Simulation
// instances (AGENTS.md [ac6a287]/[f4593c4]); a missed store leaks a prior test's entity, which
// (a stale Health/CurrentAtomic on a reused id) silently diverts a planner/carrier decision.
beforeEach(clearComponentStores);

function clearComponentStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c && c.store instanceof Map) {
      c.store.clear();
    }
  }
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

/** A fully-BUILT level-0 home at a map tile (the births anchor + the upgrade-materials delivery sink). */
function builtHomeAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HOME_L0, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map<number, number>() });
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

/** All `settlerBorn` events this tick (cleared each tick — accumulate across a loop, docs/AGENTS [8addb28]). */
function bornThisTick(sim: Simulation): readonly SimEvent[] {
  return sim.events.current().filter((ev) => ev.kind === 'settlerBorn');
}

/** Count of this tribe's settlers that are newborn babies (the births, distinct from the carriers). */
function babyCount(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Settler)) {
    const s = sim.world.get(e, Settler);
    if (s.tribe === VIKING && s.jobType === NEWBORN_AGE_CLASS) n++;
  }
  return n;
}

describe('e2e: the births → housing → upgrade → more-births loop (full step schedule)', () => {
  it('a level-0 home fills with births, upgrades on delivered materials, then fills the new capacity', () => {
    const sim = new Simulation({ seed: 2, content: loopContent(), map: grassMap(6, 1) });
    const home = builtHomeAt(sim, 3, 0); // L0: shelters 3
    // Two carriers each holding one stone — together L1's 2-stone upgrade cost. (They are VIKING
    // settlers, so they count as 2 of the housed population; capacity 3 leaves room for 1 birth.)
    loadedCarrierAt(sim, 0, 0, STONE, 1);
    loadedCarrierAt(sim, 5, 0, STONE, 1);

    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(3); // L0 capacity
    expect(tribePopulation(sim.world, VIKING)).toBe(2); // the two carriers, pre-birth

    // Run the real schedule. Reproduction fills the home's spare slot; carriers deliver the upgrade
    // cost; the constructionSystem levels the home up; reproduction then fills the larger home's new
    // slots — all in one continuous run, the population never overshooting the (growing) ceiling.
    const inv = populationWithinHousing(sim.content);
    let totalBirths = 0;
    let upgraded = false;
    for (let i = 0; i < 200; i++) {
      sim.step();
      totalBirths += bornThisTick(sim).length;
      // The births never overshoot the (growing) housing ceiling at any tick — the gate self-limits.
      expect(inv(sim.world)).toEqual([]);
      if (sim.world.get(home, Building).buildingType === HOME_L1) upgraded = true;
    }

    // The home upgraded a tier on the delivered materials.
    expect(upgraded).toBe(true);
    expect(sim.world.get(home, Building).buildingType).toBe(HOME_L1);
    expect(sim.world.get(home, Building).level).toBe(1);
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(5); // L1 shelters 5 (was 3)

    // The loop filled BOTH ceilings: 1 birth into L0's spare slot (pop 2→3), then 2 more after the
    // upgrade opened L1's two extra slots (pop 3→5). Babies don't grow up within this window
    // (GROWUP_TICKS ≫ 200), so each birth permanently occupies a slot — exactly 3 births total.
    expect(totalBirths).toBe(3);
    expect(babyCount(sim)).toBe(3); // three babies now occupy the (grown) home
    expect(tribePopulation(sim.world, VIKING)).toBe(5); // 2 carriers + 3 babies = the full L1 capacity

    // The upgrade consumed the delivered stone; both carriers unloaded (no undeliverable load left).
    expect(sim.world.get(home, Stockpile).amounts.get(STONE) ?? 0).toBe(0);
    for (const e of sim.world.query(Settler)) {
      if (sim.world.get(e, Settler).jobType === CARRIER) expect(sim.world.has(e, Carrying)).toBe(false);
    }
  });

  it('the population never exceeds capacity when no upgrade lands (the gate self-limits)', () => {
    // No carriers: the home never gets its upgrade cost, so capacity stays at 3 and births stop at
    // exactly the 3-baby L0 ceiling — the reproduction gate is self-limiting against the L0 capacity.
    const sim = new Simulation({ seed: 1, content: loopContent(), map: grassMap(4, 1) });
    builtHomeAt(sim, 2, 0);
    const inv = populationWithinHousing(sim.content);
    for (let i = 0; i < 60; i++) {
      sim.step();
      expect(inv(sim.world)).toEqual([]); // never overshoots capacity 3
      expect(tribePopulation(sim.world, VIKING)).toBeLessThanOrEqual(3);
    }
    expect(tribePopulation(sim.world, VIKING)).toBe(3); // filled to the L0 ceiling and stopped
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(3); // still L0 — never upgraded
  });

  it('is deterministic — two same-seed loop runs reach the same final state hash', () => {
    const run = (): string => {
      clearComponentStores();
      const sim = new Simulation({ seed: 9, content: loopContent(), map: grassMap(6, 1) });
      builtHomeAt(sim, 3, 0);
      loadedCarrierAt(sim, 0, 0, STONE, 1);
      loadedCarrierAt(sim, 5, 0, STONE, 1);
      for (let i = 0; i < 150; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
