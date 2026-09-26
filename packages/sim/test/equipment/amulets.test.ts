import { describe, expect, it } from 'vitest';
import {
  Armor,
  addWildlife,
  CurrentAtomic,
  Equipment,
  type EquipmentSlot,
  Health,
  MISC_EQUIP_SLOTS,
  MoveGoal,
  Settler,
  WALK_DIRECTION,
  WalkFacing,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import { plannerSystem } from '../../src/systems/index.js';
import { walkStepModifiersOf } from '../../src/systems/movement/walk-cost.js';
import {
  resolveAttackHit,
  resolveCombatHit,
} from '../../src/systems/settlers/atomics/effects/combat/index.js';
import { testContent } from '../fixtures/content.js';
import {
  ctxOf,
  grassMap,
  justAbove,
  NEED_DRIVE_THRESHOLD,
  needsSettlerAt,
} from '../settlers/needs/support.js';

// The six amulets on the fixture goods, carrying the original's magnitudes: food and stamina top their
// need up by 40% and never wear, strength deals 3/2, critical hit doubles one blow in five, defense
// halves what the bearer takes, speed saves two ticks a step.

const AMULET_FOOD = 23;
const AMULET_STAMINA = 24;
const AMULET_STRENGTH = 25;
const AMULET_DEFENSE = 26;
const AMULET_CRITICAL_HIT = 27;
const AMULET_SPEED = 28;
const POTION_FOOD = 14;
/** The fixture's leather armor, `blockingValue 10`. */
const LEATHER_CLASS = 1;
/** An animal tribe of the fixture. */
const BOAR_TRIBE = 12;

const ATTACK_SWING = { atomicId: 81, elapsed: 4, duration: 4 } as const;
const HP = 10_000;
const BLOW = 101;
const PRESSING: Fixed = justAbove(NEED_DRIVE_THRESHOLD);
const RESTORE_40: Fixed = fx.div(fx.fromInt(40), fx.fromInt(100));
const HALF: Fixed = fx.div(ONE, fx.fromInt(2));

const worn = (goodType: number, degreeOfUse: Fixed = fx.fromInt(0)): EquipmentSlot => ({
  goodType,
  degreeOfUse,
});

function carry(sim: Simulation, e: Entity, goods: ReadonlyArray<EquipmentSlot | null>): void {
  const misc = [...goods, ...new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null)].slice(
    0,
    MISC_EQUIP_SLOTS,
  );
  sim.world.add(e, Equipment, { boots: null, tool: null, weapon: null, armor: null, misc });
}

function sim(): Simulation {
  return new Simulation({ seed: 7, content: testContent(), map: grassMap(4, 1) });
}

/** A striker and a full-health target, each carrying the given misc row. */
function duel(
  s: Simulation,
  attackerCarries: ReadonlyArray<EquipmentSlot | null>,
  targetCarries: ReadonlyArray<EquipmentSlot | null> = [],
): { attacker: Entity; target: Entity } {
  const attacker = needsSettlerAt(s, 1, 0, {});
  const target = needsSettlerAt(s, 0, 0, {});
  // Facing its striker to the east, so every blow lands head-on at x1.
  s.world.add(target, WalkFacing, { direction: WALK_DIRECTION.E, target: WALK_DIRECTION.E });
  s.world.add(target, Health, { hitpoints: HP, max: HP });
  carry(s, attacker, attackerCarries);
  carry(s, target, targetCarries);
  return { attacker, target };
}

/** Land one `damage` blow and return the hitpoints it took. */
function strike(s: Simulation, attacker: Entity, target: Entity, damage = BLOW): number {
  const before = s.world.get(target, Health).hitpoints;
  resolveAttackHit(s.world, ctxOf(s), attacker, ATTACK_SWING, { kind: 'attack', target, damage }, []);
  return before - s.world.get(target, Health).hitpoints;
}

describe('combat amulets', () => {
  it('strength deals 3/2 of the blow, rounded down', () => {
    const s = sim();
    const { attacker, target } = duel(s, [worn(AMULET_STRENGTH)]);
    expect(strike(s, attacker, target)).toBe(151);
  });

  it('defense halves what the bearer takes, truncated, after the striker has scaled the blow', () => {
    const s = sim();
    const bare = duel(s, [], [worn(AMULET_DEFENSE)]);
    expect(strike(s, bare.attacker, bare.target)).toBe(50);
    const strong = duel(s, [worn(AMULET_STRENGTH)], [worn(AMULET_DEFENSE)]);
    expect(strike(s, strong.attacker, strong.target)).toBe(75); // trunc(151 / 2)
  });

  it('scales the blow after the hit direction and the armor, then the defense halves it', () => {
    const s = sim();
    const { attacker, target } = duel(s, [worn(AMULET_STRENGTH)], [worn(AMULET_DEFENSE)]);
    s.world.add(target, Armor, { armorClass: LEATHER_CLASS });
    // The striker stands east of the target, which faces west: struck from behind, x1.5.
    s.world.mut(target, WalkFacing).direction = WALK_DIRECTION.W;
    // trunc(101 * 1.5) = 151, less leather's 10 = 141, strength (141 * 3) >> 1 = 211, defense 211 / 2.
    expect(strike(s, attacker, target)).toBe(105);
  });

  it('a second copy adds nothing', () => {
    const s = sim();
    const { attacker, target } = duel(
      s,
      [worn(AMULET_STRENGTH), worn(AMULET_STRENGTH)],
      [worn(AMULET_DEFENSE), worn(AMULET_DEFENSE)],
    );
    expect(strike(s, attacker, target)).toBe(75);
  });

  it('an amulet taken off stops working', () => {
    const s = sim();
    const { attacker, target } = duel(s, [worn(AMULET_STRENGTH)]);
    s.world.mut(attacker, Equipment).misc = [null, null, null, null];
    expect(strike(s, attacker, target)).toBe(BLOW);
  });

  it("the attacker's amulets work on a target that carries nothing, such as an animal", () => {
    const s = sim();
    const attacker = needsSettlerAt(s, 1, 0, {});
    carry(s, attacker, [worn(AMULET_STRENGTH)]);
    const beast = s.world.create();
    addWildlife(s.world, beast, BOAR_TRIBE);
    s.world.add(beast, Health, { hitpoints: HP, max: HP });
    expect(strike(s, attacker, beast)).toBe(151);
  });

  it("a dead striker's blow and a defence-mode building's shot carry no striker amulet", () => {
    const s = sim();
    const striker = [worn(AMULET_STRENGTH), worn(AMULET_CRITICAL_HIT)];
    const dead = duel(s, striker);
    s.world.add(dead.attacker, Health, { hitpoints: 0, max: HP });
    const before = s.rng.getState();
    expect(strike(s, dead.attacker, dead.target)).toBe(BLOW);

    const garrison = duel(s, striker, [worn(AMULET_DEFENSE)]);
    const shelter = s.world.create(); // the building fires its own shot, carrying nothing
    resolveCombatHit(s.world, ctxOf(s), shelter, garrison.target, { damage: BLOW }, [], 'projectile');
    expect(HP - s.world.get(garrison.target, Health).hitpoints).toBe(50); // the target's defense still halves it
    expect(s.rng.getState()).toBe(before); // neither rolled the critical hit
  });

  it("a vehicle's shot carries none of its commander's amulets", () => {
    const s = sim();
    const { attacker, target } = duel(s, [worn(AMULET_STRENGTH), worn(AMULET_CRITICAL_HIT)]);
    const before = s.rng.getState();
    const stone = { damage: BLOW, vehicleShot: true };
    resolveCombatHit(s.world, ctxOf(s), attacker, target, stone, [], 'projectile');
    expect(HP - s.world.get(target, Health).hitpoints).toBe(BLOW);
    expect(s.rng.getState()).toBe(before); // no critical hit rolled
  });

  it('a critical hit doubles about one blow in five, after strength, drawn only while carried', () => {
    const s = sim();
    const plain = duel(s, []);
    const before = s.rng.getState();
    strike(s, plain.attacker, plain.target);
    expect(s.rng.getState()).toBe(before); // no amulet, no draw

    const { attacker, target } = duel(s, [worn(AMULET_STRENGTH), worn(AMULET_CRITICAL_HIT)]);
    const blows = 1000;
    const dealt: number[] = [];
    for (let i = 0; i < blows; i++) dealt.push(strike(s, attacker, target, 1));
    // floor(1 * 3/2) = 1, so a critical blow deals 2.
    expect(new Set(dealt)).toEqual(new Set([1, 2]));
    const critical = dealt.filter((d) => d === 2).length;
    expect(critical).toBeGreaterThan(150);
    expect(critical).toBeLessThan(250);
  });

  it('rolls the same critical hits for the same seed', () => {
    const run = () => {
      const s = sim();
      const { attacker, target } = duel(s, [worn(AMULET_CRITICAL_HIT)]);
      return Array.from({ length: 50 }, () => strike(s, attacker, target));
    };
    expect(run()).toEqual(run());
  });
});

describe('need amulets', () => {
  it('the food amulet tops hunger up on the spot by 40% and never wears', () => {
    const s = sim();
    const settler = needsSettlerAt(s, 0, 0, { hunger: PRESSING });
    carry(s, settler, [worn(AMULET_FOOD)]);
    plannerSystem(s.world, ctxOf(s));
    expect(s.world.has(settler, MoveGoal)).toBe(false);
    expect(s.world.has(settler, CurrentAtomic)).toBe(false);
    expect(s.world.get(settler, Settler).hunger).toBe(fx.sub(PRESSING, RESTORE_40));
    expect(s.world.get(settler, Equipment).misc[0]).toEqual(worn(AMULET_FOOD));
  });

  it('the stamina amulet answers fatigue the same way', () => {
    const s = sim();
    const settler = needsSettlerAt(s, 0, 0, { fatigue: PRESSING });
    carry(s, settler, [worn(AMULET_STAMINA)]);
    plannerSystem(s.world, ctxOf(s));
    expect(s.world.get(settler, Settler).fatigue).toBe(fx.sub(PRESSING, RESTORE_40));
    expect(s.world.get(settler, Equipment).misc[0]).toEqual(worn(AMULET_STAMINA));
  });

  it('goes before an unopened bottle but after an opened one', () => {
    const s = sim();
    const fresh = needsSettlerAt(s, 0, 0, { hunger: PRESSING });
    carry(s, fresh, [worn(POTION_FOOD), worn(AMULET_FOOD)]);
    const opened = needsSettlerAt(s, 1, 0, { hunger: PRESSING });
    carry(s, opened, [worn(AMULET_FOOD), worn(POTION_FOOD, HALF)]);
    plannerSystem(s.world, ctxOf(s));
    expect(s.world.get(fresh, Equipment).misc[0]).toEqual(worn(POTION_FOOD));
    expect(s.world.get(fresh, Settler).hunger).toBe(fx.sub(PRESSING, RESTORE_40));
    expect(s.world.get(opened, Equipment).misc[1]).toBeNull();
    expect(s.world.get(opened, Settler).hunger).toBe(fx.sub(PRESSING, ONE));
  });
});

describe('speed amulet', () => {
  it('saves two ticks a step, once however many are carried, and nothing once removed', () => {
    const s = sim();
    const walker = needsSettlerAt(s, 0, 0, {});
    const saved = () => walkStepModifiersOf(s.world, walker, s.content).stepTicksSaved;
    expect(saved()).toBe(0);
    carry(s, walker, [worn(AMULET_SPEED)]);
    expect(saved()).toBe(2);
    s.world.mut(walker, Equipment).misc = [worn(AMULET_SPEED), worn(AMULET_SPEED), null, null];
    expect(saved()).toBe(2);
    s.world.mut(walker, Equipment).misc = [null, null, null, null];
    expect(saved()).toBe(0);
  });
});
