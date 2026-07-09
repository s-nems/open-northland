import { describe, expect, it } from 'vitest';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../src/catalog/felling.js';
import { STONE_DEPOSIT_UNITS } from '../src/catalog/mining.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import { GOOD_STONE, GOOD_WOOD, JOB_IDLE, JOB_SOLDIER_SWORD, WEAPON_SWORD } from '../src/game/sandbox/ids.js';
import { resourceCommand } from '../src/game/sandbox/place.js';
import {
  CIVILIAN_PRESETS,
  RESOURCE_ENTRIES,
  WARRIOR_PRESETS,
  unitSpawnCommand,
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

  it('a warrior spawns with its class weapon, chosen owner, HP and armor', () => {
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
    expect(cmd.deposit).toBeDefined();
    expect(cmd.felling).toBeUndefined();
  });

  it('an unknown good is not spawnable (null command)', () => {
    expect(resourceCommand(9999, 0, 0)).toBeNull();
  });
});
