import { describe, expect, it } from 'vitest';
import {
  Building,
  Health,
  Owner,
  Position,
  Settler,
  SettlerProgress,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import { fx, ONE, Simulation, TICKS_PER_SECOND } from '../../../../../src/index.js';
import { attackClipTiming } from '../../../../../src/systems/conflict/weapons.js';
import {
  atomicSystem,
  FIGHT_EXPERIENCE_FULL,
  FIGHT_EXPERIENCE_FULL_UNITS,
  FIGHT_EXPERIENCE_TYPE,
  FIGHT_EXPERIENCE_UNITS_PER_POINT,
  fightUnitsOfPoints,
  WEAPON_MAIN_TYPE,
} from '../../../../../src/systems/index.js';
import { nextTickCtxOf } from '../../../../fixtures/context.js';
import {
  ARMOR_BLOCKING,
  CHAIN_CLASS,
  combatCadenceContent,
  fighterAt,
  grass,
  HERO,
  HERO_AXE_MAIN_TYPE,
  IRON_SPEAR_DAMAGE,
  OTHER,
  SOLDIER_SPEAR,
  SOLDIER_UNARMED,
  startSwing,
  VIKING,
  WOLF_TRIBE,
  WOMAN,
} from '../support.js';

const PERSONAL = FIGHT_EXPERIENCE_TYPE.PERSONAL;
/** The owner's blow-time rates, in points per second of the attack clip. */
const MELEE_POINTS_PER_SECOND = 0.75;
const TAKEN_POINTS_PER_SECOND = 0.5;
/** A blow on a structure earns a quarter of the same blow on a living target. */
const STRUCTURE_SHARE_DENOMINATOR = 4;
const HEADQUARTERS_TYPE = 1;
const OTHER_PLAYER = 1;

/** The seconds of `e`'s own attack clip. */
function clipSeconds(sim: Simulation, e: Entity): number {
  return attackClipTiming(sim.content, sim.world.get(e, Settler)).length / TICKS_PER_SECOND;
}

/** The stored units one landed melee blow of `striker` earns him. */
function meleeUnits(sim: Simulation, striker: Entity): number {
  return clipSeconds(sim, striker) * MELEE_POINTS_PER_SECOND * FIGHT_EXPERIENCE_UNITS_PER_POINT;
}

/** `e`'s personal counter in points, parts of a point kept. */
function pointsOf(sim: Simulation, e: Entity): number {
  return (sim.world.get(e, SettlerProgress).experience.get(PERSONAL) ?? 0) / FIGHT_EXPERIENCE_UNITS_PER_POINT;
}

describe('atomicSystem - a damaging swing accrues fight XP into the personal counter', () => {
  it("a landed melee blow earns 3/4 point per second of the striker's own attack clip", () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(
      sim,
      attacker,
      { target, damage: 2090, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.SPEAR },
      4,
    );

    atomicSystem(sim.world, nextTickCtxOf(sim)); // the blow lands (frame 0) and trains its striker

    const xp = sim.world.get(attacker, SettlerProgress).experience;
    expect(pointsOf(sim, attacker)).toBe(clipSeconds(sim, attacker) * MELEE_POINTS_PER_SECOND);
    expect(pointsOf(sim, attacker)).toBeGreaterThan(1); // a spear's slow swing earns more than a point
    expect(xp.size).toBe(1); // no other bucket, no trade track
  });

  it('a change of weapon keeps the counter: every class but the catapult adds to it, saber and axe too', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_UNARMED);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    const classes = [
      WEAPON_MAIN_TYPE.UNARMED,
      WEAPON_MAIN_TYPE.SPEAR,
      WEAPON_MAIN_TYPE.SWORD,
      WEAPON_MAIN_TYPE.SABER,
      HERO_AXE_MAIN_TYPE,
    ];
    for (const mainType of classes) {
      startSwing(sim, attacker, { target, damage: 100, hitFrames: [0], weaponMainType: mainType }, 2);
      atomicSystem(sim.world, nextTickCtxOf(sim));
    }
    const xp = sim.world.get(attacker, SettlerProgress).experience;
    expect(xp.get(PERSONAL)).toBe(classes.length * meleeUnits(sim, attacker));
    expect(xp.size).toBe(1);
  });

  it('trains nothing on a 0-damage swing or on a hit of no weapon class', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    // A 0-damage swing (fully-absorbed / missed material) trains nothing.
    startSwing(
      sim,
      attacker,
      { target, damage: 0, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.SPEAR },
      2,
    );
    atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(attacker, SettlerProgress).experience.size).toBe(0);

    startSwing(
      sim,
      attacker,
      { target, damage: 400, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.NONE },
      2,
    );
    atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(attacker, SettlerProgress).experience.size).toBe(0);
  });

  it("trains nothing when the armor's blockingValue takes the whole blow, and the blow's time when it does not", () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000, armorClass: CHAIN_CLASS });
    const swing = (damage: number): void => {
      startSwing(
        sim,
        attacker,
        { target, damage, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.SPEAR },
        2,
      );
      atomicSystem(sim.world, nextTickCtxOf(sim));
    };

    swing(ARMOR_BLOCKING); // the whole blow blocked: no damage, no experience
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000);
    expect(sim.world.get(attacker, SettlerProgress).experience.size).toBe(0);

    swing(ARMOR_BLOCKING + 1);
    expect(sim.world.get(target, Health).hitpoints).toBe(10_000 - 1);
    expect(sim.world.get(attacker, SettlerProgress).experience.get(PERSONAL)).toBe(meleeUnits(sim, attacker));
  });

  it('the personal counter stops at full experience', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    sim.world.mut(attacker, SettlerProgress).experience.set(PERSONAL, FIGHT_EXPERIENCE_FULL_UNITS);
    startSwing(
      sim,
      attacker,
      { target, damage: 100, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.SPEAR },
      2,
    );
    atomicSystem(sim.world, nextTickCtxOf(sim));
    const xp = sim.world.get(attacker, SettlerProgress).experience;
    expect(xp.get(PERSONAL)).toBe(FIGHT_EXPERIENCE_FULL_UNITS);
  });

  it('a hero and a civilian train only the personal counter, never a trade track', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(4, 1) });
    const target = fighterAt(sim, 2, 0, OTHER, null, { hitpoints: 10_000 });

    const hero = fighterAt(sim, 0, 0, VIKING, HERO);
    startSwing(sim, hero, { target, damage: 400, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.SWORD }, 2);
    atomicSystem(sim.world, nextTickCtxOf(sim));
    const heroXp = sim.world.get(hero, SettlerProgress).experience;
    expect(heroXp.get(PERSONAL)).toBe(meleeUnits(sim, hero));
    expect(heroXp.size).toBe(1);

    const civilian = fighterAt(sim, 1, 0, VIKING, WOMAN);
    startSwing(
      sim,
      civilian,
      { target, damage: 100, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.UNARMED },
      2,
    );
    atomicSystem(sim.world, nextTickCtxOf(sim));
    const civXp = sim.world.get(civilian, SettlerProgress).experience;
    expect(civXp.get(PERSONAL)).toBe(meleeUnits(sim, civilian));
    expect(civXp.size).toBe(1);
  });

  it('a blow landing on a man felled earlier the same tick trains nothing and sounds no hit', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 100 });
    const killer = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const late = fighterAt(sim, 2, 0, VIKING, SOLDIER_SPEAR);
    const blow = { target, damage: 2090, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.SPEAR };
    startSwing(sim, killer, blow, 4);
    startSwing(sim, late, blow, 4);

    atomicSystem(sim.world, nextTickCtxOf(sim)); // both blows reach their frame this tick; the first one kills

    expect(sim.world.get(killer, SettlerProgress).experience.get(PERSONAL)).toBe(meleeUnits(sim, killer));
    expect(sim.world.get(late, SettlerProgress).experience.size).toBe(0);
    const hits = sim.events.current().filter((ev) => ev.kind === 'combatHit');
    expect(hits.map((ev) => ev.kind === 'combatHit' && ev.attacker)).toEqual([killer]);
  });

  it('a damaging blow on a wild animal trains the striker like one on a person', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const wolf = fighterAt(sim, 1, 0, WOLF_TRIBE, null, { hitpoints: 10_000 });
    startSwing(
      sim,
      attacker,
      { target: wolf, damage: 100, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.SPEAR },
      4,
    );
    atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(wolf, Health).hitpoints).toBeLessThan(10_000);
    expect(sim.world.get(attacker, SettlerProgress).experience.get(PERSONAL)).toBe(meleeUnits(sim, attacker));
  });

  it('a blow on a building earns a quarter of the same blow on a person, rounded down', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const house = sim.world.create();
    sim.world.add(house, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    sim.world.add(house, Building, { buildingType: HEADQUARTERS_TYPE, tribe: VIKING, built: ONE, level: 0 });
    sim.world.add(house, Owner, { player: OTHER_PLAYER });
    sim.world.add(house, Health, { hitpoints: 10_000, max: 10_000 });
    startSwing(
      sim,
      attacker,
      { target: house, damage: 100, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.SPEAR },
      4,
    );
    atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(house, Health).hitpoints).toBeLessThan(10_000);
    const quarter = Math.floor(meleeUnits(sim, attacker) / STRUCTURE_SHARE_DENOMINATOR);
    expect(quarter).toBeGreaterThan(0);
    expect(sim.world.get(attacker, SettlerProgress).experience.get(PERSONAL)).toBe(quarter);
  });

  it("a wild-animal bite trains the beast nothing, and earns its victim 1/2 point per second of the beast's clip", () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    // A jobless animal-tribe attacker whose natural weapon carries the real `maintype 1` (bearfist/
    // wolvefist): without the wildlife gate every landed bite would accrue FIST XP and feed the mastery
    // damage bonus.
    const wolf = fighterAt(sim, 0, 0, WOLF_TRIBE, null);
    const target = fighterAt(sim, 1, 0, VIKING, WOMAN, { hitpoints: 10_000 });
    startSwing(
      sim,
      wolf,
      { target, damage: 100, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.UNARMED },
      2,
    );
    atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(wolf, SettlerProgress).experience.size).toBe(0);
    expect(pointsOf(sim, target)).toBe(clipSeconds(sim, wolf) * TAKEN_POINTS_PER_SECOND);
  });
});

describe('fight experience raises a landed melee blow', () => {
  /** The hitpoints one melee blow of `base` takes off an unarmored man, struck by a spearman of `points`. */
  const landedOf = (points: number, base: number): number => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    if (points > 0)
      sim.world.mut(attacker, SettlerProgress).experience.set(PERSONAL, fightUnitsOfPoints(points));
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(
      sim,
      attacker,
      { target, damage: base, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.SPEAR },
      2,
    );
    atomicSystem(sim.world, nextTickCtxOf(sim));
    return 10_000 - sim.world.get(target, Health).hitpoints;
  };

  it('raises the blow linearly to +40% at full experience, truncating, as it lands', () => {
    const base = IRON_SPEAR_DAMAGE['0'];
    const bare = landedOf(0, base);
    const HALF = FIGHT_EXPERIENCE_FULL / 2;
    expect(landedOf(HALF, base)).toBe(Math.trunc((bare * 12_000) / 10_000));
    expect(landedOf(FIGHT_EXPERIENCE_FULL, base)).toBe(Math.trunc((bare * 14_000) / 10_000));
  });
});
