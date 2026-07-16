import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../src/catalog/felling.js';
import {
  CLAY_MINE_STRIKES_PER_UNIT,
  HARD_MINE_STRIKES_PER_UNIT,
  STONE_DEPOSIT_UNITS,
} from '../src/catalog/mining.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import {
  GOOD_BOW_LONG,
  GOOD_BOW_SHORT,
  GOOD_MUD,
  GOOD_SPEAR_IRON,
  GOOD_STONE,
  GOOD_SWORD_LONG,
  GOOD_SWORD_SHORT,
  GOOD_WOOD,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_COLLECTOR,
  JOB_IDLE,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  WEAPON_FISTS,
  WEAPON_SWORD,
  weaponEquipmentFor,
} from '../src/game/sandbox/ids/index.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { resourceCommand } from '../src/game/sandbox/place.js';
import {
  ADMIN_DROP_AMOUNT,
  CIVILIAN_PRESETS,
  goodDropCommand,
  RESOURCE_ENTRIES,
  unitSpawnCommand,
  WARRIOR_PRESETS,
} from '../src/view/admin-debug/spawn-catalog.js';

/**
 * The admin/debug spawn palette's PURE command mapping — the data half of the panel (a click → a sim
 * command), verifiable without the DOM. The panel's window-capture wiring (a map click enqueues this)
 * is browser-verified; here we pin that a warrior carries its weapon, a civilian does not, the optional
 * HP/armor stamps are omitted when non-positive, and a resource resolves to the right node lifecycle.
 */

describe('admin spawn command mapping', () => {
  const sword = WARRIOR_PRESETS.find((p) => p.id === 'sword');
  const civilian = CIVILIAN_PRESETS.find((p) => p.id === 'civilian');

  it('a warrior spawns with its class weapon (combat + equipment slot), chosen owner, HP and armor', () => {
    if (sword === undefined) throw new Error('missing sword preset');
    const cmd = unitSpawnCommand(sword, { player: 1, hitpoints: 250, armorClass: 2, x: 7, y: 9 });
    expect(cmd).toEqual({
      kind: 'spawnSettler',
      jobType: JOB_SOLDIER_SWORD,
      x: 7,
      y: 9,
      tribe: PRIMARY_TRIBE,
      owner: 1,
      hitpoints: 250,
      weaponTypeId: WEAPON_SWORD,
      armorClass: 2,
      // The weapon good in the equipment slot drives the drawn look + the panel's Broń row.
      equipment: { weapon: { goodType: GOOD_SWORD_SHORT } },
    });
  });

  it('the bare-handed warrior spawns as job soldier_unarmed wielding fists', () => {
    const unarmed = WARRIOR_PRESETS.find((p) => p.id === 'unarmed');
    if (unarmed === undefined) throw new Error('missing unarmed preset');
    const cmd = unitSpawnCommand(unarmed, { player: 0, hitpoints: 300, armorClass: 0, x: 4, y: 6 });
    expect(cmd).toEqual({
      kind: 'spawnSettler',
      jobType: JOB_SOLDIER_UNARMED,
      x: 4,
      y: 6,
      tribe: PRIMARY_TRIBE,
      owner: 0,
      hitpoints: 300,
      weaponTypeId: WEAPON_FISTS,
    });
  });

  it('a civilian carries no weapon, and non-positive HP/armor are omitted (non-combatant)', () => {
    if (civilian === undefined) throw new Error('missing civilian preset');
    const cmd = unitSpawnCommand(civilian, { player: HUMAN_PLAYER, hitpoints: 0, armorClass: 0, x: 2, y: 3 });
    expect(cmd).toEqual({
      kind: 'spawnSettler',
      jobType: JOB_IDLE,
      x: 2,
      y: 3,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
    });
    expect('weaponTypeId' in cmd).toBe(false);
    expect('hitpoints' in cmd).toBe(false);
    expect('armorClass' in cmd).toBe(false);
  });

  it('the palette offers every gatherable resource', () => {
    const goods = new Set(RESOURCE_ENTRIES.map((r) => r.good));
    expect(goods.has(GOOD_WOOD)).toBe(true);
    expect(goods.has(GOOD_STONE)).toBe(true);
    expect(RESOURCE_ENTRIES.length).toBeGreaterThanOrEqual(6);
  });

  it('the goods palette is the running content — every good it defines is droppable (bare-checkout sandbox)', () => {
    // The panel builds its goods list from `sim.content.goods`, so it can only offer goods the sim will
    // actually drop (a good absent from the content is a `dropGood` no-op). Assert the source it reads on a
    // bare checkout — the sandbox content — spans the whole catalog, so nothing silently drops out.
    const goods = sandboxContent(grassTerrain(4, 4)).goods;
    const ids = new Set(goods.map((g) => g.id));
    expect(ids.has('wood')).toBe(true);
    expect(ids.has('bread')).toBe(true);
    expect(ids.has('armor_plate')).toBe(true);
    expect(goods.length).toBeGreaterThanOrEqual(60);
  });

  it('a good drops as a loose ground pile via dropGood', () => {
    const cmd = goodDropCommand(GOOD_STONE, 4, 5);
    expect(cmd).toEqual({ kind: 'dropGood', good: GOOD_STONE, x: 4, y: 5, amount: ADMIN_DROP_AMOUNT });
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
      felling: { chopsLeft: WOOD_CHOPS_TO_FELL },
    });
  });

  it('a stone resource resolves to a mined deposit node', () => {
    const cmd = resourceCommand(GOOD_STONE, 1, 1);
    expect(cmd?.kind).toBe('placeResource');
    if (cmd?.kind !== 'placeResource') throw new Error('expected placeResource');
    expect(cmd.remaining).toBe(STONE_DEPOSIT_UNITS);
    expect(cmd.deposit?.strikesPerUnit).toBe(HARD_MINE_STRIKES_PER_UNIT);
    expect(cmd.felling).toBeUndefined();
  });

  it('a clay resource uses an extra dig cycle for its shorter animation', () => {
    const cmd = resourceCommand(GOOD_MUD, 1, 1);
    expect(cmd?.kind).toBe('placeResource');
    if (cmd?.kind !== 'placeResource') throw new Error('expected placeResource');
    expect(cmd.deposit?.strikesPerUnit).toBe(CLAY_MINE_STRIKES_PER_UNIT);
  });

  it('an unknown good is not spawnable (null command)', () => {
    expect(resourceCommand(9999, 0, 0)).toBeNull();
  });
});

describe('weaponEquipmentFor — the one job→equipment-weapon map every spawn path shares', () => {
  it('each soldier class carries its matching weapon good (so its Broń row + drawn weapon match)', () => {
    // The seam the scene placer, the imported-map spawn AND the admin palette all derive from, so a
    // pre-placed warrior fills the same equipment weapon slot a freshly-spawned one does.
    expect(weaponEquipmentFor(JOB_SOLDIER_SPEAR)).toEqual({ weapon: { goodType: GOOD_SPEAR_IRON } });
    expect(weaponEquipmentFor(JOB_SOLDIER_SWORD)).toEqual({ weapon: { goodType: GOOD_SWORD_SHORT } });
    expect(weaponEquipmentFor(JOB_SOLDIER_BROADSWORD)).toEqual({ weapon: { goodType: GOOD_SWORD_LONG } });
    expect(weaponEquipmentFor(JOB_ARCHER)).toEqual({ weapon: { goodType: GOOD_BOW_SHORT } });
    expect(weaponEquipmentFor(JOB_ARCHER_LONG)).toEqual({ weapon: { goodType: GOOD_BOW_LONG } });
  });

  it('the bare-handed warrior and a civilian get no equipment weapon (empty slot → their own body)', () => {
    expect(weaponEquipmentFor(JOB_SOLDIER_UNARMED)).toBeUndefined();
    expect(weaponEquipmentFor(JOB_COLLECTOR)).toBeUndefined();
    expect(weaponEquipmentFor(JOB_IDLE)).toBeUndefined();
  });
});
