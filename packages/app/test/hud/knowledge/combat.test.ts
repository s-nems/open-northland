import { describe, expect, it } from 'vitest';
import { createKnowledgeBase, type KnowledgeWeapon } from '../../../src/hud/knowledge/base.js';
import {
  ANIMAL_TARGET,
  CAP_HITS,
  type CombatTarget,
  clipSeconds,
  combatTargets,
  criticalDamage,
  HIT_DIRECTION,
  HUMAN_HITPOINTS,
  hitsToKill,
  landed,
  NO_MODIFIERS,
  perSecond,
  secondsForHits,
  shownWeapons,
  stepSeconds,
  type TargetId,
  weaponOf,
} from '../../../src/hud/knowledge/combat.js';
import { FRANK, knowledgeContent, VIKING } from '../../support/knowledge-content.js';

const SPEAR = 2;
const BOW = 6;
const CATAPULT = 7;
const BLOCKING = 5;

const weapon = (over: Partial<KnowledgeWeapon> = {}): KnowledgeWeapon => ({
  typeId: 1,
  id: 'iron_spear',
  jobType: 33,
  filmJob: null,
  jobName: null,
  goodType: 40,
  goodName: null,
  mainType: SPEAR,
  weight: 0,
  minRange: 1,
  maxRange: 1,
  damage: { '0': 100, '2': 80, '6': 40, '7': 30 },
  clipTicks: 24,
  blows: 2,
  usable: true,
  ...over,
});

const base = createKnowledgeBase(knowledgeContent());
const target = (id: TargetId): CombatTarget => {
  const found = combatTargets(base).find((t) => t.id === id);
  if (found === undefined) throw new Error(`no target ${id}`);
  return found;
};

describe('landed', () => {
  it('takes the bare column unblocked on an armourless person', () => {
    expect(landed(weapon(), target('bare'))).toBe(100);
  });

  it("takes the armour's blocking off a person's column", () => {
    expect(landed(weapon(), target('leather'))).toBe(80 - BLOCKING);
  });

  it('turns a blow from behind up before the armour blocks', () => {
    const behind = { ...NO_MODIFIERS, direction: HIT_DIRECTION.behind };
    expect(landed(weapon(), target('leather'), behind)).toBe(120 - BLOCKING);
  });

  it('raises a soldier blow with fight experience, capped at double', () => {
    expect(landed(weapon(), target('bare'), { ...NO_MODIFIERS, hits: CAP_HITS })).toBe(200);
    expect(landed(weapon(), target('bare'), { ...NO_MODIFIERS, hits: CAP_HITS * 2 })).toBe(200);
  });

  it('gives a building the experience and the amulet, but no direction or block', () => {
    const strong = { ...NO_MODIFIERS, hits: CAP_HITS, strength: true, direction: HIT_DIRECTION.behind };
    expect(landed(weapon(), target('building'), strong)).toBe(90);
  });

  it('gives an animal the leather column with no blocking', () => {
    expect(landed(weapon(), ANIMAL_TARGET)).toBe(80);
  });

  it('gives a vehicle the bare column of the weapon, no experience', () => {
    expect(landed(weapon(), target('vehicle'), { ...NO_MODIFIERS, hits: CAP_HITS })).toBe(40);
  });

  it('gives a hero no fight experience', () => {
    const hero = weapon({ id: 'hero_spear' });
    expect(landed(hero, target('bare'), { ...NO_MODIFIERS, hits: CAP_HITS })).toBe(100);
  });

  it('gives a ranged shot no fight experience', () => {
    const bow = weapon({ id: 'long_bow', mainType: BOW });
    expect(landed(bow, target('bare'), { ...NO_MODIFIERS, hits: CAP_HITS })).toBe(100);
  });

  it('never lets an amulet raise a catapult or a building shot', () => {
    const strength = { ...NO_MODIFIERS, strength: true };
    expect(landed(weapon({ id: 'catapult', mainType: CATAPULT }), target('bare'), strength)).toBe(100);
    expect(landed(weapon({ id: 'house_bow', mainType: BOW }), target('bare'), strength)).toBe(100);
  });

  it('raises a blow with the strength amulet after the armour blocks', () => {
    expect(landed(weapon(), target('leather'), { ...NO_MODIFIERS, strength: true })).toBe(
      Math.floor(((80 - BLOCKING) * 150) / 100),
    );
  });

  it("halves what a defense amulet's bearer takes, last of all", () => {
    expect(landed(weapon(), target('leather'), { ...NO_MODIFIERS, defense: true })).toBe(
      Math.trunc((80 - BLOCKING) / 2),
    );
  });

  it('lands nothing below zero and on a column the weapon lacks', () => {
    expect(landed(weapon({ damage: { '2': BLOCKING - 1 } }), target('leather'))).toBe(0);
    expect(landed(weapon({ damage: {} }), target('building'))).toBe(0);
  });
});

describe('blow arithmetic', () => {
  it('counts blows to kill, a person by default', () => {
    expect(hitsToKill(1000)).toBe(HUMAN_HITPOINTS / 1000);
    expect(hitsToKill(70, 100)).toBe(2);
    expect(hitsToKill(0)).toBeNull();
  });

  it('doubles a critical hit', () => {
    expect(criticalDamage(75)).toBe(150);
  });

  it('spreads a clip over its blows', () => {
    const spear = weapon();
    expect(clipSeconds(spear)).toBe(2);
    expect(perSecond(100, spear)).toBe(100);
    expect(secondsForHits(3, spear)).toBe(4);
  });

  it('answers no timing for a row with no clip', () => {
    const unclipped = weapon({ clipTicks: null });
    expect(clipSeconds(unclipped)).toBeNull();
    expect(perSecond(100, unclipped)).toBeNull();
    expect(secondsForHits(1, unclipped)).toBeNull();
  });

  it('walks a shod step slower with weight, shorter for a tribe-wide reduction', () => {
    expect(stepSeconds(base, 0, VIKING)).toBeCloseTo(6 / 12);
    expect(stepSeconds(base, 2, VIKING)).toBeCloseTo(7 / 12);
    expect(stepSeconds(base, 0, FRANK)).toBeCloseTo(4 / 12);
  });
});

describe('weapon rows', () => {
  it('picks the row a soldier fights with over one the tribe cannot field', () => {
    const good = base.goodById.get('spear_wooden');
    expect(good).toBeDefined();
    if (good === undefined) return;
    expect(weaponOf(base, good, VIKING)?.id).toBe('wooden_spear');
    expect(shownWeapons(base, VIKING).map((w) => w.id)).toEqual(['wooden_spear']);
  });
});
