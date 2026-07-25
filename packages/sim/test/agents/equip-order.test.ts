import type { EquipCategory } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Age,
  Building,
  Carrying,
  Engagement,
  Equipment,
  type EquipmentSlot,
  EquipOrder,
  MISC_EQUIP_SLOTS,
  Owner,
  Position,
  Settler,
  Stance,
  Stockpile,
  setNeedsEnabled,
} from '../../src/components/index.js';
import type { Command } from '../../src/core/commands/index.js';
import type { Fixed } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, nodeOfPosition, Simulation } from '../../src/index.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
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
 * (permanent weapons), 10 = fur_boots (boots); building 22 = armoury (the only store with gear
 * slots); tribe 1 = viking, job 1 = woodcutter.
 */

const SHOES = 8;
const SWORD = 9;
const FUR_BOOTS = 10;
const LONG_SWORD = 17;
const WOOD = 1;
const WOODCUTTER = 1;
const VIKING = 1;
const HUMAN_PLAYER = 0;
const ARMOURY = 22;

/** Enough ticks for a fetch across the small map plus the stow and return legs. */
const ERRAND_TICKS = 600;

function freshSim(): Simulation {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 6) });
  setNeedsEnabled(sim.world, false); // isolate the errand from the needs drives
  return sim;
}

function ownedSettler(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
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

/** A worn good: a bare number is a fresh item, `{goodType, usedPct}` one part-way through its life. */
type WornSpec = number | { goodType: number; usedPct: number };

const FULL_LIFE_PCT = 100;

function wear(sim: Simulation, e: Entity, slots: Partial<Record<'boots' | 'weapon', WornSpec>>): void {
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
    tool: null,
    weapon: slot(slots.weapon),
    armor: null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
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
  it('fetches the good from a pile, wears it fresh and returns to the issue node', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    const pile = pileAt(sim, 12, 2, SHOES, 1);
    const home = sim.world.get(settler, Position);
    const homeNode = nodeOfPosition(home.x, home.y);

    sim.enqueue(equip(settler, SHOES));
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
    // A weapon swap is the fresh-stow shape: boots wear per walked waypoint, so a swapped-out pair
    // is part-used (destroyed) by the time the settler reaches its replacement; a permanent weapon
    // arrives at the pile still fresh and stows.
    wear(sim, settler, { weapon: SWORD });
    pileAt(sim, 12, 2, LONG_SWORD, 1);
    const armoury = armouryAt(sim, 6, 4);

    sim.enqueue(equip(settler, LONG_SWORD, 'weapon'));
    sim.run(ERRAND_TICKS);

    expect(sim.world.get(settler, Equipment).weapon?.goodType).toBe(LONG_SWORD);
    expect(sim.world.get(armoury, Stockpile).amounts.get(SWORD)).toBe(1);
    expect(sim.world.has(settler, EquipOrder)).toBe(false);
    expect(sim.world.has(settler, Carrying)).toBe(false);
  });

  it('swap: a part-used replaced good is destroyed instead of stowed', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    wear(sim, settler, { boots: { goodType: SHOES, usedPct: 50 } });
    pileAt(sim, 12, 2, FUR_BOOTS, 1);
    const armoury = armouryAt(sim, 6, 4);

    sim.enqueue(equip(settler, FUR_BOOTS));
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

  it('gives up and walks home when nothing reachable holds the good', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);

    sim.enqueue(equip(settler, SHOES));
    sim.run(50);

    expect(sim.world.has(settler, EquipOrder)).toBe(false);
    expect(sim.world.tryGet(settler, Equipment)?.boots ?? null).toBeNull();
  });
});

describe('unequipGood - take off at the stow store, walk back', () => {
  it('walks to the store still wearing the good and takes it off there', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    wear(sim, settler, { weapon: SWORD });
    const armoury = armouryAt(sim, 10, 2);

    sim.enqueue({ kind: 'unequipGood', entity: settler, group: 'weapon', slot: 0 });
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

    sim.enqueue({ kind: 'unequipGood', entity: settler, group: 'boots', slot: 0 });
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

    sim.enqueue({ kind: 'unequipGood', entity: settler, group: 'weapon', slot: 0 });
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
    sim.world.get(idle, Settler).jobType = null;
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

describe('errand interactions with combat and player orders', () => {
  it('a DEFEND guard with a stale Engagement completes the errand and re-holds its anchor', () => {
    const sim = freshSim();
    const guard = combatant(sim, 2, 2, HUMAN_PLAYER, MILITARY_MODE.DEFEND);
    const home = sim.world.get(guard, Position);
    const anchor = terrainNodeAt(sim, home.x, home.y);
    // A guard whose fight just ended: DEFEND anchored at its post + the Engagement the combat pass
    // must drop in returnToAnchor even while the errand lives (the deadlock regression).
    sim.world.get(guard, Stance).anchorCell = anchor;
    sim.world.add(guard, Engagement, { repathAt: 0 });
    pileAt(sim, 10, 2, SHOES, 1);

    sim.enqueue(equip(guard, SHOES));
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

    sim.enqueue(equip(settler, SHOES));
    sim.run(10); // errand under way (walking to the pile)
    expect(sim.world.has(settler, EquipOrder)).toBe(true);

    sim.enqueue({ kind: 'moveUnit', entity: settler, x: 4, y: 8 });
    sim.run(5);
    expect(sim.world.has(settler, EquipOrder)).toBe(false);
  });
});

describe('equipPickList - the pick-menu read view', () => {
  it('lists only the slot group’s goods with reachable units, summed over stores, in content order', () => {
    const sim = freshSim();
    const settler = ownedSettler(sim, 2, 2);
    pileAt(sim, 8, 2, SHOES, 3);
    pileAt(sim, 10, 2, SHOES, 2);
    pileAt(sim, 12, 2, SWORD, 1);
    pileAt(sim, 13, 2, WOOD, 5); // not equippable - never listed

    expect(sim.equipPickList(settler, 'boots')).toEqual([{ goodType: SHOES, available: 5 }]);
    expect(sim.equipPickList(settler, 'weapon')).toEqual([{ goodType: SWORD, available: 1 }]);
    expect(sim.equipPickList(settler, 'misc')).toEqual([]);
  });
});
