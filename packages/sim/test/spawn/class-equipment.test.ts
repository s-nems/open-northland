import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Armor, Equipment } from '../../src/components/index.js';
import type { SettlerEquipment } from '../../src/core/commands/index.js';
import { Rng } from '../../src/core/rng.js';
import { World } from '../../src/ecs/world.js';
import { createSettler } from '../../src/systems/spawn/index.js';
import { testContent } from '../fixtures/content.js';

const VIKING = 1;
const HERO_SABER = 45;
const HERO_SABER_GOOD = 17;
const HERO_ARMOR = 3;
const HERO_ARMOR_GOOD = 18;

describe('createSettler hero equipment', () => {
  it('derives the permanent weapon from the hero class for mission/map spawns', () => {
    const world = new World();
    const base = testContent();
    const content = {
      ...base,
      jobs: base.jobs.map((job) =>
        job.typeId === HERO_SABER ? { ...job, fixedArmorType: HERO_ARMOR } : job,
      ),
      weapons: [
        ...base.weapons,
        {
          typeId: 13,
          id: 'test_hatschi_saber',
          tribeType: VIKING,
          jobType: HERO_SABER,
          goodType: HERO_SABER_GOOD,
          weight: 0,
          minRange: 1,
          maxRange: 2,
          damage: { '0': 90 },
          hitSounds: {},
          missSounds: {},
        },
      ],
      armor: [
        ...base.armor,
        {
          typeId: HERO_ARMOR,
          id: 'test_hero_chain',
          goodType: HERO_ARMOR_GOOD,
          mainType: 2,
          blockingValue: 5,
          weight: 3,
        },
      ],
    };
    const hero = createSettler(world, content, new Rng(1), {
      x: 0,
      y: 0,
      tribe: VIKING,
      jobType: HERO_SABER,
      // A caller cannot replace the class-authored weapon or armor through a raw spawn payload.
      armorClass: 1,
      equipment: { weapon: { goodType: 9 }, armor: { goodType: 1 } },
    });
    if (hero === null) throw new Error('hero spawn failed');

    expect(world.get(hero, Equipment)).toMatchObject({
      weapon: { goodType: HERO_SABER_GOOD, degreeOfUse: 0 },
      armor: { goodType: HERO_ARMOR_GOOD, degreeOfUse: 0 },
    });
    expect(world.get(hero, Armor)).toEqual({ armorClass: HERO_ARMOR });
  });
});

describe('createSettler soldier class weapon', () => {
  const SOLDIER_UNARMED = 31;
  const SWORDSMAN_LONG = 35;
  const LONG_SWORD_GOOD = 17; // fixture good `long_sword`
  const LEATHER_GOOD = 1;
  const base = testContent();
  const content = parseContentSet({
    ...base,
    jobs: [...base.jobs, { typeId: SWORDSMAN_LONG, id: 'soldier_sword_long' }],
    weapons: [
      ...base.weapons,
      {
        typeId: 8,
        id: 'long_sword',
        tribeType: VIKING,
        mainType: 3,
        jobType: SWORDSMAN_LONG,
        goodType: LONG_SWORD_GOOD,
        minRange: 1,
        maxRange: 2,
        damage: { '0': 3800 },
      },
    ],
  });
  const spawn = (jobType: number, equipment?: SettlerEquipment) => {
    const world = new World();
    const e = createSettler(world, content, new Rng(1), {
      x: 0,
      y: 0,
      tribe: VIKING,
      jobType,
      ...(equipment !== undefined ? { equipment } : {}),
    });
    if (e === null) throw new Error('soldier spawn failed');
    return world.tryGet(e, Equipment);
  };

  it('fills an unnamed weapon slot with the class weapon good, beside the named slots', () => {
    expect(spawn(SWORDSMAN_LONG)?.weapon).toEqual({ goodType: LONG_SWORD_GOOD, degreeOfUse: 0 });
    expect(spawn(SWORDSMAN_LONG, { armor: { goodType: LEATHER_GOOD } })).toMatchObject({
      weapon: { goodType: LONG_SWORD_GOOD },
      armor: { goodType: LEATHER_GOOD },
    });
  });

  it('keeps an explicitly empty weapon slot, and a class with no weapon good carries no equipment', () => {
    expect(spawn(SWORDSMAN_LONG, { weapon: null })?.weapon).toBeNull();
    expect(spawn(SOLDIER_UNARMED)).toBeUndefined();
  });
});
