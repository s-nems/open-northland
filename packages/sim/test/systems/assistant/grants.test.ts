import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Age,
  AssistantCivilianOnlyGrants,
  type AssistantGrantAudience,
  AssistantGrants,
  AssistantRecruit,
  AssistantSoldierOnlyGrants,
  addPerson,
  Building,
  Carrying,
  Engagement,
  Equipment,
  type EquipmentSlot,
  EquipOrder,
  Female,
  IdleStand,
  MISC_EQUIP_SLOTS,
  MoveGoal,
  Owner,
  PickupClaim,
  Position,
  Stance,
  Stockpile,
  setNeedsEnabled,
  setSettlerJob,
  UnreachableGoals,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { type Fixed, fx, nodeHxOfPosition, nodeHyOfPosition, Simulation } from '../../../src/index.js';
import type { NodeId } from '../../../src/nav/terrain/index.js';
import { CHILD_MALE, CIVILIST_JOB, WOMAN_JOB } from '../../../src/systems/lifecycle/ageclass.js';
import { defaultStance } from '../../../src/systems/readviews/index.js';
import { testContent } from '../../fixtures/content.js';
import { grassCellMap as grassMap } from '../../fixtures/terrain.js';

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
/** The fixture's small healing potion, and a big one of the same effect this suite appends. */
const HEAL_SMALL = 16;
const HEAL_BIG = 60;
const FOOD_POTION = 14;
const STAMINA_POTION = 15;
const FOOD_AMULET = 23;
const STAMINA_AMULET = 24;
const STRENGTH_AMULET = 25;
const DEFENSE_AMULET = 26;
const CRIT_AMULET = 27;
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
/** Wooden tools left in store beside the iron ones: nobody holding iron swaps down to them. */
const SPARE_WOODEN = 2;

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

/** Make `e` a soldier the way the game does: the fighter trade and its default stance, DEFEND. */
function enlist(sim: Simulation, e: Entity): void {
  setSettlerJob(sim.world, e, FIGHTER_JOB);
  sim.world.add(e, Stance, { mode: defaultStance(sim.world, sim.content, e, FIGHTER_JOB), anchorCell: null });
}

/** The node `e` stands on. */
function nodeOf(sim: Simulation, e: Entity): NodeId {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  const p = sim.world.get(e, Position);
  return terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y));
}

/** A pile of one `goodType` unit already promised to another walker: the stock ledger counts it, no
 *  store search finds it. */
function promisedPileAt(sim: Simulation, x: number, y: number, goodType: number): void {
  const pile = pileAt(sim, x, y, goodType, 1);
  sim.world.add(sim.world.create(), PickupClaim, { source: pile, goodType, amount: 1 });
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

function wearTool(sim: Simulation, e: Entity, goodType: number, degreeOfUse: Fixed): void {
  sim.world.add(e, Equipment, {
    boots: null,
    tool: { goodType, degreeOfUse },
    weapon: null,
    armor: null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
}

/** Wooden tools held in stock or carried, rather than worn. */
function woodenToolsOutsideSlots(sim: Simulation): number {
  let held = 0;
  for (const e of sim.world.query(Stockpile))
    held += sim.world.get(e, Stockpile).amounts.get(TOOL_WOODEN) ?? 0;
  for (const e of sim.world.query(Carrying)) {
    const load = sim.world.get(e, Carrying);
    if (load.goodType === TOOL_WOODEN) held += load.amount;
  }
  return held;
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

function setAudience(
  sim: Simulation,
  goodType: number,
  audience: AssistantGrantAudience,
  player = HUMAN_PLAYER,
): void {
  sim.enqueueSetup({ kind: 'setAssistantGrantAudience', player, goodType, audience });
}

function swordCounter(sim: Simulation, infinite: boolean): void {
  sim.enqueueSetup({
    kind: 'setAssistantCounter',
    player: HUMAN_PLAYER,
    counter: 'trainSword',
    value: 0,
    infinite,
  });
}

/** The shared fixture plus the big healing potion: the small one's effect in a five-sip bottle. */
function twoBottleContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      {
        typeId: HEAL_BIG,
        id: 'potion_heal_big',
        weight: 0,
        equip: { category: 'misc', wears: true, uses: 5, restorePct: { healthMax: 40 } },
      },
    ],
  });
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

  it('limits carried goods to soldiers in ascending id, independent of the grant, and drops the carrier when empty', () => {
    const sim = freshSim();
    setAudience(sim, STRENGTH_AMULET, 'soldiers');
    setAudience(sim, MEAD, 'soldiers');
    setAudience(sim, WOOD, 'soldiers'); // not wearable: skipped
    setAudience(sim, SHOES, 'soldiers'); // gear has no audience: skipped
    sim.step();
    expect(sim.assistantSoldierOnlyGrants(HUMAN_PLAYER)).toEqual([MEAD, STRENGTH_AMULET]);
    expect(sim.assistantGrants(HUMAN_PLAYER)).toEqual([]); // a limit grants nothing by itself
    expect(sim.assistantSoldierOnlyGrants(RIVAL_PLAYER)).toEqual([]);
    setAudience(sim, MEAD, 'everyone');
    sim.step();
    expect(sim.assistantSoldierOnlyGrants(HUMAN_PLAYER)).toEqual([STRENGTH_AMULET]);
    setAudience(sim, STRENGTH_AMULET, 'everyone');
    sim.step();
    expect(sim.assistantSoldierOnlyGrants(HUMAN_PLAYER)).toEqual([]);
    expect([...sim.world.query(AssistantSoldierOnlyGrants)]).toEqual([]);
  });

  it("keeps a good on one group's list at a time, and drops both carriers when it goes to everyone", () => {
    const sim = freshSim();
    setAudience(sim, MEAD, 'soldiers');
    setAudience(sim, STRENGTH_AMULET, 'civilians');
    sim.step();
    expect(sim.assistantSoldierOnlyGrants(HUMAN_PLAYER)).toEqual([MEAD]);
    expect(sim.assistantCivilianOnlyGrants(HUMAN_PLAYER)).toEqual([STRENGTH_AMULET]);
    setAudience(sim, MEAD, 'civilians');
    sim.step();
    expect(sim.assistantSoldierOnlyGrants(HUMAN_PLAYER)).toEqual([]);
    expect(sim.assistantCivilianOnlyGrants(HUMAN_PLAYER)).toEqual([MEAD, STRENGTH_AMULET]);
    setAudience(sim, MEAD, 'everyone');
    setAudience(sim, STRENGTH_AMULET, 'everyone');
    sim.step();
    expect(sim.assistantCivilianOnlyGrants(HUMAN_PLAYER)).toEqual([]);
    expect([...sim.world.query(AssistantSoldierOnlyGrants)]).toEqual([]);
    expect([...sim.world.query(AssistantCivilianOnlyGrants)]).toEqual([]);
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
  it('keeps its scan beats in step with settlers born and dying', () => {
    const sim = freshSim();
    pileAt(sim, 8, 3, SHOES, 1, HUMAN_PLAYER);
    grant(sim, SHOES);
    const first = ownedSettler(sim, 2, 3);
    sim.run(1);
    const born = ownedSettler(sim, 3, 3);
    sim.world.destroy(first);
    sim.run(1);
    expect(sim.world.verifyCaches()).toEqual([]);
    sim.world.destroy(born);
    ownedSettler(sim, 4, 3);
    sim.run(1);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

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

  it('with the upgrade switch on, swaps a weaker tool for a granted better one, never a stronger tool', () => {
    const sim = freshSim();
    const worn = ownedSettler(sim, 2, 2);
    const fresh = ownedSettler(sim, 2, 3);
    const strong = ownedSettler(sim, 2, 4);
    wearTool(sim, worn, TOOL_WOODEN, fx.div(fx.fromInt(1), fx.fromInt(4)));
    wearTool(sim, fresh, TOOL_WOODEN, fx.fromInt(0));
    wearTool(sim, strong, TOOL_IRON, fx.fromInt(0));
    pileAt(sim, 12, 2, TOOL_IRON, 2, HUMAN_PLAYER);
    pileAt(sim, 12, 4, TOOL_WOODEN, SPARE_WOODEN, HUMAN_PLAYER); // in reach of the iron holder too
    grant(sim, TOOL_WOODEN);
    grant(sim, TOOL_IRON);

    sim.run(ERRAND_TICKS);
    expect(sim.world.get(worn, Equipment).tool?.goodType).toBe(TOOL_WOODEN); // switch off: kept

    sim.enqueueSetup({ kind: 'setAssistantUpgradeTools', player: HUMAN_PLAYER, enabled: true });
    sim.run(2 * ERRAND_TICKS);

    for (const e of [worn, fresh, strong]) expect(sim.world.get(e, Equipment).tool?.goodType).toBe(TOOL_IRON);
    // The take-off rule: the part-used tool is gone, the fresh one survives off the back.
    expect(woodenToolsOutsideSlots(sim)).toBe(SPARE_WOODEN + 1);
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

  it('dresses a soldier in his default DEFEND stance and walks him back to his post', () => {
    const sim = freshSim();
    const soldier = ownedSettler(sim, 2, 2);
    enlist(sim, soldier);
    const post = nodeOf(sim, soldier);
    pileAt(sim, 12, 2, STRENGTH_AMULET, 1);
    grant(sim, STRENGTH_AMULET);
    setAudience(sim, STRENGTH_AMULET, 'soldiers');

    sim.run(ERRAND_TICKS);

    expect(sim.world.get(soldier, Equipment).misc[0]?.goodType).toBe(STRENGTH_AMULET);
    expect(sim.world.has(soldier, EquipOrder)).toBe(false);
    expect(nodeOf(sim, soldier)).toBe(post);
  });

  it('leaves a booked recruit owed his weapon to the arming pass, and dresses him once he is armed', () => {
    const sim = freshSim();
    const recruit = ownedSettler(sim, 2, 2);
    enlist(sim, recruit);
    sim.world.add(recruit, AssistantRecruit, { intent: 'trainSword', armed: false, barracks: recruit });
    swordCounter(sim, true); // keeps the booking past the release sweep
    pileAt(sim, 12, 2, SHOES, 1);
    grant(sim, SHOES);

    sim.run(ERRAND_TICKS);
    expect(sim.world.tryGet(recruit, Equipment)?.boots ?? null).toBeNull();
    expect(sim.world.has(recruit, EquipOrder)).toBe(false);

    // Paid: with no armour in reach the arming pass settles the booking, and the grant lands.
    swordCounter(sim, false); // and no counter books the bare man again
    sim.world.mut(recruit, AssistantRecruit).armed = true;
    sim.run(ERRAND_TICKS);
    expect(sim.world.get(recruit, Equipment).boots?.goodType).toBe(SHOES);
  });

  it('sends a soldier for his gear while a comrade fights beside him', () => {
    const sim = freshSim();
    const soldier = ownedSettler(sim, 2, 2);
    enlist(sim, soldier);
    // His own side's fight inside his rest clearance; its opponent is off the fixture.
    const comrade = ownedSettler(sim, 4, 4);
    enlist(sim, comrade);
    pileAt(sim, 12, 2, SHOES, 2); // a pair each, so the comrade's errand takes none of his
    grant(sim, SHOES);

    for (let tick = 0; tick < ERRAND_TICKS; tick++) {
      if (!sim.world.has(comrade, Engagement)) sim.world.add(comrade, Engagement, { repathAt: sim.tick });
      sim.run(1);
    }

    expect(sim.world.get(soldier, Equipment).boots?.goodType).toBe(SHOES);
  });

  it('fetches every owed grant in one outing before the single walk back', () => {
    const sim = freshSim();
    const soldier = ownedSettler(sim, 2, 2);
    enlist(sim, soldier);
    const post = nodeOf(sim, soldier);
    pileAt(sim, 12, 2, SHOES, 1);
    pileAt(sim, 12, 3, MEAD, 1);
    pileAt(sim, 12, 4, STRENGTH_AMULET, 1);
    grant(sim, SHOES);
    grant(sim, MEAD);
    grant(sim, STRENGTH_AMULET);

    // One errand, alive from the first fetch to the arrival back at the post, fetches all three.
    const fetched = new Set<number>();
    let errands = 0;
    let holding = false;
    for (let tick = 0; tick < 2 * ERRAND_TICKS; tick++) {
      sim.run(1);
      const order = sim.world.tryGet(soldier, EquipOrder);
      if (order !== undefined && !holding) errands++;
      holding = order !== undefined;
      if (order?.goodType != null) fetched.add(order.goodType);
    }

    expect(errands).toBe(1);
    expect([...fetched].sort((a, b) => a - b)).toEqual([SHOES, MEAD, STRENGTH_AMULET]);
    const eq = sim.world.get(soldier, Equipment);
    expect(eq.boots?.goodType).toBe(SHOES);
    expect(eq.misc.flatMap((slot) => (slot === null ? [] : [slot.goodType])).sort((a, b) => a - b)).toEqual([
      MEAD,
      STRENGTH_AMULET,
    ]);
    expect(nodeOf(sim, soldier)).toBe(post);
  });

  it("chains no civilians' good onto a soldier's outing", () => {
    const sim = freshSim();
    const soldier = ownedSettler(sim, 2, 2);
    enlist(sim, soldier);
    pileAt(sim, 12, 2, SHOES, 1);
    pileAt(sim, 12, 3, MEAD, 1);
    grant(sim, SHOES);
    grant(sim, MEAD);
    setAudience(sim, MEAD, 'civilians');

    sim.run(2 * ERRAND_TICKS);

    const eq = sim.world.get(soldier, Equipment);
    expect(eq.boots?.goodType).toBe(SHOES);
    expect(eq.misc.every((slot) => slot === null)).toBe(true);
  });

  it('walks back with what he has when the rest of his owed stock is out of reach', () => {
    const sim = freshSim();
    const soldier = ownedSettler(sim, 2, 2);
    enlist(sim, soldier);
    const post = nodeOf(sim, soldier);
    // More owed goods than a pass has store searches, all of them counted and none of them findable.
    const promised = [
      MEAD,
      FOOD_POTION,
      STAMINA_POTION,
      HEAL_SMALL,
      FOOD_AMULET,
      STAMINA_AMULET,
      STRENGTH_AMULET,
      DEFENSE_AMULET,
      CRIT_AMULET,
    ];
    promised.forEach((good, i) => {
      promisedPileAt(sim, 14, i % 6, good);
    });
    pileAt(sim, 12, 2, SHOES, 1);
    for (const good of [SHOES, ...promised]) grant(sim, good);
    // Another man's own equip order, which a soldier stuck at the store would starve of store searches.
    const worker = ownedSettler(sim, 3, 5);
    wearBoots(sim, worker, SHOES);
    pileAt(sim, 2, 5, FUR_BOOTS, 1);

    sim.run(ERRAND_TICKS);
    sim.enqueueSetup({ kind: 'equipGood', entity: worker, group: 'boots', slot: 0, goodType: FUR_BOOTS });
    sim.run(ERRAND_TICKS);

    expect(sim.world.get(soldier, Equipment).boots?.goodType).toBe(SHOES);
    expect(sim.world.has(soldier, EquipOrder)).toBe(false);
    expect(nodeOf(sim, soldier)).toBe(post);
    expect(sim.world.get(worker, Equipment).boots?.goodType).toBe(FUR_BOOTS);
  });

  it('walks back when the owed stock in his reach lies where he cannot get to, more of it than a pass searches', () => {
    const sim = freshSim();
    const soldier = ownedSettler(sim, 2, 2);
    enlist(sim, soldier);
    const post = nodeOf(sim, soldier);
    // Every owed good in one pile his reach takes in but his route never got to: each search finds it
    // and turns it down, and there are more goods than a pass has searches.
    const walledOff = [
      MEAD,
      FOOD_POTION,
      STAMINA_POTION,
      HEAL_SMALL,
      FOOD_AMULET,
      STAMINA_AMULET,
      STRENGTH_AMULET,
      DEFENSE_AMULET,
      CRIT_AMULET,
    ];
    const pile = sim.world.create();
    sim.world.add(pile, Position, { x: fx.fromInt(14), y: fx.fromInt(4) });
    sim.world.add(pile, Stockpile, { amounts: new Map(walledOff.map((good) => [good, 1])) });
    sim.world.add(soldier, UnreachableGoals, {
      entries: [{ cell: nodeOf(sim, pile), until: Number.MAX_SAFE_INTEGER }],
    });
    pileAt(sim, 12, 2, SHOES, 1);
    for (const good of [SHOES, ...walledOff]) grant(sim, good);
    // The soldier's alone, so the civilian worker below takes none of them.
    for (const good of walledOff) setAudience(sim, good, 'soldiers');
    const worker = ownedSettler(sim, 3, 5);
    wearBoots(sim, worker, SHOES);
    pileAt(sim, 2, 5, FUR_BOOTS, 1);

    sim.run(ERRAND_TICKS);
    sim.enqueueSetup({ kind: 'equipGood', entity: worker, group: 'boots', slot: 0, goodType: FUR_BOOTS });
    sim.run(ERRAND_TICKS);

    expect(sim.world.get(soldier, Equipment).boots?.goodType).toBe(SHOES);
    expect(sim.world.has(soldier, EquipOrder)).toBe(false);
    expect(nodeOf(sim, soldier)).toBe(post);
    expect(sim.world.get(worker, Equipment).boots?.goodType).toBe(FUR_BOOTS);
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
    enlist(sim, fighter);
    const scout = ownedSettler(sim, 2, 3);
    setSettlerJob(sim.world, scout, SCOUT_JOB);
    const civilist = ownedSettler(sim, 2, 4); // the "Civilian" row's trade-less settler
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

  it('keeps a soldiers-only good from civilians until its limit is lifted; the other grants still land', () => {
    const sim = freshSim();
    const fighter = ownedSettler(sim, 2, 2);
    enlist(sim, fighter);
    const woodcutter = ownedSettler(sim, 2, 4);
    pileAt(sim, 12, 2, STRENGTH_AMULET, 5);
    pileAt(sim, 12, 4, MEAD, 5);
    pileAt(sim, 12, 5, SHOES, 5);
    grant(sim, STRENGTH_AMULET);
    grant(sim, MEAD);
    grant(sim, SHOES);
    setAudience(sim, STRENGTH_AMULET, 'soldiers');

    sim.run(4 * ERRAND_TICKS);

    const carried = (e: Entity): number[] =>
      sim.world
        .get(e, Equipment)
        .misc.flatMap((s) => (s === null ? [] : [s.goodType]))
        .sort((a, b) => a - b);
    expect(carried(fighter)).toEqual([MEAD, STRENGTH_AMULET]);
    expect(carried(woodcutter)).toEqual([MEAD]); // the amulet is the soldiers' alone, the mead everyone's
    expect(sim.world.get(woodcutter, Equipment).boots?.goodType).toBe(SHOES);

    setAudience(sim, STRENGTH_AMULET, 'everyone');
    sim.run(2 * ERRAND_TICKS);
    expect(carried(woodcutter)).toEqual([MEAD, STRENGTH_AMULET]);
  });

  it('keeps a civilians-only good from soldiers; the soldiers still take the goods open to them', () => {
    const sim = freshSim();
    const fighter = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, fighter, FIGHTER_JOB);
    const woodcutter = ownedSettler(sim, 2, 4);
    pileAt(sim, 12, 2, STRENGTH_AMULET, 5);
    pileAt(sim, 12, 4, MEAD, 5);
    grant(sim, STRENGTH_AMULET);
    grant(sim, MEAD);
    setAudience(sim, MEAD, 'civilians');
    setAudience(sim, STRENGTH_AMULET, 'soldiers');

    sim.run(4 * ERRAND_TICKS);

    const carried = (e: Entity): number[] =>
      sim.world
        .get(e, Equipment)
        .misc.flatMap((s) => (s === null ? [] : [s.goodType]))
        .sort((a, b) => a - b);
    expect(carried(fighter)).toEqual([STRENGTH_AMULET]);
    expect(carried(woodcutter)).toEqual([MEAD]);
  });

  it('hands out the big bottle before the small one and treats either as the same drink', () => {
    const sim = new Simulation({ seed: 1, content: twoBottleContent(), map: grassMap(16, 6) });
    setNeedsEnabled(sim.world, false);
    const first = ownedSettler(sim, 2, 2);
    const second = ownedSettler(sim, 2, 4);
    pileAt(sim, 12, 2, HEAL_BIG, 1);
    pileAt(sim, 12, 4, HEAL_SMALL, 5);
    grant(sim, HEAL_SMALL);
    grant(sim, HEAL_BIG);

    sim.run(3 * ERRAND_TICKS);

    const bottles = (e: Entity): number[] =>
      sim.world.get(e, Equipment).misc.flatMap((s) => (s === null ? [] : [s.goodType]));
    const both = [...bottles(first), ...bottles(second)].sort((a, b) => a - b);
    // One man took the only big bottle, the other a small one; neither went for a second healing drink.
    expect(both).toEqual([HEAL_SMALL, HEAL_BIG]);
    expect(bottles(first)).toHaveLength(1);
    expect(bottles(second)).toHaveLength(1);
  });

  it('hands nothing to a woman, a child or a hero', () => {
    const sim = freshSim();
    const woman = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, woman, WOMAN_JOB);
    sim.world.add(woman, Female, { female: true });
    const child = ownedSettler(sim, 2, 3);
    setSettlerJob(sim.world, child, CHILD_MALE);
    sim.world.add(child, Age, { ticks: 0, asOf: null });
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
