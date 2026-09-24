import { type ContentSet, type EquipCategory, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Age,
  addPerson,
  Building,
  Carrying,
  Engagement,
  Equipment,
  type EquipmentSlot,
  EquipOrder,
  Female,
  MISC_EQUIP_SLOTS,
  Owner,
  Position,
  Stance,
  Stockpile,
  setNeedsEnabled,
  setSettlerJob,
  TrainingOrder,
  Upgrading,
} from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import type { Fixed } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, nodeOfPosition, Simulation } from '../../src/index.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import { WOMAN_JOB } from '../../src/systems/lifecycle/ageclass.js';
import { equipGood, unequipGood } from '../../src/systems/orders/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { combatant } from '../conflict/stances/support.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * The equip errand: `equipGood` sends a settler to fetch a wearable good from the nearest reachable
 * store/pile, wear it, stow a swap-out, and walk back to where it was ordered; `unequipGood` walks to
 * the stow store STILL WEARING the good and takes it off there (in place only when destroying it or
 * dropping it on the ground). A part-used unit is destroyed instead of stowed - fungible store stock
 * would regenerate it to fresh. Fixture: good 8 = shoes (boots, wears), 9 = sword / 17 = long_sword
 * (permanent weapons), 10 = fur_boots (boots), 11 = tool_wooden (tool), 13 = mead (misc); building
 * 22 = armoury (the only store with gear slots) and this suite's own brewhouse (the only workplace
 * that MAKES an equippable); tribe 1 = viking, job 1 = woodcutter.
 */

const SHOES = 8;
const SWORD = 9;
const FUR_BOOTS = 10;
const TOOL_WOODEN = 11;
const MEAD = 13;
const LONG_SWORD = 17;
const MAIL = 18;
const WOOD = 1;
const WOODCUTTER = 1;
const CARPENTER = 2;
const VIKING = 1;
const HUMAN_PLAYER = 0;
const RIVAL_PLAYER = 1;
const ARMOURY = 22;
const FORGE = 25;
const FORGE_UPGRADE = 26;
/** Appended by this suite alone, out of the 10..19 band the shared fixture reserves for that. */
const BREWHOUSE = 10;
/** The fixture's soldier trade (`soldier_unarmed`) - what `isFighterJob` reads off the job slug. */
const FIGHTER_JOB = 31;
/** The fixture's hero trade; heroes keep the equipment authored with their class. */
const HERO_JOB = 45;

/** Enough ticks for a fetch across the small map plus the stow and return legs. */
const ERRAND_TICKS = 600;

function freshSim(): Simulation {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 6) });
  setNeedsEnabled(sim.world, false); // isolate the errand from the needs drives
  return sim;
}

function upgradeableForgeSim(): Simulation {
  const base = testContent();
  const forge = {
    typeId: FORGE,
    id: 'forge_00',
    kind: 'workplace' as const,
    produces: [SWORD],
    stock: [
      { goodType: WOOD, capacity: 10, initial: 0 },
      { goodType: SWORD, capacity: 10, initial: 0 },
    ],
    recipes: [
      {
        inputs: [{ goodType: WOOD, amount: 1 }],
        outputs: [{ goodType: SWORD, amount: 1 }],
        ticks: 20,
      },
    ],
    upgradeTarget: FORGE_UPGRADE,
  };
  const content = parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      forge,
      {
        ...forge,
        typeId: FORGE_UPGRADE,
        id: 'forge_01',
        construction: [{ goodType: WOOD, amount: 1 }],
        upgradeTarget: undefined,
      },
    ],
  });
  const sim = new Simulation({ seed: 1, content, map: grassMap(16, 6) });
  setNeedsEnabled(sim.world, false);
  return sim;
}

function forgeAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: FORGE, tribe: VIKING, built: fx.fromInt(1), level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

function ownedSettler(sim: Simulation, x: number, y: number): Entity {
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
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  return e;
}

/** A loose ground pile holding `amount` of `goodType` at visual cell (x,y). */
function pileAt(sim: Simulation, x: number, y: number, goodType: number, amount: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map([[goodType, amount]]) });
  return e;
}

/** A built armoury (the fixture's only gear-slot store) at visual cell (x,y). */
function armouryAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: ARMOURY, tribe: VIKING, built: fx.fromInt(1), level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

/** The shared fixture plus a brewery-shaped workplace, carrying an equippable on BOTH sides of its
 *  recipe: it makes mead (its shelf is a fetch source) out of wood and shoes (its shoe slot is a
 *  reserve no errand may lift - the `work_coin_mint` shape, which strikes an amulet out of a pair).
 *  The armoury cannot stand in - it declares no recipe, so a producer filter growing onto the fetch
 *  scan would slip past it. */
function brewhouseContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: BREWHOUSE,
        id: 'brewhouse',
        kind: 'workplace',
        workers: [{ jobType: CARPENTER, count: 1 }],
        stock: [
          { goodType: WOOD, capacity: 10, initial: 0 },
          { goodType: SHOES, capacity: 10, initial: 0 },
          { goodType: MEAD, capacity: 10, initial: 0 },
        ],
        recipes: [
          {
            inputs: [
              { goodType: WOOD, amount: 1 },
              { goodType: SHOES, amount: 1 },
            ],
            outputs: [{ goodType: MEAD, amount: 1 }],
            ticks: 20,
          },
        ],
      },
    ],
  });
}

/** A built brewhouse holding the given stock. */
function brewhouseAt(sim: Simulation, x: number, y: number, stock: Array<[number, number]>): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: BREWHOUSE, tribe: VIKING, built: fx.fromInt(1), level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map(stock) });
  sim.world.add(e, Owner, { player: HUMAN_PLAYER });
  return e;
}

/** A worn good: a bare number is a fresh item, `{goodType, usedPct}` one part-way through its life. */
type WornSpec = number | { goodType: number; usedPct: number };

const FULL_LIFE_PCT = 100;

function wear(
  sim: Simulation,
  e: Entity,
  slots: Partial<Record<'boots' | 'tool' | 'weapon', WornSpec>>,
): void {
  const slot = (spec: WornSpec | undefined): EquipmentSlot | null => {
    if (spec === undefined) return null;
    if (typeof spec === 'number') return { goodType: spec, degreeOfUse: fx.fromInt(0) };
    return {
      goodType: spec.goodType,
      degreeOfUse: fx.div(fx.fromInt(spec.usedPct), fx.fromInt(FULL_LIFE_PCT)),
    };
  };
  sim.world.add(e, Equipment, {
    boots: slot(slots.boots),
    tool: slot(slots.tool),
    weapon: slot(slots.weapon),
    armor: null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
}

/** Total units of `goodType` sitting outside any building store (loose ground piles). */
function groundUnits(sim: Simulation, goodType: number): number {
  let sum = 0;
  for (const p of sim.world.query(Stockpile, Position)) {
    if (sim.world.has(p, Building)) continue;
    sum += sim.world.get(p, Stockpile).amounts.get(goodType) ?? 0;
  }
  return sum;
}

const equip = (entity: Entity, goodType: number, group: EquipCategory = 'boots', slot = 0): Command => ({
  kind: 'equipGood',
  entity,
  group,
  slot,
  goodType,
});

/** The terrain NodeId under a fixed-point position (the anchor/goal id space the sim compares in). */
function terrainNodeAt(sim: Simulation, x: Fixed, y: Fixed): NodeId {
  const n = nodeOfPosition(x, y);
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  return terrain.nodeAtClamped(n.hx, n.hy);
}

describe('equipGood - fetch, wear, stow the swap-out, walk back', () => {
  it('rejects a stale weapon pick after the selected fighter changes to a civilian trade', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, settler, FIGHTER_JOB);
    pileAt(sim, 8, 2, SWORD, 1);

    expect(sim.equipPickList(settler, 'weapon')).toEqual([{ goodType: SWORD, available: 1 }]);
    setSettlerJob(sim.world, settler, WOODCUTTER); // the menu row is now stale
    sim.enqueueSetup(equip(settler, SWORD, 'weapon'));
    sim.step();

    expect(sim.world.has(settler, EquipOrder)).toBe(false);
    expect(sim.world.tryGet(settler, Equipment)?.weapon ?? null).toBeNull();
  });

  it('cancels an active weapon fetch when the fighter changes to a civilian trade in flight', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, settler, FIGHTER_JOB);
    pileAt(sim, 12, 2, SWORD, 1);
    sim.enqueueSetup(equip(settler, SWORD, 'weapon'));
    sim.run(2);
    expect(sim.world.has(settler, EquipOrder)).toBe(true);

    sim.enqueueSetup({ kind: 'setJob', entity: settler, jobType: WOODCUTTER });
    sim.run(ERRAND_TICKS);

    expect(sim.world.has(settler, EquipOrder)).toBe(false);
    expect(sim.world.tryGet(settler, Equipment)?.weapon ?? null).toBeNull();
  });

  it('takes a stored output weapon from a forge while that building is being upgraded', () => {
    const sim = upgradeableForgeSim();
    const settler = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, settler, FIGHTER_JOB);
    const forge = forgeAt(sim, 8, 2);
    sim.world.mut(forge, Stockpile).amounts.set(SWORD, 1);
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: forge });
    sim.step();

    expect(sim.world.get(forge, Upgrading).savedStock.get(SWORD)).toBe(1);
    expect(sim.equipPickList(settler, 'weapon')).toEqual([{ goodType: SWORD, available: 1 }]);

    sim.enqueueSetup(equip(settler, SWORD, 'weapon'));
    sim.run(ERRAND_TICKS);

    expect(sim.world.get(settler, Equipment).weapon?.goodType).toBe(SWORD);
    expect(sim.world.get(forge, Upgrading).savedStock.get(SWORD)).toBe(0);
    expect(sim.world.get(forge, Stockpile).amounts.get(SWORD) ?? 0).toBe(0);
  });

  it('fetches the good from a pile, wears it fresh and returns to the issue node', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    const pile = pileAt(sim, 12, 2, SHOES, 1);
    const home = sim.world.get(settler, Position);
    const homeNode = nodeOfPosition(home.x, home.y);

    sim.enqueueSetup(equip(settler, SHOES));
    sim.run(ERRAND_TICKS);

    // Worn fresh at the pile; the walk home has already worn the pair a few steps (boots wear per
    // walked waypoint - see systems/equipment/), so only the good is pinned here.
    expect(sim.world.get(settler, Equipment).boots?.goodType).toBe(SHOES);
    expect(sim.world.isAlive(pile)).toBe(false); // the emptied loose pile is reaped
    expect(sim.world.has(settler, EquipOrder)).toBe(false);
    expect(sim.world.has(settler, Carrying)).toBe(false);
    const back = sim.world.get(settler, Position);
    expect(nodeOfPosition(back.x, back.y)).toEqual(homeNode);
  });

  it('swap: the replaced good is stowed into a store that can take it', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, settler, FIGHTER_JOB);
    // A weapon swap is the fresh-stow shape: boots wear per walked waypoint, so a swapped-out pair
    // is part-used (destroyed) by the time the settler reaches its replacement; a permanent weapon
    // arrives at the pile still fresh and stows.
    wear(sim, settler, { weapon: SWORD });
    pileAt(sim, 12, 2, LONG_SWORD, 1);
    const armoury = armouryAt(sim, 6, 4);

    sim.enqueueSetup(equip(settler, LONG_SWORD, 'weapon'));
    sim.run(ERRAND_TICKS);

    expect(sim.world.get(settler, Equipment).weapon?.goodType).toBe(LONG_SWORD);
    expect(sim.world.get(armoury, Stockpile).amounts.get(SWORD)).toBe(1);
    expect(sim.world.has(settler, EquipOrder)).toBe(false);
    expect(sim.world.has(settler, Carrying)).toBe(false);
  });

  it('queues a group armor order before a later weapon order without losing either under stock contention', () => {
    const sim = freshSim();
    const settlers = Array.from({ length: 5 }, (_, i) => {
      const settler = ownedSettler(sim, 2, 1 + i);
      setSettlerJob(sim.world, settler, FIGHTER_JOB);
      return settler;
    });
    const armorPile = pileAt(sim, 12, 2, MAIL, 4);
    const weaponPile = pileAt(sim, 12, 4, LONG_SWORD, 6);

    for (const settler of settlers) sim.enqueueSetup(equip(settler, MAIL, 'armor'));
    for (const settler of settlers) sim.enqueueSetup(equip(settler, LONG_SWORD, 'weapon'));
    sim.run(2 * ERRAND_TICKS);

    expect(settlers.filter((e) => sim.world.tryGet(e, Equipment)?.armor?.goodType === MAIL)).toHaveLength(4);
    expect(
      settlers.filter((e) => sim.world.tryGet(e, Equipment)?.weapon?.goodType === LONG_SWORD),
    ).toHaveLength(5);
    expect(sim.world.isAlive(armorPile)).toBe(false);
    expect(sim.world.get(weaponPile, Stockpile).amounts.get(LONG_SWORD)).toBe(1);
    for (const settler of settlers) expect(sim.world.has(settler, EquipOrder)).toBe(false);
  });

  it('continues to the next queued equipment type before returning to the issue point', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, settler, FIGHTER_JOB);
    const start = sim.world.get(settler, Position);
    const home = nodeOfPosition(start.x, start.y);
    pileAt(sim, 12, 2, MAIL, 1);
    pileAt(sim, 12, 4, LONG_SWORD, 1);
    sim.enqueueSetup(equip(settler, MAIL, 'armor'));
    sim.enqueueSetup(equip(settler, LONG_SWORD, 'weapon'));

    let woreArmorBeforeWeapon = false;
    let returnedBetweenItems = false;
    for (let tick = 0; tick < 2 * ERRAND_TICKS; tick++) {
      sim.run(1);
      const equipment = sim.world.tryGet(settler, Equipment);
      if (equipment?.armor?.goodType !== MAIL || equipment.weapon !== null) continue;
      woreArmorBeforeWeapon = true;
      const at = sim.world.get(settler, Position);
      const node = nodeOfPosition(at.x, at.y);
      if (node.hx === home.hx && node.hy === home.hy) returnedBetweenItems = true;
    }

    expect(woreArmorBeforeWeapon).toBe(true);
    expect(returnedBetweenItems).toBe(false);
    expect(sim.world.get(settler, Equipment).weapon?.goodType).toBe(LONG_SWORD);
    const back = sim.world.get(settler, Position);
    expect(nodeOfPosition(back.x, back.y)).toEqual(home);
  });

  it('a skip-return order ends at the pile instead of walking back', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    pileAt(sim, 12, 2, SHOES, 1);

    sim.enqueueSetup({
      kind: 'equipGood',
      entity: settler,
      group: 'boots',
      slot: 0,
      goodType: SHOES,
      skipReturn: true,
    });
    sim.run(ERRAND_TICKS);

    expect(sim.world.get(settler, Equipment).boots?.goodType).toBe(SHOES);
    expect(sim.world.has(settler, EquipOrder)).toBe(false);
    const at = sim.world.get(settler, Position);
    expect(nodeOfPosition(at.x, at.y)).toEqual(nodeOfPosition(fx.fromInt(12), fx.fromInt(2)));
  });

  it('the last queued intent decides whether the errand walks back, and to where', () => {
    /** Long enough for the armor walk to be underway when the weapon order arrives. */
    const ORDER_GAP_TICKS = 60;
    const run = (armorSkipsReturn: boolean) => {
      const sim = freshSim();
      const settler = ownedSettler(sim, 2, 2);
      setSettlerJob(sim.world, settler, FIGHTER_JOB);
      pileAt(sim, 12, 2, MAIL, 1);
      pileAt(sim, 12, 4, LONG_SWORD, 1);
      const nodeNow = () => {
        const at = sim.world.get(settler, Position);
        return nodeOfPosition(at.x, at.y);
      };
      sim.enqueueSetup({
        kind: 'equipGood',
        entity: settler,
        group: 'armor',
        slot: 0,
        goodType: MAIL,
        skipReturn: armorSkipsReturn,
      });
      sim.run(ORDER_GAP_TICKS);
      const weaponIssuedAt = nodeNow();
      sim.enqueueSetup({
        kind: 'equipGood',
        entity: settler,
        group: 'weapon',
        slot: 0,
        goodType: LONG_SWORD,
        skipReturn: !armorSkipsReturn,
      });
      sim.run(2 * ERRAND_TICKS);
      expect(sim.world.get(settler, Equipment).weapon?.goodType).toBe(LONG_SWORD);
      return { weaponIssuedAt, end: nodeNow() };
    };

    expect(run(false).end).toEqual(nodeOfPosition(fx.fromInt(12), fx.fromInt(4)));
    // Queued behind an errand that keeps no issue spot, a returning intent heads for where it was given.
    const midWalk = run(true);
    expect(midWalk.weaponIssuedAt).not.toEqual(nodeOfPosition(fx.fromInt(2), fx.fromInt(2)));
    expect(midWalk.end).toEqual(midWalk.weaponIssuedAt);
  });

  it('swap: a part-used replaced good is destroyed instead of stowed', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    wear(sim, settler, { boots: { goodType: SHOES, usedPct: 50 } });
    pileAt(sim, 12, 2, FUR_BOOTS, 1);
    const armoury = armouryAt(sim, 6, 4);

    sim.enqueueSetup(equip(settler, FUR_BOOTS));
    sim.run(ERRAND_TICKS);

    expect(sim.world.get(settler, Equipment).boots?.goodType).toBe(FUR_BOOTS);
    expect(sim.world.has(settler, EquipOrder)).toBe(false);
    // The half-worn shoes vanished at the swap: no store or heap anywhere holds them.
    expect(sim.world.get(armoury, Stockpile).amounts.get(SHOES) ?? 0).toBe(0);
    const heaps = [...sim.world.query(Stockpile)].filter(
      (e) => (sim.world.get(e, Stockpile).amounts.get(SHOES) ?? 0) > 0,
    );
    expect(heaps).toHaveLength(0);
  });

  it('swap: worn-out boots are replaced by a fresh pair of the SAME good', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    wear(sim, settler, { boots: { goodType: SHOES, usedPct: 80 } });
    pileAt(sim, 12, 2, SHOES, 1);

    sim.enqueueSetup(equip(settler, SHOES));
    sim.run(ERRAND_TICKS);

    // The manual's rule (p. 27): equipping over an occupied slot drops the old item, and a part-used
    // one is lost. Matching goodType alone must not read as "already wearing it" and cancel the walk.
    // Near-fresh, not exactly fresh: the walk home already wears the new pair a fraction of a percent.
    const worn = sim.world.get(settler, Equipment).boots?.degreeOfUse ?? fx.fromInt(1);
    expect(worn).toBeLessThan(fx.div(fx.fromInt(1), fx.fromInt(10)));
    expect(groundUnits(sim, SHOES)).toBe(0); // the fresh pair was taken; the 80%-worn one was lost
    expect(sim.world.has(settler, EquipOrder)).toBe(false);
  });

  it('swap: a FRESH pair of the same good is not fetched twice', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    wear(sim, settler, { boots: SHOES });
    const pile = pileAt(sim, 12, 2, SHOES, 1);

    sim.enqueueSetup(equip(settler, SHOES));
    sim.run(ERRAND_TICKS);

    expect(sim.world.get(pile, Stockpile).amounts.get(SHOES)).toBe(1); // stock untouched
    expect(sim.world.has(settler, EquipOrder)).toBe(false);
  });

  it('gives up and walks home when nothing reachable holds the good', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);

    sim.enqueueSetup(equip(settler, SHOES));
    sim.run(50);

    expect(sim.world.has(settler, EquipOrder)).toBe(false);
    expect(sim.world.tryGet(settler, Equipment)?.boots ?? null).toBeNull();
  });

  it('an unconfined fighter fetches only inside the network at his feet, and stays put otherwise', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(64, 6) });
    setNeedsEnabled(sim.world, false);
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const fighter = ownedSettler(sim, 40, 3);
    setSettlerJob(sim.world, fighter, FIGHTER_JOB);
    const far = pileAt(sim, 2, 3, SWORD, 1); // 76 nodes away, no post to catch: not his to fetch
    const start = sim.world.get(fighter, Position).x;

    sim.enqueueSetup(equip(fighter, SWORD, 'weapon'));
    sim.run(ERRAND_TICKS);
    expect(sim.world.tryGet(fighter, Equipment)?.weapon ?? null).toBeNull();
    expect(sim.world.get(fighter, Position).x).toBe(start);
    expect(sim.world.get(far, Stockpile).amounts.get(SWORD)).toBe(1);

    pileAt(sim, 30, 3, SWORD, 1);
    sim.enqueueSetup(equip(fighter, SWORD, 'weapon'));
    sim.run(ERRAND_TICKS);
    expect(sim.world.get(fighter, Equipment).weapon?.goodType).toBe(SWORD);
  });

  it('fetches straight off the shelf of the workshop that makes the good', () => {
    // A producer's FINISHED shelf is a fetch source like any other - the brewery case, where a
    // settler need not wait for a carrier to walk the bottle to a warehouse first. (The input-side
    // reserve is the opposite rule and belongs to the recipe's own inputs, not its outputs.)
    const sim = new Simulation({ seed: 1, content: brewhouseContent(), map: grassMap(16, 6) });
    setNeedsEnabled(sim.world, false);
    const settler = ownedSettler(sim, 2, 2);
    const brewhouse = brewhouseAt(sim, 12, 2, [[MEAD, 3]]);

    sim.enqueueSetup(equip(settler, MEAD, 'misc', 0));
    sim.run(ERRAND_TICKS);

    expect(sim.world.get(settler, Equipment).misc[0]?.goodType).toBe(MEAD);
    expect(sim.world.get(brewhouse, Stockpile).amounts.get(MEAD)).toBe(2);
    expect(sim.world.has(settler, EquipOrder)).toBe(false);
  });

  it("leaves a workshop's own input reserve alone, and the menu never offers it", () => {
    // The twin of the case above. The brewhouse's shoes are what it brews WITH, so the errand may not
    // strip them however badly the settler wants boots - and the pick menu must agree, or the row
    // promises a pair no click can deliver.
    const sim = new Simulation({ seed: 1, content: brewhouseContent(), map: grassMap(16, 6) });
    setNeedsEnabled(sim.world, false);
    const settler = ownedSettler(sim, 2, 2);
    const brewhouse = brewhouseAt(sim, 12, 2, [[SHOES, 3]]);

    expect(sim.equipPickList(settler, 'boots')).toEqual([]);

    sim.enqueueSetup(equip(settler, SHOES, 'boots', 0));
    sim.run(ERRAND_TICKS);

    expect(sim.world.tryGet(settler, Equipment)?.boots ?? null).toBeNull();
    expect(sim.world.get(brewhouse, Stockpile).amounts.get(SHOES)).toBe(3);
    expect(sim.world.has(settler, EquipOrder)).toBe(false); // the drive found no source and gave up
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const errand = (): { hash: string; worn: boolean } => {
      const sim = freshSim();
      const settler = ownedSettler(sim, 2, 2);
      pileAt(sim, 12, 2, SHOES, 1);
      sim.enqueueSetup(equip(settler, SHOES));
      sim.run(ERRAND_TICKS);
      return { hash: sim.hashState(), worn: sim.world.get(settler, Equipment).boots?.goodType === SHOES };
    };
    const a = errand();
    const b = errand();
    expect(a.worn).toBe(true); // the fetch-and-wear errand really ran (not a vacuous hash)
    expect(a.hash).toBe(b.hash);
  });
});

describe('unequipGood - take off at the stow store, walk back', () => {
  it('walks to the store still wearing the good and takes it off there', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    wear(sim, settler, { weapon: SWORD });
    const armoury = armouryAt(sim, 10, 2);

    sim.enqueueSetup({ kind: 'unequipGood', entity: settler, group: 'weapon', slot: 0 });
    sim.run(10); // mid-walk to the armoury: the sword must still be ON the body, not in the hands
    expect(sim.world.has(settler, EquipOrder)).toBe(true);
    expect(sim.world.get(settler, Equipment).weapon?.goodType).toBe(SWORD);
    expect(sim.world.has(settler, Carrying)).toBe(false);

    sim.run(ERRAND_TICKS);
    expect(sim.world.get(settler, Equipment).weapon).toBeNull();
    expect(sim.world.get(armoury, Stockpile).amounts.get(SWORD)).toBe(1);
    expect(sim.world.has(settler, EquipOrder)).toBe(false);
    const back = sim.world.get(settler, Position);
    expect(nodeOfPosition(back.x, back.y)).toEqual(nodeOfPosition(fx.fromInt(2), fx.fromInt(2)));
  });

  it('destroys a part-used good where the settler stands instead of stowing it', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    wear(sim, settler, { boots: { goodType: SHOES, usedPct: 50 } });
    const armoury = armouryAt(sim, 10, 2);

    sim.enqueueSetup({ kind: 'unequipGood', entity: settler, group: 'boots', slot: 0 });
    sim.run(100);

    expect(sim.world.get(settler, Equipment).boots).toBeNull();
    expect(sim.world.has(settler, EquipOrder)).toBe(false);
    expect(sim.world.has(settler, Carrying)).toBe(false);
    // Destroyed, not stowed or dropped: no store or heap anywhere gained the shoes.
    expect(sim.world.get(armoury, Stockpile).amounts.get(SHOES) ?? 0).toBe(0);
    const heaps = [...sim.world.query(Stockpile)].filter(
      (e) => (sim.world.get(e, Stockpile).amounts.get(SHOES) ?? 0) > 0,
    );
    expect(heaps).toHaveLength(0);
    // Never walked off: the destroy happens on the spot, so the settler is still at the issue node.
    const at = sim.world.get(settler, Position);
    expect(nodeOfPosition(at.x, at.y)).toEqual(nodeOfPosition(fx.fromInt(2), fx.fromInt(2)));
  });

  it('sets the good on the ground when no store can take it', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 4, 2);
    wear(sim, settler, { weapon: SWORD });

    sim.enqueueSetup({ kind: 'unequipGood', entity: settler, group: 'weapon', slot: 0 });
    sim.run(100);

    expect(sim.world.get(settler, Equipment).weapon).toBeNull();
    expect(sim.world.has(settler, EquipOrder)).toBe(false);
    const heaps = [...sim.world.query(Stockpile)].filter(
      (e) => (sim.world.get(e, Stockpile).amounts.get(SWORD) ?? 0) > 0,
    );
    expect(heaps).toHaveLength(1); // dropped at its feet as a loose heap
  });
});

describe('order validation (recoverable no-ops)', () => {
  it('rejects a category mismatch, a bad slot address, a child and an empty-slot take-off', () => {
    const sim = freshSim();
    const ctx = ctxOf(sim);
    const settler = ownedSettler(sim, 2, 2);

    // A sword is no boots good; wood is no equippable at all; the misc row has MISC_EQUIP_SLOTS slots.
    equipGood(sim.world, ctx, {
      kind: 'equipGood',
      entity: settler,
      group: 'boots',
      slot: 0,
      goodType: SWORD,
    });
    equipGood(sim.world, ctx, {
      kind: 'equipGood',
      entity: settler,
      group: 'boots',
      slot: 0,
      goodType: WOOD,
    });
    equipGood(sim.world, ctx, {
      kind: 'equipGood',
      entity: settler,
      group: 'misc',
      slot: MISC_EQUIP_SLOTS,
      goodType: SHOES,
    });
    // Nothing worn: the cross has nothing to take off.
    unequipGood(sim.world, ctx, { kind: 'unequipGood', entity: settler, group: 'boots', slot: 0 });
    expect(sim.world.has(settler, EquipOrder)).toBe(false);

    const child = ownedSettler(sim, 3, 2);
    sim.world.add(child, Age, { ticks: 0 });
    equipGood(sim.world, ctx, { kind: 'equipGood', entity: child, group: 'boots', slot: 0, goodType: SHOES });
    expect(sim.world.has(child, EquipOrder)).toBe(false);
  });

  it('rejects a jobless settler - the planner ladder never plans one, so its errand would sit inert', () => {
    const sim = freshSim();
    const idle = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, idle, null);
    equipGood(sim.world, ctxOf(sim), {
      kind: 'equipGood',
      entity: idle,
      group: 'boots',
      slot: 0,
      goodType: SHOES,
    });
    expect(sim.world.has(idle, EquipOrder)).toBe(false);
  });
});

describe('enlisting - a fighter trade keeps no tool', () => {
  it('sets a fresh tool down at the settler feet instead of keeping or vanishing it', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 3, 2);
    wear(sim, e, { tool: TOOL_WOODEN });

    sim.enqueueSetup({ kind: 'setJob', entity: e, jobType: FIGHTER_JOB });
    sim.step();
    expect(sim.world.get(e, Equipment).tool).toBeNull(); // the slot empties the moment it enlists

    sim.run(30); // the drop atomic sets the freed unit down
    expect(sim.world.has(e, Carrying)).toBe(false);
    expect(groundUnits(sim, TOOL_WOODEN)).toBe(1); // conserved on the ground
  });

  it('destroys a part-used tool - fungible stock would regenerate it to fresh', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 3, 2);
    wear(sim, e, { tool: { goodType: TOOL_WOODEN, usedPct: 40 } });

    sim.enqueueSetup({ kind: 'setJob', entity: e, jobType: FIGHTER_JOB });
    sim.run(30);

    expect(sim.world.get(e, Equipment).tool).toBeNull();
    expect(sim.world.has(e, Carrying)).toBe(false);
    expect(groundUnits(sim, TOOL_WOODEN)).toBe(0);
  });

  it('calls off a tool-fetch errand in flight', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2);
    pileAt(sim, 12, 2, TOOL_WOODEN, 1);
    sim.enqueueSetup(equip(e, TOOL_WOODEN, 'tool'));
    sim.step();
    expect(sim.world.has(e, EquipOrder)).toBe(true);

    sim.enqueueSetup({ kind: 'setJob', entity: e, jobType: FIGHTER_JOB });
    sim.step();
    expect(sim.world.has(e, EquipOrder)).toBe(false); // the fetch died with the civilian trade

    sim.run(ERRAND_TICKS);
    expect(sim.world.tryGet(e, Equipment)?.tool ?? null).toBeNull();
    expect(groundUnits(sim, TOOL_WOODEN)).toBe(1); // the unit stayed in its pile
  });

  it('calls off a barracks drill in flight - the two errands never run at once', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2);
    const house = armouryAt(sim, 12, 2); // any house will do - the order only stores its id
    pileAt(sim, 12, 2, TOOL_WOODEN, 1);
    sim.world.add(e, TrainingOrder, { house, drillTicksLeft: 100 });

    sim.enqueueSetup(equip(e, TOOL_WOODEN, 'tool'));
    sim.step();
    // Without this the drill would outrank the fetch for its whole term, then the fetch would resume
    // and walk the settler back to a return spot the drill had already invalidated.
    expect(sim.world.has(e, TrainingOrder)).toBe(false);
    expect(sim.world.has(e, EquipOrder)).toBe(true);
  });

  it('sets a fresh tool down beside a foreign heap when its hands are full', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 3, 2);
    wear(sim, e, { tool: TOOL_WOODEN });
    sim.world.add(e, Carrying, { goodType: WOOD, amount: 1 }); // hands hold another good
    const feet = sim.world.get(e, Position);
    pileAt(sim, 3, 2, SWORD, 1); // and the tile it stands on already holds a third good

    sim.enqueueSetup({ kind: 'setJob', entity: e, jobType: FIGHTER_JOB });
    sim.run(30);

    expect(sim.world.get(e, Equipment).tool).toBeNull();
    expect(groundUnits(sim, TOOL_WOODEN)).toBe(1); // conserved, not swallowed by the refusing heap
    expect(groundUnits(sim, SWORD)).toBe(1); // and the heap already there is untouched
    expect(groundUnits(sim, WOOD)).toBe(1); // the carried load still reached the ground too
    expect(sim.world.get(e, Position)).toEqual(feet); // shed where it stood
  });

  it('leaves a disarmed soldier its weapon and armour on the ground, not nowhere', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 3, 2);
    setSettlerJob(sim.world, e, FIGHTER_JOB);
    wear(sim, e, { weapon: SWORD });
    const eq = sim.world.mut(e, Equipment);
    eq.armor = { goodType: FUR_BOOTS, degreeOfUse: fx.fromInt(0) }; // any good stands in for armour here

    sim.enqueueSetup({ kind: 'setJob', entity: e, jobType: WOODCUTTER });
    sim.run(30); // the hands-first unit rides the drop atomic to the ground

    expect(eq.weapon).toBeNull();
    expect(eq.armor).toBeNull();
    expect(sim.world.has(e, Carrying)).toBe(false);
    expect(groundUnits(sim, SWORD)).toBe(1); // both units survived the conversion
    expect(groundUnits(sim, FUR_BOOTS)).toBe(1);
  });

  it('carries the disarmed weapon into a store when one can take it', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 3, 2);
    setSettlerJob(sim.world, e, FIGHTER_JOB);
    wear(sim, e, { weapon: SWORD });
    const store = armouryAt(sim, 9, 2);

    // A workshop trade, not a gatherer: a gatherer's fresh work flag would make its own yard the
    // delivery sink, so the arms would bank on the ground beside it rather than walk to the store.
    sim.enqueueSetup({ kind: 'setJob', entity: e, jobType: CARPENTER });
    sim.run(ERRAND_TICKS);

    expect(sim.world.get(store, Stockpile).amounts.get(SWORD)).toBe(1); // banked, not left in the grass
    expect(groundUnits(sim, SWORD)).toBe(0);
    expect(sim.world.has(e, Carrying)).toBe(false);
  });

  it('refuses a tool equip order on a fighter but still accepts its boots order', () => {
    const sim = freshSim();
    const e = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, e, FIGHTER_JOB);
    pileAt(sim, 12, 2, TOOL_WOODEN, 1);
    pileAt(sim, 12, 4, SHOES, 1);

    sim.enqueueSetup(equip(e, TOOL_WOODEN, 'tool'));
    sim.step();
    expect(sim.world.has(e, EquipOrder)).toBe(false); // recoverable no-op, like every bad order

    sim.enqueueSetup(equip(e, SHOES));
    sim.step();
    expect(sim.world.has(e, EquipOrder)).toBe(true); // boots stay orderable on a fighter
  });

  it('refuses every equip and unequip order on a hero', () => {
    const sim = freshSim();
    const hero = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, hero, HERO_JOB);
    wear(sim, hero, { weapon: SWORD });
    pileAt(sim, 12, 2, LONG_SWORD, 1);

    sim.enqueueSetup(equip(hero, LONG_SWORD, 'weapon'));
    sim.enqueueSetup({ kind: 'unequipGood', entity: hero, group: 'weapon', slot: 0 });
    sim.step();

    expect(sim.world.has(hero, EquipOrder)).toBe(false);
    expect(sim.world.get(hero, Equipment).weapon?.goodType).toBe(SWORD);
  });

  it('refuses every equip order on a woman and offers her no pick list', () => {
    const sim = freshSim();
    const woman = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, woman, WOMAN_JOB);
    sim.world.add(woman, Female, { female: true });
    pileAt(sim, 12, 2, SHOES, 1);
    pileAt(sim, 12, 4, MEAD, 1);

    sim.enqueueSetup(equip(woman, SHOES));
    sim.enqueueSetup(equip(woman, MEAD, 'misc'));
    sim.step();

    expect(sim.world.has(woman, EquipOrder)).toBe(false);
    expect(sim.equipPickList(woman, 'boots')).toEqual([]);
    expect(sim.equipPickList(woman, 'misc')).toEqual([]);
  });
});

describe('errand interactions with combat and player orders', () => {
  it('a DEFEND guard with a stale Engagement completes the errand and re-holds its anchor', () => {
    const sim = freshSim();
    const guard = combatant(sim, 2, 2, HUMAN_PLAYER, MILITARY_MODE.DEFEND);
    const home = sim.world.get(guard, Position);
    const anchor = terrainNodeAt(sim, home.x, home.y);
    // A guard whose fight just ended: DEFEND anchored at its post + the Engagement the combat pass
    // must drop in returnToAnchor even while the errand lives (the deadlock regression).
    sim.world.mut(guard, Stance).anchorCell = anchor;
    sim.world.add(guard, Engagement, { repathAt: 0 });
    pileAt(sim, 10, 2, SHOES, 1);

    sim.enqueueSetup(equip(guard, SHOES));
    sim.run(ERRAND_TICKS);

    expect(sim.world.get(guard, Equipment).boots?.goodType).toBe(SHOES);
    expect(sim.world.has(guard, EquipOrder)).toBe(false);
    expect(sim.world.has(guard, Engagement)).toBe(false);
    const back = sim.world.get(guard, Position);
    expect(terrainNodeAt(sim, back.x, back.y)).toBe(anchor); // back on its unchanged post
  });

  it('a fresh move order cancels an in-flight errand (the player calls it off)', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    pileAt(sim, 12, 2, SHOES, 1);

    sim.enqueueSetup(equip(settler, SHOES));
    sim.run(10); // errand under way (walking to the pile)
    expect(sim.world.has(settler, EquipOrder)).toBe(true);

    sim.enqueueSetup({ kind: 'moveUnit', entity: settler, x: 4, y: 8 });
    sim.run(5);
    expect(sim.world.has(settler, EquipOrder)).toBe(false);
  });
});

describe('equipPickList - the pick-menu read view', () => {
  it('lists only the slot group’s goods with reachable units, summed over stores, in content order', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    setSettlerJob(sim.world, settler, FIGHTER_JOB);
    pileAt(sim, 8, 2, SHOES, 3);
    pileAt(sim, 10, 2, SHOES, 2);
    pileAt(sim, 12, 2, SWORD, 1);
    pileAt(sim, 13, 2, WOOD, 5); // not equippable - never listed

    expect(sim.equipPickList(settler, 'boots')).toEqual([{ goodType: SHOES, available: 5 }]);
    expect(sim.equipPickList(settler, 'weapon')).toEqual([{ goodType: SWORD, available: 1 }]);
    expect(sim.equipPickList(settler, 'misc')).toEqual([]);
  });

  it('counts only the settler’s own side - a rival store is not the errand’s to fetch from', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    const ours = pileAt(sim, 8, 2, SHOES, 2);
    sim.world.add(ours, Owner, { player: HUMAN_PLAYER });
    const theirs = pileAt(sim, 10, 2, SHOES, 7);
    sim.world.add(theirs, Owner, { player: RIVAL_PLAYER });

    // Without the owner gate the row would promise 9 pairs and the errand would come home with one.
    expect(sim.equipPickList(settler, 'boots')).toEqual([{ goodType: SHOES, available: 2 }]);
  });

  it('offers a fighter no tools at all - the menu must not list what no click can wear', () => {
    const sim = freshSim();
    const civilian = ownedSettler(sim, 2, 2);
    const fighter = ownedSettler(sim, 3, 2);
    setSettlerJob(sim.world, fighter, FIGHTER_JOB);
    pileAt(sim, 8, 2, TOOL_WOODEN, 2);
    pileAt(sim, 8, 4, SHOES, 1);

    expect(sim.equipPickList(civilian, 'tool')).toEqual([{ goodType: TOOL_WOODEN, available: 2 }]);
    expect(sim.equipPickList(fighter, 'tool')).toEqual([]);
    expect(sim.equipPickList(fighter, 'boots')).toEqual([{ goodType: SHOES, available: 1 }]);
  });

  it('bounds an unconfined fighter to the network at his feet, as the errand and the grant do', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(64, 6) });
    setNeedsEnabled(sim.world, false);
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const fighter = ownedSettler(sim, 40, 3);
    setSettlerJob(sim.world, fighter, FIGHTER_JOB);
    pileAt(sim, 2, 3, SWORD, 1); // 76 nodes away: beyond the walk range around him, no post to catch
    pileAt(sim, 30, 3, SWORD, 2);
    expect(sim.equipPickList(fighter, 'weapon')).toEqual([{ goodType: SWORD, available: 2 }]);
  });

  it('offers a civilian no weapon or armor rows', () => {
    const sim = freshSim();
    const civilian = ownedSettler(sim, 2, 2);
    pileAt(sim, 8, 2, SWORD, 1);

    expect(sim.equipPickList(civilian, 'weapon')).toEqual([]);
    expect(sim.equipPickList(civilian, 'armor')).toEqual([]);
  });
});
