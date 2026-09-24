import { describe, expect, it } from 'vitest';
import {
  Carrying,
  Chat,
  CraftSelection,
  CurrentAtomic,
  LISTEN_ATOMIC_ID,
  MoveGoal,
  Owner,
  PlayerOrder,
  Production,
  Resting,
  SettlerProgress,
  Stockpile,
} from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import {
  MAX_GROUND_STACK,
  plannerSystem,
  productionSystem,
  stockCapacity,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import {
  BAKEHOUSE,
  buildingAt,
  CARPENTER,
  CARRIER,
  cell,
  ctxOf,
  FARM,
  FOOD_SIMPLE,
  FORGE,
  grassMap,
  HEADQUARTERS,
  PICKUP_ATOMIC,
  PLANK,
  PLANK_GATE_RAW_XP,
  pileAt,
  SAWMILL,
  settlerAt,
  siteAt,
  TWIN_MILL,
  WHEAT,
  WOOD,
  WOOD_TRACK,
  WOODCUTTER,
} from './support.js';

describe('producer self-service - fetching a missing recipe input', () => {
  it('walks to a separate store that holds a missing input', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0); // empty: needs wood for its 1 wood → 1 plank recipe
    buildingAt(sim, HEADQUARTERS, 5, 0, [[WOOD, 3]]); // the warehouse holding the wood
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill); // on its mill, but the mill has no wood

    plannerSystem(sim.world, ctxOf(sim));

    // Can't produce (no wood), nothing to haul out - so it heads for the store that holds the input.
    expect(sim.world.has(smith, MoveGoal)).toBe(true);
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 5, 0));
  });

  it('skips a nearer ENEMY store and fetches its missing input from its own side', () => {
    // The same-side rule reaches the workshop supplier too: two players field the same tribe, so a
    // craftsman must not cross into a rival's warehouse for a recipe input.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const mill = buildingAt(sim, SAWMILL, 4, 0); // empty: needs wood for its 1 wood → 1 plank recipe
    const enemyStore = buildingAt(sim, HEADQUARTERS, 2, 0, [[WOOD, 3]]); // NEARER, another player's wood
    const myStore = buildingAt(sim, HEADQUARTERS, 7, 0, [[WOOD, 3]]); // its own side's wood, farther
    const smith = settlerAt(sim, 4, 0, CARPENTER, mill);
    sim.world.add(smith, Owner, { player: 0 });
    sim.world.add(mill, Owner, { player: 0 });
    sim.world.add(enemyStore, Owner, { player: 1 });
    sim.world.add(myStore, Owner, { player: 0 });

    plannerSystem(sim.world, ctxOf(sim));

    // Proximity alone would send it to the enemy warehouse (cell 2); the same-side gate sends it to
    // its own side's wood (cell 7).
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 7, 0));
    expect(sim.world.get(enemyStore, Stockpile).amounts.get(WOOD)).toBe(3); // enemy store untouched
  });

  it('never raids another workshop’s input reserve - a rival consumer’s store is not a warehouse', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    // The nearest wood sits inside a twin mill, which CONSUMES wood: that stock is the neighbour's
    // reserve, and stripping it would starve one shop to feed the other. The miller walks past it to
    // the settlement's warehouse instead.
    const mill = buildingAt(sim, SAWMILL, 0, 0); // needs wood for its recipe
    const rival = buildingAt(sim, TWIN_MILL, 2, 0, [[WOOD, 2]]); // a rival consumer's reserve, next door
    buildingAt(sim, HEADQUARTERS, 6, 0, [[WOOD, 3]]); // the common stock, far away
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 6, 0));
    expect(sim.world.get(rival, Stockpile).amounts.get(WOOD)).toBe(2);
  });

  it('still lifts a good no recipe of the holder consumes (an orphan stock slot is not a sink)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    // The FARM produces wheat and consumes nothing, so wood parked in it is nobody's reserve - the
    // rule protects recipe INPUTS, not every good sitting in a producing building.
    const mill = buildingAt(sim, SAWMILL, 0, 0);
    buildingAt(sim, FARM, 2, 0, [[WOOD, 2]]);
    buildingAt(sim, HEADQUARTERS, 6, 0, [[WOOD, 3]]);
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 2, 0));
  });

  it('never strips a neighbouring construction site of its delivered build material', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The ONLY wood nearby sits on a construction site as delivered build material. A producer short
    // of wood must leave it alone - pulling it would drop the site's built fraction and force the
    // builders to re-deliver (the observed "surowce znikają z placu budowy" bug). The site is a
    // delivery sink, never a source, the same guard `nearestStoreHolding` applies to a builder's fetch.
    const mill = buildingAt(sim, SAWMILL, 0, 0); // needs wood for its recipe
    siteAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 2]]); // a half-built store holding delivered wood
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    // No source to fetch from → the operator waits inside its mill, never walks to the site.
    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
    expect(sim.world.has(smith, MoveGoal)).toBe(false);
  });

  it('picks up exactly the shortfall when standing on the source store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 0, 0);
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 3]]);
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill); // standing on the warehouse (the source)

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(smith, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    // Recipe needs 1 wood and the mill has 0 → fetch the shortfall of 1, out of the HQ.
    expect(atomic.effect).toEqual({ kind: 'pickup', goodType: WOOD, amount: 1, from: hq });
  });

  it('delivers a fetched input to its workshop, not back to the nearer store it came from', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 5, 0); // the workshop, far
    buildingAt(sim, HEADQUARTERS, 1, 0, [[WOOD, 3]]); // a NEARER store
    const smith = settlerAt(sim, 2, 0, CARPENTER, mill);
    sim.world.add(smith, Carrying, { goodType: WOOD, amount: 1 }); // already carrying a fetched input

    plannerSystem(sim.world, ctxOf(sim));

    // The carried input routes to the bound workshop (cell 5), NOT the nearer HQ at cell 1.
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 5, 0));
  });

  it('stays on the station while a cycle is already running (does not wander off to fetch)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0);
    sim.world.add(mill, Production, { cycles: [{ goodType: PLANK, elapsed: 2, duration: 20 }] }); // a cycle in flight
    buildingAt(sim, HEADQUARTERS, 5, 0, [[WOOD, 3]]); // wood is available elsewhere…
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    // …but the mill is producing, so the operator holds the tile (worker-presence gate) rather than
    // leaving to fetch more.
    expect(sim.world.has(smith, MoveGoal)).toBe(false);
    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
  });

  it('works INSIDE the station while a cycle runs (the render-hiding Resting marker)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0);
    sim.world.add(mill, Production, { cycles: [{ goodType: PLANK, elapsed: 2, duration: 20 }] });
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    // A craftsman on its producing station steps inside (observed original behaviour: the miller works
    // in the mill, not standing at the door) - the render hides a Resting settler.
    expect(sim.world.tryGet(smith, Resting)).toEqual({ at: mill });
  });

  it('fetches the next input BEFORE hauling finished output out (goods bank in the shop)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The mill holds a finished plank (haulable) AND is missing its wood input (fetchable) - both
    // branches apply. The producer must fetch first: output banks up in the shop's own store until
    // production can't continue (observed original behaviour - the mill fills with flour before the
    // miller carries any to the warehouse).
    const mill = buildingAt(sim, SAWMILL, 3, 0, [[PLANK, 1]]);
    buildingAt(sim, HEADQUARTERS, 5, 0, [[WOOD, 3]]);
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    // Heads for the input source - never a pickup of the finished plank out of its own mill.
    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 5, 0));
  });

  it('fetches for its own CRAFT PICK, not the first shortfall on the whole shop’s shelf', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    // Both products of the two-product shop are starved, and the merged shop view lists wood before wheat
    // (ascending goodType), so a shop-wide scan sends this food-pinned baker for wood it may never use and
    // its own wheat only on the next trip. The wheat sits FARTHER, so the goal cell alone names the choice.
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0);
    buildingAt(sim, HEADQUARTERS, 2, 0, [[WOOD, 5]]);
    pileAt(sim, 5, 0, [[WHEAT, 5]]);
    const baker = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.add(baker, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(baker, MoveGoal).cell).toBe(cell(sim, 5, 0));
  });

  it('narrows on the XP gate too: a junior with no pick fetches only for what it has EARNED', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    // The rotation's other axis, and the commoner one on real content: every multi-product workshop
    // gates its secondary ware behind `needforgood`, so a junior's pool is a strict subset without any
    // craft pick at all. This baker has not earned PLANK, so the shop's wood is not its errand.
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0);
    buildingAt(sim, HEADQUARTERS, 2, 0, [[WOOD, 5]]);
    pileAt(sim, 5, 0, [[WHEAT, 5]]);
    const baker = settlerAt(sim, 0, 0, CARPENTER, shop);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(baker, MoveGoal).cell).toBe(cell(sim, 5, 0));
  });

  it('keeps the whole shop’s view for an operator that may craft EVERY product', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    // The control for the two cases above: same starved shop, but no pick and every product earned, so
    // this baker's own view IS the merged one and the nearer wood still wins.
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0);
    buildingAt(sim, HEADQUARTERS, 2, 0, [[WOOD, 5]]);
    pileAt(sim, 5, 0, [[WHEAT, 5]]);
    const baker = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.mut(baker, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    settlerAt(sim, 7, 0, WOODCUTTER); // unlocks PLANK for this control case

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(baker, MoveGoal).cell).toBe(cell(sim, 2, 0));
  });

  it('measures the shortfall against ONE cycle, not the sum over every product', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The forge's two products both eat wood, so the merged target is 2 where the pinned ware needs 1.
    // That single wood on the shelf covers this smith's pick, so it crafts; the whole-shop view would
    // send it out to the HQ for a second one.
    const forge = buildingAt(sim, FORGE, 0, 0, [[WOOD, 1]]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 5]]);
    const smith = settlerAt(sim, 0, 0, CARPENTER, forge);
    sim.world.add(smith, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, MoveGoal)).toBe(false);
    expect(sim.world.tryGet(smith, Resting)).toEqual({ at: forge });
  });

  it('falls back to the whole shop’s view for an operator that has earned NOTHING here', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // An empty pool must not read as "no inputs needed": the seat gate has already freed this green
    // carpenter, and stocking the mill for the colleague who CAN mill is still useful work.
    const mill = buildingAt(sim, TWIN_MILL, 0, 0);
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 3]]);
    const green = settlerAt(sim, 3, 0, CARPENTER, mill); // no WOOD_TRACK XP: PLANK is out of reach

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(green, CurrentAtomic).effect).toMatchObject({
      kind: 'pickup',
      goodType: WOOD,
      from: hq,
    });
  });
});

describe('producer self-service - hauling the finished output', () => {
  it('carries its finished output out when it cannot produce', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0, [[PLANK, 1]]); // a finished plank, but no wood to make more
    buildingAt(sim, HEADQUARTERS, 5, 0); // a store that can take the plank
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(smith, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toMatchObject({ kind: 'pickup', goodType: PLANK, from: mill });
  });

  it('a bound CARRIER tops the input slot up toward CAPACITY (not just one cycle) and never crafts', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The twin mill (fixture 7: 2 carpenter slots + a carrier slot, wood cap 10) holds ONE wood -
    // enough for the next cycle, so a CRAFTSMAN would stay and produce. The bound CARRIER instead
    // keeps ferrying: its restock target is the input slot's capacity, so it heads for the HQ's wood.
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [[WOOD, 1]]);
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 5]]);
    const porter = settlerAt(sim, 3, 0, CARRIER, mill); // standing on the source already

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(porter, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    // One carry-load per trip (on foot), out of the HQ - topping up the mill's 10-slot, not crafting.
    expect(atomic.effect).toEqual({ kind: 'pickup', goodType: WOOD, amount: 1, from: hq });
  });

  it('a bound CARRIER hauls the finished output out once the inputs are covered', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // Input slot full (10/10), a finished plank waiting - the carrier's next trip is the output run.
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [
      [WOOD, 10],
      [PLANK, 1],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0); // the sink that can take the plank
    const porter = settlerAt(sim, 0, 0, CARRIER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(porter, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toMatchObject({ kind: 'pickup', goodType: PLANK, from: mill });
  });

  it('a STARVED craftsman fetches its input itself even when a carrier is bound', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The mill is starved (no wood) and holds a haulable plank; the HQ has wood. The bound carrier is
    // elsewhere mid-errand - the craftsman does not wait for it: a starved mill takes wheat from
    // whoever gets there first, so it heads for the HQ (fetch), never a pickup of its own plank.
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [[PLANK, 1]]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 5]]);
    settlerAt(sim, 5, 0, CARRIER, mill); // the bound carrier (elsewhere, mid-errand)
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 3, 0));
  });

  it('a craftsman with nothing else to do hauls even when a carrier is bound', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // Nothing to fetch (no wood anywhere), a haulable plank, a sink for it. The workshop staffs a
    // carrier, but that carrier is the settlement's porter too and plans for its own workshop only
    // now and then - a craftsman that waited for it left a full shelf standing for tens of thousands
    // of ticks (the reported flour-starved bakery). With its own work exhausted, it makes the run.
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [[PLANK, 1]]);
    buildingAt(sim, HEADQUARTERS, 3, 0);
    settlerAt(sim, 5, 0, CARRIER, mill); // the bound carrier (elsewhere, mid-errand)
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, Resting)).toBe(false); // no longer waits inside for the carrier
    const atomic = sim.world.get(smith, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toMatchObject({ kind: 'pickup', goodType: PLANK, from: mill });
  });

  it('never routes a hauled output onto a full or foreign-good ground heap (the per-tile cap)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const ctx = ctxOf(sim);
    // A loose heap advertises at most MAX_GROUND_STACK of the ONE good it holds, and refuses others -
    // the engine's global per-tile ground limit (observed original behaviour; the `ls_goods` heap art
    // has exactly 5 fill states). This is what keeps hauled flour from banking a 14-unit heap on a
    // field tile beside the mill.
    const woodHeap = pileAt(sim, 2, 0, [[WOOD, 2]]);
    const fullHeap = pileAt(sim, 4, 0, [[PLANK, MAX_GROUND_STACK]]);
    expect(stockCapacity(sim.world, ctx, woodHeap, WOOD)).toBe(MAX_GROUND_STACK);
    expect(stockCapacity(sim.world, ctx, woodHeap, PLANK)).toBe(0); // a heap never mixes goods
    expect(stockCapacity(sim.world, ctx, fullHeap, PLANK)).toBe(MAX_GROUND_STACK); // full: have == cap
  });
});

describe('producer work seats - one stay-inside seat per batch', () => {
  it('a SURPLUS operator leaves a one-batch mill to fetch instead of waiting inside', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // One batch grinding, no wood left for a second - the twin mill offers ONE work seat. The first
    // operator (planner settler order) keeps the batch running; the second is surplus: instead of
    // idling inside until its colleague finishes, it walks out for the next wood (the "drugi młynarz
    // czeka w środku aż pierwszy skończy" bug).
    const mill = buildingAt(sim, TWIN_MILL, 0, 0);
    sim.world.add(mill, Production, { cycles: [{ goodType: PLANK, elapsed: 2, duration: 20 }] });
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 5]]);
    const first = settlerAt(sim, 0, 0, CARPENTER, mill);
    const second = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(first, Resting)).toEqual({ at: mill });
    expect(sim.world.has(first, MoveGoal)).toBe(false);
    expect(sim.world.get(second, MoveGoal).cell).toBe(cell(sim, 3, 0));
  });

  it('both operators stay inside while the stock feeds two batches', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [[WOOD, 10]]); // seats for both (and then some)
    const first = settlerAt(sim, 0, 0, CARPENTER, mill);
    const second = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(first, Resting)).toEqual({ at: mill });
    expect(sim.world.tryGet(second, Resting)).toEqual({ at: mill });
  });

  it('a surplus operator with nothing to fetch hauls the banked output out', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // One seat (the running batch), no wood ANYWHERE, planks banked in the mill and a sink for them:
    // the surplus operator's next-best work is the output run.
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [[PLANK, 3]]);
    sim.world.add(mill, Production, { cycles: [{ goodType: PLANK, elapsed: 2, duration: 20 }] });
    buildingAt(sim, HEADQUARTERS, 3, 0);
    const first = settlerAt(sim, 0, 0, CARPENTER, mill);
    const second = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(first, Resting)).toEqual({ at: mill });
    const atomic = sim.world.get(second, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toMatchObject({ kind: 'pickup', goodType: PLANK, from: mill });
  });

  it('frees an operator whose craft pick names the product the shelf CANNOT start', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The two-product shop stocked with wood but no wheat: planks are startable (and this carpenter
    // has earned them), food is not. An operator pinned to food may never touch the plank recipe, so a
    // seat sized off "SOME product is startable" pins it inside a shop it can never run (the AI's
    // iron-only joinery standing on wood it is not allowed to use). Its seat has to answer for ITS
    // rotation. The unpinned twin below is the control: same shelf, and it stays.
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0, [[WOOD, 10]]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WHEAT, 5]]);
    settlerAt(sim, 5, 0, WOODCUTTER); // alive → PLANK is tech-unlocked, so the plank recipe really can start
    const smith = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.mut(smith, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    sim.world.add(smith, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, Resting)).toBe(false);
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 3, 0)); // out for the wheat its pick needs
  });

  it('fetches for the other open product before claiming a new seat', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0, [[WOOD, 10]]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WHEAT, 5]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.mut(smith, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, Resting)).toBe(false);
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 3, 0));
  });

  it('makes a newly available product with a different input while the old shelf still has room', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0, [
      [WOOD, 10],
      [PLANK, 15],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WHEAT, 5]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.mut(smith, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);

    for (let i = 0; i < 500; i++) sim.step();

    expect(sim.world.get(shop, Stockpile).amounts.get(FOOD_SIMPLE) ?? 0).toBeGreaterThan(0);
  });

  it('keeps the last shared input for a second operator fetching its new ingredient', () => {
    const content = testContent();
    const bakery = content.buildings.find((building) => building.typeId === BAKEHOUSE);
    const food = bakery?.recipes[1];
    if (bakery === undefined || food === undefined) throw new Error('fixture shop needs two recipes');
    bakery.workers = [{ jobType: CARPENTER, count: 2 }];
    food.inputs = [
      { goodType: WOOD, amount: 1 },
      { goodType: WHEAT, amount: 1 },
    ];
    const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0, [[WOOD, 1]]);
    const store = buildingAt(sim, HEADQUARTERS, 3, 0, [[WHEAT, 1]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const oldWorker = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.mut(oldWorker, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    sim.world.add(oldWorker, CraftSelection, { goods: [PLANK], cursor: 0 });
    const newWorker = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.add(newWorker, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });

    for (let i = 0; i < 500; i++) sim.step();

    expect(sim.world.get(store, Stockpile).amounts.get(FOOD_SIMPLE) ?? 0).toBe(1);
  });

  it('keeps the seat when the picked product is the one the stock can start', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0, [
      [WOOD, 10],
      [WHEAT, 5],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0);
    const smith = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.add(smith, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(smith, Resting)).toEqual({ at: shop });
  });

  it('frees an operator that has EARNED none of the workplace’s products', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The rotation's other narrowing: the fixture's `needforgood PLANK` row. A carpenter without those
    // repeats can start nothing here however full the shelf is, so the seat gate must let it go
    // (banked planks and a sink: its next-best work is the output run).
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [
      [WOOD, 10],
      [PLANK, 3],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0);
    settlerAt(sim, 5, 0, WOODCUTTER); // alive → PLANK is tech-unlocked, so only the XP gate is left
    const green = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(green, Resting)).toBe(false);
    expect(sim.world.get(green, CurrentAtomic).effect).toMatchObject({
      kind: 'pickup',
      goodType: PLANK,
      from: mill,
    });
  });

  it('seats the same operator once it has earned the product', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [
      [WOOD, 10],
      [PLANK, 3],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);
    sim.world.mut(smith, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(smith, Resting)).toEqual({ at: mill });
  });

  it('stays to advance a running batch its own pick could never have started', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The seat a GRINDING batch needs belongs to whoever is present (the FIFO advance rule), pick or
    // no pick: otherwise a food-pinned operator would walk out on the plank batch it is holding and
    // leave it paused for the whole trip.
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0);
    sim.world.add(shop, Production, { cycles: [{ goodType: PLANK, elapsed: 2, duration: 20 }] });
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WHEAT, 5]]);
    const smith = settlerAt(sim, 0, 0, CARPENTER, shop);
    sim.world.add(smith, CraftSelection, { goods: [FOOD_SIMPLE], cursor: 0 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(smith, Resting)).toEqual({ at: shop });
  });
});

describe('producer unblocks its own full output slot', () => {
  it('ships one unit out even when a carrier is bound (a blocked workshop never waits on transport)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // Plank slot at the brim with wood on hand: the mill can start nothing until a plank leaves. Before
    // this rung the craftsman stood inside and left the run to its bound carrier - which stalls the
    // workshop for as long as that carrier is busy elsewhere (here: at the far end of the strip).
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [
      [WOOD, 10],
      [PLANK, 20],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0);
    settlerAt(sim, 5, 0, WOODCUTTER); // alive → tech-unlocks PLANK, so the mill really is shelf-blocked
    settlerAt(sim, 5, 0, CARRIER, mill);
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, Resting)).toBe(false);
    const atomic = sim.world.get(smith, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'pickup', goodType: PLANK, amount: 1, from: mill });
  });

  it('fetches for a product with shelf room before shipping a blocked product', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // Planks are at the brim with wood on hand, while food can start after fetching wheat. Shipping
    // a plank first lets the plank recipe take the seat again and can starve food indefinitely.
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0, [
      [WOOD, 10],
      [PLANK, 20],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WHEAT, 5]]); // wheat to fetch AND room for the plank
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, shop);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 3, 0));
    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
  });

  it('fetches the second shared input before reopening the full first product', () => {
    const content = testContent();
    const forgeType = content.buildings.find((building) => building.typeId === FORGE);
    const secondRecipe = forgeType?.recipes[1];
    if (secondRecipe === undefined) throw new Error('fixture forge needs its second recipe');
    secondRecipe.inputs = [{ goodType: WOOD, amount: 2 }];
    const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
    const forge = buildingAt(sim, FORGE, 0, 0, [
      [WOOD, 1],
      [PLANK, 20],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 5]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, forge);
    sim.world.mut(smith, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    sim.world.add(smith, CraftSelection, { goods: [PLANK, FOOD_SIMPLE], cursor: 0 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 3, 0));
    expect(sim.world.get(forge, Stockpile).amounts.get(PLANK)).toBe(20);
    for (let i = 0; i < 500; i++) sim.step();
    expect(sim.world.get(forge, Stockpile).amounts.get(FOOD_SIMPLE) ?? 0).toBeGreaterThan(0);
  });

  it('accumulates two shared inputs for the next selected product while the first slot has room', () => {
    const content = testContent();
    const secondRecipe = content.buildings.find((building) => building.typeId === FORGE)?.recipes[1];
    if (secondRecipe === undefined) throw new Error('fixture forge needs its second recipe');
    secondRecipe.inputs = [{ goodType: WOOD, amount: 2 }];
    const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
    const forge = buildingAt(sim, FORGE, 0, 0, [
      [WOOD, 1],
      [PLANK, 15],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 5]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, forge);
    sim.world.mut(smith, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    sim.world.add(smith, CraftSelection, { goods: [PLANK, FOOD_SIMPLE], cursor: 1 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 3, 0));
    for (let i = 0; i < 500; i++) sim.step();
    expect(sim.world.get(forge, Stockpile).amounts.get(FOOD_SIMPLE) ?? 0).toBeGreaterThan(0);
  });

  it('accumulates the second product input with two default-selected operators', () => {
    const content = testContent();
    const forgeType = content.buildings.find((building) => building.typeId === FORGE);
    const secondRecipe = forgeType?.recipes[1];
    if (forgeType === undefined || secondRecipe === undefined)
      throw new Error('fixture forge needs two recipes');
    forgeType.workers = [{ jobType: CARPENTER, count: 2 }];
    secondRecipe.inputs = [{ goodType: WOOD, amount: 2 }];
    const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
    const forge = buildingAt(sim, FORGE, 0, 0, [
      [WOOD, 1],
      [PLANK, 15],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 8]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    for (let i = 0; i < 2; i++) {
      const smith = settlerAt(sim, 0, 0, CARPENTER, forge);
      sim.world.mut(smith, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    }

    for (let i = 0; i < 700; i++) sim.step();

    expect(sim.world.get(forge, Stockpile).amounts.get(FOOD_SIMPLE) ?? 0).toBeGreaterThan(0);
  });

  it('keeps crafting the cheaper product when no source can complete the costly input', () => {
    const content = testContent();
    const secondRecipe = content.buildings.find((building) => building.typeId === FORGE)?.recipes[1];
    if (secondRecipe === undefined) throw new Error('fixture forge needs its second recipe');
    secondRecipe.inputs = [{ goodType: WOOD, amount: 2 }];
    const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
    const forge = buildingAt(sim, FORGE, 0, 0, [[WOOD, 1]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, forge);
    sim.world.mut(smith, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    sim.world.add(smith, CraftSelection, { goods: [PLANK, FOOD_SIMPLE], cursor: 1 });

    sim.step();

    expect(sim.world.get(forge, Production).cycles[0]?.goodType).toBe(PLANK);
  });

  it('skips a full product before an unfundable partial recipe', () => {
    const content = testContent();
    const forgeType = content.buildings.find((building) => building.typeId === FORGE);
    const costly = forgeType?.recipes[1];
    if (forgeType === undefined || costly === undefined) throw new Error('fixture forge needs two recipes');
    costly.inputs = [{ goodType: WOOD, amount: 2 }];
    forgeType.stock.push({ goodType: 7, capacity: 20, initial: 0 });
    forgeType.recipes.push({
      inputs: [{ goodType: WOOD, amount: 1 }],
      outputs: [{ goodType: 7, amount: 1 }],
      ticks: 20,
    });
    const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
    const forge = buildingAt(sim, FORGE, 0, 0, [
      [WOOD, 1],
      [PLANK, 20],
    ]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, forge);
    sim.world.mut(smith, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    sim.world.add(smith, CraftSelection, { goods: [PLANK, FOOD_SIMPLE, 7], cursor: 0 });

    sim.step();

    expect(sim.world.get(forge, Production).cycles[0]?.goodType).toBe(7);
  });

  it('holds a partially stocked input while a bound carrier brings the last unit', () => {
    const content = testContent();
    const forgeType = content.buildings.find((building) => building.typeId === FORGE);
    const secondRecipe = forgeType?.recipes[1];
    if (forgeType === undefined || secondRecipe === undefined)
      throw new Error('fixture forge needs its second recipe');
    forgeType.workers.push({ jobType: CARRIER, count: 1 });
    secondRecipe.inputs = [{ goodType: WOOD, amount: 2 }];
    const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
    const forge = buildingAt(sim, FORGE, 0, 0, [[WOOD, 1]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, forge);
    sim.world.mut(smith, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    sim.world.add(smith, CraftSelection, { goods: [PLANK, FOOD_SIMPLE], cursor: 1 });
    const carrier = settlerAt(sim, 3, 0, CARRIER, forge);
    sim.world.add(carrier, Carrying, { goodType: WOOD, amount: 1 });

    for (let i = 0; i < 500; i++) sim.step();

    expect(sim.world.get(forge, Stockpile).amounts.get(FOOD_SIMPLE) ?? 0).toBeGreaterThan(0);
  });

  it('does not wait for a carrier whose player order prevents delivery', () => {
    const content = testContent();
    const forgeType = content.buildings.find((building) => building.typeId === FORGE);
    const secondRecipe = forgeType?.recipes[1];
    if (forgeType === undefined || secondRecipe === undefined)
      throw new Error('fixture forge needs its second recipe');
    forgeType.workers.push({ jobType: CARRIER, count: 1 });
    secondRecipe.inputs = [{ goodType: WOOD, amount: 2 }];
    const sim = new Simulation({ seed: 1, content, map: grassMap(6, 1) });
    const forge = buildingAt(sim, FORGE, 0, 0, [[WOOD, 1]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, forge);
    sim.world.mut(smith, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    sim.world.add(smith, CraftSelection, { goods: [PLANK, FOOD_SIMPLE], cursor: 1 });
    const diverted = settlerAt(sim, 3, 0, CARRIER, forge);
    sim.world.add(diverted, Carrying, { goodType: WOOD, amount: 1 });
    sim.world.add(diverted, PlayerOrder, {});

    plannerSystem(sim.world, ctxOf(sim));
    productionSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(forge, Production).cycles[0]?.goodType).toBe(PLANK);
  });

  it('keeps crafting the product that still has shelf room (a full slot is not a full workshop)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The same two-product shop, but now the wheat is in-house: food is startable, so the workshop is
    // not blocked at all and the craftsman holds a work seat instead of ferrying planks about.
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0, [
      [WOOD, 10],
      [PLANK, 20],
      [WHEAT, 5],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, shop);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
    expect(sim.world.tryGet(smith, Resting)).toEqual({ at: shop }); // inside, holding a seat
  });

  it('leaves a starved workshop to the fetch rung - a full shelf alone is not the blocker', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // Plank slot full AND no wood: the shelf is not the only thing missing, so shipping a plank would not
    // by itself let the mill grind. The ordinary fetch keeps priority (it un-starves the mill; the shelf
    // clears on the next pass, once the wood is home).
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [[PLANK, 20]]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 5]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 3, 0)); // off to the HQ for wood
  });

  it('does not fire when the shelf is full but nothing anywhere can take the good', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // Blocked mill, no sink for planks at all (no other store) - there is no unblocking trip to make,
    // so the worker falls through to its ordinary idle behaviour instead of lifting a plank it would
    // only shed at its feet (the pickup→shed livelock the delivery probe exists to prevent).
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [
      [WOOD, 10],
      [PLANK, 20],
    ]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
    expect(sim.world.tryGet(smith, Resting)).toEqual({ at: mill });
  });

  it('end to end: a mill seeded FULL empties its shelf and resumes producing', () => {
    // The payoff behind the planner decisions above: a mill starting at 20/20 must actually bank planks
    // in the HQ and run fresh cycles. The two cases above are what pin the new rung (both fail without
    // it); this one guards the whole loop against livelock - a shelf that empties but never refills, or
    // a worker that ships and re-fetches the same unit forever.
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(5, 1) });
    const mill = buildingAt(sim, SAWMILL, 1, 0, [
      [WOOD, 20],
      [PLANK, 20],
    ]);
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0);
    const smith = settlerAt(sim, 1, 0, CARPENTER, mill);
    // The fixture's `needforgood PLANK` gate, earned up front - this case is about the shelf loop.
    sim.world.mut(smith, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    settlerAt(sim, 4, 0, WOODCUTTER); // unlocks PLANK; no tree, so it never competes for the wood

    let produced = 0;
    for (let i = 0; i < 2000; i++) {
      sim.step();
      for (const ev of sim.events.current()) if (ev.kind === 'goodProduced') produced += ev.amount;
    }

    expect(produced).toBeGreaterThan(0); // the workshop restarted
    expect(sim.world.get(hq, Stockpile).amounts.get(PLANK) ?? 0).toBeGreaterThan(0); // planks reached the store
  });
});

describe('producer works ONLY its own workplace’s goods (its own building’s carrier)', () => {
  it('collects a missing input off the GROUND, not just out of a warehouse', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The mill's wood lies in a loose heap on the ground rather than in a store. A craftsman that
    // cannot craft is its own workplace's carrier, and that carrier brings inputs in from wherever they
    // lie - the ground counts, so the mill is not starved by goods nobody banked.
    const mill = buildingAt(sim, SAWMILL, 0, 0);
    pileAt(sim, 2, 0, [[WOOD, 3]]);
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 2, 0)); // heads for the loose wood
  });

  it('leaves a loose pile of a good its recipe does not use well alone', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // A heap of PLANKs (the mill's OUTPUT, not an input) beside an idle mill with a sink for them. The
    // craftsman is not a general porter: it ferries its own workplace's goods and nobody else's, so a
    // pile that is not its input and not out of its own store is somebody else's errand.
    const mill = buildingAt(sim, SAWMILL, 0, 0);
    buildingAt(sim, HEADQUARTERS, 5, 0); // a sink that would happily take the planks
    pileAt(sim, 2, 0, [[PLANK, 3]]);
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, MoveGoal)).toBe(false);
    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
    expect(sim.world.tryGet(smith, Resting)).toEqual({ at: mill }); // waits at its own door instead
  });
});

describe('producer loiter - an idle owned worker waits BESIDE the door, not inside', () => {
  it('an owned operator with nothing to do loiters off the door (a MoveGoal beside it, no Resting)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0); // no wood anywhere → nothing to produce/fetch/haul
    const worker = settlerAt(sim, 3, 0, CARPENTER, mill);
    sim.world.add(worker, Owner, { player: 0 });

    plannerSystem(sim.world, ctxOf(sim));

    // The user-facing "bored by the door" look: it steps OFF the door to loiter beside it (a MoveGoal to a
    // non-door cell) and never stamps the wait-inside Resting marker.
    expect(sim.world.has(worker, Resting)).toBe(false);
    expect(sim.world.has(worker, CurrentAtomic)).toBe(false);
    expect(sim.world.has(worker, MoveGoal)).toBe(true);
    expect(sim.world.get(worker, MoveGoal).cell).not.toBe(cell(sim, 3, 0)); // beside the door, not on it
  });

  it('a loiterer grabbed into idle chatter keeps chatting: standing by the door is not work', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0);
    const worker = settlerAt(sim, 3, 0, CARPENTER, mill);
    sim.world.add(worker, Owner, { player: 0 });
    const idler = settlerAt(sim, 0, 0, WOODCUTTER); // no tree: idle for good
    sim.world.add(idler, Owner, { player: 0 });

    let paired = false;
    for (let i = 0; i < 400 && !paired; i++) {
      sim.step();
      paired = sim.world.tryGet(worker, Chat)?.kind === 'pastime';
    }
    expect(paired).toBe(true);
    const chat = sim.world.get(worker, Chat);
    let talking = false;
    for (let i = 0; i < 200 && !talking; i++) {
      sim.step();
      talking = sim.world.tryGet(worker, CurrentAtomic)?.atomicId === LISTEN_ATOMIC_ID;
    }

    // The same chat reached its talk round: the worker's own loiter rung neither ended it nor started
    // another while the idler walked over.
    expect(talking).toBe(true);
    expect(sim.world.get(worker, Chat)).toBe(chat);
  });

  it('a loiterer that walked off to an idle partner holds the chat on arrival', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0);
    const worker = settlerAt(sim, 3, 0, CARPENTER, mill);
    sim.world.add(worker, Owner, { player: 0 });
    const idler = settlerAt(sim, 0, 0, WOODCUTTER); // no tree: idle for good
    sim.world.add(idler, Owner, { player: 0 });
    for (let i = 0; i < 20; i++) sim.step(); // the worker settles beside its door
    expect(sim.world.has(worker, MoveGoal)).toBe(false);

    // The loiter rung's own idle chat, seeking the distant idler: the gossip system walks it over.
    sim.world.add(worker, Chat, {
      partner: idler,
      seeker: true,
      talking: false,
      speaks: true,
      kind: 'pastime',
    });
    sim.world.add(idler, Chat, {
      partner: worker,
      seeker: false,
      talking: false,
      speaks: false,
      kind: 'pastime',
    });
    let talking = false;
    for (let i = 0; i < 200 && !talking; i++) {
      sim.step();
      talking = sim.world.tryGet(worker, Chat)?.talking === true;
    }
    expect(talking).toBe(true); // arriving, it talks rather than walking straight back to the door
  });

  it('an UNOWNED operator keeps the wait-inside (Resting) behaviour - golden fixtures stay byte-identical', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0);
    const worker = settlerAt(sim, 3, 0, CARPENTER, mill); // no Owner

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(worker, Resting)).toEqual({ at: mill }); // waits inside on the door, unchanged
  });
});

describe('producer self-service - end to end', () => {
  it('a smith drains a warehouse of inputs, forges the product, and returns it', () => {
    // 1-row strip: sawmill at 1, HQ at 3 holding 2 wood. A woodcutter is alive (tech-unlocks PLANK
    // production) but has no tree, so it never competes for the wood; the smith self-supplies from the HQ.
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(5, 1) });
    const mill = buildingAt(sim, SAWMILL, 1, 0);
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 2]]);
    const smith = settlerAt(sim, 1, 0, CARPENTER, mill); // the smith, on its mill
    // The fixture's `needforgood PLANK` gate, earned up front - this case is about self-supply.
    sim.world.mut(smith, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
    settlerAt(sim, 4, 0, WOODCUTTER); // alive → unlocks PLANK; no tree → idles, never touches the wood

    let produced = 0;
    for (let i = 0; i < 400; i++) {
      sim.step();
      for (const ev of sim.events.current()) if (ev.kind === 'goodProduced') produced += ev.amount;
    }

    // The 2 warehouse-stored wood became planks - the smith fetched every unit and forged it.
    expect(produced).toBe(2);
    expect(sim.world.get(hq, Stockpile).amounts.get(WOOD) ?? 0).toBe(0); // warehouse wood fully drained
    // Every plank ends up in a store (the mill hauled its output to the HQ), none stranded on the smith.
    const planksInStores =
      (sim.world.get(hq, Stockpile).amounts.get(PLANK) ?? 0) +
      (sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0);
    expect(planksInStores).toBe(2);
  });
});
