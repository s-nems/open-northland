import { describe, expect, it } from 'vitest';
import { CurrentAtomic, SettlerProgress } from '../../../../src/components/index.js';
import { Simulation } from '../../../../src/index.js';
import {
  atomicSystem,
  combatSystem,
  FIGHT_EXPERIENCE_TYPE,
  FIGHT_MASTERY_HITS,
  HERO_GENERAL_EXPERIENCE_TYPE,
  SOLDIER_GENERAL_EXPERIENCE_TYPE,
  WEAPON_MAIN_TYPE,
} from '../../../../src/systems/index.js';
import {
  combatCadenceContent,
  ctxOf,
  fighterAt,
  grass,
  HERO,
  IRON_SPEAR_DAMAGE,
  OTHER,
  SOLDIER_SPEAR,
  SOLDIER_UNARMED,
  startSwing,
  VIKING,
  WOLF_TRIBE,
  WOMAN,
} from '../support.js';

describe('atomicSystem - a damaging swing accrues fight XP into the weapon-class bucket', () => {
  it('a spear swing accrues into the SPEAR fight bucket (the needfor-gate id space)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    startSwing(sim, attacker, { target, damage: 2090, hitAt: 1, weaponMainType: WEAPON_MAIN_TYPE.SPEAR }, 4);

    atomicSystem(sim.world, ctxOf(sim)); // the blow lands (frame 1) and trains the weapon class

    const xp = sim.world.get(attacker, SettlerProgress).experience;
    expect(xp.get(FIGHT_EXPERIENCE_TYPE.SPEAR)).toBe(1); // soldier-general factor 1 per swing
    expect(xp.get(FIGHT_EXPERIENCE_TYPE.SWORD)).toBeUndefined(); // only the spear bucket
    expect(xp.get(SOLDIER_GENERAL_EXPERIENCE_TYPE)).toBe(1); // and the band's general track (69)
  });

  it('maps each weapon class to its fight bucket (sword → SWORD, fist → FIST)', () => {
    const check = (mainType: number, bucket: number): void => {
      const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
      const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_UNARMED);
      const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
      startSwing(sim, attacker, { target, damage: 100, hitAt: 1, weaponMainType: mainType }, 2);
      atomicSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(attacker, SettlerProgress).experience.get(bucket)).toBe(1);
    };
    check(WEAPON_MAIN_TYPE.SWORD, FIGHT_EXPERIENCE_TYPE.SWORD);
    check(WEAPON_MAIN_TYPE.UNARMED, FIGHT_EXPERIENCE_TYPE.FIST);
  });

  it('trains nothing on a 0-damage swing; a saber hit trains only the band track (no bucket)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 10_000 });
    // A 0-damage swing (fully-absorbed / missed material) trains nothing.
    startSwing(sim, attacker, { target, damage: 0, hitAt: 1, weaponMainType: WEAPON_MAIN_TYPE.SPEAR }, 2);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(attacker, SettlerProgress).experience.size).toBe(0);

    // A saber (no JOB_EXPERIENCE_TYPE_FIGHT_SABER in the data) trains no fight BUCKET even when it
    // hits - but a soldier-band swing still feeds the class-gate track (69).
    startSwing(sim, attacker, { target, damage: 400, hitAt: 1, weaponMainType: WEAPON_MAIN_TYPE.SABER }, 2);
    atomicSystem(sim.world, ctxOf(sim));
    const xp = sim.world.get(attacker, SettlerProgress).experience;
    expect(xp.get(SOLDIER_GENERAL_EXPERIENCE_TYPE)).toBe(1);
    expect(xp.size).toBe(1); // no weapon bucket alongside it
  });

  it('routes the band track by job band: hero swings feed 70, civilian swings feed no band track', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(4, 1) });
    const target = fighterAt(sim, 2, 0, OTHER, null, { hitpoints: 10_000 });

    const hero = fighterAt(sim, 0, 0, VIKING, HERO);
    startSwing(sim, hero, { target, damage: 400, hitAt: 1, weaponMainType: WEAPON_MAIN_TYPE.SWORD }, 2);
    atomicSystem(sim.world, ctxOf(sim));
    const heroXp = sim.world.get(hero, SettlerProgress).experience;
    expect(heroXp.get(FIGHT_EXPERIENCE_TYPE.SWORD)).toBe(1);
    expect(heroXp.get(HERO_GENERAL_EXPERIENCE_TYPE)).toBe(1); // the hero band's own track
    expect(heroXp.get(SOLDIER_GENERAL_EXPERIENCE_TYPE)).toBeUndefined(); // never the soldier one

    const civilian = fighterAt(sim, 1, 0, VIKING, WOMAN);
    startSwing(sim, civilian, { target, damage: 100, hitAt: 1, weaponMainType: WEAPON_MAIN_TYPE.UNARMED }, 2);
    atomicSystem(sim.world, ctxOf(sim));
    const civXp = sim.world.get(civilian, SettlerProgress).experience;
    expect(civXp.get(FIGHT_EXPERIENCE_TYPE.FIST)).toBe(1); // the weapon bucket still trains
    expect(civXp.size).toBe(1); // but no band track for a non-fighter
  });

  it('a blow landing on a man felled earlier the same tick trains nothing and sounds no hit', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const target = fighterAt(sim, 1, 0, OTHER, null, { hitpoints: 100 });
    const killer = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    const late = fighterAt(sim, 2, 0, VIKING, SOLDIER_SPEAR);
    const blow = { target, damage: 2090, hitAt: 1, weaponMainType: WEAPON_MAIN_TYPE.SPEAR };
    startSwing(sim, killer, blow, 4);
    startSwing(sim, late, blow, 4);

    atomicSystem(sim.world, ctxOf(sim)); // both blows reach their frame this tick; the first one kills

    expect(sim.world.get(killer, SettlerProgress).experience.get(FIGHT_EXPERIENCE_TYPE.SPEAR)).toBe(1);
    expect(sim.world.get(late, SettlerProgress).experience.size).toBe(0);
    const hits = sim.events.current().filter((ev) => ev.kind === 'combatHit');
    expect(hits.map((ev) => ev.kind === 'combatHit' && ev.attacker)).toEqual([killer]);
  });

  it('a wild-animal bite trains nothing - progression is a civilization mechanic', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    // A jobless animal-tribe attacker whose natural weapon carries the real `maintype 1` (bearfist/
    // wolvefist): without the wildlife gate every landed bite would accrue FIST XP and feed the +50%
    // mastery damage bonus.
    const wolf = fighterAt(sim, 0, 0, WOLF_TRIBE, null);
    const target = fighterAt(sim, 1, 0, VIKING, WOMAN, { hitpoints: 10_000 });
    startSwing(sim, wolf, { target, damage: 100, hitAt: 1, weaponMainType: WEAPON_MAIN_TYPE.UNARMED }, 2);
    atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(wolf, SettlerProgress).experience.size).toBe(0);
  });
});

describe('combatSystem - fight experience raises the issued swing damage', () => {
  const swingDamageOf = (spearHits: number): number => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    if (spearHits > 0) {
      sim.world.mut(attacker, SettlerProgress).experience.set(FIGHT_EXPERIENCE_TYPE.SPEAR, spearHits);
    }
    fighterAt(sim, 1, 0, OTHER, null); // an adjacent unarmored enemy - the drive swings this tick
    combatSystem(sim.world, ctxOf(sim));
    const atomic = sim.world.get(attacker, CurrentAtomic);
    if (atomic.effect.kind !== 'attack') throw new Error('expected an attack swing');
    return atomic.effect.damage;
  };

  it('a novice swings the weapon column raw; combat mastery adds half again', () => {
    const base = IRON_SPEAR_DAMAGE['0'];
    expect(swingDamageOf(0)).toBe(base);
    expect(swingDamageOf(FIGHT_MASTERY_HITS)).toBe(base + base / 2); // +50% at the combat cap
  });
});
