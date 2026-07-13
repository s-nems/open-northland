import { type ContentSet, IR_VERSION, parseContentSet } from '@open-northland/data';
import { beforeEach } from 'vitest';
import {
  Building,
  Carrying,
  Position,
  Settler,
  Stockpile,
  UnderConstruction,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, type SimEvent, type Simulation, type TerrainMap } from '../../../src/index.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { clearComponentStores } from '../../fixtures/stores.js';

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

export const VIKING = 1;
export const STONE = 1;
export const WOOD = 2;
export const HOUSE = 2; // a residence needing 2× stone + 1× wood to build (3 units → 3·STRIKES_PER_UNIT swings)
export const HEADQUARTERS = 1; // free — empty construction cost
export const GRASS = 0;
export const CARRIER = 36; // a job with no harvest atomics — it can only haul a load it already carries
export const BUILDER = 7; // the builder trade (jobtypes.ini type 7); permitted to run the build-house atomic
export const BUILD_HOUSE_ATOMIC = 39; // setatomic 7 39 "..._builder_build_house" (tribetypes.ini)
export const HOUSE_MAX_HP = 100; // the HOUSE fixture's `hitpoints` — small so the ramp is exact-integer to read

// The home level chain — consecutive typeIds, each a larger `home` with its own per-tier upgrade cost.
export const HOME_L0 = 2; // home level 00, homeSize 1, upgrades by paying L1's cost
export const HOME_L1 = 3; // home level 01, homeSize 2, upgrades by paying L2's cost
export const HOME_L2 = 4; // home level 02, homeSize 3 — top tier in this fixture (no typeId 5 home)

export function constructionContent(): ContentSet {
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
export function levelChainContent(): ContentSet {
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
export function placeBuiltHome(
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

export function upgradedEvents(sim: Simulation): readonly SimEvent[] {
  return sim.events.current().filter((ev) => ev.kind === 'buildingUpgraded');
}

// Clear EVERY component store — the module-level singleton stores are shared across Simulation
// instances (AGENTS.md [ac6a287]); a store missed here leaks a prior test's entity, which
// (e.g. a stale Health/CurrentAtomic on a reused id) silently diverts the carrier-delivery scan.
beforeEach(clearComponentStores);

export { clearComponentStores };

export function ctxOf(sim: Simulation): SystemContext {
  return { content: sim.content, rng: sim.rng, tick: sim.tick, events: sim.events };
}

/** Place an under-construction building (`built = 0`, labor 0) holding the given starting materials. */
export function placeSite(sim: Simulation, buildingType: number, stock: Record<number, number> = {}): Entity {
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
export function fullyHammer(sim: Simulation, site: Entity): void {
  sim.world.get(site, UnderConstruction).labor = ONE;
}

export function finishedEvents(sim: Simulation): readonly SimEvent[] {
  return sim.events.current().filter((ev) => ev.kind === 'buildingFinished');
}

export function grassMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
}

/** An under-construction site placed at a given tile (empty hold — accumulates deliveries). */
export function siteAt(sim: Simulation, buildingType: number, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: fx.fromInt(0), level: 0 });
  sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  sim.world.add(e, Stockpile, { amounts: new Map<number, number>() });
  return e;
}

/** A builder settler placed at a tile. */
export function builderAt(sim: Simulation, x: number, y: number): Entity {
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

/** A carrier already holding the load a producing workplace would have handed it. */
export function loadedCarrierAt(
  sim: Simulation,
  x: number,
  y: number,
  goodType: number,
  amount: number,
): Entity {
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

export function levelChainWithCarrier(): ContentSet {
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

export function builtHomeAt(
  sim: Simulation,
  buildingType: number,
  level: number,
  x: number,
  y: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level });
  sim.world.add(e, Stockpile, { amounts: new Map<number, number>() });
  return e;
}
