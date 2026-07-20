import { describe, expect, it } from 'vitest';
import {
  Carrying,
  CurrentAtomic,
  MoveGoal,
  Owner,
  Production,
  Resting,
  Stockpile,
} from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { aiSystem, MAX_GROUND_STACK, stockCapacity } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import {
  BAKEHOUSE,
  buildingAt,
  CARPENTER,
  CARRIER,
  cell,
  ctxOf,
  FARM,
  grassMap,
  HEADQUARTERS,
  PICKUP_ATOMIC,
  PLANK,
  pileAt,
  SAWMILL,
  settlerAt,
  siteAt,
  TWIN_MILL,
  WHEAT,
  WOOD,
  WOODCUTTER,
} from './support.js';

describe('producer self-service — fetching a missing recipe input', () => {
  it('walks to a separate store that holds a missing input', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0); // empty: needs wood for its 1 wood → 1 plank recipe
    buildingAt(sim, HEADQUARTERS, 5, 0, [[WOOD, 3]]); // the warehouse holding the wood
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill); // on its mill, but the mill has no wood

    aiSystem(sim.world, ctxOf(sim));

    // Can't produce (no wood), nothing to haul out — so it heads for the store that holds the input.
    expect(sim.world.has(smith, MoveGoal)).toBe(true);
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 5, 0));
  });

  it('fetches a missing input from another WORKPLACE’s store (the farm next door), like from a warehouse', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The input source scan accepts ANY positioned stockpile that holds the good — a warehouse, a
    // flag pile, or another workplace's own store. Here the good sits in a FARM building's store
    // (nothing lies on the ground): the miller walks there for it all the same.
    const mill = buildingAt(sim, SAWMILL, 0, 0); // needs wood for its recipe
    buildingAt(sim, FARM, 3, 0, [[WOOD, 2]]); // the neighbouring workplace holding the input
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 3, 0));
  });

  it('never strips a neighbouring construction site of its delivered build material', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The ONLY wood nearby sits on a construction site as delivered build material. A producer short
    // of wood must leave it alone — pulling it would drop the site's built fraction and force the
    // builders to re-deliver (the observed "surowce znikają z placu budowy" bug). The site is a
    // delivery sink, never a source, the same guard `nearestStoreHolding` applies to a builder's fetch.
    const mill = buildingAt(sim, SAWMILL, 0, 0); // needs wood for its recipe
    siteAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 2]]); // a half-built store holding delivered wood
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

    // No source to fetch from → the operator waits inside its mill, never walks to the site.
    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
    expect(sim.world.has(smith, MoveGoal)).toBe(false);
  });

  it('picks up exactly the shortfall when standing on the source store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 0, 0);
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 3]]);
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill); // standing on the warehouse (the source)

    aiSystem(sim.world, ctxOf(sim));

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

    aiSystem(sim.world, ctxOf(sim));

    // The carried input routes to the bound workshop (cell 5), NOT the nearer HQ at cell 1.
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 5, 0));
  });

  it('stays on the station while a cycle is already running (does not wander off to fetch)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0);
    sim.world.add(mill, Production, { cycles: [{ goodType: PLANK, elapsed: 2, duration: 20 }] }); // a cycle in flight
    buildingAt(sim, HEADQUARTERS, 5, 0, [[WOOD, 3]]); // wood is available elsewhere…
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

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

    aiSystem(sim.world, ctxOf(sim));

    // A craftsman on its producing station steps inside (observed original behaviour: the miller works
    // in the mill, not standing at the door) — the render hides a Resting settler.
    expect(sim.world.tryGet(smith, Resting)).toEqual({ at: mill });
  });

  it('fetches the next input BEFORE hauling finished output out (goods bank in the shop)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The mill holds a finished plank (haulable) AND is missing its wood input (fetchable) — both
    // branches apply. The producer must fetch first: output banks up in the shop's own store until
    // production can't continue (observed original behaviour — the mill fills with flour before the
    // miller carries any to the warehouse).
    const mill = buildingAt(sim, SAWMILL, 3, 0, [[PLANK, 1]]);
    buildingAt(sim, HEADQUARTERS, 5, 0, [[WOOD, 3]]);
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

    // Heads for the input source — never a pickup of the finished plank out of its own mill.
    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 5, 0));
  });
});

describe('producer self-service — hauling the finished output', () => {
  it('carries its finished output out when it cannot produce', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0, [[PLANK, 1]]); // a finished plank, but no wood to make more
    buildingAt(sim, HEADQUARTERS, 5, 0); // a store that can take the plank
    const smith = settlerAt(sim, 3, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(smith, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toMatchObject({ kind: 'pickup', goodType: PLANK, from: mill });
  });

  it('a bound CARRIER tops the input slot up toward CAPACITY (not just one cycle) and never crafts', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The twin mill (fixture 7: 2 carpenter slots + a carrier slot, wood cap 10) holds ONE wood —
    // enough for the next cycle, so a CRAFTSMAN would stay and produce. The bound CARRIER instead
    // keeps ferrying: its restock target is the input slot's capacity, so it heads for the HQ's wood.
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [[WOOD, 1]]);
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 5]]);
    const porter = settlerAt(sim, 3, 0, CARRIER, mill); // standing on the source already

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(porter, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    // One carry-load per trip (on foot), out of the HQ — topping up the mill's 10-slot, not crafting.
    expect(atomic.effect).toEqual({ kind: 'pickup', goodType: WOOD, amount: 1, from: hq });
  });

  it('a bound CARRIER hauls the finished output out once the inputs are covered', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // Input slot full (10/10), a finished plank waiting — the carrier's next trip is the output run.
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [
      [WOOD, 10],
      [PLANK, 1],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0); // the sink that can take the plank
    const porter = settlerAt(sim, 0, 0, CARRIER, mill);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(porter, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toMatchObject({ kind: 'pickup', goodType: PLANK, from: mill });
  });

  it('a STARVED craftsman fetches its input itself even when a carrier is bound', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The mill is starved (no wood) and holds a haulable plank; the HQ has wood. The bound carrier is
    // elsewhere mid-errand — the craftsman does not wait for it: a starved mill takes wheat from
    // whoever gets there first, so it heads for the HQ (fetch), never a pickup of its own plank.
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [[PLANK, 1]]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 5]]);
    settlerAt(sim, 5, 0, CARRIER, mill); // the bound carrier (elsewhere, mid-errand)
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 3, 0));
  });

  it('a craftsman with nothing else to do hauls even when a carrier is bound', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // Nothing to fetch (no wood anywhere), a haulable plank, a sink for it. The workshop staffs a
    // carrier, but that carrier is the settlement's porter too and plans for its own workshop only
    // now and then — a craftsman that waited for it left a full shelf standing for tens of thousands
    // of ticks (the reported flour-starved bakery). With its own work exhausted, it makes the run.
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [[PLANK, 1]]);
    buildingAt(sim, HEADQUARTERS, 3, 0);
    settlerAt(sim, 5, 0, CARRIER, mill); // the bound carrier (elsewhere, mid-errand)
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, Resting)).toBe(false); // no longer waits inside for the carrier
    const atomic = sim.world.get(smith, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toMatchObject({ kind: 'pickup', goodType: PLANK, from: mill });
  });

  it('never routes a hauled output onto a full or foreign-good ground heap (the per-tile cap)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const ctx = ctxOf(sim);
    // A loose heap advertises at most MAX_GROUND_STACK of the ONE good it holds, and refuses others —
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

describe('producer work seats — one stay-inside seat per batch', () => {
  it('a SURPLUS operator leaves a one-batch mill to fetch instead of waiting inside', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // One batch grinding, no wood left for a second — the twin mill offers ONE work seat. The first
    // operator (planner settler order) keeps the batch running; the second is surplus: instead of
    // idling inside until its colleague finishes, it walks out for the next wood (the "drugi młynarz
    // czeka w środku aż pierwszy skończy" bug).
    const mill = buildingAt(sim, TWIN_MILL, 0, 0);
    sim.world.add(mill, Production, { cycles: [{ goodType: PLANK, elapsed: 2, duration: 20 }] });
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 5]]);
    const first = settlerAt(sim, 0, 0, CARPENTER, mill);
    const second = settlerAt(sim, 0, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(first, Resting)).toEqual({ at: mill });
    expect(sim.world.has(first, MoveGoal)).toBe(false);
    expect(sim.world.get(second, MoveGoal).cell).toBe(cell(sim, 3, 0));
  });

  it('both operators stay inside while the stock feeds two batches', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [[WOOD, 10]]); // seats for both (and then some)
    const first = settlerAt(sim, 0, 0, CARPENTER, mill);
    const second = settlerAt(sim, 0, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

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

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(first, Resting)).toEqual({ at: mill });
    const atomic = sim.world.get(second, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toMatchObject({ kind: 'pickup', goodType: PLANK, from: mill });
  });
});

describe('producer unblocks its own full output slot', () => {
  it('ships one unit out even when a carrier is bound (a blocked workshop never waits on transport)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // Plank slot at the brim with wood on hand: the mill can start nothing until a plank leaves. Before
    // this rung the craftsman stood inside and left the run to its bound carrier — which stalls the
    // workshop for as long as that carrier is busy elsewhere (here: at the far end of the strip).
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [
      [WOOD, 10],
      [PLANK, 20],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0);
    settlerAt(sim, 5, 0, WOODCUTTER); // alive → tech-unlocks PLANK, so the mill really is shelf-blocked
    settlerAt(sim, 5, 0, CARRIER, mill);
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, Resting)).toBe(false);
    const atomic = sim.world.get(smith, CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'pickup', goodType: PLANK, amount: 1, from: mill });
  });

  it('ships the BLOCKED product before fetching the other product’s missing input', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // The upgraded-bakery shape: two products off different inputs. Planks are at the brim with wood on
    // hand (shelf-blocked), while food is merely starved of wheat the HQ holds. Fetching the wheat is the
    // wrong move — it leaves the full slot full — so the blocked product's unit goes out first.
    const shop = buildingAt(sim, BAKEHOUSE, 0, 0, [
      [WOOD, 10],
      [PLANK, 20],
    ]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WHEAT, 5]]); // wheat to fetch AND room for the plank
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, shop);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, MoveGoal)).toBe(false); // never walks off to the HQ for wheat
    expect(sim.world.get(smith, CurrentAtomic).effect).toEqual({
      kind: 'pickup',
      goodType: PLANK, // the blocked product, not whichever output is stocked first
      amount: 1,
      from: shop,
    });
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

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
    expect(sim.world.tryGet(smith, Resting)).toEqual({ at: shop }); // inside, holding a seat
  });

  it('leaves a starved workshop to the fetch rung — a full shelf alone is not the blocker', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // Plank slot full AND no wood: the shelf is not the only thing missing, so shipping a plank would not
    // by itself let the mill grind. The ordinary fetch keeps priority (it un-starves the mill; the shelf
    // clears on the next pass, once the wood is home).
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [[PLANK, 20]]);
    buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 5]]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(smith, MoveGoal).cell).toBe(cell(sim, 3, 0)); // off to the HQ for wood
  });

  it('does not fire when the shelf is full but nothing anywhere can take the good', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    // Blocked mill, no sink for planks at all (no other store) — there is no unblocking trip to make,
    // so the worker falls through to its ordinary idle behaviour instead of lifting a plank it would
    // only shed at its feet (the pickup→shed livelock the delivery probe exists to prevent).
    const mill = buildingAt(sim, TWIN_MILL, 0, 0, [
      [WOOD, 10],
      [PLANK, 20],
    ]);
    settlerAt(sim, 5, 0, WOODCUTTER);
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
    expect(sim.world.tryGet(smith, Resting)).toEqual({ at: mill });
  });

  it('end to end: a mill seeded FULL empties its shelf and resumes producing', () => {
    // The payoff behind the planner decisions above: a mill starting at 20/20 must actually bank planks
    // in the HQ and run fresh cycles. The two cases above are what pin the new rung (both fail without
    // it); this one guards the whole loop against livelock — a shelf that empties but never refills, or
    // a worker that ships and re-fetches the same unit forever.
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(5, 1) });
    const mill = buildingAt(sim, SAWMILL, 1, 0, [
      [WOOD, 20],
      [PLANK, 20],
    ]);
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0);
    settlerAt(sim, 1, 0, CARPENTER, mill);
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
    // lie — the ground counts, so the mill is not starved by goods nobody banked.
    const mill = buildingAt(sim, SAWMILL, 0, 0);
    pileAt(sim, 2, 0, [[WOOD, 3]]);
    const smith = settlerAt(sim, 0, 0, CARPENTER, mill);

    aiSystem(sim.world, ctxOf(sim));

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

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(smith, MoveGoal)).toBe(false);
    expect(sim.world.has(smith, CurrentAtomic)).toBe(false);
    expect(sim.world.tryGet(smith, Resting)).toEqual({ at: mill }); // waits at its own door instead
  });
});

describe('producer loiter — an idle owned worker waits BESIDE the door, not inside', () => {
  it('an owned operator with nothing to do loiters off the door (a MoveGoal beside it, no Resting)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0); // no wood anywhere → nothing to produce/fetch/haul
    const worker = settlerAt(sim, 3, 0, CARPENTER, mill);
    sim.world.add(worker, Owner, { player: 0 });

    aiSystem(sim.world, ctxOf(sim));

    // The user-facing "bored by the door" look: it steps OFF the door to loiter beside it (a MoveGoal to a
    // non-door cell) and never stamps the wait-inside Resting marker.
    expect(sim.world.has(worker, Resting)).toBe(false);
    expect(sim.world.has(worker, CurrentAtomic)).toBe(false);
    expect(sim.world.has(worker, MoveGoal)).toBe(true);
    expect(sim.world.get(worker, MoveGoal).cell).not.toBe(cell(sim, 3, 0)); // beside the door, not on it
  });

  it('an UNOWNED operator keeps the wait-inside (Resting) behaviour — golden fixtures stay byte-identical', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const mill = buildingAt(sim, SAWMILL, 3, 0);
    const worker = settlerAt(sim, 3, 0, CARPENTER, mill); // no Owner

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(worker, Resting)).toEqual({ at: mill }); // waits inside on the door, unchanged
  });
});

describe('producer self-service — end to end', () => {
  it('a smith drains a warehouse of inputs, forges the product, and returns it', () => {
    // 1-row strip: sawmill at 1, HQ at 3 holding 2 wood. A woodcutter is alive (tech-unlocks PLANK
    // production) but has no tree, so it never competes for the wood; the smith self-supplies from the HQ.
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(5, 1) });
    const mill = buildingAt(sim, SAWMILL, 1, 0);
    const hq = buildingAt(sim, HEADQUARTERS, 3, 0, [[WOOD, 2]]);
    settlerAt(sim, 1, 0, CARPENTER, mill); // the smith, on its mill
    settlerAt(sim, 4, 0, WOODCUTTER); // alive → unlocks PLANK; no tree → idles, never touches the wood

    let produced = 0;
    for (let i = 0; i < 400; i++) {
      sim.step();
      for (const ev of sim.events.current()) if (ev.kind === 'goodProduced') produced += ev.amount;
    }

    // The 2 warehouse-stored wood became planks — the smith fetched every unit and forged it.
    expect(produced).toBe(2);
    expect(sim.world.get(hq, Stockpile).amounts.get(WOOD) ?? 0).toBe(0); // warehouse wood fully drained
    // Every plank ends up in a store (the mill hauled its output to the HQ), none stranded on the smith.
    const planksInStores =
      (sim.world.get(hq, Stockpile).amounts.get(PLANK) ?? 0) +
      (sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0);
    expect(planksInStores).toBe(2);
  });
});
