import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  MoveGoal,
  Owner,
  Position,
  SiteAssignment,
  Stockpile,
  SupplyRun,
  UnderConstruction,
} from '../../../src/components/index.js';
import { fx, ONE, positionOfNode, Simulation } from '../../../src/index.js';
import { aiSystem, housingCapacity } from '../../../src/systems/index.js';

import {
  builderAt,
  builtHomeAt,
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
} from './support.js';

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
    // The build takes 3 units × STRIKES_PER_UNIT swings (several ticks each) even with the material
    // already inbound, so the tick budget covers the full hammer-out at the tuned ~1%/strike pace.
    for (let i = 0; i < 600 && !built; i++) {
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
    // The global one-good-per-person rule: no lift ever exceeds CARRY_CAPACITY — three units take
    // three trips (source basis: observed original behavior — no on-foot batch exists in the game).
    expect(maxCarried).toBe(1);
    expect(sim.world.get(warehouse, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // drawn from the warehouse
    expect(sim.world.get(site, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // and spent into the build
  });

  it('a missing material never blocks the others — the builder fetches what IS available and builds partway', () => {
    // The house bill is 2 stone + 1 wood; the warehouse holds ONLY the wood. The least-covered pick on an
    // empty hold is stone (tie broken by ascending goodType), which has no source anywhere — the builder
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

    // With the wood on hand the builder hammers the delivered third and no further — the site keeps
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

  it('only ONE builder fetches the last missing unit — the supply-run reservation stops the duplicate', () => {
    const sim = new Simulation({ seed: 5, content: constructionContent(), map: grassMap(8, 1) });
    const site = siteAt(sim, HOUSE, 4, 0); // cost 2 stone + 1 wood…
    sim.world.get(site, Stockpile).amounts.set(STONE, 1);
    sim.world.get(site, Stockpile).amounts.set(WOOD, 1); // …with only 1 stone still missing
    const warehouse = sim.world.create();
    sim.world.add(warehouse, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(warehouse, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(warehouse, Stockpile, { amounts: new Map<number, number>([[STONE, 3]]) });
    builderAt(sim, 3, 0);
    builderAt(sim, 5, 0);

    // Run through the hammer-then-fetch phase: the warehouse must only ever lose the ONE lifted stone —
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

  it('a builder COHORT self-supplying one site never over-fetches — the inbound tally sums concurrent runs', () => {
    // Four builders, one foundation needing 2 stone + 1 wood, one warehouse holding a big surplus of both.
    // Each tick several builders replan at once and read the shared inbound tally: it must fold every
    // concurrent SupplyRun so the crew fetches exactly the 3 outstanding units (spread across materials),
    // never a duplicate — the tally reproducing the old per-call full-store scan under real concurrency.
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
    // surplus (stockCapacity gate), and the extra loads wander back INTO the warehouse — restoring the
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
    expect(minStone).toBe(7); // only the 2 stone the site needs were ever lifted — never a duplicate
    expect(minWood).toBe(8); // only the 1 wood
    expect(sim.world.get(warehouse, Stockpile).amounts.get(STONE) ?? 0).toBe(7); // 9 − 2 spent
    expect(sim.world.get(warehouse, Stockpile).amounts.get(WOOD) ?? 0).toBe(8); // 9 − 1 spent
  });

  it('overlaps a fetch with the hammering: the lead builder hammers while exactly one peels off for the missing good', () => {
    // A hammer-ready site (2 of its 2 stone already on hand) still short ONE wood, three builders on it,
    // and a warehouse holding the wood. The whole crew COULD hammer the delivered stone up to the 2/3 cap,
    // but that would stall on one late fetch trip. Instead only the lead (lowest-id) builder is pinned to
    // the hammer; the other two try to fetch first, and the SupplyRun reservation lets exactly ONE claim
    // the single missing wood — so the deficit closes in parallel with the hammering (the user's rule:
    // "4 build, 1 goes for the last resource").
    const sim = new Simulation({ seed: 21, content: constructionContent(), map: grassMap(12, 3) });
    const site = siteAt(sim, HOUSE, 6, 1); // cost 2 stone + 1 wood
    sim.world.get(site, Stockpile).amounts.set(STONE, 2); // stone fully on hand → hammerable, wood missing
    const warehouse = sim.world.create();
    sim.world.add(warehouse, Position, { x: fx.fromInt(0), y: fx.fromInt(1) });
    sim.world.add(warehouse, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(warehouse, Stockpile, { amounts: new Map<number, number>([[WOOD, 3]]) });
    const lead = builderAt(sim, 5, 1); // lowest id — the pinned hammerer
    const second = builderAt(sim, 7, 1);
    const third = builderAt(sim, 6, 2);

    aiSystem(sim.world, ctxOf(sim));

    // Exactly one builder peeled off to fetch the wood, and it is not the lead.
    const runners = [lead, second, third].filter((b) => sim.world.has(b, SupplyRun));
    expect(runners).toHaveLength(1);
    expect(sim.world.has(lead, SupplyRun)).toBe(false); // the lead stays on the hammer
    for (const runner of runners) {
      expect(sim.world.get(runner, SupplyRun)).toMatchObject({ site, goodType: WOOD });
    }
  });

  it('a builder fetch skips a pile buried under walls for the nearest reachable source', () => {
    // A stone pile left INSIDE a standing house's walk-blocked body (the leftover the footprint goods
    // eviction could not land, or hand-dropped state): geometrically the nearest source, but its stand
    // is unreachable — committing to it would path-fail and strand the builder on a retry loop. The
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
    const buried = sim.world.create(); // on the wall node — nearer to the builder than the free pile
    sim.world.add(buried, Position, positionOfNode(10, 4));
    sim.world.add(buried, Stockpile, { amounts: new Map<number, number>([[STONE, 1]]) });
    const free = sim.world.create();
    sim.world.add(free, Position, positionOfNode(20, 4));
    sim.world.add(free, Stockpile, { amounts: new Map<number, number>([[STONE, 1]]) });
    const builder = builderAt(sim, 0, 0);
    const at = positionOfNode(6, 4);
    const pos = sim.world.get(builder, Position);
    pos.x = at.x;
    pos.y = at.y;

    aiSystem(sim.world, ctxOf(sim));

    // The fetch was stamped for the site's stone — and the walk goal is the REACHABLE pile's tile,
    // not the nearer buried one.
    expect(sim.world.get(builder, SupplyRun)).toMatchObject({ site, goodType: STONE });
    expect(sim.world.get(builder, MoveGoal).cell).toBe(terrain.nodeAt(20, 4));
  });

  it('assignBuilder pins a builder to the CHOSEN site over a nearer one; a non-builder is a no-op', () => {
    // A 4-row map: the near site's footprint must not wall off the corridor to the far one.
    const sim = new Simulation({ seed: 6, content: constructionContent(), map: grassMap(10, 4) });
    // Both sites fully stocked (hammer-ready), so without the pin the nearest would win.
    const near = siteAt(sim, HOUSE, 2, 1);
    const far = siteAt(sim, HOUSE, 8, 1);
    for (const site of [near, far]) {
      sim.world.get(site, Stockpile).amounts.set(STONE, 2);
      sim.world.get(site, Stockpile).amounts.set(WOOD, 1);
    }
    const builder = builderAt(sim, 1, 2);
    const carrier = loadedCarrierAt(sim, 0, 2, WOOD, 1); // hauls, but its job can't run the build atomic
    sim.world.add(builder, Owner, { player: 0 }); // player commands steer only OWNED settlers
    sim.world.add(carrier, Owner, { player: 0 });
    sim.enqueue({ kind: 'assignBuilder', entity: builder, site: far });
    sim.enqueue({ kind: 'assignBuilder', entity: carrier, site: far });
    sim.step();
    expect(sim.world.get(builder, SiteAssignment)).toEqual({ site: far, pinned: true });
    expect(sim.world.has(carrier, SiteAssignment)).toBe(false); // only the builder trade assigns

    // The pinned builder walks PAST the nearer stocked site and raises its assigned one to completion
    // FIRST — the nearer site untouched until then (afterwards the pin retires and it may move on).
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

  it('a PINNED builder routes its load to a site beyond the signpost area — the bound-site sink (3c)', () => {
    // assignBuilder deliberately has no confinement gate (a pinned foundation is how the network's
    // frontier grows) and routing treats the builder's own SiteAssignment as a bound sink (case 3c) —
    // so a builder pinned far outside its local circle still fetches from an in-area store and ROUTES
    // the load to the pinned site instead of shedding it on "no in-area sink" (the old livelock).
    // The fixture HOUSE has no door and blocks its anchor. Construction routing must therefore use a
    // legal perimeter cell rather than inheriting the finished-building interaction point.
    const sim = new Simulation({ seed: 13, content: constructionContent(), map: grassMap(60, 8) });
    sim.enqueue({ kind: 'setSignpostNavigation', enabled: true });
    const SITE_TILE_X = 20; // node x 40 — far beyond the 24-node local circle around the builder
    const site = siteAt(sim, HOUSE, SITE_TILE_X, 1);
    const warehouse = sim.world.create();
    sim.world.add(warehouse, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(warehouse, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(warehouse, Stockpile, { amounts: new Map<number, number>([[STONE, 2]]) });
    const builder = builderAt(sim, 2, 1);
    sim.world.add(builder, Owner, { player: 0 });
    sim.enqueue({ kind: 'assignBuilder', entity: builder, site });

    // Phase 1: despite the pin pointing out of area, the builder fetches the site's material from the
    // in-area warehouse (planBuilder's self-supply is not disabled by the out-of-area pin).
    let carrying = false;
    for (let t = 0; t < 300 && !carrying; t++) {
      sim.step();
      carrying = sim.world.has(builder, Carrying);
    }
    expect(carrying).toBe(true);

    // Phase 2: loaded, the delivery rung must reach the pinned site's perimeter and unload there.
    const MAP_NODES_WIDE = 60;
    const SITE_NODE_X = SITE_TILE_X * 2;
    let delivered = false;
    for (let t = 0; t < 1_000 && !delivered; t++) {
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

  it("a builder raises only its OWN player's site — a same-tribe enemy foundation is left alone", () => {
    // A 4-row map so a site footprint doesn't wall off the corridor between the two.
    const sim = new Simulation({ seed: 7, content: constructionContent(), map: grassMap(8, 4) });
    // Two same-tribe (VIKING) foundations, different players; both fully stocked (hammer-ready).
    const mine = siteAt(sim, HOUSE, 2, 1);
    const enemy = siteAt(sim, HOUSE, 6, 1);
    sim.world.add(mine, Owner, { player: 0 });
    sim.world.add(enemy, Owner, { player: 1 });
    for (const site of [mine, enemy]) {
      sim.world.get(site, Stockpile).amounts.set(STONE, 2);
      sim.world.get(site, Stockpile).amounts.set(WOOD, 1);
    }
    // My builder sits NEARER the enemy site (x=5 vs the enemy at 6, mine at 2) — proximity alone would
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

  it('is deterministic — two same-seed delivery+build runs reach the same finished state hash', () => {
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
 * site again, so the SAME carrier + builder machinery serves it — at the target tier's own cost (the
 * level difference). A built home never attracts upgrade materials on its own: demand starts with the
 * command, never before it.
 */
describe('constructionSystem — upgrade-site DELIVERY dispatch (carrier path)', () => {
  it('end-to-end: the command opens the site, carriers haul the difference, a builder hammers it up', () => {
    const sim = new Simulation({ seed: 2, content: levelChainWithCarrier(), map: grassMap(6, 1) });
    const home = builtHomeAt(sim, HOME_L0, 0, 3, 0); // L0 (homeSize 1) — the L1 difference is 2 stone
    loadedCarrierAt(sim, 0, 0, STONE, 1);
    loadedCarrierAt(sim, 1, 0, STONE, 1);
    builderAt(sim, 5, 0);
    sim.enqueue({ kind: 'upgradeBuilding', building: home });

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

  it('a built home attracts NO upgrade materials before the command — the carrier sets its load down', () => {
    // Upgrade demand starts with the command: an untouched built L0 advertises no stone room (its type
    // has no stock slots), so the carrier finds no sink and sets the stone down rather than stand
    // holding it forever.
    const sim = new Simulation({ seed: 3, content: levelChainWithCarrier(), map: grassMap(6, 1) });
    const home = builtHomeAt(sim, HOME_L0, 0, 3, 0);
    const carrier = loadedCarrierAt(sim, 0, 0, STONE, 1);
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.world.get(home, Stockpile).amounts.get(STONE) ?? 0).toBe(0); // nothing delivered
    expect(sim.world.has(carrier, Carrying)).toBe(false); // no sink → set the load on the ground
    expect(sim.world.get(home, Building).buildingType).toBe(HOME_L0); // unchanged
  });

  it('is deterministic — two same-seed upgrade-delivery runs reach the same state hash', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 9, content: levelChainWithCarrier(), map: grassMap(6, 1) });
      const home = builtHomeAt(sim, HOME_L0, 0, 3, 0);
      loadedCarrierAt(sim, 0, 0, STONE, 1);
      loadedCarrierAt(sim, 1, 0, STONE, 1);
      builderAt(sim, 5, 0);
      sim.enqueue({ kind: 'upgradeBuilding', building: home });
      for (let i = 0; i < 200; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
