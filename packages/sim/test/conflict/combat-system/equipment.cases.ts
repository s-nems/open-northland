import { describe, expect, it } from 'vitest';
import { Armor, CurrentAtomic, Weapon } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { combatSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import { BEAR, ctxOf, FRANK, fighterAt, grassMap, VIKING, WOODCUTTER } from './support.js';

describe('combatSystem — armor material column (the target armor material join)', () => {
  // The fixture's test_axe lists `damage { "0": 50, "1": 60 }`; leather (armor class 1, material 1).
  // Armor selects the damage COLUMN (no blockingValue subtracted): a viking woodcutter hits an
  // UNARMORED target for 50 (material 0) and a leather-clad one for 60 (material 1); a column the
  // weapon lists no value for resolves to 0.

  it('an unarmored target (no Armor) takes the material-0 damage (unchanged behavior)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const enemy = fighterAt(sim, 1, 0, FRANK, WOODCUTTER); // no Armor -> material 0

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(attacker, CurrentAtomic).effect).toEqual({
      kind: 'attack',
      target: enemy,
      damage: 50, // test_axe damage["0"]
      maxRange: 2, // the melee reach, carried for the hit-frame re-check
    });
  });

  it('an armored target takes the per-material damage column (no blockingValue subtracted)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const enemy = fighterAt(sim, 1, 0, FRANK, WOODCUTTER);
    sim.world.add(enemy, Armor, { armorClass: 1 }); // leather: selects damage["1"] = 60 (material 1)

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(attacker, CurrentAtomic).effect).toEqual({
      kind: 'attack',
      target: enemy,
      damage: 60, // test_axe damage["1"] — the material-1 column, NOT 60 − 5 (armor selects, doesn't mitigate)
      maxRange: 2, // the melee reach, carried for the hit-frame re-check
    });
  });

  it('a target wearing an out-of-table armor class selects that class’s column (no record → the class is its own material)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    const enemy = fighterAt(sim, 1, 0, FRANK, WOODCUTTER);
    sim.world.add(enemy, Armor, { armorClass: 2 }); // no armor record → the class value (2) is its own column

    combatSystem(sim.world, ctxOf(sim));

    // test_axe lists no `damage["2"]`, so the column is 0 — the swing connects but does this material no
    // harm (a class with no `[armortype]` record selects its own column rather than crashing).
    expect(sim.world.get(attacker, CurrentAtomic).effect).toEqual({
      kind: 'attack',
      target: enemy,
      damage: 0,
      maxRange: 2, // test_axe reach, carried for the hit-frame re-check
    });
  });

  it('a weapon that lists no column for the target material does 0 damage (no harm), never negative', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    // The bear's test_bearfist lists only `damage["0"]` 40. A leather-clad (material 1) target selects
    // the material-1 column, which bearfist doesn't list → 0 damage (no subtraction, never negative).
    const bear = fighterAt(sim, 0, 0, BEAR, WOODCUTTER);
    const viking = fighterAt(sim, 1, 0, VIKING, WOODCUTTER);
    sim.world.add(viking, Armor, { armorClass: 1 });

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(bear, CurrentAtomic).effect).toEqual({
      kind: 'attack',
      target: viking,
      damage: 0, // bearfist has no damage["1"] column
      maxRange: 2, // test_bearfist reach, carried for the hit-frame re-check
    });
  });
});

describe('combatSystem — worn-weapon override (the equip seed)', () => {
  // A viking woodcutter's DEFAULT weapon is test_axe (tribe 1, job 1; damage["0"] 50, maxRange 2). A worn
  // `Weapon{weaponTypeId}` overrides that with a specific weapon resolved vs the viking tribe: test_spear
  // (typeId 11, tribe 1; damage["0"] 70, minRange 3, maxRange 17 — a ranged reach).

  it('a combatant with NO Weapon fights with its class default (unchanged behavior)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER); // no Weapon -> test_axe by (tribe,job)
    const enemy = fighterAt(sim, 1, 0, FRANK, WOODCUTTER);

    combatSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(attacker, CurrentAtomic).effect).toEqual({
      kind: 'attack',
      target: enemy,
      damage: 50, // test_axe damage["0"]
      maxRange: 2, // the melee reach, carried for the hit-frame re-check
    });
  });

  it('a worn Weapon overrides the default class weapon (damage + reach come from the worn one)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    sim.world.add(attacker, Weapon, { weaponTypeId: 11 }); // test_spear (tribe 1): damage 70, minRange 3
    const enemy = fighterAt(sim, 4, 0, FRANK, WOODCUTTER); // 8 nodes: in the spear's 3..17 band, beyond axe's 2

    combatSystem(sim.world, ctxOf(sim));

    // The default axe (maxRange 2) could not reach 4 cells; the worn spear (maxRange 17) does, for 70.
    expect(sim.world.get(attacker, CurrentAtomic).effect).toEqual({
      kind: 'attack',
      target: enemy,
      damage: 70, // test_spear damage["0"]
      maxRange: 17, // test_spear's long melee reach, carried for the hit-frame re-check
    });
  });

  it('a worn weapon respects its near reach — a spear-wielder can’t strike an adjacent target', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    sim.world.add(attacker, Weapon, { weaponTypeId: 11 }); // test_spear: minRange 3
    fighterAt(sim, 1, 0, FRANK, WOODCUTTER); // adjacent — below the spear's near reach (3)

    combatSystem(sim.world, ctxOf(sim));

    // The worn spear's minRange band is honored even though the default axe could have hit at range 1.
    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false);
  });

  it('a worn weapon id with no matching record leaves the combatant unarmed (no silent fallback)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, WOODCUTTER);
    sim.world.add(attacker, Weapon, { weaponTypeId: 999 }); // no (tribe 1, typeId 999) record
    fighterAt(sim, 1, 0, FRANK, WOODCUTTER); // adjacent — the default axe WOULD have hit

    combatSystem(sim.world, ctxOf(sim));

    // The bad worn id does NOT fall back to the class default; the combatant simply can't attack.
    expect(sim.world.has(attacker, CurrentAtomic)).toBe(false);
  });
});
