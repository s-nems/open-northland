import { describe, expect, it } from 'vitest';
import {
  addPerson,
  BerryBush,
  Building,
  Damaged,
  Health,
  Position,
  Resource,
  ResourceFootprint,
  Stockpile,
  Stump,
  UnderConstruction,
  Upgrading,
} from '../../../src/components/index.js';
import type { Fixed } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { adminCommand, fx, ONE, Simulation } from '../../../src/index.js';
import { type HalfCellNode, nodeOfPosition, positionOfNode } from '../../../src/nav/halfcell.js';
import { commandSystem } from '../../../src/systems/command/index.js';
import { createBerryBush } from '../../../src/systems/economy/berries.js';
import { createResourceNode } from '../../../src/systems/footprint/index.js';
import { dropGroundPile } from '../../../src/systems/settlers/atomics/effects/goods/piles.js';
import { createVehicle } from '../../../src/systems/vehicles/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf, nextTickCtxOf } from '../../fixtures/context.js';
import { needsOf } from '../../fixtures/settler.js';
import { waterColumnMap } from '../../fixtures/terrain.js';

/**
 * The DEBUG / cheat commands the admin panel issues - `debugKill`, `debugSetNeeds`, `debugFillStockpile`,
 * `debugCompleteConstruction` and `debugTeleport`. Each is a real serializable command applied through the ONE command
 * path (so it replays/hashes like any order), issued only by the debug panel. These prove the EFFECT of
 * each (the panel's own click→command wiring is browser-verified); the determinism/replay half is locked
 * by the fuzz-determinism generator (each variant is fuzzed there). Bad/wrong-kind targets must be a
 * recoverable no-op, exactly like `demolish`/`attackUnit`.
 */

const VIKING = 1;
const WORKPLACE = 2; // fixture building: stock slots goodType 1 (cap 20) + goodType 2 (cap 20)
const WORKPLACE_STOCK: readonly [number, number][] = [
  [1, 20],
  [2, 20],
];
const GRANARY = 6; // fixture building kind 'storage' - used as a construction-site body (no home upgrade)
const GRANARY_MAX_HP = 100;
const RESOURCE_GOOD = 1; // a gathered good with a footprint in the AI fixture content
const HARVEST_ATOMIC = 24;

/** The test content's cart type. */
const HANDCART = 1;

function fresh(seed = 1): Simulation {
  return new Simulation({ seed, content: testContent() });
}

/** A killable UNIT: a settler carrying a Health pool at a tile (what `debugKill` gates on + drains). */
function unitWithHealth(sim: Simulation, hitpoints: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(3), y: fx.fromInt(3) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  return e;
}

/** A bare Health entity with NO Settler - a stand-in non-settler (the wrong-kind target for the tools). */
function healthOnlyEntity(sim: Simulation, hitpoints: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(3), y: fx.fromInt(3) });
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  return e;
}

/** A settler carrying its four needs pre-set to `level` (a Fixed), so a debug-set is a visible change. */
function settlerWithNeeds(sim: Simulation, level: Fixed): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(3), y: fx.fromInt(3) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: null,
    hunger: level,
    fatigue: level,
    piety: level,
    enjoyment: level,
  });
  return e;
}

/** Whether this tick announced `building` destroyed. */
function destroyed(sim: Simulation, building: Entity): boolean {
  return sim.events.current().some((ev) => ev.kind === 'buildingDestroyed' && ev.entity === building);
}

describe('debugErase', () => {
  /** A map-style node with a stamped footprint, as harvesting would leave worked. */
  function standingNode(sim: Simulation): Entity {
    const node = createResourceNode(sim.world, sim.content, {
      good: RESOURCE_GOOD,
      x: 8,
      y: 8,
      remaining: 5,
      harvestAtomic: HARVEST_ATOMIC,
    });
    if (node === null) throw new Error('the test content ships a footprint for this good');
    return node;
  }

  it('takes a resource node off the map with its footprint and retires its static sprite', () => {
    const sim = new Simulation({ seed: 1, content: aiContent() });
    const node = standingNode(sim);
    expect(sim.world.has(node, ResourceFootprint)).toBe(true);
    const { x, y } = sim.world.get(node, Position);
    const drop = dropGroundPile(sim.world, x, y, RESOURCE_GOOD, 2);

    sim.enqueueSetup({ kind: 'debugErase', target: node });
    sim.step();

    expect(sim.world.has(node, Resource)).toBe(false);
    expect(sim.world.isAlive(drop)).toBe(false);
    expect(sim.events.current()).toContainEqual({
      kind: 'resourceDepleted',
      node,
      goodType: RESOURCE_GOOD,
      at: { hx: 8, hy: 8 },
    });
  });

  it('removes a berry bush and a loose pile, but never a building store', () => {
    const sim = fresh();
    const bush = createBerryBush(sim.world, { x: 6, y: 6, gfxIndex: 0 });
    const pile = dropGroundPile(sim.world, fx.fromInt(3), fx.fromInt(3), RESOURCE_GOOD, 2);
    const store = sim.world.create();
    sim.world.add(store, Position, { x: fx.fromInt(5), y: fx.fromInt(5) });
    sim.world.add(store, Building, { buildingType: GRANARY, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map([[RESOURCE_GOOD, 2]]) });

    for (const target of [bush, pile, store]) sim.enqueueSetup({ kind: 'debugErase', target });
    sim.step();

    expect(sim.world.has(bush, BerryBush)).toBe(false);
    expect(sim.events.current().some((ev) => ev.kind === 'berryBushRazed' && ev.bush === bush)).toBe(true);
    expect(sim.world.has(pile, Stockpile)).toBe(false);
    expect(sim.world.has(store, Stockpile)).toBe(true);
  });

  it('leaves a settler and a stump standing', () => {
    const sim = fresh();
    const settler = unitWithHealth(sim, 50);
    const stump = sim.world.create();
    sim.world.add(stump, Position, { x: fx.fromInt(4), y: fx.fromInt(4) });
    sim.world.add(stump, Stump, { goodType: RESOURCE_GOOD });

    for (const target of [settler, stump]) sim.enqueueSetup({ kind: 'debugErase', target });
    sim.step();

    expect(sim.world.isAlive(settler)).toBe(true);
    expect(sim.world.isAlive(stump)).toBe(true);
  });
});

describe('debugKill', () => {
  it('drains a Health pool to 0 so the CleanupSystem reaps the entity with a settlerDied event', () => {
    const sim = fresh();
    const victim = unitWithHealth(sim, 50);

    sim.enqueueSetup({ kind: 'debugKill', target: victim });
    sim.step();

    expect(sim.world.has(victim, Health)).toBe(false); // reaped (destroyed), not a lingering 0-HP zombie
    expect(sim.events.current().some((ev) => ev.kind === 'settlerDied')).toBe(true);
  });

  it('wrecks a vehicle through the CleanupSystem with a vehicleDestroyed event', () => {
    const sim = fresh();
    const cart = createVehicle(sim.world, ctxOf(sim), { vehicleType: HANDCART, x: 4, y: 4, tribe: VIKING });
    if (cart === null) throw new Error('the test content ships a handcart');

    sim.enqueueSetup({ kind: 'debugKill', target: cart });
    sim.step();

    expect(sim.world.isAlive(cart)).toBe(false);
    expect(
      sim.events.current().some((ev) => ev.kind === 'vehicleDestroyed' && ev.cause === 'destroyed'),
    ).toBe(true);
  });

  it('razes a finished building through the demolish teardown, with a buildingDestroyed event', () => {
    const sim = fresh();
    const store = sim.world.create();
    sim.world.add(store, Position, { x: fx.fromInt(3), y: fx.fromInt(3) });
    sim.world.add(store, Building, { buildingType: GRANARY, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map() });

    sim.enqueueSetup({ kind: 'debugKill', target: store });
    sim.step();

    expect(sim.world.isAlive(store)).toBe(false);
    expect(destroyed(sim, store)).toBe(true);
  });

  it('razes a construction site rather than draining its Health pool', () => {
    const sim = fresh();
    const site = sim.world.create();
    sim.world.add(site, Position, { x: fx.fromInt(3), y: fx.fromInt(3) });
    sim.world.add(site, Building, { buildingType: GRANARY, tribe: VIKING, built: fx.fromInt(0), level: 0 });
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.add(site, Stockpile, { amounts: new Map() });
    sim.world.add(site, Health, { hitpoints: 1, max: GRANARY_MAX_HP });

    sim.enqueueSetup({ kind: 'debugKill', target: site });
    sim.step();

    expect(sim.world.isAlive(site)).toBe(false);
    expect(destroyed(sim, site)).toBe(true);
    expect(sim.events.current().some((ev) => ev.kind === 'settlerDied')).toBe(false);
  });

  it('a Health pool on neither a settler, a vehicle nor a building is a no-op', () => {
    const sim = fresh();
    const other = healthOnlyEntity(sim, 5);

    sim.enqueueSetup({ kind: 'debugKill', target: other });
    sim.step();

    expect(sim.world.get(other, Health).hitpoints).toBe(5);
  });
});

describe('debugSetHealth', () => {
  it('rejects non-finite and fractional percentages from the in-process admin queue', () => {
    const sim = fresh();
    const target = unitWithHealth(sim, 1000);
    for (const percent of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5]) {
      sim.enqueue(adminCommand({ kind: 'debugSetHealth', target, percent }));
      commandSystem(sim.world, nextTickCtxOf(sim));
      expect(sim.world.get(target, Health)).toEqual({ hitpoints: 1000, max: 1000 });
    }
  });

  it('sets exact percentages through the admin queue, preserving max health and repair eligibility', () => {
    const sim = fresh();
    const unit = unitWithHealth(sim, 5000);
    const building = sim.world.create();
    sim.world.add(building, Building, { buildingType: GRANARY, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(building, Health, { hitpoints: 1000, max: 1000 });

    for (const [percent, unitHp, buildingHp] of [
      [1, 50, 10],
      [80, 4000, 800],
      [100, 5000, 1000],
    ] as const) {
      for (const target of [unit, building])
        sim.enqueue(adminCommand({ kind: 'debugSetHealth', target, percent }));
      // Inspect the command's exact result before ordinary unit regeneration advances it.
      commandSystem(sim.world, nextTickCtxOf(sim));
      expect(sim.world.get(unit, Health)).toEqual({ hitpoints: unitHp, max: 5000 });
      expect(sim.world.get(building, Health)).toEqual({ hitpoints: buildingHp, max: 1000 });
      expect(sim.world.has(building, Damaged)).toBe(percent < 100);
    }
    expect(sim.commands.log.filter(({ command }) => command.kind === 'debugSetHealth')).toHaveLength(6);
  });

  it('uses the built pool for construction and the standing pool for an upgrade', () => {
    const sim = fresh();
    const sites = [sim.world.create(), sim.world.create()];
    for (const [index, site] of sites.entries()) {
      sim.world.add(site, Building, {
        buildingType: GRANARY,
        tribe: VIKING,
        built: fx.fromFloat(0.5),
        level: 0,
      });
      sim.world.add(site, Health, { hitpoints: 500, max: 1000 });
      sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
      if (index === 1)
        sim.world.add(site, Upgrading, {
          target: sim.world.get(site, Building).buildingType,
          savedStock: new Map(),
          seeded: new Map(),
        });
      sim.enqueue(adminCommand({ kind: 'debugSetHealth', target: site, percent: 1 }));
    }
    commandSystem(sim.world, nextTickCtxOf(sim));
    expect(sites.map((site) => sim.world.get(site, Health).hitpoints)).toEqual([5, 10]);
  });

  it('keeps a small pool alive and ignores wrong targets, dead units and out-of-range percentages', () => {
    const sim = fresh();
    const tiny = unitWithHealth(sim, 5);
    const dead = unitWithHealth(sim, 10);
    sim.world.mut(dead, Health).hitpoints = 0;
    const wrong = healthOnlyEntity(sim, 50);
    const gone = sim.world.create();
    sim.world.destroy(gone);
    for (const target of [tiny, dead, wrong, gone]) {
      sim.enqueue(adminCommand({ kind: 'debugSetHealth', target, percent: 1 }));
    }
    commandSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(tiny, Health).hitpoints).toBe(1);
    expect(sim.world.get(dead, Health).hitpoints).toBe(0);
    expect(sim.world.get(wrong, Health).hitpoints).toBe(50);
    expect(sim.world.isAlive(gone)).toBe(false);
    for (const percent of [0, 101])
      sim.enqueue(adminCommand({ kind: 'debugSetHealth', target: tiny, percent }));
    commandSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(tiny, Health).hitpoints).toBe(1);
  });
});

describe('debugSetNeeds', () => {
  it('sets only the named needs (percent → 0..ONE Fixed); omitted needs are left untouched', () => {
    const sim = fresh();
    // Freeze needs first so the NeedsSystem's per-tick rise can't perturb the values we set.
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    sim.step();

    const start = fx.fromInt(0); // a sentinel the omitted needs must keep
    const settler = settlerWithNeeds(sim, start);
    sim.enqueueSetup({ kind: 'debugSetNeeds', target: settler, hunger: 100, fatigue: 50 });
    sim.step();

    const s = needsOf(sim, settler);
    expect(s.hunger).toBe(ONE); // 100% → maxed
    expect(s.fatigue).toBe(fx.mulDiv(ONE, fx.fromInt(50), fx.fromInt(100))); // 50% → ONE/2
    expect(s.piety).toBe(start); // omitted - untouched
    expect(s.enjoyment).toBe(start); // omitted - untouched
  });
});

describe('debugFillStockpile', () => {
  it('fills only a selected declared slot through the admin queue', () => {
    const sim = fresh();
    const store = sim.world.create();
    sim.world.add(store, Building, { buildingType: WORKPLACE, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, {
      amounts: new Map([
        [1, 3],
        [2, 4],
        [99, 5],
      ]),
    });

    sim.enqueue(adminCommand({ kind: 'debugFillStockpile', target: store, goodType: 1 }));
    commandSystem(sim.world, nextTickCtxOf(sim));

    expect([...sim.world.get(store, Stockpile).amounts]).toEqual([
      [1, 20],
      [2, 4],
      [99, 5],
    ]);
  });

  it('leaves stock and mutation versions unchanged for invalid or undeclared selections', () => {
    const sim = fresh();
    const store = sim.world.create();
    sim.world.add(store, Building, { buildingType: WORKPLACE, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, {
      amounts: new Map([
        [1, 3],
        [2, 4],
        [99, 5],
      ]),
    });
    for (const goodType of [99, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      const version = sim.world.mutationVersion;
      sim.enqueue(adminCommand({ kind: 'debugFillStockpile', target: store, goodType }));
      commandSystem(sim.world, nextTickCtxOf(sim));
      expect([...sim.world.get(store, Stockpile).amounts]).toEqual([
        [1, 3],
        [2, 4],
        [99, 5],
      ]);
      expect(sim.world.mutationVersion).toBe(version);
    }
  });

  it("fills every stock slot the building type declares to that slot's capacity", () => {
    const sim = fresh();
    const store = sim.world.create();
    sim.world.add(store, Building, { buildingType: WORKPLACE, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(store, Stockpile, { amounts: new Map() });

    sim.enqueueSetup({ kind: 'debugFillStockpile', target: store });
    sim.step();

    const amounts = sim.world.get(store, Stockpile).amounts;
    for (const [goodType, capacity] of WORKPLACE_STOCK) expect(amounts.get(goodType)).toBe(capacity);
  });

  it("delivers a construction site's bill rather than the finished building's stock slots", () => {
    const base = testContent();
    const bill = [
      { goodType: 1, amount: 2 },
      { goodType: 2, amount: 3 },
    ];
    const sim = new Simulation({
      seed: 1,
      content: {
        ...base,
        buildings: base.buildings.map((b) => (b.typeId === WORKPLACE ? { ...b, construction: bill } : b)),
      },
    });
    const site = sim.world.create();
    sim.world.add(site, Building, { buildingType: WORKPLACE, tribe: VIKING, built: fx.fromInt(0), level: 0 });
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.add(site, Stockpile, { amounts: new Map([[2, 1]]) });

    sim.enqueue(adminCommand({ kind: 'debugFillStockpile', target: site, goodType: 2 }));
    commandSystem(sim.world, nextTickCtxOf(sim));
    expect([...sim.world.get(site, Stockpile).amounts]).toEqual([[2, 3]]);

    sim.enqueue(adminCommand({ kind: 'debugFillStockpile', target: site }));
    commandSystem(sim.world, nextTickCtxOf(sim));
    expect([...sim.world.get(site, Stockpile).amounts].sort((a, b) => a[0] - b[0])).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });
});

describe('debugCompleteConstruction', () => {
  it('forces a construction site straight to built with full Health and a buildingFinished event', () => {
    const sim = fresh();
    const site = sim.world.create();
    sim.world.add(site, Position, { x: fx.fromInt(3), y: fx.fromInt(3) });
    sim.world.add(site, Building, { buildingType: GRANARY, tribe: VIKING, built: fx.fromInt(0), level: 0 });
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) }); // no labor, no delivered material
    sim.world.add(site, Stockpile, { amounts: new Map() });
    sim.world.add(site, Health, { hitpoints: 1, max: GRANARY_MAX_HP });

    sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: site });
    sim.step();

    expect(sim.world.get(site, Building).built).toBe(ONE);
    expect(sim.world.has(site, UnderConstruction)).toBe(false); // a finished building is a plain Building
    expect(sim.world.get(site, Health).hitpoints).toBe(GRANARY_MAX_HP); // ramped to full life
    expect(sim.events.current().some((ev) => ev.kind === 'buildingFinished' && ev.entity === site)).toBe(
      true,
    );
  });

  it('a target that is not a construction site (no UnderConstruction) is a no-op', () => {
    const sim = fresh();
    const built = sim.world.create();
    sim.world.add(built, Building, { buildingType: GRANARY, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(built, Stockpile, { amounts: new Map() });

    sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: built });
    expect(() => sim.step()).not.toThrow();
    expect(sim.world.has(built, UnderConstruction)).toBe(false);
  });
});

describe('debugTeleport', () => {
  const MAP_CELLS = 12;
  const RIVER_COLUMN = 6;
  const WEST_BANK: HalfCellNode = { hx: 4, hy: 4 };
  const EAST_BANK: HalfCellNode = { hx: 18, hy: 10 };
  /** Cell (`RIVER_COLUMN`, 4)'s own node: open water. */
  const RIVER: HalfCellNode = { hx: 2 * RIVER_COLUMN, hy: 8 };

  function riverSim(): Simulation {
    return new Simulation({
      seed: 1,
      content: testContent(),
      map: waterColumnMap(MAP_CELLS, MAP_CELLS, RIVER_COLUMN),
    });
  }

  function personAt(sim: Simulation, node: HalfCellNode): Entity {
    const e = sim.world.create();
    const at = positionOfNode(node.hx, node.hy);
    sim.world.add(e, Position, { x: at.x, y: at.y });
    addPerson(sim.world, e, {
      tribe: VIKING,
      jobType: null,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    return e;
  }

  function nodeOf(sim: Simulation, e: Entity): HalfCellNode {
    const at = sim.world.get(e, Position);
    return nodeOfPosition(at.x, at.y);
  }

  it('lands a human on walkable ground across water no walk could cross', () => {
    const sim = riverSim();
    const settler = personAt(sim, WEST_BANK);
    sim.enqueueSetup({ kind: 'debugTeleport', target: settler, x: EAST_BANK.hx, y: EAST_BANK.hy });
    sim.step();
    expect(nodeOf(sim, settler)).toEqual(EAST_BANK);
  });

  it('refuses a destination in the water or off the map', () => {
    const sim = riverSim();
    const settler = personAt(sim, WEST_BANK);
    sim.enqueueSetup({ kind: 'debugTeleport', target: settler, x: RIVER.hx, y: RIVER.hy });
    sim.enqueueSetup({ kind: 'debugTeleport', target: settler, x: -1, y: EAST_BANK.hy });
    sim.step();
    expect(nodeOf(sim, settler)).toEqual(WEST_BANK);
  });

  it('a non-human target is a no-op', () => {
    const sim = riverSim();
    const notAHuman = healthOnlyEntity(sim, 10);
    const before = { ...sim.world.get(notAHuman, Position) };
    sim.enqueueSetup({ kind: 'debugTeleport', target: notAHuman, x: EAST_BANK.hx, y: EAST_BANK.hy });
    sim.step();
    expect(sim.world.get(notAHuman, Position)).toEqual(before);
  });
});
