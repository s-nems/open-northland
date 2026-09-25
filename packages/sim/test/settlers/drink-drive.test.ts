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
  Position,
  Settler,
  Stockpile,
  WALK_DIRECTION,
  WalkFacing,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import {
  HUMAN_HITPOINTS,
  needsSystem,
  plannerSystem,
  STARVATION_HITPOINTS_PER_TICK,
} from '../../src/systems/index.js';
import { resolveAttackHit } from '../../src/systems/settlers/atomics/effects/combat/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, grassMap, justAbove, NEED_DRIVE_THRESHOLD, needsSettlerAt } from './needs/support.js';

/** The fixture's attack swing (`setatomic 1 81 "viking_attack"`, length 4) at its landing frame - the
 *  shape `resolveAttackHit` reads to decide whether the clip announces the swing itself. */
const ATTACK_SWING = { atomicId: 81, elapsed: 4, duration: 4 } as const;

/**
 * Carried draughts are drunk on the spot with no clip: a pressing hunger or fatigue bar takes a sip before
 * anything else, and a blow or starvation bite that would leave a bearer under half its max hitpoints
 * is softened by healing sips first, even a lethal one. Fixture draughts (2 sips each, the original's
 * restores): mead 13 (half of both bars), potion_food_small 14 (a whole hunger bar),
 * potion_stamina_small 15 (a whole fatigue bar), potion_heal_small 16 (40% of max hitpoints).
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

function foodStoreAt(sim: Simulation, x: number, y: number, food: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[FOOD, food]]) });
}

describe('drink drive - hunger and fatigue draughts', () => {
  it('drinks a food potion on the spot instead of walking to the larder, and refills the whole bar', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
    carryDraughts(sim, settler, [fresh(POTION_FOOD)]);
    foodStoreAt(sim, 5, 0, 5); // a stocked larder exists - the sip must still win

    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(settler, MoveGoal)).toBe(false);
    expect(sim.world.get(settler, Settler).hunger).toBe(fx.sub(PRESSING, ONE));
    expect(sim.world.get(settler, Equipment).misc[0]).toEqual({ goodType: POTION_FOOD, degreeOfUse: HALF });
  });

  it('the second sip empties the bottle and it vanishes from the slot', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
    carryDraughts(sim, settler, [{ goodType: POTION_FOOD, degreeOfUse: HALF }]);

    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(settler, Equipment).misc[0]).toBeNull();
  });

  it('mead answers hunger and relieves both bars by half', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING, fatigue: HALF });
    carryDraughts(sim, settler, [fresh(MEAD)]);

    plannerSystem(sim.world, ctxOf(sim));
    const s = sim.world.get(settler, Settler);
    expect(s.hunger).toBe(fx.sub(PRESSING, HALF));
    expect(s.fatigue).toBe(fx.fromInt(0));
  });

  it('drinks a stamina potion instead of bedding down when tired', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { fatigue: PRESSING });
    carryDraughts(sim, settler, [fresh(POTION_STAMINA)]);

    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(settler, MoveGoal)).toBe(false);
    expect(sim.world.get(settler, Settler).fatigue).toBe(fx.sub(PRESSING, ONE));
  });

  it('answers hunger and fatigue in the same pass, each with its own bottle', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING, fatigue: PRESSING });
    carryDraughts(sim, settler, [fresh(POTION_STAMINA), fresh(POTION_FOOD)]);

    plannerSystem(sim.world, ctxOf(sim));
    const s = sim.world.get(settler, Settler);
    expect(s.hunger).toBe(fx.sub(PRESSING, ONE));
    expect(s.fatigue).toBe(fx.sub(PRESSING, ONE));
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
    // Mead counts as a small bottle, so the row order breaks the tie with a small food potion.
    expect(drunkSlot([fresh(MEAD), fresh(POTION_FOOD)])).toBe(0);
    expect(drunkSlot([fresh(POTION_FOOD), fresh(MEAD)])).toBe(0);
  });

  it('drinks before eating the food in hand', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
    sim.world.add(settler, Carrying, { goodType: FOOD, amount: 1 });
    carryDraughts(sim, settler, [fresh(POTION_FOOD)]);

    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(settler, Settler).hunger).toBe(fx.sub(PRESSING, ONE));
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
      expect(sim.world.get(settler, Settler).hunger).toBe(PRESSING);
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
    expect(sim.world.get(settler, Settler).fatigue).toBeLessThan(NEED_DRIVE_THRESHOLD);
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
    resolveAttackHit(sim.world, ctxOf(sim), attacker, ATTACK_SWING, { kind: 'attack', target, damage }, []);
  }

  it('a blow that leaves the bearer under half its max takes one sip', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = woundedBearer(sim, HP_MAX, [fresh(POTION_HEAL)]);
    const attacker = needsSettlerAt(sim, 1, 0, {});

    const blow = (HP_MAX * 3) / 5; // leaves two fifths of the pool, under half
    strike(sim, attacker, settler, blow);
    expect(sim.world.get(settler, Health).hitpoints).toBe(HP_MAX - blow + SIP_HP);
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
    expect(sim.world.get(settler, Equipment).misc[0]).toBeNull();
  });

  it('a blow past what the sips cover still kills', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = woundedBearer(sim, 10, [fresh(POTION_HEAL)]);
    const attacker = needsSettlerAt(sim, 1, 0, {});
    strike(sim, attacker, settler, 10 + 2 * SIP_HP);
    expect(sim.world.get(settler, Health).hitpoints).toBe(0);
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
    sim.world.mut(settler, Settler).hunger = ONE; // starving: this tick bites
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
      effect: { kind: 'attack', target: settler, damage: HP_MAX + 50, hitAt: 1 },
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
