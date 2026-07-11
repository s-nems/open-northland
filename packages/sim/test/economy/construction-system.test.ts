import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import {
  Building,
  Carrying,
  Health,
  Position,
  Settler,
  Stockpile,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, type SimEvent, Simulation, type TerrainMap, fx, nodeOfPosition } from '../../src/index.js';
import { type SystemContext, constructionSystem, housingCapacity } from '../../src/systems/index.js';

/**
 * Unit + integration tests for the ConstructionSystem — a construction site (`UnderConstruction`) rises to
 * `built = min(builder-work, delivered-material)`, ramping its `Health` with it, and FINISHES (consumes
 * the cost, removes the marker, fills Health, emits `buildingFinished`) the tick its builder work is
 * complete AND every material is present. A free (empty-cost) type finishes at once. A built `home`
 * levels up as its next tier's materials arrive. WHO hammers/delivers is the AI planner (exercised in the
 * builder end-to-end block below); the unit tests drive `labor` by hand to isolate the system.
 *
 * Content is built with `parseContentSet` (not the shared fixture) so the `construction` cost is explicit
 * and the golden slice — whose buildings carry no cost and are placed already-built — is untouched.
 */

const VIKING = 1;
const STONE = 1;
const WOOD = 2;
const HOUSE = 2; // a residence needing 2× stone + 1× wood to build (3 units → 3·STRIKES_PER_UNIT swings)
const HEADQUARTERS = 1; // free — empty construction cost
const GRASS = 0;
const CARRIER = 36; // a job with no harvest atomics — it can only haul a load it already carries
const BUILDER = 7; // the builder trade (jobtypes.ini type 7); permitted to run the build-house atomic
const BUILD_HOUSE_ATOMIC = 39; // setatomic 7 39 "..._builder_build_house" (tribetypes.ini)
const HOUSE_MAX_HP = 100; // the HOUSE fixture's `hitpoints` — small so the ramp is exact-integer to read

// The home level chain — consecutive typeIds, each a larger `home` with its own per-tier upgrade cost.
const HOME_L0 = 2; // home level 00, homeSize 1, upgrades by paying L1's cost
const HOME_L1 = 3; // home level 01, homeSize 2, upgrades by paying L2's cost
const HOME_L2 = 4; // home level 02, homeSize 3 — top tier in this fixture (no typeId 5 home)

function constructionContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
      { typeId: WOOD, id: 'wood' },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: CARRIER, id: 'carrier' },
      // The builder trade: permitted to run the build-house atomic (the data-driven "who constructs"
      // gate the planner reads). No atomic animation is bound, so a build swing takes the default
      // duration — enough to drive the labor loop in the end-to-end test.
      { typeId: BUILDER, id: 'builder', allowedAtomics: [BUILD_HOUSE_ATOMIC] },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      { typeId: HEADQUARTERS, id: 'headquarters', kind: 'headquarters' }, // construction defaults to []
      {
        typeId: HOUSE,
        id: 'home_small',
        kind: 'home',
        homeSize: 2,
        // 2× stone + 1× wood — a repeat in the source good-id list encodes the amount.
        construction: [
          { goodType: STONE, amount: 2 },
          { goodType: WOOD, amount: 1 },
        ],
        hitpoints: HOUSE_MAX_HP, // the life pool the ConstructionSystem ramps up as it rises
        // A 2-cell body (anchor + one cell east) — the footprint the render's construction-plot decal
        // washes grey. Inert for the placement/build tests here (they bypass collision); read only by
        // constructionPlots below.
        footprint: {
          blocked: [
            { dx: 0, dy: 0 },
            { dx: 2, dy: 0 },
          ],
        },
      },
    ],
  });
}

/**
 * A home level chain: three consecutive `home` typeIds of rising `homeSize`, each carrying the cost to
 * BUILD that tier. The level-up trigger pays the NEXT tier's cost: a level-0 home that accumulates
 * HOME_L1's cost upgrades to HOME_L1, etc. HOME_L2 is the top (no typeId-5 home), so it never upgrades.
 */
function levelChainContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
      { typeId: WOOD, id: 'wood' },
    ],
    jobs: [{ typeId: 0, id: 'idle' }],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: HOME_L0,
        id: 'home_level_00',
        kind: 'home',
        homeSize: 1,
        construction: [{ goodType: STONE, amount: 1 }],
      },
      {
        typeId: HOME_L1,
        id: 'home_level_01',
        kind: 'home',
        homeSize: 2,
        construction: [{ goodType: STONE, amount: 2 }],
      },
      // Top tier: bigger, and its own (irrelevant for upgrades — nothing upgrades INTO it past L2) cost.
      {
        typeId: HOME_L2,
        id: 'home_level_02',
        kind: 'home',
        homeSize: 3,
        construction: [{ goodType: WOOD, amount: 1 }],
      },
    ],
  });
}

/** Place a fully-BUILT home of the given tier holding the given stock (the upgrade-materials sink). */
function placeBuiltHome(
  sim: Simulation,
  buildingType: number,
  level: number,
  stock: Record<number, number> = {},
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level });
  sim.world.add(e, Stockpile, {
    amounts: new Map<number, number>(Object.entries(stock).map(([g, n]) => [Number(g), n])),
  });
  return e;
}

function upgradedEvents(sim: Simulation): readonly SimEvent[] {
  return sim.events.current().filter((ev) => ev.kind === 'buildingUpgraded');
}

// Clear EVERY component store — the module-level singleton stores are shared across Simulation
// instances (AGENTS.md [ac6a287]); a store missed here leaks a prior test's entity, which
// (e.g. a stale Health/CurrentAtomic on a reused id) silently diverts the carrier-delivery scan.
beforeEach(clearComponentStores);

function clearComponentStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c && c.store instanceof Map) {
      c.store.clear();
    }
  }
}

function ctxOf(sim: Simulation): SystemContext {
  return { content: sim.content, rng: sim.rng, tick: sim.tick, events: sim.events };
}

/** Place an under-construction building (`built = 0`, labor 0) holding the given starting materials. */
function placeSite(sim: Simulation, buildingType: number, stock: Record<number, number> = {}): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: fx.fromInt(0), level: 0 });
  sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  sim.world.add(e, Stockpile, {
    amounts: new Map<number, number>(Object.entries(stock).map(([g, n]) => [Number(g), n])),
  });
  return e;
}

/** Fully hammer a site — the by-hand stand-in for the build swings a real builder runs, so a unit test
 *  can isolate the ConstructionSystem's completion logic from the planner. */
function fullyHammer(sim: Simulation, site: Entity): void {
  sim.world.get(site, UnderConstruction).labor = ONE;
}

function finishedEvents(sim: Simulation): readonly SimEvent[] {
  return sim.events.current().filter((ev) => ev.kind === 'buildingFinished');
}

describe('constructionSystem', () => {
  it('caps built at the delivered-material fraction however much a builder has hammered', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 1 }); // needs 2 stone + 1 wood, has only 1 of 3 units
    fullyHammer(sim, e); // the builder has done all the work it can — material is the limit now
    constructionSystem(sim.world, ctxOf(sim));
    // built = min(labor=ONE, delivered=1/3) = 1/3 — the site can't rise past what material backs it.
    expect(sim.world.get(e, Building).built).toBe(fx.div(ONE, fx.fromInt(3)));
    expect(finishedEvents(sim)).toHaveLength(0);
    // The partial materials are NOT consumed — the site keeps waiting on the rest.
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(1);
    expect(sim.world.has(e, UnderConstruction)).toBe(true); // still a site
  });

  it('does NOT finish a fully-stocked site with no builder work — labor is required', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 2, [WOOD]: 1 }); // every material present, labor still 0
    constructionSystem(sim.world, ctxOf(sim));
    // built = min(labor=0, delivered=ONE) = 0 — material alone never raises a building; a builder must
    // hammer it. This is the behaviour the whole feature adds.
    expect(sim.world.get(e, Building).built).toBe(fx.fromInt(0));
    expect(finishedEvents(sim)).toHaveLength(0);
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(2); // untouched — not consumed
  });

  it('finishes a site once fully hammered AND every material is present, consuming the materials', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 2, [WOOD]: 1 });
    fullyHammer(sim, e);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(ONE); // built
    expect(finishedEvents(sim)).toEqual([{ kind: 'buildingFinished', entity: e }]);
    expect(sim.world.has(e, UnderConstruction)).toBe(false); // a finished building is a plain Building
    // The materials are spent into the structure.
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(0);
    expect(sim.world.get(e, Stockpile).amounts.get(WOOD)).toBe(0);
  });

  it('leaves any surplus material beyond the cost in the stockpile', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 5, [WOOD]: 3 }); // cost 2 stone + 1 wood
    fullyHammer(sim, e);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(ONE);
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(3); // 5 - 2
    expect(sim.world.get(e, Stockpile).amounts.get(WOOD)).toBe(2); // 3 - 1
  });

  it('ramps the site Health up with built, then fills it at completion', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HOUSE, { [STONE]: 2, [WOOD]: 1 }); // fully stocked (delivered = ONE)
    sim.world.add(e, Health, { hitpoints: 1, max: HOUSE_MAX_HP });
    sim.world.get(e, UnderConstruction).labor = fx.div(ONE, fx.fromInt(2)); // hammered halfway
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(fx.div(ONE, fx.fromInt(2))); // min(0.5, ONE)
    expect(sim.world.get(e, Health).hitpoints).toBe(HOUSE_MAX_HP / 2); // 50 of 100 — ramped with built
    // Finish it: Health fills to max.
    fullyHammer(sim, e);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(ONE);
    expect(sim.world.get(e, Health).hitpoints).toBe(HOUSE_MAX_HP);
  });

  it('finishes a free (empty-cost) building immediately — no labor needed', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeSite(sim, HEADQUARTERS); // construction cost [] — nothing to hammer in
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).built).toBe(ONE);
    expect(finishedEvents(sim)).toEqual([{ kind: 'buildingFinished', entity: e }]);
    expect(sim.world.has(e, UnderConstruction)).toBe(false);
  });

  it('never revisits an already-built building', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = sim.world.create();
    sim.world.add(e, Building, { buildingType: HOUSE, tribe: VIKING, built: ONE, level: 0 });
    // A built house that happens to hold its materials must NOT re-consume them.
    sim.world.add(e, Stockpile, {
      amounts: new Map<number, number>([
        [STONE, 2],
        [WOOD, 1],
      ]),
    });
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(2); // untouched
    expect(finishedEvents(sim)).toHaveLength(0);
  });

  it('is deterministic — two runs from the same seed reach the same finished state', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 7, content: constructionContent() });
      const e = placeSite(sim, HOUSE, { [STONE]: 2, [WOOD]: 1 });
      fullyHammer(sim, e);
      constructionSystem(sim.world, ctxOf(sim));
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

describe('placeBuilding underConstruction (CommandSystem)', () => {
  it('starts a building at built=0 with an empty hold + a foundation Health + marker, then builds once hammered', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: HOUSE,
      x: 0,
      y: 0,
      tribe: VIKING,
      underConstruction: true,
    });
    sim.step(); // commandSystem places the under-construction site
    const e = [...sim.world.query(Building)][0];
    expect(sim.world.get(e, Building).built).toBe(fx.fromInt(0)); // under construction
    expect(sim.world.has(e, UnderConstruction)).toBe(true); // the builder-work marker
    expect(sim.world.get(e, Stockpile).amounts.size).toBe(0); // empty hold — accumulates deliveries
    // The foundation carries a Health pool floored at 1 (never a 0-HP corpse the CleanupSystem reaps).
    expect(sim.world.get(e, Health)).toEqual({ hitpoints: 1, max: HOUSE_MAX_HP });

    // Stock the site (the carrier-delivery, done by hand here) and hammer it (the builder work, likewise),
    // then step: the constructionSystem finishes it. Material alone is not enough — labor is required.
    const stock = sim.world.get(e, Stockpile).amounts;
    stock.set(STONE, 2);
    stock.set(WOOD, 1);
    sim.step();
    expect(sim.world.get(e, Building).built).toBe(fx.fromInt(0)); // stocked but un-hammered — still 0
    fullyHammer(sim, e);
    sim.step();
    expect(sim.world.get(e, Building).built).toBe(ONE);
    expect(sim.world.has(e, UnderConstruction)).toBe(false); // finished — marker gone
    expect(sim.world.get(e, Health).hitpoints).toBe(HOUSE_MAX_HP); // full life
  });

  it('places an already-built building (default) seeded from its stock initials, with no site marker', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    sim.enqueue({ kind: 'placeBuilding', buildingType: HOUSE, x: 0, y: 0, tribe: VIKING }); // no flag
    sim.step();
    const e = [...sim.world.query(Building)][0];
    expect(sim.world.get(e, Building).built).toBe(ONE); // immediately built — the slice path
    expect(sim.world.has(e, UnderConstruction)).toBe(false); // not a site
    expect(sim.world.has(e, Health)).toBe(false); // a plain built placement carries no life pool (golden path)
  });
});

/**
 * Material-DELIVERY dispatch: a construction site advertises room (via `stockCapacity`) for *exactly*
 * its outstanding `construction` materials, so the existing carrier path — the same
 * `nearestStoreFor` → MoveGoal → `pileup` chain that hauls a workplace's output to a store — now routes
 * the build materials to the site through the real `step()` schedule, with NO construction-specific
 * transport code. Once stocked, the constructionSystem finishes it. (A built building reverts to its
 * normal stock-slot capacity, so a finished site stops attracting materials.)
 */
function grassMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
}

/** An under-construction site placed at a given tile (empty hold — accumulates deliveries). */
function siteAt(sim: Simulation, buildingType: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: fx.fromInt(0), level: 0 });
  sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  sim.world.add(e, Stockpile, { amounts: new Map<number, number>() });
  return e;
}

/** A builder settler placed at a tile — a job permitted to run the build-house atomic, so the planner's
 *  builder drive hammers the nearest site (and self-supplies it when it runs dry). */
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
    experience: new Map(),
  });
  return e;
}

/** A carrier already holding a load of `goodType` (the haul a producing workplace would have handed it). */
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
    experience: new Map(),
  });
  sim.world.add(e, Carrying, { goodType, amount });
  return e;
}

describe('constructionSystem — material-DELIVERY dispatch (carrier path)', () => {
  it('a construction site is a valid delivery sink for its outstanding materials, but not random goods', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(4, 1) });
    const carrier = loadedCarrierAt(sim, 0, 0, STONE, 1); // carrying a stone the house needs
    const site = siteAt(sim, HOUSE, 2, 0); // empty — needs 2 stone + 1 wood

    // Loaded, the carrier should head FOR the site (it has room for the stone it needs).
    sim.step();
    // It either set a MoveGoal toward the site or, once adjacent, is en route — verify it picked the site.
    let stoneAtSite = 0;
    for (let i = 0; i < 60 && stoneAtSite === 0; i++) {
      sim.step();
      stoneAtSite = sim.world.get(site, Stockpile).amounts.get(STONE) ?? 0;
    }
    expect(stoneAtSite).toBe(1); // the carrier delivered its stone to the construction site
    expect(sim.world.has(carrier, Carrying)).toBe(false); // unloaded
  });

  it('end-to-end: carriers haul the full cost while a builder hammers, then the site builds and consumes it', () => {
    const sim = new Simulation({ seed: 2, content: constructionContent(), map: grassMap(6, 1) });
    const site = siteAt(sim, HOUSE, 3, 0); // needs 2 stone + 1 wood
    // Three carriers each holding one of the three needed units (2 stone + 1 wood)…
    loadedCarrierAt(sim, 0, 0, STONE, 1);
    loadedCarrierAt(sim, 1, 0, STONE, 1);
    loadedCarrierAt(sim, 5, 0, WOOD, 1);
    // …and a builder that hammers the site as the material lands (parallel supply + work).
    builderAt(sim, 4, 0);

    let built = false;
    for (let i = 0; i < 200 && !built; i++) {
      sim.step();
      built = sim.world.get(site, Building).built >= ONE;
    }
    expect(built).toBe(true); // delivered material + builder work together completed the build
    // The cost was consumed into the structure — the materials don't linger as stock.
    expect(sim.world.get(site, Stockpile).amounts.get(STONE) ?? 0).toBe(0);
    expect(sim.world.get(site, Stockpile).amounts.get(WOOD) ?? 0).toBe(0);
    expect(sim.world.has(site, UnderConstruction)).toBe(false); // finished — a plain Building now
    // No construction material is left IN FLIGHT — every unit the carriers held reached the site (the
    // cost above is 0 because it was delivered THEN consumed, so this is the "nothing stuck en route" half).
    let materialInFlight = 0;
    for (const e of sim.world.query(Carrying)) {
      const load = sim.world.get(e, Carrying);
      if (load.goodType === STONE || load.goodType === WOOD) materialInFlight += load.amount;
    }
    expect(materialInFlight).toBe(0);
  });

  it('a builder self-supplies: fetches material from a warehouse to its own site, then builds it', () => {
    const sim = new Simulation({ seed: 4, content: constructionContent(), map: grassMap(8, 1) });
    const site = siteAt(sim, HOUSE, 4, 0); // needs 2 stone + 1 wood, empty hold
    // A warehouse holding the full cost — the builder must carry it over itself (no carriers). It is a
    // BUILDING store (not a bare Stockpile), so the gatherer-yard reaper never mistakes it for a loose
    // ground heap and removes it once the builder drains it (isYardHeap excludes Building stores).
    const warehouse = sim.world.create();
    sim.world.add(warehouse, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(warehouse, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(warehouse, Stockpile, {
      amounts: new Map<number, number>([
        [STONE, 2],
        [WOOD, 1],
      ]),
    });
    builderAt(sim, 6, 0);

    let built = false;
    for (let i = 0; i < 400 && !built; i++) {
      sim.step();
      built = sim.world.get(site, Building).built >= ONE;
    }
    expect(built).toBe(true); // the builder hauled every material itself and hammered the site up
    expect(sim.world.get(warehouse, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // drawn from the warehouse
    expect(sim.world.get(site, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // and spent into the build
  });

  it('is deterministic — two same-seed delivery+build runs reach the same finished state hash', () => {
    const run = (): string => {
      clearComponentStores();
      const sim = new Simulation({ seed: 9, content: constructionContent(), map: grassMap(6, 1) });
      siteAt(sim, HOUSE, 3, 0);
      loadedCarrierAt(sim, 0, 0, STONE, 1);
      loadedCarrierAt(sim, 1, 0, STONE, 1);
      loadedCarrierAt(sim, 5, 0, WOOD, 1);
      builderAt(sim, 4, 0);
      for (let i = 0; i < 120; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

/**
 * Home level-up: a BUILT `home` that accumulates the NEXT tier's `construction` cost in its own
 * stockpile consumes those materials and upgrades — its `buildingType` becomes the next tier's typeId
 * and `level` increments, so its larger `homeSize` immediately raises `housingCapacity`. The level
 * chain is the consecutive `home` typeIds; the top tier (no next typeId) never upgrades.
 */
describe('constructionSystem — home level-up', () => {
  it('does NOT upgrade a built home missing the next tier cost', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 1 }); // L1 needs 2 stone; only 1 present
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HOME_L0); // unchanged
    expect(sim.world.get(e, Building).level).toBe(0);
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(1); // materials untouched
    expect(upgradedEvents(sim)).toHaveLength(0);
  });

  it('upgrades a built home once the next tier cost is present, consuming the materials', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 2 }); // L1 needs 2 stone
    constructionSystem(sim.world, ctxOf(sim));
    const b = sim.world.get(e, Building);
    expect(b.buildingType).toBe(HOME_L1); // adopted the larger tier
    expect(b.level).toBe(1);
    expect(b.built).toBe(ONE); // still built (it was already built; only the tier changed)
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(0); // spent into the upgrade
    expect(upgradedEvents(sim)).toEqual([{ kind: 'buildingUpgraded', entity: e, level: 1 }]);
  });

  it('raises the tribe housing capacity by the new tier homeSize', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 2 });
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(1); // L0 shelters 1
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HOME_L1);
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(2); // L1 shelters 2
  });

  it('upgrades at most ONE tier per tick — the new tier cost is not present after the jump', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    // Hold both L1's cost (2 stone) AND L2's cost (1 wood). One tick should advance exactly one tier:
    // after L0→L1 the stone is spent, and L2's cost (wood) is what L1 would need — present, so a SECOND
    // tick advances L1→L2. This guards against a within-tick double-upgrade (query yields each id once).
    const e = placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 2, [WOOD]: 1 });
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HOME_L1); // exactly one tier this tick
    expect(sim.world.get(e, Building).level).toBe(1);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HOME_L2); // second tick advances again
    expect(sim.world.get(e, Building).level).toBe(2);
  });

  it('never upgrades the top-tier home (no next typeId in the chain)', () => {
    const sim = new Simulation({ seed: 1, content: levelChainContent() });
    // HOME_L2 is the top; even holding a pile of every good, there is no tier to upgrade into.
    const e = placeBuiltHome(sim, HOME_L2, 2, { [STONE]: 9, [WOOD]: 9 });
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HOME_L2); // unchanged
    expect(sim.world.get(e, Building).level).toBe(2);
    expect(sim.world.get(e, Stockpile).amounts.get(STONE)).toBe(9); // nothing consumed
    expect(upgradedEvents(sim)).toHaveLength(0);
  });

  it('does NOT upgrade a non-home built building even if it holds matching goods', () => {
    // A built workplace whose typeId+1 happens to be a home must NOT be treated as a home upgrade.
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const e = placeBuiltHome(sim, HEADQUARTERS, 0, { [STONE]: 9, [WOOD]: 9 }); // typeId 1, kind headquarters
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(e, Building).buildingType).toBe(HEADQUARTERS); // unchanged — not a home
    expect(upgradedEvents(sim)).toHaveLength(0);
  });

  it('is deterministic — two same-seed upgrade runs reach the same state hash', () => {
    const run = (): string => {
      clearComponentStores();
      const sim = new Simulation({ seed: 5, content: levelChainContent() });
      placeBuiltHome(sim, HOME_L0, 0, { [STONE]: 2 });
      constructionSystem(sim.world, ctxOf(sim));
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

/**
 * Upgrade-material DELIVERY dispatch: a BUILT home that can still level up advertises its NEXT tier's
 * `construction` cost as carrier-delivery demand (via `stockCapacity`'s built-home branch + `homeNextTier`),
 * so the same carrier path that supplies a build SITE now accumulates the UPGRADE materials at the home —
 * no upgrade-specific transport code. Once the next tier's cost lands, the `constructionSystem` levels it
 * up. A maxed-out (top-tier) home has no next tier and reverts to its plain stock-slot capacity, so it
 * stops attracting materials.
 */
function levelChainWithCarrier(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
      { typeId: WOOD, id: 'wood' },
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
        homeSize: 1,
        construction: [{ goodType: STONE, amount: 1 }],
      },
      {
        typeId: HOME_L1,
        id: 'home_level_01',
        kind: 'home',
        homeSize: 2,
        construction: [{ goodType: STONE, amount: 2 }],
      },
      {
        typeId: HOME_L2,
        id: 'home_level_02',
        kind: 'home',
        homeSize: 3,
        construction: [{ goodType: WOOD, amount: 1 }],
      },
    ],
  });
}

/** A fully-BUILT home of the given tier placed at a map tile (the carrier-delivery target). */
function builtHomeAt(sim: Simulation, buildingType: number, level: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level });
  sim.world.add(e, Stockpile, { amounts: new Map<number, number>() });
  return e;
}

describe('constructionSystem — upgrade-material DELIVERY dispatch (carrier path)', () => {
  it('end-to-end: carriers haul the next tier cost to a built home, which then levels up', () => {
    const sim = new Simulation({ seed: 2, content: levelChainWithCarrier(), map: grassMap(6, 1) });
    const home = builtHomeAt(sim, HOME_L0, 0, 3, 0); // L0 (homeSize 1) — L1 needs 2 stone
    loadedCarrierAt(sim, 0, 0, STONE, 1);
    loadedCarrierAt(sim, 1, 0, STONE, 1);

    let upgraded = false;
    for (let i = 0; i < 120 && !upgraded; i++) {
      sim.step();
      upgraded = sim.world.get(home, Building).buildingType === HOME_L1;
    }
    expect(upgraded).toBe(true); // the delivered upgrade materials triggered the level-up
    expect(sim.world.get(home, Building).level).toBe(1);
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(2); // L1 shelters 2 (was 1)
    expect(sim.world.get(home, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // spent into the upgrade
    for (const e of sim.world.query(Settler)) expect(sim.world.has(e, Carrying)).toBe(false); // both unloaded
  });

  it('a TOP-TIER home does not attract upgrade materials — a carrier with no other sink keeps its load', () => {
    // HOME_L2 is the top of the chain (no typeId-5 home), so `stockCapacity` advertises no upgrade demand
    // (and the home has no stock slots) — the carrier finds no valid sink and never delivers its stone.
    const sim = new Simulation({ seed: 3, content: levelChainWithCarrier(), map: grassMap(6, 1) });
    const home = builtHomeAt(sim, HOME_L2, 2, 3, 0);
    const carrier = loadedCarrierAt(sim, 0, 0, STONE, 1);
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.world.get(home, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // nothing delivered
    expect(sim.world.has(carrier, Carrying)).toBe(true); // still holding its load — no sink
    expect(sim.world.get(home, Building).buildingType).toBe(HOME_L2); // unchanged
  });

  it('is deterministic — two same-seed upgrade-delivery runs reach the same state hash', () => {
    const run = (): string => {
      clearComponentStores();
      const sim = new Simulation({ seed: 9, content: levelChainWithCarrier(), map: grassMap(6, 1) });
      builtHomeAt(sim, HOME_L0, 0, 3, 0);
      loadedCarrierAt(sim, 0, 0, STONE, 1);
      loadedCarrierAt(sim, 1, 0, STONE, 1);
      for (let i = 0; i < 80; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

describe('constructionPlots — the render decal cells for under-construction sites', () => {
  it("returns each site's footprint body cells (anchor + offsets), for a plot matching the building", () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    placeSite(sim, HOUSE); // Position (0,0); HOUSE footprint blocked = anchor + one cell east
    const { hx, hy } = nodeOfPosition(fx.fromInt(0), fx.fromInt(0));
    expect(sim.constructionPlots()).toEqual([
      {
        cells: [
          { col: hx, row: hy },
          { col: hx + 2, row: hy },
        ],
      },
    ]);
  });

  it('falls back to the anchor cell for a footprint-less type, and drops a site once it finishes', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent() });
    const hq = placeSite(sim, HEADQUARTERS); // empty cost + no footprint
    const { hx, hy } = nodeOfPosition(fx.fromInt(0), fx.fromInt(0));
    expect(sim.constructionPlots()).toEqual([{ cells: [{ col: hx, row: hy }] }]);
    // A free (empty-cost) building finishes on the first construction tick → no longer a plot.
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(hq, UnderConstruction)).toBe(false);
    expect(sim.constructionPlots()).toEqual([]);
  });
});
