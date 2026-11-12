import type { JobRequirement } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../../../src/catalog/buildings.js';
import { WOOD_YIELD_PER_NODE } from '../../../src/catalog/felling.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_CHILD_FEMALE,
  JOB_CHILD_MALE,
  JOB_CIVILIST,
  JOB_COLLECTOR,
  JOB_HERO_SABER,
  JOB_HERO_SWORD,
  JOB_HERO_UNARMED,
  JOB_HEROINE_BOW,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  JOB_WOMAN,
} from '../../../src/catalog/jobs.js';
import { MINE_LEVELS, STONE_DEPOSIT_UNITS } from '../../../src/catalog/mining.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../../src/game/rules.js';
import {
  GOOD_BOW_LONG,
  GOOD_BOW_SHORT,
  GOOD_SPEAR_IRON,
  GOOD_SPEAR_WOODEN,
  GOOD_STONE,
  GOOD_SWORD_LONG,
  GOOD_SWORD_SHORT,
  GOOD_WOOD,
  WEAPON_FISTS,
  WEAPON_SWORD,
  weaponEquipmentFor,
} from '../../../src/game/sandbox/ids/index.js';
import { sandboxContent } from '../../../src/game/sandbox/index.js';
import { resourceCommand } from '../../../src/game/sandbox/place/index.js';
import { createSceneSim } from '../../../src/scenes/index.js';
import { sandboxScene } from '../../../src/scenes/sandbox/index.js';
import {
  type ArmorEntry,
  everyJobExperience,
  PERSON_PRESETS,
  type PersonPreset,
  personSpawnCommand,
  SOLDIER_WEAPONS,
  type SoldierWeapon,
  soldierSpawnCommand,
} from '../../../src/view/admin-debug/spawn-catalog.js';

/**
 * The admin/debug spawn palette's pure command mapping: a soldier carries its weapon and armor, a person
 * neither, a non-positive health is left to the sim, and a resource resolves to the right node lifecycle.
 */

describe('admin spawn command mapping', () => {
  // The running content's goods table the palette resolves weapon-good slugs against.
  const sandboxGoods = sandboxContent(grassTerrain(4, 4)).goods;
  const person = { player: 1, tribe: PRIMARY_TRIBE, hitpoints: 0, x: 2, y: 3 };
  const weapon = (jobType: number): SoldierWeapon => {
    const found = SOLDIER_WEAPONS.find((entry) => entry.jobType === jobType);
    if (found === undefined) throw new Error(`missing weapon for job ${jobType}`);
    return found;
  };
  const presetOf = (id: PersonPreset['id']): PersonPreset => {
    const found = PERSON_PRESETS.find((entry) => entry.id === id);
    if (found === undefined) throw new Error(`missing preset ${id}`);
    return found;
  };

  it('offers a man, a woman and both children, the woman and the girl spawning female', () => {
    expect(PERSON_PRESETS.map(({ id, jobType }) => [id, jobType])).toEqual([
      ['man', JOB_CIVILIST],
      ['woman', JOB_WOMAN],
      ['boy', JOB_CHILD_MALE],
      ['girl', JOB_CHILD_FEMALE],
    ]);
    const sim = createSceneSim(sandboxScene);
    const before = new Set(sim.snapshot().entities.map((e) => e.id));
    for (const id of ['man', 'woman', 'boy', 'girl'] as const)
      sim.enqueueSetup(personSpawnCommand(presetOf(id), { ...person, player: HUMAN_PLAYER }));
    sim.step();
    const spawned = sim
      .snapshot()
      .entities.filter((e) => !before.has(e.id) && e.components.Settler !== undefined)
      .sort((a, b) => a.id - b.id);
    expect(spawned.map((e) => e.components.Female !== undefined)).toEqual([false, true, false, true]);
  });

  it('a soldier wields its weapon and wears its armor, both also in its equipment slots', () => {
    const chain: ArmorEntry = { armorClass: 3, good: 999, id: 'armor_chain' };
    const cmd = soldierSpawnCommand({
      ...person,
      hitpoints: 250,
      weapon: weapon(JOB_SOLDIER_SWORD),
      armor: chain,
      x: 7,
      y: 9,
      goods: sandboxGoods,
    });
    expect(cmd).toEqual({
      kind: 'spawnSettler',
      jobType: JOB_SOLDIER_SWORD,
      x: 7,
      y: 9,
      tribe: PRIMARY_TRIBE,
      owner: 1,
      humanForm: true,
      hitpoints: 250,
      weaponTypeId: WEAPON_SWORD,
      armorClass: 3,
      // The goods in the slots drive the drawn look and the settler panel's equipment rows.
      equipment: { weapon: { goodType: GOOD_SWORD_SHORT }, armor: { goodType: 999 } },
    });
  });

  it('a bare-handed, unarmored soldier spawns as soldier_unarmed with fists and empty slots', () => {
    const cmd = soldierSpawnCommand({
      ...person,
      weapon: weapon(JOB_SOLDIER_UNARMED),
      armor: null,
      goods: sandboxGoods,
    });
    expect(cmd).toEqual({
      kind: 'spawnSettler',
      jobType: JOB_SOLDIER_UNARMED,
      x: 2,
      y: 3,
      tribe: PRIMARY_TRIBE,
      owner: 1,
      humanForm: true,
      weaponTypeId: WEAPON_FISTS,
    });
  });

  it('a person carries nothing, and the seat tribe and non-positive health pass as the sim defaults', () => {
    const FRANK = 2;
    const cmd = personSpawnCommand(presetOf('man'), { ...person, tribe: FRANK });
    expect(cmd).toEqual({ kind: 'spawnSettler', jobType: JOB_CIVILIST, x: 2, y: 3, tribe: FRANK, owner: 1 });
    expect(personSpawnCommand(presetOf('man'), { ...person, experience: [[7, 50]] })).toMatchObject({
      experience: [[7, 50]],
    });
  });

  it('every job experience clears each need and training row of the content', () => {
    const content = sandboxContent(grassTerrain(4, 4));
    const [track] = content.jobExperience;
    const [tribe] = content.tribes;
    if (track === undefined || tribe === undefined) throw new Error('sandbox lacks a track or a tribe');
    const RAW_TRACK = 77;
    const rows: JobRequirement[] = [
      { requirement: 'need', target: 'job', targetId: 19, amount: 10, experienceTypes: [track.typeId] },
      { requirement: 'need', target: 'job', targetId: 20, amount: 30, experienceTypes: [track.typeId] },
      { requirement: 'train', target: 'job', targetId: 19, amount: 5, experienceTypes: [RAW_TRACK] },
    ];
    const OLD_SWORD_BUCKET = 73;
    const swordRow: JobRequirement = {
      requirement: 'need',
      target: 'job',
      targetId: JOB_SOLDIER_SWORD,
      amount: 10,
      experienceTypes: [OLD_SWORD_BUCKET],
    };
    const withRows = { ...content, tribes: [{ ...tribe, jobRequirements: [...rows, swordRow] }] };
    const xp = new Map(everyJobExperience(withRows));
    for (const row of rows) {
      expect(
        systems.requirementRepeats(content.jobExperience, xp, row.experienceTypes),
      ).toBeGreaterThanOrEqual(row.amount);
    }
    // The fighter's row names an old bucket nothing reads; the personal counter starts full instead.
    expect(xp.has(OLD_SWORD_BUCKET)).toBe(false);
    expect(xp.get(systems.FIGHT_EXPERIENCE_TYPE.PERSONAL)).toBe(systems.FIGHT_EXPERIENCE_FULL);
  });

  it('a wood resource resolves to a felled tree node', () => {
    const cmd = resourceCommand(GOOD_WOOD, 4, 5);
    expect(cmd).toEqual({
      kind: 'placeResource',
      good: GOOD_WOOD,
      x: 4,
      y: 5,
      remaining: WOOD_YIELD_PER_NODE,
      harvestAtomic: expect.any(Number),
      felling: true,
    });
  });

  it('a stone resource resolves to a mined deposit node', () => {
    const cmd = resourceCommand(GOOD_STONE, 1, 1);
    expect(cmd?.kind).toBe('placeResource');
    if (cmd?.kind !== 'placeResource') throw new Error('expected placeResource');
    expect(cmd.remaining).toBe(STONE_DEPOSIT_UNITS);
    expect(cmd.deposit).toEqual({ levels: MINE_LEVELS });
    expect(cmd.felling).toBeUndefined();
  });

  it('an unknown good is not spawnable (null command)', () => {
    expect(resourceCommand(9999, 0, 0)).toBeNull();
  });
});

describe('weaponEquipmentFor - the one job→equipment-weapon map every spawn path shares', () => {
  const sandboxGoods = sandboxContent(grassTerrain(4, 4)).goods;

  it('each soldier class carries its matching weapon good (so its Broń row + drawn weapon match)', () => {
    // The seam the scene placer, the imported-map spawn AND the admin palette all derive from, so a
    // pre-placed warrior fills the same equipment weapon slot a freshly-spawned one does.
    const eq = (jobType: number) => weaponEquipmentFor(jobType, sandboxGoods);
    expect(eq(JOB_SOLDIER_SPEAR_WOODEN)).toEqual({ weapon: { goodType: GOOD_SPEAR_WOODEN } });
    expect(eq(JOB_SOLDIER_SPEAR)).toEqual({ weapon: { goodType: GOOD_SPEAR_IRON } });
    expect(eq(JOB_SOLDIER_SWORD)).toEqual({ weapon: { goodType: GOOD_SWORD_SHORT } });
    expect(eq(JOB_SOLDIER_BROADSWORD)).toEqual({ weapon: { goodType: GOOD_SWORD_LONG } });
    expect(eq(JOB_ARCHER)).toEqual({ weapon: { goodType: GOOD_BOW_SHORT } });
    expect(eq(JOB_ARCHER_LONG)).toEqual({ weapon: { goodType: GOOD_BOW_LONG } });
  });

  it('resolves the good against the running content - real goodtypes.ini ids, not the sandbox +100', () => {
    // On a decoded map the sim plays on the merged real content whose weapon goods keep the
    // goodtypes.ini ids (37–42); the slug join must land there, or the panel's Weapon row shows an
    // unknown good (the empty-socket bug this pins).
    const realGoods = [
      { typeId: 38, id: 'bow_long' },
      { typeId: 42, id: 'sword_long' },
    ];
    expect(weaponEquipmentFor(JOB_SOLDIER_BROADSWORD, realGoods)).toEqual({ weapon: { goodType: 42 } });
    expect(weaponEquipmentFor(JOB_ARCHER_LONG, realGoods)).toEqual({ weapon: { goodType: 38 } });
    // A content without the slug (a minimal fixture) spawns the soldier without an equipment weapon.
    expect(weaponEquipmentFor(JOB_SOLDIER_SWORD, realGoods)).toBeUndefined();
  });

  it('heroes carry the good matching the warrior body they borrow', () => {
    const eq = (jobType: number) => weaponEquipmentFor(jobType, sandboxGoods);
    // Heroes borrow per their baseatomics soldier class (jobtypes.ini): 44→34 (short sword), 45→35.
    expect(eq(JOB_HERO_SWORD)).toEqual({ weapon: { goodType: GOOD_SWORD_SHORT } });
    expect(eq(JOB_HERO_SABER)).toEqual({ weapon: { goodType: GOOD_SWORD_LONG } });
    expect(eq(JOB_HEROINE_BOW)).toEqual({ weapon: { goodType: GOOD_BOW_LONG } });
    expect(eq(JOB_HERO_UNARMED)).toBeUndefined();
  });

  it('the bare-handed warrior and a civilian get no equipment weapon (empty slot → their own body)', () => {
    const eq = (jobType: number) => weaponEquipmentFor(jobType, sandboxGoods);
    expect(eq(JOB_SOLDIER_UNARMED)).toBeUndefined();
    expect(eq(JOB_COLLECTOR)).toBeUndefined();
    expect(eq(JOB_CIVILIST)).toBeUndefined();
  });
});
