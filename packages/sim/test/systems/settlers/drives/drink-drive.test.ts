import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  Building,
  Carrying,
  CurrentAtomic,
  Equipment,
  type EquipmentSlot,
  Health,
  MISC_EQUIP_SLOTS,
  MoveGoal,
  NeedOrder,
  NoRegeneration,
  PathFollow,
  Position,
  Resting,
  Settler,
  Stockpile,
  WALK_DIRECTION,
  WalkFacing,
  writeEquipSlot,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { cellAnchorNode, type Fixed, fx, ONE, Simulation } from '../../../../src/index.js';
import {
  atomicSystem,
  HUMAN_HITPOINTS,
  needsSystem,
  plannerSystem,
  STARVATION_HITPOINTS_PER_TICK,
  WHOLE_CLIP,
} from '../../../../src/systems/index.js';
import { DRINK_IN_PLACE_LEVEL } from '../../../../src/systems/lifecycle/needs/index.js';
import { resolveAttackHit } from '../../../../src/systems/settlers/atomics/effects/combat/index.js';
import { EAT_ATOMIC_ID } from '../../../../src/systems/settlers/atomics/start.js';
import { answerNeedInPlace } from '../../../../src/systems/settlers/drives/needs.js';
import { testContent } from '../../../fixtures/content.js';
import { nextTickCtxOf } from '../../../fixtures/context.js';
import { ctxOf, grassMap, justAbove, NEED_DRIVE_THRESHOLD, needsSettlerAt } from '../../../fixtures/needs.js';
import { needsOf, setNeeds } from '../../../fixtures/settler.js';

/** The fixture's attack swing (`setatomic 1 81 "viking_attack"`, length 4) at its landing frame - the
 *  shape `resolveAttackHit` reads to decide whether the clip announces the swing itself. */
const ATTACK_SWING = { atomicId: 81, elapsed: 4, duration: 4 } as const;

/**
 * Carried potions are drunk on the spot with no clip: a pressing hunger or fatigue bar takes a sip before
 * anything else, and a blow or starvation bite that would leave a bearer under half its max hitpoints
 * is softened by healing sips first, even a lethal one. Mead `stopsToDrink`: it is drunk on the eat clip,
 * on a stop of the way. Fixture draughts (2 sips each, the original's restores): mead 13 (half of both
 * bars), potion_food_small 14 (a whole hunger bar), potion_stamina_small 15 (a whole fatigue bar),
 * potion_heal_small 16 (40% of max hitpoints).
 */

const FOOD = 3;
const MEAD = 13;
const POTION_FOOD = 14;
const POTION_STAMINA = 15;
const POTION_HEAL = 16;
/** A five-sip food potion added per test; the fixture carries only small bottles. */
const POTION_FOOD_BIG = 19;
const BIG_BOTTLE_USES = 5;
const HEADQUARTERS = 1;
const VIKING = 1;
const PRESSING: Fixed = justAbove(NEED_DRIVE_THRESHOLD);
const HALF: Fixed = fx.div(ONE, fx.fromInt(2));
/** Enough ticks for a walker to leave its start and reach the next node on its route. */
const WALK_TICKS = 60;
/** Enough ticks for a walker to cross the fixture's 12-cell row, with a drink on the way. */
const ARRIVE_TICKS = 1200;

/** Put draughts (fresh unless a slot spec says otherwise) on a settler's misc row, low slots first. */
function carryDraughts(sim: Simulation, e: Entity, slots: ReadonlyArray<EquipmentSlot | null>): void {
  const misc = [...slots, ...new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null)].slice(
    0,
    MISC_EQUIP_SLOTS,
  );
  sim.world.add(e, Equipment, { boots: null, tool: null, weapon: null, armor: null, misc });
}

const fresh = (goodType: number): EquipmentSlot => ({ goodType, degreeOfUse: fx.fromInt(0) });

function withBigFoodPotion() {
  const base = testContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      {
        typeId: POTION_FOOD_BIG,
        id: 'potion_food_big',
        weight: 1,
        equip: { category: 'misc', wears: true, uses: BIG_BOTTLE_USES, restorePct: { hunger: 100 } },
      },
    ],
  });
}

function foodStoreAt(sim: Simulation, x: number, y: number, food: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[FOOD, food]]) });
  return e;
}

/** The misc slot of the mead `e` is drinking on the eat clip, or null when it runs no drink. */
function drinkingSlot(sim: Simulation, e: Entity): number | null {
  const atomic = sim.world.tryGet(e, CurrentAtomic);
  if (atomic === undefined || atomic.effect.kind !== 'drink') return null;
  expect(atomic.atomicId).toBe(EAT_ATOMIC_ID);
  return atomic.effect.slot;
}

/** Run the clip `e` is playing out to its end. */
function finishClip(sim: Simulation, e: Entity): void {
  const ticks = sim.world.get(e, CurrentAtomic).duration;
  for (let i = 0; i < ticks; i++) atomicSystem(sim.world, nextTickCtxOf(sim));
  expect(sim.world.has(e, CurrentAtomic)).toBe(false);
}

/** Send `e` walking to visual cell `(x, 0)`. */
function walkTo(sim: Simulation, e: Entity, x: number): void {
  const goal = cellAnchorNode(x, 0);
  const cell = sim.terrain?.nodeAt(goal.hx, goal.hy);
  if (cell === undefined) throw new Error('fixture map has no such cell');
  sim.world.add(e, MoveGoal, { cell });
}

describe('drink drive - hunger and fatigue draughts', () => {
  it('drinks a food potion on the spot instead of walking to the larder, and refills the whole bar', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
    carryDraughts(sim, settler, [fresh(POTION_FOOD)]);
    foodStoreAt(sim, 5, 0, 5); // a stocked larder exists - the sip must still win

    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(settler, MoveGoal)).toBe(false);
    expect(needsOf(sim, settler).hunger).toBe(fx.sub(PRESSING, ONE));
    expect(sim.world.get(settler, Equipment).misc[0]).toEqual({ goodType: POTION_FOOD, degreeOfUse: HALF });
  });

  it('the second sip empties the bottle and it vanishes from the slot', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
    carryDraughts(sim, settler, [{ goodType: POTION_FOOD, degreeOfUse: HALF }]);

    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(settler, Equipment).misc[0]).toBeNull();
  });

  it('puts mead off for its next walk, then drinks it where it stands on the eat clip near critical', () => {
    const hungerAt = (level: Fixed) => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
      const settler = needsSettlerAt(sim, 0, 0, { hunger: level, fatigue: HALF });
      carryDraughts(sim, settler, [fresh(MEAD)]);
      foodStoreAt(sim, 5, 0, 5); // the mead it carries keeps it from walking off to eat
      plannerSystem(sim.world, ctxOf(sim));
      return { sim, settler };
    };
    const early = hungerAt(PRESSING);
    expect(drinkingSlot(early.sim, early.settler)).toBeNull();
    expect(early.sim.world.has(early.settler, MoveGoal)).toBe(false);

    const { sim, settler } = hungerAt(DRINK_IN_PLACE_LEVEL);
    expect(drinkingSlot(sim, settler)).toBe(0);
    expect(sim.world.get(settler, Equipment).misc[0]).toEqual(fresh(MEAD));
    finishClip(sim, settler);
    // Half of both bars, and nothing from the eat clip's own food event.
    const s = needsOf(sim, settler);
    expect(s.hunger).toBe(fx.sub(DRINK_IN_PLACE_LEVEL, HALF));
    expect(s.fatigue).toBe(fx.fromInt(0));
    expect(sim.world.get(settler, Equipment).misc[0]).toEqual({ goodType: MEAD, degreeOfUse: HALF });
  });

  it('a drink whose mead left the slot during the clip lands nothing', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: DRINK_IN_PLACE_LEVEL });
    carryDraughts(sim, settler, [fresh(MEAD)]);
    plannerSystem(sim.world, ctxOf(sim));
    writeEquipSlot(sim.world, settler, 'misc', 0, fresh(POTION_HEAL));

    finishClip(sim, settler);
    expect(needsOf(sim, settler).hunger).toBe(DRINK_IN_PLACE_LEVEL);
    expect(sim.world.get(settler, Equipment).misc[0]).toEqual(fresh(POTION_HEAL));
  });

  it('a settler inside a building drinks its mead there rather than in the doorway', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
    carryDraughts(sim, settler, [fresh(MEAD)]);
    sim.world.add(settler, Resting, { at: foodStoreAt(sim, 0, 0, 0) });

    plannerSystem(sim.world, ctxOf(sim));
    expect(drinkingSlot(sim, settler)).toBe(0);
    expect(sim.world.has(settler, Resting)).toBe(true);
  });

  it('a walker stops on the way to drink its mead, clear of both ends; a loaded one only near critical', () => {
    /** Walk from cell 0 toward cell 10 at `hunger`, and where it stopped to drink, or null. */
    const stopOf = (hunger: Fixed, loaded: boolean): Fixed | null => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
      const settler = needsSettlerAt(sim, 0, 0, { hunger });
      carryDraughts(sim, settler, [fresh(MEAD)]);
      if (loaded) sim.world.add(settler, Carrying, { goodType: FOOD, amount: 1 });
      walkTo(sim, settler, 10);
      for (let i = 0; i < ARRIVE_TICKS && sim.world.has(settler, MoveGoal); i++) {
        sim.step();
        if (drinkingSlot(sim, settler) === null) continue;
        expect(sim.world.has(settler, PathFollow)).toBe(false); // it stands: the planner takes it up after
        return sim.world.get(settler, Position).x;
      }
      expect(sim.world.get(settler, Equipment).misc[0]).toEqual(fresh(MEAD));
      return null;
    };
    const stop = stopOf(PRESSING, false);
    // Two legs, a cell, clear of either end of the walk from cell 0 to cell 10.
    expect(stop).toBeGreaterThanOrEqual(fx.fromInt(1));
    expect(stop).toBeLessThanOrEqual(fx.fromInt(9));
    expect(stopOf(PRESSING, true)).toBeNull();
    expect(stopOf(DRINK_IN_PLACE_LEVEL, true)).not.toBeNull();
  });

  it('a fighter drinks its mead in place, unless its regeneration is prohibited; potions serve either way', () => {
    for (const prohibited of [false, true]) {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
      const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING, fatigue: PRESSING });
      carryDraughts(sim, settler, [fresh(MEAD), fresh(POTION_FOOD)]);
      if (prohibited) sim.world.add(settler, NoRegeneration, { prohibited: true });

      const started = answerNeedInPlace(sim.world, ctxOf(sim), settler, sim.world.get(settler, Settler));
      expect(needsOf(sim, settler).hunger).toBe(fx.sub(PRESSING, ONE)); // the potion, on the spot
      expect(started).toBe(!prohibited);
      expect(drinkingSlot(sim, settler)).toBe(prohibited ? null : 0); // mead for the fatigue
    }
  });

  it('drinks a stamina potion instead of bedding down when tired', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { fatigue: PRESSING });
    carryDraughts(sim, settler, [fresh(POTION_STAMINA)]);

    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(settler, MoveGoal)).toBe(false);
    expect(needsOf(sim, settler).fatigue).toBe(fx.sub(PRESSING, ONE));
  });

  it('answers hunger and fatigue in the same pass, each with its own bottle', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING, fatigue: PRESSING });
    carryDraughts(sim, settler, [fresh(POTION_STAMINA), fresh(POTION_FOOD)]);

    plannerSystem(sim.world, ctxOf(sim));
    const s = needsOf(sim, settler);
    expect(s.hunger).toBe(fx.sub(PRESSING, ONE));
    expect(s.fatigue).toBe(fx.sub(PRESSING, ONE));
    expect(sim.events.current()).toEqual([
      { kind: 'draughtDrunk', entity: settler, goodType: POTION_FOOD },
      { kind: 'draughtDrunk', entity: settler, goodType: POTION_STAMINA },
    ]);
  });

  it('takes an opened bottle first, then a small one before a large one, then the lowest slot', () => {
    const content = withBigFoodPotion();
    const drunkSlot = (misc: ReadonlyArray<EquipmentSlot>): number => {
      const sim = new Simulation({ seed: 1, content, map: grassMap(4, 1) });
      const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
      carryDraughts(sim, settler, misc);
      plannerSystem(sim.world, ctxOf(sim));
      const after = sim.world.get(settler, Equipment).misc;
      return misc.findIndex((held, slot) => after[slot]?.degreeOfUse !== held.degreeOfUse);
    };
    const opened = (goodType: number): EquipmentSlot => ({
      goodType,
      degreeOfUse: fx.div(ONE, fx.fromInt(BIG_BOTTLE_USES)),
    });

    expect(drunkSlot([fresh(POTION_FOOD), opened(POTION_FOOD_BIG)])).toBe(1);
    expect(drunkSlot([fresh(POTION_FOOD_BIG), fresh(POTION_FOOD)])).toBe(1);
    // Mead waits for a stop, so a potion answers on the spot whatever the row order.
    expect(drunkSlot([fresh(MEAD), fresh(POTION_FOOD)])).toBe(1);
    expect(drunkSlot([fresh(POTION_FOOD), fresh(MEAD)])).toBe(0);
  });

  it('drinks before eating the food in hand', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
    sim.world.add(settler, Carrying, { goodType: FOOD, amount: 1 });
    carryDraughts(sim, settler, [fresh(POTION_FOOD)]);

    plannerSystem(sim.world, ctxOf(sim));
    expect(needsOf(sim, settler).hunger).toBe(fx.sub(PRESSING, ONE));
    expect(sim.world.get(settler, Carrying).amount).toBe(1);
  });

  it('ignores a spent bottle and falls through to the walk-to-food branch', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
    carryDraughts(sim, settler, [{ goodType: POTION_FOOD, degreeOfUse: ONE }]);
    foodStoreAt(sim, 3, 0, 5);
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(settler, MoveGoal)).toBe(true);
  });

  it("leaves the bottle to a player's need order, which walks to the larder instead", () => {
    for (const need of ['hunger', 'piety'] as const) {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
      const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
      carryDraughts(sim, settler, [fresh(POTION_FOOD)]);
      sim.world.add(settler, NeedOrder, { need });
      foodStoreAt(sim, 5, 0, 5);

      plannerSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(settler, Equipment).misc[0]).toEqual(fresh(POTION_FOOD));
      expect(needsOf(sim, settler).hunger).toBe(PRESSING);
      if (need === 'hunger') expect(sim.world.has(settler, MoveGoal)).toBe(true);
    }
  });

  it('a walker drinks at the next node it reaches and keeps walking', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { fatigue: PRESSING });
    carryDraughts(sim, settler, [fresh(POTION_STAMINA)]);
    const goal = cellAnchorNode(10, 0);
    const cell = sim.terrain?.nodeAt(goal.hx, goal.hy);
    if (cell === undefined) throw new Error('fixture map has no such cell');
    sim.world.add(settler, MoveGoal, { cell });

    for (let i = 0; i < WALK_TICKS && sim.world.get(settler, Equipment).misc[0]?.degreeOfUse === 0; i++) {
      sim.step();
    }
    expect(sim.world.get(settler, Equipment).misc[0]?.degreeOfUse).toBe(HALF);
    expect(needsOf(sim, settler).fatigue).toBeLessThan(NEED_DRIVE_THRESHOLD);
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
    expect(sim.world.has(settler, MoveGoal)).toBe(true);
  });

  it('keeps the bottle while the bar is below the drive level', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: HALF });
    carryDraughts(sim, settler, [fresh(POTION_FOOD)]);
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(settler, Equipment).misc[0]).toEqual(fresh(POTION_FOOD));
  });
});

describe('healing draught - below half of max hitpoints', () => {
  const HP_MAX = HUMAN_HITPOINTS;
  /** 40% of HP_MAX, one healing sip. */
  const SIP_HP = 2000;

  function woundedBearer(
    sim: Simulation,
    hitpoints: number,
    misc: ReadonlyArray<EquipmentSlot | null>,
    max = HP_MAX,
  ) {
    const settler = needsSettlerAt(sim, 0, 0, {});
    sim.world.add(settler, Health, { hitpoints, max });
    // Facing its striker to the east, so every blow lands head-on at x1.
    sim.world.add(settler, WalkFacing, { direction: WALK_DIRECTION.E, target: WALK_DIRECTION.E });
    carryDraughts(sim, settler, misc);
    return settler;
  }

  function strike(sim: Simulation, attacker: Entity, target: Entity, damage: number): void {
    resolveAttackHit(
      sim.world,
      ctxOf(sim),
      attacker,
      ATTACK_SWING,
      { kind: 'attack', target, damage },
      [],
      WHOLE_CLIP,
    );
  }

  it('a blow that leaves the bearer under half its max takes one sip', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = woundedBearer(sim, HP_MAX, [fresh(POTION_HEAL)]);
    const attacker = needsSettlerAt(sim, 1, 0, {});

    const blow = (HP_MAX * 3) / 5; // leaves two fifths of the pool, under half
    strike(sim, attacker, settler, blow);
    expect(sim.world.get(settler, Health).hitpoints).toBe(HP_MAX - blow + SIP_HP);
    expect(sim.events.current().find((event) => event.kind === 'combatHit')).toMatchObject({
      damage: blow,
      targetMaxHealth: HP_MAX,
    });
    expect(sim.world.get(settler, Equipment).misc[0]).toEqual({ goodType: POTION_HEAL, degreeOfUse: HALF });
  });

  it('keeps drinking until the bearer is back at half, while sips last', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = woundedBearer(sim, HP_MAX, [fresh(POTION_HEAL)]);
    const attacker = needsSettlerAt(sim, 1, 0, {});

    strike(sim, attacker, settler, HP_MAX - 10);
    expect(sim.world.get(settler, Health).hitpoints).toBe(10 + 2 * SIP_HP);
    expect(sim.world.get(settler, Equipment).misc[0]).toBeNull();
  });

  it('a blow that stays at or above half leaves the bottle corked', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = woundedBearer(sim, HP_MAX, [fresh(POTION_HEAL)]);
    const attacker = needsSettlerAt(sim, 1, 0, {});
    strike(sim, attacker, settler, HP_MAX / 2);
    expect(sim.world.get(settler, Health).hitpoints).toBe(HP_MAX / 2);
    expect(sim.world.get(settler, Equipment).misc[0]).toEqual(fresh(POTION_HEAL));
  });

  it('a blow that would kill is survived when the sips cover it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = woundedBearer(sim, HP_MAX, [fresh(POTION_HEAL)]);
    const attacker = needsSettlerAt(sim, 1, 0, {});
    strike(sim, attacker, settler, HP_MAX + 50);
    expect(sim.world.get(settler, Health).hitpoints).toBe(2 * SIP_HP - 50);
    expect(sim.events.current().find((event) => event.kind === 'combatHit')).toMatchObject({
      damage: HP_MAX,
      targetMaxHealth: HP_MAX,
    });
    expect(sim.world.get(settler, Equipment).misc[0]).toBeNull();
  });

  it('a blow past what the sips cover still kills', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = woundedBearer(sim, 10, [fresh(POTION_HEAL)]);
    const attacker = needsSettlerAt(sim, 1, 0, {});
    strike(sim, attacker, settler, 10 + 2 * SIP_HP);
    expect(sim.world.get(settler, Health).hitpoints).toBe(0);
    expect(sim.events.current().find((event) => event.kind === 'combatHit')).toMatchObject({
      damage: 10,
      targetMaxHealth: HP_MAX,
    });
    expect(sim.world.get(settler, Equipment).misc[0]).toBeNull();
  });

  it('a blow on hitpoints a temple raised above the max takes only the damage off', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const blessed = HP_MAX + HP_MAX / 2;
    const settler = woundedBearer(sim, blessed, [fresh(POTION_HEAL)]);
    const attacker = needsSettlerAt(sim, 1, 0, {});
    strike(sim, attacker, settler, 10);
    expect(sim.world.get(settler, Health).hitpoints).toBe(blessed - 10);
  });

  it('a starvation bite that drops the bearer under half takes a sip', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const half = HP_MAX / 2;
    const settler = woundedBearer(sim, half, [fresh(POTION_HEAL)]);
    setNeeds(sim, settler, { hunger: ONE }); // starving: this tick bites
    needsSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(settler, Health).hitpoints).toBe(half - STARVATION_HITPOINTS_PER_TICK + SIP_HP);
    expect(sim.world.get(settler, Equipment).misc[0]).toEqual({ goodType: POTION_HEAL, degreeOfUse: HALF });
  });

  it('a lethal blow in a full tick is drunk off before the reaper looks', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = woundedBearer(sim, HP_MAX, [fresh(POTION_HEAL)]);
    const attacker = needsSettlerAt(sim, 1, 0, {});
    addCurrentAtomic(sim.world, attacker, {
      atomicId: ATTACK_SWING.atomicId,
      duration: ATTACK_SWING.duration,
      effect: { kind: 'attack', target: settler, damage: HP_MAX + 50, hitFrames: [0] },
      targetEntity: settler,
      targetTile: null,
    });

    sim.step(); // the blow lands, takes the pool under 1, the carried sips cover it, the cleanup spares it
    expect(sim.world.isAlive(settler)).toBe(true);
    expect(sim.world.get(settler, Health).hitpoints).toBe(2 * SIP_HP - 50);
    expect(sim.world.get(settler, Equipment).misc[0]).toBeNull();
    expect(sim.events.current().some((ev) => ev.kind === 'settlerDied')).toBe(false);
  });
});
