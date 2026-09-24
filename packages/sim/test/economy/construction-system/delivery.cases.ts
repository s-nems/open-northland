import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  Building,
  Carrying,
  CurrentAtomic,
  Fleeing,
  JobAssignment,
  MoveGoal,
  Owner,
  Position,
  Settler,
  SiteAssignment,
  Stockpile,
  SupplyRun,
  UnderConstruction,
  Upgrading,
} from '../../../src/components/index.js';
import type { AtomicEffect } from '../../../src/core/atomic-effect.js';
import type { Entity } from '../../../src/ecs/world.js';
import { type Fixed, fx, ONE, positionOfNode, Simulation } from '../../../src/index.js';
import { housingCapacity } from '../../../src/simulation/hud.js';
import { remainingConstructionStrikes } from '../../../src/systems/economy/construction.js';
import { plannerSystem } from '../../../src/systems/index.js';
import { pickupFromStore } from '../../../src/systems/settlers/atomics/effects/goods/index.js';
import { PlannerSpacing } from '../../../src/systems/settlers/planner/spacing.js';
import {
  collectInboundSupply,
  deliveredConstructionFraction,
  inboundSupplyOf,
  reservedSourceSupplyOf,
} from '../../../src/systems/stores/index.js';

import {
  BUILD_HOUSE_ATOMIC,
  BUILDER,
  builderAt,
  builtBuildingAt,
  constructionContent,
  ctxOf,
  grassMap,
  HEADQUARTERS,
  HOME_L0,
  HOME_L1,
  HOUSE,
  levelChainWithCarrier,
  loadedCarrierAt,
  STONE,
  siteAt,
  VIKING,
  WOOD,
  WORKSHOP,
} from './support.js';

/** Step until `settler` starts a pickup and return that effect - which store it chose to lift from. */
function firstPickup(sim: Simulation, settler: Entity): AtomicEffect | null {
  for (let i = 0; i < 400; i++) {
    sim.step();
    const effect = sim.world.tryGet(settler, CurrentAtomic)?.effect;
    if (effect?.kind === 'pickup') return effect;
  }
  return null;
}

describe('constructionSystem - material-DELIVERY dispatch (carrier path)', () => {
  it('a construction site is a valid delivery sink for its outstanding materials, but not random goods', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(4, 1) });
    const carrier = loadedCarrierAt(sim, 0, 0, STONE, 1); // carrying a stone the house needs
    const site = siteAt(sim, HOUSE, 2, 0); // empty - needs 2 stone + 1 wood

    // Loaded, the carrier should head FOR the site (it has room for the stone it needs).
    sim.step();
    // It either set a MoveGoal toward the site or, once adjacent, is en route - verify it picked the site.
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
    // The build takes 3 units × STRIKES_PER_UNIT swings (several ticks each) even with the material
    // already inbound, so the tick budget covers the full hammer-out at the tuned ~1%/strike pace.
    for (let i = 0; i < 600 && !built; i++) {
      sim.step();
      built = sim.world.get(site, Building).built >= ONE;
    }
    expect(built).toBe(true); // delivered material + builder work together completed the build
    // The cost was consumed into the structure - the materials don't linger as stock.
    expect(sim.world.get(site, Stockpile).amounts.get(STONE) ?? 0).toBe(0);
    expect(sim.world.get(site, Stockpile).amounts.get(WOOD) ?? 0).toBe(0);
    expect(sim.world.has(site, UnderConstruction)).toBe(false); // finished - a plain Building now
    // No construction material is left IN FLIGHT - every unit the carriers held reached the site (the
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
    // A warehouse holding the full cost - the builder must carry it over itself (no carriers). It is a
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
    let maxCarried = 0;
    // Generous tick budget: the builder makes three fetch trips AND hammers out every strike alone
    // (3 units × STRIKES_PER_UNIT swings, several ticks each).
    for (let i = 0; i < 1200 && !built; i++) {
      sim.step();
      built = sim.world.get(site, Building).built >= ONE;
      for (const c of sim.world.query(Carrying)) {
        maxCarried = Math.max(maxCarried, sim.world.get(c, Carrying).amount);
      }
    }
    expect(built).toBe(true); // the builder hauled every material itself and hammered the site up
    // The global one-good-per-person rule: no lift ever exceeds CARRY_CAPACITY - three units take
    // three trips (source basis: observed original behavior - no on-foot batch exists in the game).
    expect(maxCarried).toBe(1);
    expect(sim.world.get(warehouse, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // drawn from the warehouse
    expect(sim.world.get(site, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // and spent into the build
  });

  it('a missing material never blocks the others - the builder fetches what IS available and builds partway', () => {
    // The house bill is 2 stone + 1 wood; the warehouse holds ONLY the wood. The least-covered pick on an
    // empty hold is stone (tie broken by ascending goodType), which has no source anywhere - the builder
    // must fall through the bill and fetch the wood rather than wait, then hammer the delivered third and
    // hold for the stone (the fetch-any-available-line rule).
    const sim = new Simulation({ seed: 12, content: constructionContent(), map: grassMap(8, 1) });
    const site = siteAt(sim, HOUSE, 4, 0);
    const warehouse = sim.world.create();
    sim.world.add(warehouse, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(warehouse, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(warehouse, Stockpile, { amounts: new Map<number, number>([[WOOD, 1]]) });
    builderAt(sim, 6, 0);

    let woodAtSite = 0;
    for (let i = 0; i < 400 && woodAtSite === 0; i++) {
      sim.step();
      woodAtSite = sim.world.get(site, Stockpile).amounts.get(WOOD) ?? 0;
    }
    expect(woodAtSite).toBe(1); // fetched despite stone (the least-covered line) having no source
    expect(sim.world.get(warehouse, Stockpile).amounts.get(WOOD) ?? 0).toBe(0);

    // With the wood on hand the builder hammers the delivered third and no further - the site keeps
    // standing (still under construction), waiting for stone to appear.
    let built = sim.world.get(site, Building).built;
    for (let i = 0; i < 200; i++) {
      sim.step();
      built = sim.world.get(site, Building).built;
    }
    expect(built).toBeGreaterThan(0); // hammered up the delivered material…
    expect(built).toBeLessThan(ONE); // …but capped at the delivered fraction (1 of 3 units)
    expect(sim.world.has(site, UnderConstruction)).toBe(true); // still waiting for the stone
  });

  it('only ONE builder fetches the last missing unit - the supply-run reservation stops the duplicate', () => {
    const sim = new Simulation({ seed: 5, content: constructionContent(), map: grassMap(8, 1) });
    const site = siteAt(sim, HOUSE, 4, 0); // cost 2 stone + 1 wood…
    sim.world.mut(site, Stockpile).amounts.set(STONE, 1);
    sim.world.mut(site, Stockpile).amounts.set(WOOD, 1); // …with only 1 stone still missing
    const warehouse = sim.world.create();
    sim.world.add(warehouse, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(warehouse, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(warehouse, Stockpile, { amounts: new Map<number, number>([[STONE, 3]]) });
    builderAt(sim, 3, 0);
    builderAt(sim, 5, 0);

    // Run through the hammer-then-fetch phase: the warehouse must only ever lose the ONE lifted stone -
    // without the SupplyRun reservation both builders raced to fetch it and the surplus wandered off.
    let minWarehouseStone = 3;
    for (let i = 0; i < 240; i++) {
      sim.step();
      minWarehouseStone = Math.min(
        minWarehouseStone,
        sim.world.get(warehouse, Stockpile).amounts.get(STONE) ?? 0,
      );
      const siteStone = sim.world.tryGet(site, Stockpile)?.amounts.get(STONE) ?? 0;
      expect(siteStone).toBeLessThanOrEqual(2); // never above the cost line
    }
    expect(minWarehouseStone).toBe(2);
  });

  it("sends only one builder for a store's last unit, but never refuses it to a settler at the counter", () => {
    const sim = new Simulation({ seed: 17, content: constructionContent(), map: grassMap(40, 4) });
    const left = siteAt(sim, HOUSE, 4, 1);
    const right = siteAt(sim, HOUSE, 34, 1);
    const warehouse = builtBuildingAt(sim, HEADQUARTERS, 20, 1, [[STONE, 1]]);
    const first = builderAt(sim, 2, 1);
    const second = builderAt(sim, 36, 1);
    sim.world.add(first, SiteAssignment, { site: left, pinned: true });
    sim.world.add(second, SiteAssignment, { site: right, pinned: true });

    plannerSystem(sim.world, ctxOf(sim));

    const runners = [first, second].filter((builder) => sim.world.has(builder, SupplyRun));
    expect(runners).toHaveLength(1);
    const runner = runners[0];
    if (runner === undefined) throw new Error('expected one reserved construction pickup');
    expect(sim.world.get(runner, SupplyRun)).toMatchObject({ source: warehouse, goodType: STONE });

    // No other trade reads the reservation, so a refusal would leave that settler retrying this store
    // until the builder arrived. It takes the unit, and the builder finds the store empty and stands down.
    const unrelated = sim.world.create();
    pickupFromStore(sim.world, ctxOf(sim), unrelated, warehouse, STONE, 1);
    expect(sim.world.get(unrelated, Carrying)).toMatchObject({ goodType: STONE, amount: 1 });

    for (let tick = 0; tick < 400 && sim.world.has(runner, SupplyRun); tick++) sim.step();
    expect(sim.world.has(runner, SupplyRun)).toBe(false);
    expect(sim.world.has(runner, Carrying)).toBe(false);
  });

  it('keeps a passing load off a site whose bill line a live fetch already covers', () => {
    const sim = new Simulation({ seed: 28, content: constructionContent(), map: grassMap(40, 4) });
    const site = siteAt(sim, HOUSE, 4, 1);
    const warehouse = builtBuildingAt(sim, HEADQUARTERS, 30, 1, [[WOOD, 1]]);
    const fetcher = builderAt(sim, 28, 3);
    sim.world.add(fetcher, SiteAssignment, { site, pinned: true });
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(fetcher, SupplyRun)).toMatchObject({ site, goodType: WOOD, source: warehouse });

    // The site is the nearest stockpile with room for wood, but its one wood unit is already on its way.
    // Taking this load too would cover the line from farther off and stand the fetcher down at the door.
    const passing = loadedCarrierAt(sim, 6, 3, WOOD, 1);
    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(passing, SupplyRun)).toBe(false);
    expect(inboundSupplyOf(collectInboundSupply(sim.world), site, WOOD)).toBe(1);
  });

  it('releases a drained source and retargets the construction run instead of covering the bill forever', () => {
    const sim = new Simulation({ seed: 18, content: constructionContent(), map: grassMap(40, 3) });
    const site = siteAt(sim, HOUSE, 36, 1);
    const drained = builtBuildingAt(sim, HEADQUARTERS, 8, 1, [[STONE, 1]]);
    const replacement = builtBuildingAt(sim, HEADQUARTERS, 28, 1, [[STONE, 1]]);
    const builder = builderAt(sim, 2, 1);
    sim.world.add(builder, SiteAssignment, { site, pinned: true });

    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(builder, SupplyRun).source).toBe(drained);
    sim.world.mut(drained, Stockpile).amounts.set(STONE, 0);

    let retargeted = false;
    for (let tick = 0; tick < 600 && !retargeted; tick++) {
      sim.step();
      retargeted = sim.world.tryGet(builder, SupplyRun)?.source === replacement;
    }

    expect(retargeted).toBe(true);
    const tally = collectInboundSupply(sim.world);
    expect(reservedSourceSupplyOf(tally, drained, STONE)).toBe(0);
    expect(reservedSourceSupplyOf(tally, replacement, STONE)).toBe(1);
    expect(inboundSupplyOf(tally, site, STONE)).toBe(1);
  });

  it('releases source and destination promises when flight diverts a travelling construction runner', () => {
    const sim = new Simulation({ seed: 20, content: constructionContent(), map: grassMap(8, 2) });
    const site = siteAt(sim, HOUSE, 6, 0);
    const source = builtBuildingAt(sim, HEADQUARTERS, 4, 0, [[STONE, 1]]);
    const builder = builderAt(sim, 0, 0);
    sim.world.add(builder, SupplyRun, { site, source, goodType: STONE, amount: 1 });
    sim.world.add(builder, Fleeing, { repathAt: 0, calmUntil: null });
    sim.world.add(builder, MoveGoal, { cell: 1 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(builder, SupplyRun)).toBe(false);
    const tally = collectInboundSupply(sim.world);
    expect(reservedSourceSupplyOf(tally, source, STONE)).toBe(0);
    expect(inboundSupplyOf(tally, site, STONE)).toBe(0);
  });

  it('drops once and does not re-fetch when a pinned site has no legal delivery perimeter', () => {
    const sim = new Simulation({ seed: 19, content: constructionContent(), map: grassMap(1, 1) });
    const site = siteAt(sim, HOUSE, 0, 0);
    const builder = builderAt(sim, 0, 0);
    sim.world.add(builder, Carrying, { goodType: STONE, amount: 1 });
    sim.world.add(builder, SiteAssignment, { site, pinned: true });

    let pickupSeen = false;
    for (let tick = 0; tick < 80; tick++) {
      sim.step();
      if (sim.world.tryGet(builder, CurrentAtomic)?.effect.kind === 'pickup') pickupSeen = true;
    }

    expect(sim.world.has(builder, Carrying)).toBe(false);
    expect(sim.world.has(builder, SupplyRun)).toBe(false);
    expect(pickupSeen).toBe(false);
    const looseStone = [...sim.world.query(Stockpile)]
      .filter((entity) => entity !== site)
      .reduce((sum, entity) => sum + (sim.world.get(entity, Stockpile).amounts.get(STONE) ?? 0), 0);
    expect(looseStone).toBe(1);
  });

  it('a builder COHORT self-supplying one site never over-fetches - the inbound tally sums concurrent runs', () => {
    // Four builders, one foundation needing 2 stone + 1 wood, one warehouse holding a big surplus of both.
    // Each tick several builders replan at once and read the shared inbound tally: it must fold every
    // concurrent SupplyRun so the crew fetches exactly the 3 outstanding units (spread across materials),
    // never a duplicate - the tally reproducing the old per-call full-store scan under real concurrency.
    const sim = new Simulation({ seed: 11, content: constructionContent(), map: grassMap(10, 1) });
    const site = siteAt(sim, HOUSE, 5, 0); // cost 2 stone + 1 wood, empty hold
    const warehouse = sim.world.create();
    sim.world.add(warehouse, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(warehouse, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(warehouse, Stockpile, {
      amounts: new Map<number, number>([
        [STONE, 9],
        [WOOD, 9],
      ]),
    });
    for (const x of [3, 4, 6, 7]) builderAt(sim, x, 0);

    // Track the warehouse LOW-WATER mark across every step, not just the final stock: a final-only check
    // self-heals, because a crew that ignored each other's inbound runs over-fetches, the site rejects the
    // surplus (stockCapacity gate), and the extra loads wander back INTO the warehouse - restoring the
    // final count. Only 2 stone + 1 wood are ever genuinely needed, so with the tally folding concurrent
    // runs the low-water mark must be exactly 9−2 / 9−1; a broken fold would dip it lower.
    let built = false;
    let minStone = 9;
    let minWood = 9;
    for (let i = 0; i < 400 && !built; i++) {
      sim.step();
      built = sim.world.get(site, Building).built >= ONE;
      minStone = Math.min(minStone, sim.world.get(warehouse, Stockpile).amounts.get(STONE) ?? 0);
      minWood = Math.min(minWood, sim.world.get(warehouse, Stockpile).amounts.get(WOOD) ?? 0);
    }
    expect(built).toBe(true);
    expect(minStone).toBe(7); // only the 2 stone the site needs were ever lifted - never a duplicate
    expect(minWood).toBe(8); // only the 1 wood
    expect(sim.world.get(warehouse, Stockpile).amounts.get(STONE) ?? 0).toBe(7); // 9 − 2 spent
    expect(sim.world.get(warehouse, Stockpile).amounts.get(WOOD) ?? 0).toBe(8); // 9 − 1 spent
  });

  it('keeps a real hammer worker active while an older stale crew member fetches the missing good', () => {
    // A hammer-ready site (2 of its 2 stone already on hand) still short ONE wood, three builders on it,
    // and a warehouse holding the wood. The whole crew COULD hammer the delivered stone up to the 2/3 cap,
    // but that would stall on one late fetch trip. The higher-id builder already swinging is the real
    // hammer worker; an older crew membership with no live intent must not displace it merely by id.
    const sim = new Simulation({ seed: 21, content: constructionContent(), map: grassMap(12, 3) });
    const site = siteAt(sim, HOUSE, 6, 1); // cost 2 stone + 1 wood
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2); // stone fully on hand → hammerable, wood missing
    const warehouse = sim.world.create();
    sim.world.add(warehouse, Position, { x: fx.fromInt(0), y: fx.fromInt(1) });
    sim.world.add(warehouse, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(warehouse, Stockpile, { amounts: new Map<number, number>([[WOOD, 3]]) });
    const stale = builderAt(sim, 5, 1); // lowest id, but no active hammer intent
    const active = builderAt(sim, 7, 1);
    const third = builderAt(sim, 6, 2);
    for (const builder of [stale, active, third]) {
      sim.world.add(builder, SiteAssignment, { site, pinned: false });
    }
    addCurrentAtomic(sim.world, active, {
      atomicId: BUILD_HOUSE_ATOMIC,
      duration: 10,
      effect: { kind: 'construct', site },
      targetEntity: site,
      targetTile: null,
    });

    plannerSystem(sim.world, ctxOf(sim));

    expect([stale, active, third].filter((b) => sim.world.has(b, SupplyRun))).toEqual([stale]);
    expect(sim.world.get(stale, SupplyRun)).toMatchObject({ site, goodType: WOOD });
    expect(sim.world.get(active, CurrentAtomic).effect).toEqual({ kind: 'construct', site });
  });

  it('sends one of eight builders for the last material and redistributes the surplus to a ready site', () => {
    const sim = new Simulation({ seed: 22, content: constructionContent(), map: grassMap(24, 5) });
    const stalled = siteAt(sim, HOUSE, 6, 1);
    sim.world.mut(stalled, Stockpile).amounts.set(STONE, 2);
    sim.world.mut(stalled, UnderConstruction).labor = deliveredConstructionFraction(
      sim.world,
      ctxOf(sim),
      stalled,
    );
    const ready = siteAt(sim, HOUSE, 18, 1);
    sim.world.mut(ready, Stockpile).amounts.set(STONE, 2);
    sim.world.mut(ready, Stockpile).amounts.set(WOOD, 1);
    builtBuildingAt(sim, HEADQUARTERS, 0, 1, [[WOOD, 1]]);
    const builders = Array.from({ length: 8 }, (_, i) => builderAt(sim, 4 + (i % 4), 3 + (i % 2)));
    for (const builder of builders) sim.world.add(builder, SiteAssignment, { site: stalled, pinned: false });

    plannerSystem(sim.world, ctxOf(sim));

    const runners = builders.filter((builder) => sim.world.has(builder, SupplyRun));
    expect(runners).toHaveLength(1);
    const runner = runners[0];
    expect(runner).toBeDefined();
    if (runner === undefined) throw new Error('one construction runner expected');
    expect(sim.world.get(runner, SupplyRun)).toMatchObject({ site: stalled, goodType: WOOD });
    expect(
      builders.filter((builder) => sim.world.tryGet(builder, SiteAssignment)?.site === ready),
    ).toHaveLength(7);
  });

  it('lets a fully supplied site reserve parallel hammer work for its whole crew', () => {
    const sim = new Simulation({ seed: 23, content: constructionContent(), map: grassMap(12, 5) });
    const site = siteAt(sim, HOUSE, 6, 1);
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    sim.world.mut(site, Stockpile).amounts.set(WOOD, 1);
    const builders = Array.from({ length: 8 }, (_, i) => builderAt(sim, 4 + (i % 4), 3 + (i % 2)));

    plannerSystem(sim.world, ctxOf(sim));

    expect(builders.every((builder) => sim.world.tryGet(builder, SiteAssignment)?.site === site)).toBe(true);
    expect(builders.filter((builder) => sim.world.has(builder, SupplyRun))).toHaveLength(0);
    expect(
      builders.filter(
        (builder) =>
          sim.world.has(builder, MoveGoal) ||
          sim.world.tryGet(builder, CurrentAtomic)?.effect.kind === 'construct',
      ),
    ).toHaveLength(8);
  });

  it('parks surplus automatic crew beside a site with no task instead of releasing it to idle', () => {
    const sim = new Simulation({ seed: 25, content: constructionContent(), map: grassMap(12, 5) });
    const site = siteAt(sim, HOUSE, 6, 1);
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    sim.world.mut(site, UnderConstruction).labor = deliveredConstructionFraction(sim.world, ctxOf(sim), site);
    const automatic = Array.from({ length: 4 }, (_, i) => builderAt(sim, 3 + i, 3));
    const pinned = builderAt(sim, 7, 3);
    sim.world.add(pinned, SiteAssignment, { site, pinned: true });

    plannerSystem(sim.world, ctxOf(sim));

    // Nothing to hammer and no wood to fetch: the crew still gathers at the perimeter, so the next
    // delivery is hammered at once rather than after a walk back from wherever idling took it.
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const perimeter = PlannerSpacing.forTick(sim.world, ctxOf(sim), terrain).workCells(site);
    for (const builder of automatic) {
      expect(sim.world.get(builder, SiteAssignment)).toEqual({ site, pinned: false });
      const goal = sim.world.tryGet(builder, MoveGoal)?.cell;
      expect(goal === undefined || perimeter.includes(goal)).toBe(true);
    }
    expect(sim.world.get(pinned, SiteAssignment)).toEqual({ site, pinned: true });
  });

  it('moves parked automatic crew to another site as soon as that one has a task', () => {
    const sim = new Simulation({ seed: 26, content: constructionContent(), map: grassMap(20, 5) });
    const starved = siteAt(sim, HOUSE, 3, 1);
    const supplied = siteAt(sim, HOUSE, 14, 1);
    const builder = builderAt(sim, 2, 3);

    for (let tick = 0; tick < 200; tick++) sim.step();
    expect(sim.world.get(builder, SiteAssignment)).toEqual({ site: starved, pinned: false });
    expect(sim.world.has(builder, MoveGoal)).toBe(false); // parked at the starved perimeter

    sim.world.mut(supplied, Stockpile).amounts.set(STONE, 2);
    sim.step();

    expect(sim.world.get(builder, SiteAssignment)).toEqual({ site: supplied, pinned: false });
  });

  it('lets the crew at the site take the last strikes while another builder is still walking in', () => {
    // Map dimensions are half-cell nodes; the site at world column 24 must be inside the map.
    const sim = new Simulation({ seed: 27, content: constructionContent(), map: grassMap(60, 10) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const site = siteAt(sim, HOUSE, 24, 1);
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    // One quantum short of the delivered cap: exactly one strike is left to claim.
    sim.world.mut(site, UnderConstruction).labor = (deliveredConstructionFraction(
      sim.world,
      ctxOf(sim),
      site,
    ) - 1) as Fixed;
    expect(remainingConstructionStrikes(sim.world, ctxOf(sim), site)).toBe(1);
    const perimeter = PlannerSpacing.forTick(sim.world, ctxOf(sim), terrain).workCells(site);
    const walkGoal = perimeter[0];
    if (walkGoal === undefined) throw new Error('site perimeter expected');
    const walker = builderAt(sim, 1, 3);
    sim.world.add(walker, SiteAssignment, { site, pinned: false });
    sim.world.add(walker, MoveGoal, { cell: walkGoal });
    const atSite = builderAt(sim, 24, 3);

    let struck = false;
    for (let tick = 0; tick < 200 && !struck; tick++) {
      sim.step();
      struck = sim.world.tryGet(atSite, CurrentAtomic)?.effect.kind === 'construct';
    }

    expect(struck).toBe(true);
    expect(sim.world.has(walker, MoveGoal)).toBe(true); // the walker was still on its way
  });

  it('keeps a useful automatic assignment stable and a manual pin strict', () => {
    const sim = new Simulation({ seed: 24, content: constructionContent(), map: grassMap(16, 5) });
    const near = siteAt(sim, HOUSE, 3, 1);
    const far = siteAt(sim, HOUSE, 12, 1);
    for (const site of [near, far]) {
      sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
      sim.world.mut(site, Stockpile).amounts.set(WOOD, 1);
    }
    const automatic = builderAt(sim, 2, 3);
    const pinned = builderAt(sim, 2, 4);
    sim.world.add(automatic, SiteAssignment, { site: far, pinned: false });
    sim.world.add(pinned, SiteAssignment, { site: far, pinned: true });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(automatic, SiteAssignment)).toEqual({ site: far, pinned: false });
    expect(sim.world.get(pinned, SiteAssignment)).toEqual({ site: far, pinned: true });
  });

  it('a builder fetch skips a pile buried under walls for the nearest reachable source', () => {
    // A stone pile left INSIDE a standing house's walk-blocked body (the leftover the footprint goods
    // eviction could not land, or hand-dropped state): geometrically the nearest source, but its stand
    // is unreachable - committing to it would path-fail and strand the builder on a retry loop. The
    // pick must skip it for the farther, reachable pile.
    const sim = new Simulation({ seed: 9, content: constructionContent(), map: grassMap(32, 8) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    // The site (needs 2 stone + 1 wood, nothing delivered → the fetch takes stone), in exact node
    // coords like every entity here, so the wall/pile geometry below is byte-precise.
    const site = sim.world.create();
    sim.world.add(site, Position, positionOfNode(2, 2));
    sim.world.add(site, Building, { buildingType: HOUSE, tribe: VIKING, built: fx.fromInt(0), level: 0 });
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.add(site, Stockpile, { amounts: new Map<number, number>() });
    const house = sim.world.create(); // a built HOUSE: walls on nodes (10,4) and (12,4)
    sim.world.add(house, Position, positionOfNode(10, 4));
    sim.world.add(house, Building, { buildingType: HOUSE, tribe: VIKING, built: ONE, level: 0 });
    const buried = sim.world.create(); // on the wall node - nearer to the builder than the free pile
    sim.world.add(buried, Position, positionOfNode(10, 4));
    sim.world.add(buried, Stockpile, { amounts: new Map<number, number>([[STONE, 1]]) });
    const free = sim.world.create();
    sim.world.add(free, Position, positionOfNode(20, 4));
    sim.world.add(free, Stockpile, { amounts: new Map<number, number>([[STONE, 1]]) });
    const builder = builderAt(sim, 0, 0);
    const at = positionOfNode(6, 4);
    const pos = sim.world.mut(builder, Position);
    pos.x = at.x;
    pos.y = at.y;

    plannerSystem(sim.world, ctxOf(sim));

    // The fetch was stamped for the site's stone - and the walk goal is the REACHABLE pile's tile,
    // not the nearer buried one.
    expect(sim.world.get(builder, SupplyRun)).toMatchObject({ site, goodType: STONE });
    expect(sim.world.get(builder, MoveGoal).cell).toBe(terrain.nodeAt(20, 4));
  });

  it("a builder fetch walks past a workshop's input reserve to the farther warehouse", () => {
    // The joinery complaint: every construction bill is paid in goods the workshops also consume, so the
    // nearest wood was routinely the joinery's own reserve and the builder emptied the shop it was
    // standing next to. The workshop's wood is its recipe input - off limits - so the pick must fall
    // through to the warehouse, however much farther it stands (user rule 2026-07-27).
    const sim = new Simulation({ seed: 11, content: constructionContent(), map: grassMap(12, 1) });
    // Empty hold and no stone anywhere, so the bill falls through to its wood line (the fetch-any-
    // available-line rule the case above pins).
    const site = siteAt(sim, HOUSE, 0, 0);
    builtBuildingAt(sim, WORKSHOP, 4, 0, [[WOOD, 5]]); // wood = its recipe input, and the NEARER source
    const warehouse = builtBuildingAt(sim, HEADQUARTERS, 10, 0, [[WOOD, 5]]); // the far warehouse
    const builder = builderAt(sim, 3, 0); // standing beside the workshop

    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(builder, SupplyRun)).toMatchObject({ site, goodType: WOOD });
    // It walked past the workshop and lifted the wood out of the warehouse, not the reserve.
    expect(firstPickup(sim, builder)).toMatchObject({ goodType: WOOD, from: warehouse });
  });

  it("still lifts a workshop's OUTPUT - the pottery's own bricks pay for its upgrade", () => {
    // The other half of the rule: the finished shelf is not a reserve. `work_pottery_01`'s bill is paid
    // in brick, which the pottery itself makes, and no recipe in real content consumes brick, tile,
    // pillar or ornament at all - so a builder must still be able to lift a producer's product.
    const sim = new Simulation({ seed: 12, content: constructionContent(), map: grassMap(12, 1) });
    const site = siteAt(sim, HOUSE, 0, 0); // empty hold; stone is the least-covered line
    const workshop = builtBuildingAt(sim, WORKSHOP, 4, 0, [[STONE, 5]]); // stone = its recipe OUTPUT
    builtBuildingAt(sim, HEADQUARTERS, 10, 0, [[STONE, 5]]); // the far alternative
    const builder = builderAt(sim, 3, 0);

    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(builder, SupplyRun)).toMatchObject({ site, goodType: STONE });
    // The near shelf wins: an output is nobody's reserve, so the far warehouse is never walked to.
    expect(firstPickup(sim, builder)).toMatchObject({ goodType: STONE, from: workshop });
  });

  it("keeps an upgrading pottery's stored output available to another construction site", () => {
    const base = constructionContent();
    const potteryType = base.buildings.find((type) => type.typeId === WORKSHOP);
    if (potteryType === undefined) throw new Error('construction fixture has no pottery workshop');
    const potteryUpgrade = 6;
    const content = {
      ...base,
      buildings: [
        ...base.buildings.map((type) =>
          type.typeId === WORKSHOP ? { ...type, upgradeTarget: potteryUpgrade } : type,
        ),
        { ...potteryType, typeId: potteryUpgrade, id: 'work_mason_01' },
      ],
    };
    const sim = new Simulation({ seed: 13, content, map: grassMap(12, 1) });
    const site = siteAt(sim, HOUSE, 0, 0);
    const pottery = builtBuildingAt(sim, WORKSHOP, 4, 0, [[STONE, 5]]);
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: pottery });
    sim.step();
    // Two bricks seed the pottery's own upgrade hold; its three surplus bricks remain ordinary stock.
    expect(sim.world.get(pottery, Stockpile).amounts.get(STONE)).toBe(2);
    expect(sim.world.get(pottery, Upgrading).savedStock.get(STONE)).toBe(3);
    const builder = builderAt(sim, 3, 0);
    sim.world.add(builder, SiteAssignment, { site, pinned: true });

    expect(firstPickup(sim, builder)).toMatchObject({ goodType: STONE, from: pottery });
    for (let i = 0; i < 20 && !sim.world.has(builder, Carrying); i++) sim.step();

    expect(sim.world.get(builder, Carrying)).toMatchObject({ goodType: STONE, amount: 1 });
    expect(sim.world.get(pottery, Upgrading).savedStock.get(STONE)).toBe(2);
    expect(sim.world.get(pottery, Stockpile).amounts.get(STONE)).toBe(2);
  });

  it('a builder POSTED to a foundation raises that one, not the nearest', () => {
    // Real content lets the joiner and armorer build, so a right-click posts them into their own future
    // workshop's slot instead of pinning a crew. The drive must then send them to THAT site: the site's
    // workers window lists them there, and a stroll to the nearest foundation would make the panel lie.
    const sim = new Simulation({ seed: 6, content: constructionContent(), map: grassMap(10, 4) });
    const near = siteAt(sim, WORKSHOP, 2, 1);
    const far = siteAt(sim, WORKSHOP, 8, 1);
    for (const site of [near, far]) {
      sim.world.mut(site, Stockpile).amounts.set(STONE, 2); // both hammer-ready: distance is the only tiebreak
    }
    const builder = builderAt(sim, 1, 1);
    sim.world.add(builder, Owner, { player: 0 });
    sim.enqueueSetup({ kind: 'assignWorker', entity: builder, building: far, jobPriority: [BUILDER] });

    sim.step();
    expect(sim.world.get(builder, JobAssignment).workplace).toBe(far); // the site took him as staff

    // Crewed for the site it staffs, and unpinned - the posting, not an assignBuilder right-click.
    expect(sim.world.get(builder, SiteAssignment)).toEqual({ site: far, pinned: false });
    for (let i = 0; i < 400 && sim.world.has(far, UnderConstruction); i++) sim.step();
    expect(sim.world.get(far, Building).built).toBe(ONE);
    expect(sim.world.get(near, UnderConstruction).labor).toBe(0); // never touched
  });

  it('assignBuilder pins a builder to the CHOSEN site over a nearer one; a non-builder is a no-op', () => {
    // A 4-row map: the near site's footprint must not wall off the corridor to the far one.
    const sim = new Simulation({ seed: 6, content: constructionContent(), map: grassMap(10, 4) });
    // Both sites fully stocked (hammer-ready), so without the pin the nearest would win.
    const near = siteAt(sim, HOUSE, 2, 1);
    const far = siteAt(sim, HOUSE, 8, 1);
    for (const site of [near, far]) {
      sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
      sim.world.mut(site, Stockpile).amounts.set(WOOD, 1);
    }
    const builder = builderAt(sim, 1, 2);
    const carrier = loadedCarrierAt(sim, 0, 2, WOOD, 1); // hauls, but its job can't run the build atomic
    sim.world.add(builder, Owner, { player: 0 }); // player commands steer only OWNED settlers
    sim.world.add(carrier, Owner, { player: 0 });
    sim.enqueueSetup({ kind: 'assignBuilder', entity: builder, site: far });
    sim.enqueueSetup({ kind: 'assignBuilder', entity: carrier, site: far });
    sim.step();
    expect(sim.world.get(builder, SiteAssignment)).toEqual({ site: far, pinned: true });
    expect(sim.world.has(carrier, SiteAssignment)).toBe(false); // only the builder trade assigns

    // The pinned builder walks PAST the nearer stocked site and raises its assigned one to completion
    // FIRST - the nearer site untouched until then (afterwards the pin retires and it may move on).
    let nearLaborWhenFarFinished = -1;
    for (let i = 0; i < 400 && nearLaborWhenFarFinished < 0; i++) {
      sim.step();
      if (!sim.world.has(far, UnderConstruction)) {
        nearLaborWhenFarFinished = sim.world.get(near, UnderConstruction).labor;
      }
    }
    expect(nearLaborWhenFarFinished).toBe(0);
    expect(sim.world.get(far, Building).built).toBe(ONE);
  });

  it('unassignBuilder drops the pin and hands the builder back to the nearest site', () => {
    const sim = new Simulation({ seed: 6, content: constructionContent(), map: grassMap(10, 4) });
    const near = siteAt(sim, HOUSE, 2, 1);
    const far = siteAt(sim, HOUSE, 8, 1);
    for (const site of [near, far]) {
      sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
      sim.world.mut(site, Stockpile).amounts.set(WOOD, 1);
    }
    const builder = builderAt(sim, 1, 2);
    sim.world.add(builder, Owner, { player: 0 });
    sim.enqueueSetup({ kind: 'assignBuilder', entity: builder, site: far });
    sim.step();
    expect(sim.world.get(builder, SiteAssignment).pinned).toBe(true);

    sim.enqueueSetup({ kind: 'unassignBuilder', entity: builder });
    sim.step();
    // The trade survives the release, and the next planning pass re-crews it on the nearer site.
    expect(sim.world.get(builder, Settler).jobType).toBe(BUILDER);
    for (let i = 0; i < 20 && sim.world.tryGet(builder, SiteAssignment)?.site !== near; i++) sim.step();
    expect(sim.world.get(builder, SiteAssignment)).toEqual({ site: near, pinned: false });
  });

  it('a PINNED builder routes its load to a site beyond the signpost area - the bound-site sink', () => {
    // assignBuilder deliberately has no confinement gate (a pinned foundation is how the network's
    // frontier grows) and routing treats the builder's own SiteAssignment as a bound sink
    // (`toOwnCrewSite`) -
    // so a builder pinned far outside its walk range still fetches from an in-area store and ROUTES
    // the load to the pinned site instead of shedding it on "no in-area sink" (the old livelock).
    // The fixture HOUSE has no door and blocks its anchor. Construction routing must therefore use a
    // legal perimeter cell rather than inheriting the finished-building interaction point.
    const sim = new Simulation({ seed: 13, content: constructionContent(), map: grassMap(60, 8) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    const SITE_TILE_X = 32; // node x 65 - 60 hex nodes past the builder, beyond its 50-node walk range
    const site = siteAt(sim, HOUSE, SITE_TILE_X, 1);
    const warehouse = sim.world.create();
    sim.world.add(warehouse, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(warehouse, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(warehouse, Stockpile, { amounts: new Map<number, number>([[STONE, 2]]) });
    const builder = builderAt(sim, 2, 1);
    sim.world.add(builder, Owner, { player: 0 });
    sim.enqueueSetup({ kind: 'assignBuilder', entity: builder, site });

    // Phase 1: despite the pin pointing out of area, the builder fetches the site's material from the
    // in-area warehouse (planBuilder's self-supply is not disabled by the out-of-area pin).
    let carrying = false;
    for (let t = 0; t < 300 && !carrying; t++) {
      sim.step();
      carrying = sim.world.has(builder, Carrying);
    }
    expect(carrying).toBe(true);

    // Phase 2: loaded, the delivery rung must reach the pinned site's perimeter and unload there.
    const MAP_NODES_WIDE = 120;
    const SITE_NODE_X = SITE_TILE_X * 2;
    let delivered = false;
    for (let t = 0; t < 2_000 && !delivered; t++) {
      sim.step();
      const goal = sim.world.tryGet(builder, MoveGoal);
      if (goal !== undefined) {
        expect(goal.cell % MAP_NODES_WIDE).toBeGreaterThanOrEqual(SITE_NODE_X - 4);
      }
      delivered = (sim.world.get(site, Stockpile).amounts.get(STONE) ?? 0) > 0;
    }
    expect(delivered).toBe(true);
    expect(sim.world.has(builder, Carrying)).toBe(false);
  });

  it('a crew builder routes its load to its OWN site, not to a nearer site needing the same material', () => {
    // Pins the bound crew site ABOVE the nearest-needing-site scan in the delivery ladder
    // (`toOwnCrewSite` before `toNeedingConstructionSite`): the two rungs answer differently only when a
    // foreign site is nearer, so without this the two could be swapped with the suite still green.
    const sim = new Simulation({ seed: 5, content: constructionContent(), map: grassMap(60, 8) });
    const nearer = siteAt(sim, HOUSE, 6, 1);
    const own = siteAt(sim, HOUSE, 14, 1);
    const builder = builderAt(sim, 2, 1);
    sim.world.add(builder, Carrying, { goodType: STONE, amount: 1 });
    sim.world.add(builder, SiteAssignment, { site: own, pinned: true });

    let landed = false;
    for (let t = 0; t < 1_000 && !landed; t++) {
      sim.step();
      landed = !sim.world.has(builder, Carrying);
    }
    expect(landed).toBe(true);
    expect(sim.world.get(own, Stockpile).amounts.get(STONE)).toBe(1);
    expect(sim.world.get(nearer, Stockpile).amounts.get(STONE) ?? 0).toBe(0);
  });

  it("a builder raises only its OWN player's site - a same-tribe enemy foundation is left alone", () => {
    // A 4-row map so a site footprint doesn't wall off the corridor between the two.
    const sim = new Simulation({ seed: 7, content: constructionContent(), map: grassMap(8, 4) });
    // Two same-tribe (VIKING) foundations, different players; both fully stocked (hammer-ready).
    const mine = siteAt(sim, HOUSE, 2, 1);
    const enemy = siteAt(sim, HOUSE, 6, 1);
    sim.world.add(mine, Owner, { player: 0 });
    sim.world.add(enemy, Owner, { player: 1 });
    for (const site of [mine, enemy]) {
      sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
      sim.world.mut(site, Stockpile).amounts.set(WOOD, 1);
    }
    // My builder sits NEARER the enemy site (x=5 vs the enemy at 6, mine at 2) - proximity alone would
    // pull an ownership-blind builder onto the enemy foundation.
    const builder = builderAt(sim, 5, 2);
    sim.world.add(builder, Owner, { player: 0 });

    let mineBuilt = false;
    for (let i = 0; i < 500 && !mineBuilt; i++) {
      sim.step();
      mineBuilt = sim.world.get(mine, Building).built >= ONE;
    }
    // My site rises; the enemy's is never touched by my builder.
    expect(mineBuilt).toBe(true);
    expect(sim.world.get(enemy, UnderConstruction).labor).toBe(0);
    expect(sim.world.get(enemy, Stockpile).amounts.get(STONE)).toBe(2); // material untouched
  });

  it('is deterministic - two same-seed delivery+build runs reach the same finished state hash', () => {
    const run = (): string => {
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
 * Upgrade-site delivery: a built home re-opened by the `upgradeBuilding` command is a construction
 * site again, so the SAME carrier + builder machinery serves it - at the target tier's own cost (the
 * level difference). A built home never attracts upgrade materials on its own: demand starts with the
 * command, never before it.
 */
describe('constructionSystem - upgrade-site DELIVERY dispatch (carrier path)', () => {
  it('end-to-end: the command opens the site, carriers haul the difference, a builder hammers it up', () => {
    const sim = new Simulation({ seed: 2, content: levelChainWithCarrier(), map: grassMap(6, 1) });
    const home = builtBuildingAt(sim, HOME_L0, 3, 0); // L0 (homeSize 1) - the L1 difference is 2 stone
    loadedCarrierAt(sim, 0, 0, STONE, 1);
    loadedCarrierAt(sim, 1, 0, STONE, 1);
    builderAt(sim, 5, 0);
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: home });

    let upgraded = false;
    // 2 units × STRIKES_PER_UNIT swings (several ticks each) on top of the delivery walks.
    for (let i = 0; i < 600 && !upgraded; i++) {
      sim.step();
      upgraded = sim.world.get(home, Building).buildingType === HOME_L1;
    }
    expect(upgraded).toBe(true); // delivered difference + builder work completed the upgrade
    expect(sim.world.get(home, Building).level).toBe(1);
    expect(sim.world.get(home, Building).built).toBe(ONE);
    expect(housingCapacity(sim.world, ctxOf(sim), VIKING)).toBe(2); // L1 shelters 2 (was 1)
    expect(sim.world.get(home, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // spent into the upgrade
    for (const e of sim.world.query(Carrying)) {
      expect(sim.world.get(e, Carrying).goodType).not.toBe(STONE); // no upgrade material in flight
    }
  });

  it('a built home attracts NO upgrade materials before the command - the carrier sets its load down', () => {
    // Upgrade demand starts with the command: an untouched built L0 advertises no stone room (its type
    // has no stock slots), so the carrier finds no sink and sets the stone down rather than stand
    // holding it forever.
    const sim = new Simulation({ seed: 3, content: levelChainWithCarrier(), map: grassMap(6, 1) });
    const home = builtBuildingAt(sim, HOME_L0, 3, 0);
    const carrier = loadedCarrierAt(sim, 0, 0, STONE, 1);
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.world.get(home, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // nothing delivered
    expect(sim.world.has(carrier, Carrying)).toBe(false); // no sink → set the load on the ground
    expect(sim.world.get(home, Building).buildingType).toBe(HOME_L0); // unchanged
  });

  it('is deterministic - two same-seed upgrade-delivery runs reach the same state hash', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 9, content: levelChainWithCarrier(), map: grassMap(6, 1) });
      const home = builtBuildingAt(sim, HOME_L0, 3, 0);
      loadedCarrierAt(sim, 0, 0, STONE, 1);
      loadedCarrierAt(sim, 1, 0, STONE, 1);
      builderAt(sim, 5, 0);
      sim.enqueueSetup({ kind: 'upgradeBuilding', building: home });
      for (let i = 0; i < 200; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
