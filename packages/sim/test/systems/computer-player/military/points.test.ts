import { type ContentSet, IR_VERSION, parseContentSet, type WeaponType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { fighterPoints, UNBUFFED } from '../../../../src/systems/computer-player/military/points.js';
import { ARMOR_MATERIAL, WEAPON_MAIN_TYPE } from '../../../../src/systems/readviews/index.js';

const VIKING = 1;
/** The armours' blocking value, as every base armour record carries it. */
const BLOCKING = 5;
/** The defence amulet: half of every blow. */
const HALF_TAKEN_PCT = 50;

/** The viking short and long sword rows of the real `weapons.ini` columns (material 0 bare, 1 wool, 2
 *  leather, 3 chain, 4 plate). */
function swordContent(): ContentSet {
  const sword = (typeId: number, id: string, goodType: number, damage: Record<string, number>) => ({
    typeId,
    id,
    tribeType: VIKING,
    mainType: WEAPON_MAIN_TYPE.SWORD,
    goodType,
    minRange: 1,
    maxRange: 1,
    damage,
  });
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { data: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 41, id: 'short_sword' },
      { typeId: 42, id: 'long_sword' },
    ],
    jobs: [],
    buildings: [],
    weapons: [
      sword(7, 'short_sword', 41, { '0': 1600, '1': 800, '2': 1200, '3': 400, '4': 400 }),
      sword(8, 'long_sword', 42, { '0': 3800, '1': 1900, '2': 2850, '3': 2090, '4': 950 }),
    ],
  });
}

function weaponOf(content: ContentSet, id: string): WeaponType {
  const weapon = content.weapons.find((w) => w.id === id);
  if (weapon === undefined) throw new Error(`setup: no ${id}`);
  return weapon;
}

describe('fighter points', () => {
  const content = swordContent();
  const shortSword = weaponOf(content, 'short_sword');
  const longSword = weaponOf(content, 'long_sword');

  it('scores a man in chain with a long sword above one in a tunic with a short sword', () => {
    const veteran = fighterPoints(content, longSword, ARMOR_MATERIAL.CHAIN, BLOCKING);
    const recruit = fighterPoints(content, shortSword, ARMOR_MATERIAL.WOOL, BLOCKING);
    expect(veteran).toBeGreaterThan(recruit);
  });

  it('orders the armours as the owner ranks them: none, leather, tunic, then chain', () => {
    const wearing = (material: number) => fighterPoints(content, shortSword, material, BLOCKING);
    expect(fighterPoints(content, shortSword, ARMOR_MATERIAL.NONE, 0)).toBeLessThan(
      wearing(ARMOR_MATERIAL.LEATHER),
    );
    expect(wearing(ARMOR_MATERIAL.LEATHER)).toBeLessThan(wearing(ARMOR_MATERIAL.WOOL));
    expect(wearing(ARMOR_MATERIAL.WOOL)).toBeLessThan(wearing(ARMOR_MATERIAL.CHAIN));
  });

  it('doubles a man carrying the defence amulet', () => {
    const bare = fighterPoints(content, shortSword, ARMOR_MATERIAL.NONE, 0);
    const shielded = fighterPoints(content, shortSword, ARMOR_MATERIAL.NONE, 0, {
      ...UNBUFFED,
      takenPct: HALF_TAKEN_PCT,
    });
    expect(shielded).toBe(2 * bare);
  });
});
