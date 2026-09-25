import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Age,
  AssistantGrants,
  addPerson,
  Building,
  Carrying,
  Equipment,
  type EquipmentSlot,
  EquipOrder,
  Female,
  IdleStand,
  MISC_EQUIP_SLOTS,
  MoveGoal,
  Owner,
  Position,
  Stance,
  Stockpile,
  setNeedsEnabled,
  setSettlerJob,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { CHILD_MALE, CIVILIST_JOB, WOMAN_JOB } from '../../src/systems/lifecycle/ageclass.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * The assistant's auto-equip: a granted good is fetched by settlers with a matching free slot, one
 * errand per settler, never more fetchers than store stock. Fixture goods: 8 = shoes / 10 = fur_boots
 * (boots), 11 = tool_wooden (+20%) / 12 = tool_iron (+70%) (tools), 13 = mead (misc); 1 = wood (not
 * wearable).
 */

const SHOES = 8;
const FUR_BOOTS = 10;
const TOOL_WOODEN = 11;
const TOOL_IRON = 12;
const MEAD = 13;
const WOOD = 1;
const WOODCUTTER = 1;
/** The fixture's soldier trade (`soldier_unarmed`) - what `isFighterJob` reads off the job slug. */
const FIGHTER_JOB = 31;
/** The fixture's scout trade (`jobtypes.ini` 27). */
const SCOUT_JOB = 27;
/** The fixture's hero trade. */
const HERO_JOB = 45;
const VIKING = 1;
const HEADQUARTERS = 1;
/** Appended by this suite alone, out of the 10..19 band the shared fixture reserves for that. */
const MINT = 10;
const HUMAN_PLAYER = 0;
const RIVAL_PLAYER = 1;

/** Enough ticks for a stride beat (24) plus a fetch across the small map and the return leg. */
const ERRAND_TICKS = 600;
/** Comfortably past the set-down gesture, so a player errand's dropped load has landed. */
const DROP_ATOMIC_TICKS = 120;
/** Stuck fetchers a reservation test parks, more than the one unit of stock it lays out. */
const STUCK_FETCHERS = 4;

function freshSim(): Simulation {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 6) });
  setNeedsEnabled(sim.world, false); // isolate the errands from the needs drives
  return sim;
}

function ownedSettler(sim: Simulation, x: number, y: number, player = HUMAN_PLAYER): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player });
  return e;
}

/** A ground pile holding `amount` of `goodType` at visual cell (x,y), loose unless `player` claims it. */
function pileAt(
  sim: Simulation,
  x: number,
  y: number,
  goodType: number,
  amount: number,
  player?: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map([[goodType, amount]]) });
  if (player !== undefined) sim.world.add(e, Owner, { player });
  return e;
}

function wearBoots(sim: Simulation, e: Entity, goodType: number): void {
  sim.world.add(e, Equipment, {
    boots: { goodType, degreeOfUse: fx.fromInt(0) },
    tool: null,
    weapon: null,
    armor: null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
}

/** A built headquarters at visual cell (x,y) that banks wood, so a hauler's load has somewhere to go. */
function headquartersAt(sim: Simulation, x: number, y: number): Entity {
  const hq = sim.world.create();
  sim.world.add(hq, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(hq, Building, {
    buildingType: HEADQUARTERS,
    tribe: VIKING,
    built: fx.fromInt(1),
    level: 0,
  });
  sim.world.add(hq, Stockpile, { amounts: new Map([[WOOD, 0]]) });
  sim.world.add(hq, Owner, { player: HUMAN_PLAYER });
  return hq;
}

function grant(sim: Simulation, goodType: number, enabled = true, player = HUMAN_PLAYER): void {
  sim.enqueueSetup({ kind: 'setAssistantGrant', player, goodType, enabled });
}

/** The shared fixture plus a workplace that CONSUMES a wearable - the `work_coin_mint` shape, which
 *  strikes an amulet out of a pair of shoes, so its shoe slot is a reserve and not grantable stock. */
function mintContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: MINT,
        id: 'coin_mint',
        kind: 'workplace',
        stock: [
          { goodType: SHOES, capacity: 10, initial: 0 },
          { goodType: MEAD, capacity: 10, initial: 0 },
        ],
        recipes: [
          { inputs: [{ goodType: SHOES, amount: 1 }], outputs: [{ goodType: MEAD, amount: 1 }], ticks: 20 },
        ],
      },
    ],
  });
}

/** A built mint holding `shoes` pairs on its INPUT slot. */
function mintAt(sim: Simulation, x: number, y: number, shoes: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: MINT, tribe: VIKING, built: fx.fromInt(1), level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[SHOES, shoes]]) });
  return e;
}

/** Step one tick at a time, recording the highest concurrent acquire-stage fetch count seen; `player`
 *  narrows the count to one side's errands. */
function runTrackingFetches(sim: Simulation, ticks: number, player?: number): number {
  let peak = 0;
  for (let i = 0; i < ticks; i++) {
    sim.run(1);
    let fetching = 0;
    for (const e of sim.world.query(EquipOrder)) {
      const order = sim.world.get(e, EquipOrder);
      if (order.stage !== 'acquire' || order.goodType === null) continue;
      if (player !== undefined && sim.world.tryGet(e, Owner)?.player !== player) continue;
      fetching++;
    }
    peak = Math.max(peak, fetching);
  }
  return peak;
}

describe('setAssistantGrant - the per-player grant list', () => {
  it('grants accumulate sorted, revoke removes, the empty list drops the carrier', () => {
    const sim = freshSim();
    grant(sim, MEAD);
    grant(sim, SHOES);
    sim.run(1);
    expect(sim.assistantGrants(HUMAN_PLAYER)).toEqual([SHOES, MEAD]);
    expect(sim.assistantGrants(RIVAL_PLAYER)).toEqual([]);

    grant(sim, SHOES, false);
    sim.run(1);
    expect(sim.assistantGrants(HUMAN_PLAYER)).toEqual([MEAD]);

    grant(sim, MEAD, false);
    sim.run(1);
    expect(sim.assistantGrants(HUMAN_PLAYER)).toEqual([]);
    expect([...sim.world.query(AssistantGrants)]).toHaveLength(0); // the empty carrier is dropped
  });

  it('refuses a non-wearable good and an out-of-range player', () => {
    const sim = freshSim();
    grant(sim, WOOD);
    sim.enqueueSetup({ kind: 'setAssistantGrant', player: 99, goodType: SHOES, enabled: true });
    sim.run(1);
    expect(sim.assistantGrants(HUMAN_PLAYER)).toEqual([]);
    expect(sim.assistantGrants(99)).toEqual([]);
  });
});

describe('assistant auto-equip - dispatch and reservation', () => {
  it('dresses a settler with a free slot from a reachable pile, unprompted', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    pileAt(sim, 12, 2, SHOES, 1);
    grant(sim, SHOES);

    sim.run(ERRAND_TICKS);

    expect(sim.world.get(settler, Equipment).boots?.goodType).toBe(SHOES);
    expect(sim.world.has(settler, EquipOrder)).toBe(false); // the errand completed and released
  });

  it('an idle settler walks off on its errand the pass the assistant books it', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    sim.step(); // nothing to chop: it stands idle
    expect(sim.world.has(settler, IdleStand)).toBe(true);
    pileAt(sim, 12, 2, SHOES, 1);
    grant(sim, SHOES);

    for (let i = 0; i < ERRAND_TICKS && !sim.world.has(settler, EquipOrder); i++) sim.step();
    expect(sim.world.has(settler, EquipOrder)).toBe(true);
    expect(sim.world.has(settler, MoveGoal)).toBe(true);
  });

  it('never sends two settlers after the last unit', () => {
    const sim = freshSim();
    const first = ownedSettler(sim, 2, 2);
    const second = ownedSettler(sim, 2, 4);
    pileAt(sim, 12, 2, SHOES, 1);
    grant(sim, SHOES);

    const peak = runTrackingFetches(sim, ERRAND_TICKS);

    expect(peak).toBe(1); // one pair, so at most one fetcher underway at any tick
    const shod = [first, second].filter((e) => sim.world.tryGet(e, Equipment)?.boots?.goodType === SHOES);
    expect(shod).toHaveLength(1);
  });

  it("budgets each granting player against its own stores, never a rival's", () => {
    // Both sides grant shoes and own one pair each. The budget is per player, so this side may have one
    // fetcher underway, not two off the pooled total - which its own `nearestStoreHolding` scan cannot
    // catch, the second fetcher reaching an already emptied pile.
    const sim = freshSim();
    const first = ownedSettler(sim, 2, 2);
    const second = ownedSettler(sim, 2, 4);
    const rival = ownedSettler(sim, 4, 2, RIVAL_PLAYER);
    pileAt(sim, 12, 2, SHOES, 1, HUMAN_PLAYER);
    pileAt(sim, 12, 4, SHOES, 1, RIVAL_PLAYER);
    grant(sim, SHOES);
    grant(sim, SHOES, true, RIVAL_PLAYER);

    const peak = runTrackingFetches(sim, ERRAND_TICKS, HUMAN_PLAYER);

    expect(peak).toBe(1);
    const shod = [first, second].filter((e) => sim.world.tryGet(e, Equipment)?.boots?.goodType === SHOES);
    expect(shod).toHaveLength(1);
    expect(sim.world.tryGet(rival, Equipment)?.boots?.goodType).toBe(SHOES);
  });

  it("never counts a workshop's input reserve toward the grant budget", () => {
    // The budget is a reservation bound, so it has to count only what a settler could actually lift.
    // One loose pair plus three locked in the mint's shoe slot must dispatch ONE fetcher, not four.
    // The per-settler `nearestStoreHolding` scan cannot catch this on its own: each of the four would
    // find the loose pile and set out, and three would come home to an empty tile.
    const sim = new Simulation({ seed: 1, content: mintContent(), map: grassMap(16, 6) });
    setNeedsEnabled(sim.world, false);
    const settlers = [2, 3, 4, 5].map((y) => ownedSettler(sim, 2, y));
    pileAt(sim, 12, 2, SHOES, 1);
    mintAt(sim, 12, 4, 3); // the pairs it strikes amulets out of - not the assistant's to hand out
    grant(sim, SHOES);

    const peak = runTrackingFetches(sim, ERRAND_TICKS);

    expect(peak).toBe(1);
    const shod = settlers.filter((e) => sim.world.tryGet(e, Equipment)?.boots?.goodType === SHOES);
    expect(shod).toHaveLength(1);
  });

  it('dresses a whole village from one stocked pile', () => {
    const sim = freshSim();
    const settlers = [2, 3, 4].flatMap((y) => [ownedSettler(sim, 2, y), ownedSettler(sim, 4, y)]);
    pileAt(sim, 12, 2, SHOES, settlers.length);
    grant(sim, SHOES);

    const peak = runTrackingFetches(sim, 2 * ERRAND_TICKS);

    expect(peak).toBeLessThanOrEqual(settlers.length);
    for (const e of settlers) {
      expect(sim.world.get(e, Equipment).boots?.goodType).toBe(SHOES);
    }
  });

  it('fills empty slots only and hands out one draught per settler', () => {
    const sim = freshSim();
    const booted = ownedSettler(sim, 2, 2);
    wearBoots(sim, booted, FUR_BOOTS);
    pileAt(sim, 12, 2, SHOES, 2);
    pileAt(sim, 12, 4, MEAD, 3);
    grant(sim, SHOES);
    grant(sim, MEAD);

    sim.run(2 * ERRAND_TICKS);

    const eq = sim.world.get(booted, Equipment);
    expect(eq.boots?.goodType).toBe(FUR_BOOTS); // never swapped by the assistant
    expect(eq.misc.filter((s) => s?.goodType === MEAD)).toHaveLength(1); // one bottle, not four
  });

  it('prefers the stronger tool when both are granted and stocked', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    pileAt(sim, 12, 2, TOOL_WOODEN, 1);
    pileAt(sim, 12, 4, TOOL_IRON, 1);
    grant(sim, TOOL_WOODEN);
    grant(sim, TOOL_IRON);

    sim.run(ERRAND_TICKS);

    expect(sim.world.get(settler, Equipment).tool?.goodType).toBe(TOOL_IRON);
  });

  it('stops dispatching the moment the grant is revoked; an underway errand still finishes', () => {
    const sim = freshSim();
    const dressed = ownedSettler(sim, 2, 2);
    const late = ownedSettler(sim, 2, 4);
    pileAt(sim, 12, 2, SHOES, 2);
    grant(sim, SHOES);

    // Run until exactly one fetch errand is underway, then revoke the grant mid-walk.
    let dispatched = 0;
    for (let i = 0; i < ERRAND_TICKS && dispatched === 0; i++) {
      sim.run(1);
      dispatched = [...sim.world.query(EquipOrder)].length;
    }
    expect(dispatched).toBe(1);
    grant(sim, SHOES, false);
    sim.run(2 * ERRAND_TICKS);

    const shod = [dressed, late].filter((e) => sim.world.tryGet(e, Equipment)?.boots?.goodType === SHOES);
    expect(shod).toHaveLength(1); // the underway fetch completed, nobody new was sent
  });

  it('books a loaded hauler, who delivers his load before fetching the gear', () => {
    const sim = freshSim();
    const hq = headquartersAt(sim, 6, 3);
    const settler = ownedSettler(sim, 2, 2);
    sim.world.add(settler, Carrying, { goodType: WOOD, amount: 1 });
    pileAt(sim, 12, 2, SHOES, 1);
    grant(sim, SHOES);

    // A porter is never idle between loads, so waiting for free hands at the dispatch beat would leave
    // him barefoot for good: the booking lands while he carries, and the load still reaches the store.
    let orderWithLoad = false;
    for (let i = 0; i < 2 * ERRAND_TICKS; i++) {
      sim.run(1);
      if (sim.world.has(settler, EquipOrder) && sim.world.has(settler, Carrying)) orderWithLoad = true;
    }
    expect(orderWithLoad).toBe(true);
    expect(sim.world.get(hq, Stockpile).amounts.get(WOOD) ?? 0).toBe(1);
    expect(sim.world.get(settler, Equipment).boots?.goodType).toBe(SHOES);
  });

  it('delivers a load picked up mid-errand first, where a player order sets the load down', () => {
    const sim = freshSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    // A headquarters so a yielded load has somewhere to go: the economy walks it there, which is the
    // whole point of yielding instead of dumping it in the grass.
    const hq = headquartersAt(sim, 6, 3);
    // Same state on both, one errand each, differing only in who issued it.
    const byPlayer = ownedSettler(sim, 2, 2);
    const byAssistant = ownedSettler(sim, 2, 4);
    pileAt(sim, 12, 2, SHOES, 2);
    for (const [e, issuer] of [
      [byPlayer, 'player'],
      [byAssistant, 'assistant-grant'],
    ] as const) {
      sim.world.add(e, EquipOrder, {
        group: 'boots',
        slot: 0,
        goodType: SHOES,
        returnTo: terrain.nodeAtClamped(0, 0),
        stage: 'acquire',
        issuer,
        queued: [],
      });
      sim.world.add(e, Carrying, { goodType: WOOD, amount: 1 });
    }

    // When each settler's hands come free: the player's errand sets the load down at once, the
    // assistant's leaves it to the economy, so its load is still in hand while the other's is gone.
    let freedPlayer = -1;
    let freedAssistant = -1;
    for (let tick = 1; tick <= DROP_ATOMIC_TICKS; tick++) {
      sim.run(1);
      if (freedPlayer < 0 && !sim.world.has(byPlayer, Carrying)) freedPlayer = tick;
      if (freedAssistant < 0 && !sim.world.has(byAssistant, Carrying)) freedAssistant = tick;
    }

    expect(freedPlayer).toBeGreaterThan(0);
    expect(freedAssistant === -1 || freedAssistant > freedPlayer).toBe(true);
    expect(sim.world.get(hq, Stockpile).amounts.get(WOOD) ?? 0).toBe(1); // banked, not grounded
    // Both errands survive: the player's its own set-down, the assistant's the delivery it yielded to.
    expect(sim.world.has(byPlayer, EquipOrder)).toBe(true);
    expect(sim.world.has(byAssistant, EquipOrder)).toBe(true);

    sim.run(2 * ERRAND_TICKS);
    for (const e of [byPlayer, byAssistant]) expect(sim.world.get(e, Equipment).boots?.goodType).toBe(SHOES);
  });

  it('errands held by permanently loaded settlers reserve only their own units', () => {
    const sim = freshSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    // Settlers that never advance: each one is on an acquire-stage errand and its hands are re-loaded
    // every tick, the state a producer with no reachable sink sits in for good.
    const stuck: Entity[] = [];
    for (let i = 0; i < STUCK_FETCHERS; i++) {
      const e = ownedSettler(sim, 4 + i, 4);
      sim.world.add(e, EquipOrder, {
        group: 'boots',
        slot: 0,
        goodType: SHOES,
        returnTo: terrain.nodeAtClamped(0, 0),
        stage: 'acquire',
        issuer: 'assistant-grant',
        queued: [],
      });
      stuck.push(e);
    }
    const live = ownedSettler(sim, 2, 2);
    pileAt(sim, 12, 2, SHOES, STUCK_FETCHERS + 1);
    grant(sim, SHOES);

    for (let tick = 0; tick < ERRAND_TICKS; tick++) {
      for (const e of stuck) sim.world.add(e, Carrying, { goodType: WOOD, amount: 1 });
      sim.run(1);
    }

    // The held errands yield to their loads and keep one unit each; the unit beyond them is the free
    // settler's.
    expect(sim.world.tryGet(live, Equipment)?.boots?.goodType).toBe(SHOES);
    for (const e of stuck) expect(sim.world.has(e, EquipOrder)).toBe(true);
  });

  it('leaves a posted guard on its anchor', () => {
    const sim = freshSim();
    const guard = ownedSettler(sim, 2, 2);
    sim.world.add(guard, Stance, { mode: MILITARY_MODE.DEFEND, anchorCell: null });
    const worker = ownedSettler(sim, 2, 4);
    pileAt(sim, 12, 2, SHOES, 2);
    grant(sim, SHOES);

    sim.run(ERRAND_TICKS);

    // The equip rung outranks the DEFEND hold so the PLAYER can send a guard for gear; the assistant
    // must not use that door.
    expect(sim.world.tryGet(guard, Equipment)?.boots ?? null).toBeNull();
    expect(sim.world.get(worker, Equipment).boots?.goodType).toBe(SHOES);
  });

  it('frozen errands of jobless settlers hold no reservation', () => {
    const sim = freshSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    // Stuck fetchers past the one unit of stock: jobless (the ladder never plans one), each frozen on
    // an acquire-stage errand for the same good the live settler needs.
    for (let i = 0; i < STUCK_FETCHERS; i++) {
      const stuck = ownedSettler(sim, 4 + i, 4);
      setSettlerJob(sim.world, stuck, null);
      sim.world.add(stuck, EquipOrder, {
        group: 'boots',
        slot: 0,
        goodType: SHOES,
        returnTo: terrain.nodeAtClamped(0, 0),
        stage: 'acquire',
        issuer: 'assistant-grant',
        queued: [],
      });
    }
    const live = ownedSettler(sim, 2, 2);
    pileAt(sim, 12, 2, SHOES, 1);
    grant(sim, SHOES);

    sim.run(ERRAND_TICKS);

    expect(sim.world.get(live, Equipment).boots?.goodType).toBe(SHOES);
  });

  it('hands tools to the working trades only, and boots to every man', () => {
    const sim = freshSim();
    // The three the tool hand-out passes over, and one trade that takes it.
    const fighter = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, fighter, FIGHTER_JOB);
    const scout = ownedSettler(sim, 2, 3);
    setSettlerJob(sim.world, scout, SCOUT_JOB);
    const civilist = ownedSettler(sim, 2, 4); // the "Cywil" row's trade-less settler
    setSettlerJob(sim.world, civilist, CIVILIST_JOB);
    const woodcutter = ownedSettler(sim, 2, 5);
    pileAt(sim, 12, 2, TOOL_IRON, 5); // more than enough: only the woodcutter may take one
    pileAt(sim, 12, 4, SHOES, 5); // one pair per settler - boots are not trade-gated
    grant(sim, TOOL_IRON);
    grant(sim, SHOES);

    sim.run(6 * ERRAND_TICKS);

    for (const e of [fighter, scout, civilist]) {
      expect(sim.world.get(e, Equipment).tool).toBeNull(); // no tool spent on a trade that won't use it
      expect(sim.world.get(e, Equipment).boots?.goodType).toBe(SHOES); // the other grants still land
    }
    expect(sim.world.get(woodcutter, Equipment).tool?.goodType).toBe(TOOL_IRON);
  });

  it('hands nothing to a woman, a child or a hero', () => {
    const sim = freshSim();
    const woman = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, woman, WOMAN_JOB);
    sim.world.add(woman, Female, { female: true });
    const child = ownedSettler(sim, 2, 3);
    setSettlerJob(sim.world, child, CHILD_MALE);
    sim.world.add(child, Age, { ticks: 0 });
    const hero = ownedSettler(sim, 2, 4);
    setSettlerJob(sim.world, hero, HERO_JOB);
    const man = ownedSettler(sim, 2, 5);
    pileAt(sim, 12, 2, SHOES, 5);
    pileAt(sim, 12, 4, MEAD, 5);
    grant(sim, SHOES);
    grant(sim, MEAD);

    sim.run(2 * ERRAND_TICKS); // short of the childhood, so the boy is still a child at the end

    expect(sim.world.get(man, Equipment).boots?.goodType).toBe(SHOES);
    expect(sim.world.has(child, Age)).toBe(true);

    for (const [who, e] of Object.entries({ woman, child, hero })) {
      expect(sim.world.has(e, EquipOrder), who).toBe(false);
      expect(sim.world.tryGet(e, Equipment)?.boots ?? null, who).toBeNull();
    }
  });

  it('hands a grant to a settler whose job is exempt from confinement only from the network at his feet', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(64, 6) });
    setNeedsEnabled(sim.world, false);
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    // A scout ranges the map, so he carries no signpost confinement of his own; his fetch still shops
    // inside the walk range around him plus the posts it catches, the same bound the errand walks by, so
    // the dispatcher never picks a store the walk then refuses. A pair lying across the map, outside any
    // post's reach, is not his to fetch.
    const scout = ownedSettler(sim, 40, 3);
    setSettlerJob(sim.world, scout, SCOUT_JOB);
    pileAt(sim, 2, 3, SHOES, 1);
    grant(sim, SHOES);
    sim.run(8 * ERRAND_TICKS);
    expect(sim.world.tryGet(scout, Equipment)?.boots ?? null).toBeNull();

    pileAt(sim, 30, 3, SHOES, 1);
    sim.run(8 * ERRAND_TICKS);
    expect(sim.world.get(scout, Equipment).boots?.goodType).toBe(SHOES);
  });

  it('ignores settlers of a player with no grants and grants with no stock', () => {
    const sim = freshSim();
    const rival = ownedSettler(sim, 2, 2, RIVAL_PLAYER);
    const poor = ownedSettler(sim, 2, 4);
    pileAt(sim, 12, 2, SHOES, 1);
    grant(sim, SHOES); // HUMAN_PLAYER only
    grant(sim, MEAD); // granted but nothing anywhere holds mead

    sim.run(ERRAND_TICKS);

    expect(sim.world.tryGet(rival, Equipment)?.boots?.goodType).toBeUndefined();
    expect(sim.world.get(poor, Equipment).boots?.goodType).toBe(SHOES);
    expect(sim.world.get(poor, Equipment).misc.every((s) => s === null)).toBe(true);
  });
});
