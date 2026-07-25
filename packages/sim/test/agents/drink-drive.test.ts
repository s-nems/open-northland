import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  Equipment,
  type EquipmentSlot,
  Health,
  MISC_EQUIP_SLOTS,
  MoveGoal,
  Position,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import { resolveAttackHit } from '../../src/systems/agents/effects-combat/index.js';
import { aiSystem, atomicSystem, needsSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, grassMap, justAbove, NEED_THRESHOLD, needsSettlerAt } from './needs/support.js';

/**
 * The AUTO-DRINK drives + the healing draught's death-save. A pressing settler with a matching misc
 * draught drinks it IN PLACE (the drink replaces the walk to food/bed - manual: "will automatically
 * take it when his stomach starts to rumble"); a lethal blow or starvation bite on a healing-draught
 * bearer spends a sip instead of killing. Fixture draughts (2 sips each):
 * mead 13 (hunger+fatigue 40/40), potion_food_small 14 (+50 hunger), potion_stamina_small 15
 * (+50 fatigue), potion_heal_small 16 (50% of max HP). Eat atomic 10 ("viking_eat", 5 ticks).
 */

const FOOD = 3;
const MEAD = 13;
const POTION_FOOD = 14;
const POTION_STAMINA = 15;
const POTION_HEAL = 16;
const EAT_ATOMIC = 10;
const HEADQUARTERS = 1;
const VIKING = 1;
const PRESSING: Fixed = justAbove(NEED_THRESHOLD);
const HALF: Fixed = fx.div(ONE, fx.fromInt(2));
const RESTORE_40: Fixed = fx.div(fx.fromInt(40), fx.fromInt(100));

/** Put draughts (fresh unless a slot spec says otherwise) on a settler's misc row, low slots first. */
function carryDraughts(sim: Simulation, e: Entity, slots: ReadonlyArray<EquipmentSlot | null>): void {
  const misc = [...slots, ...new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null)].slice(
    0,
    MISC_EQUIP_SLOTS,
  );
  sim.world.add(e, Equipment, { boots: null, tool: null, weapon: null, armor: null, misc });
}

const fresh = (goodType: number): EquipmentSlot => ({ goodType, degreeOfUse: fx.fromInt(0) });

/** Drive the started drink atomic to completion (the eat clip is 5 ticks). */
function finishAtomic(sim: Simulation, e: Entity): void {
  for (let i = 0; i < 8 && sim.world.has(e, CurrentAtomic); i++) atomicSystem(sim.world, ctxOf(sim));
}

function foodStoreAt(sim: Simulation, x: number, y: number, food: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[FOOD, food]]) });
}

describe('drink drive - hunger and fatigue draughts', () => {
  it('drinks a food potion in place instead of walking to the larder', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
    carryDraughts(sim, settler, [fresh(POTION_FOOD)]);
    foodStoreAt(sim, 5, 0, 5); // a stocked larder exists - the sip must still win

    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(settler, MoveGoal)).toBe(false); // no walk - drunk on the spot
    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(EAT_ATOMIC); // the eat gesture doubles as the drink clip
    expect(atomic.effect).toEqual({ kind: 'drink', slot: 0 });

    finishAtomic(sim, settler);
    // +50% hunger relief, and the 2-sip bottle is half spent.
    expect(sim.world.get(settler, Settler).hunger).toBe(fx.sub(PRESSING, HALF));
    expect(sim.world.get(settler, Equipment).misc[0]).toEqual({ goodType: POTION_FOOD, degreeOfUse: HALF });
  });

  it('the second sip empties the bottle and it vanishes from the slot', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
    carryDraughts(sim, settler, [{ goodType: POTION_FOOD, degreeOfUse: HALF }]);

    aiSystem(sim.world, ctxOf(sim));
    finishAtomic(sim, settler);
    expect(sim.world.get(settler, Equipment).misc[0]).toBeNull();
  });

  it('mead answers hunger and relieves BOTH bars by its 40/40 restore', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING, fatigue: HALF });
    carryDraughts(sim, settler, [fresh(MEAD)]);

    aiSystem(sim.world, ctxOf(sim));
    finishAtomic(sim, settler);
    const s = sim.world.get(settler, Settler);
    expect(s.hunger).toBe(fx.sub(PRESSING, RESTORE_40));
    expect(s.fatigue).toBe(fx.sub(HALF, RESTORE_40));
  });

  it('drinks a stamina potion instead of bedding down when tired', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { fatigue: PRESSING });
    carryDraughts(sim, settler, [fresh(POTION_STAMINA)]);

    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(settler, MoveGoal)).toBe(false);
    expect(sim.world.get(settler, CurrentAtomic).effect).toEqual({ kind: 'drink', slot: 0 });
    finishAtomic(sim, settler);
    expect(sim.world.get(settler, Settler).fatigue).toBe(fx.sub(PRESSING, HALF));
  });

  it('prefers the dedicated potion over mead, wherever it sits in the row', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
    carryDraughts(sim, settler, [fresh(MEAD), fresh(POTION_FOOD)]); // mead first, potion second
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(settler, CurrentAtomic).effect).toEqual({ kind: 'drink', slot: 1 });
  });

  it('ignores a spent bottle and falls through to the walk-to-food branch', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
    carryDraughts(sim, settler, [{ goodType: POTION_FOOD, degreeOfUse: ONE }]);
    foodStoreAt(sim, 3, 0, 5);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(settler, MoveGoal)).toBe(true); // walking to the larder, not sipping air
  });

  it('carried food still outranks the bottle (food in hand is free, the sip is finite)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = needsSettlerAt(sim, 0, 0, { hunger: PRESSING });
    sim.world.add(settler, Carrying, { goodType: FOOD, amount: 1 });
    carryDraughts(sim, settler, [fresh(POTION_FOOD)]);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(settler, CurrentAtomic).effect).toMatchObject({ kind: 'eat', goodType: FOOD });
  });
});

describe('healing draught - the death-save', () => {
  const HP_MAX = 300;

  function woundedBearer(sim: Simulation, hitpoints: number, misc: ReadonlyArray<EquipmentSlot | null>) {
    const settler = needsSettlerAt(sim, 0, 0, {});
    sim.world.add(settler, Health, { hitpoints, max: HP_MAX });
    carryDraughts(sim, settler, misc);
    return settler;
  }

  it('a lethal blow spends a sip instead of killing: the bearer stands at 50% of max', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = woundedBearer(sim, 10, [fresh(POTION_HEAL)]);
    const attacker = needsSettlerAt(sim, 1, 0, {});

    resolveAttackHit(sim.world, ctxOf(sim), attacker, { kind: 'attack', target: settler, damage: 999 }, []);
    const health = sim.world.get(settler, Health);
    expect(health.hitpoints).toBe(HP_MAX / 2); // regenerated, not dead
    expect(sim.world.get(settler, Equipment).misc[0]).toEqual({ goodType: POTION_HEAL, degreeOfUse: HALF });

    // The second save drains the bottle; the third blow kills - the shield is finite.
    resolveAttackHit(sim.world, ctxOf(sim), attacker, { kind: 'attack', target: settler, damage: 999 }, []);
    expect(sim.world.get(settler, Health).hitpoints).toBe(HP_MAX / 2);
    expect(sim.world.get(settler, Equipment).misc[0]).toBeNull();
    resolveAttackHit(sim.world, ctxOf(sim), attacker, { kind: 'attack', target: settler, damage: 999 }, []);
    expect(sim.world.get(settler, Health).hitpoints).toBe(0);
  });

  it('a non-lethal blow drains normally - the bottle stays corked', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = woundedBearer(sim, HP_MAX, [fresh(POTION_HEAL)]);
    const attacker = needsSettlerAt(sim, 1, 0, {});
    resolveAttackHit(sim.world, ctxOf(sim), attacker, { kind: 'attack', target: settler, damage: 40 }, []);
    expect(sim.world.get(settler, Health).hitpoints).toBe(HP_MAX - 40);
    expect(sim.world.get(settler, Equipment).misc[0]).toEqual(fresh(POTION_HEAL));
  });

  it('the starvation bite that would finish a bearer is saved too', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 1) });
    const settler = woundedBearer(sim, 1, [fresh(POTION_HEAL)]);
    sim.world.get(settler, Settler).hunger = ONE; // starving, and the bite (max/240 >= 1) is lethal
    needsSystem(sim.world, ctxOf(sim)); // tick 0 is a starvation beat
    expect(sim.world.get(settler, Health).hitpoints).toBe(HP_MAX / 2);
    expect(sim.world.get(settler, Equipment).misc[0]).toEqual({ goodType: POTION_HEAL, degreeOfUse: HALF });
  });
});
