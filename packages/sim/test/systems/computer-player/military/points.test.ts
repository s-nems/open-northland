import { type ContentSet, IR_VERSION, parseContentSet, type WeaponType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { fighterPoints, UNBUFFED } from '../../../../src/systems/computer-player/military/points.js';
import { ARMOR_MATERIAL, WEAPON_MAIN_TYPE } from '../../../../src/systems/readviews/index.js';

const VIKING = 1;
/** The armours' blocking value, as every base armour record carries it. */
const BLOCKING = 5;
/** The defence amulet: half of every blow. */
const HALF_TAKEN_PCT = 50;

/** The viking sword, spear and bow rows of the real `weapons.ini` columns (material 0 bare, 1 wool, 2
 *  leather, 3 chain, 4 plate). */
function soldierContent(): ContentSet {
  const weapon = (
    typeId: number,
    id: string,
    mainType: number,
    goodType: number,
    maxRange: number,
    damage: Record<string, number>,
  ) => ({ typeId, id, tribeType: VIKING, mainType, goodType, minRange: 1, maxRange, damage });
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { data: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 37, id: 'short_bow' },
      { typeId: 38, id: 'long_bow' },
      { typeId: 39, id: 'wooden_spear' },
      { typeId: 40, id: 'iron_spear' },
      { typeId: 41, id: 'short_sword' },
      { typeId: 42, id: 'long_sword' },
    ],
    jobs: [],
    buildings: [],
    weapons: [
      weapon(4, 'wooden_spear', WEAPON_MAIN_TYPE.SPEAR, 39, 2, {
        '0': 2400,
        '1': 1200,
        '2': 1800,
        '3': 240,
        '4': 240,
      }),
      weapon(5, 'iron_spear', WEAPON_MAIN_TYPE.SPEAR, 40, 2, {
        '0': 3800,
        '1': 1900,
        '2': 2850,
        '3': 950,
        '4': 2090,
      }),
      weapon(7, 'short_sword', WEAPON_MAIN_TYPE.SWORD, 41, 1, {
        '0': 1600,
        '1': 800,
        '2': 1200,
        '3': 400,
        '4': 400,
      }),
      weapon(8, 'long_sword', WEAPON_MAIN_TYPE.SWORD, 42, 2, {
        '0': 3800,
        '1': 1900,
        '2': 2850,
        '3': 2090,
        '4': 950,
      }),
      weapon(16, 'short_bow', WEAPON_MAIN_TYPE.BOW, 37, 15, {
        '0': 500,
        '1': 128,
        '2': 400,
        '3': 100,
        '4': 100,
      }),
      weapon(17, 'long_bow', WEAPON_MAIN_TYPE.BOW, 38, 23, {
        '0': 700,
        '1': 448,
        '2': 560,
        '3': 360,
        '4': 360,
      }),
    ],
  });
}

function weaponOf(content: ContentSet, id: string): WeaponType {
  const weapon = content.weapons.find((w) => w.id === id);
  if (weapon === undefined) throw new Error(`setup: no ${id}`);
  return weapon;
}

describe('fighter points', () => {
  const content = soldierContent();
  const shortSword = weaponOf(content, 'short_sword');
  const longSword = weaponOf(content, 'long_sword');

  it('scores a man in chain with a long sword above one in a tunic with a short sword', () => {
    const veteran = fighterPoints(content, longSword, ARMOR_MATERIAL.CHAIN, BLOCKING);
    const recruit = fighterPoints(content, shortSword, ARMOR_MATERIAL.WOOL, BLOCKING);
    expect(veteran).toBeGreaterThan(recruit);
  });

  it('ranks each class basic weapon low and its advanced weapon high', () => {
    const bare = (id: string) => fighterPoints(content, weaponOf(content, id), ARMOR_MATERIAL.NONE, 0);
    const basic = ['short_sword', 'wooden_spear', 'short_bow'].map(bare);
    const advanced = ['long_sword', 'iron_spear', 'long_bow'].map(bare);
    expect(Math.max(...basic)).toBeLessThan(Math.min(...advanced));
    expect(new Set(advanced).size).toBe(1);
  });

  it('orders the armours as the owner ranks them: none, leather, tunic, then chain and plate equal', () => {
    const wearing = (material: number) => fighterPoints(content, shortSword, material, BLOCKING);
    expect(fighterPoints(content, shortSword, ARMOR_MATERIAL.NONE, 0)).toBeLessThan(
      wearing(ARMOR_MATERIAL.LEATHER),
    );
    expect(wearing(ARMOR_MATERIAL.LEATHER)).toBeLessThan(wearing(ARMOR_MATERIAL.WOOL));
    expect(wearing(ARMOR_MATERIAL.WOOL)).toBeLessThan(wearing(ARMOR_MATERIAL.CHAIN));
    expect(wearing(ARMOR_MATERIAL.CHAIN)).toBe(wearing(ARMOR_MATERIAL.PLATE));
  });

  it('doubles a man carrying the defence amulet', () => {
    const bare = fighterPoints(content, shortSword, ARMOR_MATERIAL.NONE, 0);
    const shielded = fighterPoints(content, shortSword, ARMOR_MATERIAL.NONE, 0, {
      ...UNBUFFED,
      takenPct: HALF_TAKEN_PCT,
    });
    // Each score floors on its own, so the doubled one may keep the half point the bare one dropped.
    expect(shielded - 2 * bare).toBeGreaterThanOrEqual(0);
    expect(shielded - 2 * bare).toBeLessThanOrEqual(1);
  });
});
