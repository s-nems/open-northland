import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Health, SettlerProgress } from '../../../../../src/components/index.js';
import { Simulation } from '../../../../../src/index.js';
import {
  atomicSystem,
  combatSystem,
  FIGHT_EXPERIENCE_FULL,
  FIGHT_EXPERIENCE_TYPE,
  WEAPON_MAIN_TYPE,
} from '../../../../../src/systems/index.js';
import { nextTickCtxOf } from '../../../../fixtures/context.js';
import {
  ARMOR_BLOCKING,
  CHAIN_CLASS,
  combatCadenceContent,
  ctxOf,
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

describe('atomicSystem - a damaging swing accrues fight XP into the personal counter', () => {
  it('a spear swing accrues one point into the personal counter', () => {
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
    expect(xp.get(PERSONAL)).toBe(1);
    expect(xp.size).toBe(1); // no other bucket, no trade track
  });

  it('a change of weapon keeps the counter: fist, spear, sword and bow hits all add to it', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_UNARMED);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    const classes = [WEAPON_MAIN_TYPE.UNARMED, WEAPON_MAIN_TYPE.SPEAR, WEAPON_MAIN_TYPE.SWORD];
    for (const mainType of classes) {
      startSwing(sim, attacker, { target, damage: 100, hitFrames: [0], weaponMainType: mainType }, 2);
      atomicSystem(sim.world, nextTickCtxOf(sim));
    }
    const xp = sim.world.get(attacker, SettlerProgress).experience;
    expect(xp.get(PERSONAL)).toBe(classes.length);
    expect(xp.size).toBe(1);
  });

  it('trains nothing on a 0-damage swing or on a hit of a class without a bucket', () => {
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

    // The hero axe's class has no fight bucket.
    startSwing(sim, attacker, { target, damage: 400, hitFrames: [0], weaponMainType: HERO_AXE_MAIN_TYPE }, 2);
    atomicSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(attacker, SettlerProgress).experience.size).toBe(0);
  });

  it("trains nothing when the armor's blockingValue takes the whole blow, and one point when it does not", () => {
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
    expect(sim.world.get(attacker, SettlerProgress).experience.get(PERSONAL)).toBe(1);
  });

  it('the personal counter stops at full experience', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    sim.world.mut(attacker, SettlerProgress).experience.set(PERSONAL, FIGHT_EXPERIENCE_FULL);
    startSwing(
      sim,
      attacker,
      { target, damage: 100, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.SPEAR },
      2,
    );
    atomicSystem(sim.world, nextTickCtxOf(sim));
    const xp = sim.world.get(attacker, SettlerProgress).experience;
    expect(xp.get(PERSONAL)).toBe(FIGHT_EXPERIENCE_FULL);
  });

  it('a hero and a civilian train only the personal counter, never a trade track', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(4, 1) });
    const target = fighterAt(sim, 2, 0, OTHER, null, { hitpoints: 10_000 });

    const hero = fighterAt(sim, 0, 0, VIKING, HERO);
    startSwing(sim, hero, { target, damage: 400, hitFrames: [0], weaponMainType: WEAPON_MAIN_TYPE.SWORD }, 2);
    atomicSystem(sim.world, nextTickCtxOf(sim));
    const heroXp = sim.world.get(hero, SettlerProgress).experience;
    expect(heroXp.get(PERSONAL)).toBe(1);
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
    expect(civXp.get(PERSONAL)).toBe(1);
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

    expect(sim.world.get(killer, SettlerProgress).experience.get(PERSONAL)).toBe(1);
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
    expect(sim.world.get(attacker, SettlerProgress).experience.get(PERSONAL)).toBe(1);
  });

  it('a wild-animal bite trains nothing - progression is a civilization mechanic', () => {
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
  });
});

describe('combatSystem - fight experience raises the issued swing damage', () => {
  const swingDamageOf = (points: number): number => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    if (points > 0) sim.world.mut(attacker, SettlerProgress).experience.set(PERSONAL, points);
    fighterAt(sim, 1, 0, OTHER, null); // an adjacent unarmored enemy - the drive swings this tick
    combatSystem(sim.world, ctxOf(sim));
    const atomic = sim.world.get(attacker, CurrentAtomic);
    if (atomic.effect.kind !== 'attack') throw new Error('expected an attack swing');
    return atomic.effect.damage;
  };

  it('raises the column linearly to +40% at full experience, truncating', () => {
    const base = IRON_SPEAR_DAMAGE['0'];
    const HALF = FIGHT_EXPERIENCE_FULL / 2;
    expect(swingDamageOf(0)).toBe(base);
    expect(swingDamageOf(HALF)).toBe(Math.trunc((base * 12_000) / 10_000));
    expect(swingDamageOf(FIGHT_EXPERIENCE_FULL)).toBe(Math.trunc((base * 14_000) / 10_000));
  });
});
