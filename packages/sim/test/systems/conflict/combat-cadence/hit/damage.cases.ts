import type { ContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Anger, CurrentAtomic } from '../../../../../src/components/index.js';
import { Simulation } from '../../../../../src/index.js';
import { combatSystem, WILDLIFE_DAMAGE_COLUMN } from '../../../../../src/systems/index.js';
import {
  CHAIN_CLASS,
  combatCadenceContent,
  ctxOf,
  fighterAt,
  grass,
  OTHER,
  PLATE_CLASS,
  SOLDIER_SPEAR,
  SOLDIER_SWORD_LONG,
  VIKING,
  WOLF_TRIBE,
} from '../support.js';

/** An animal column the spear lists apart from its leather one, and that leather column. */
const ANIMAL_DAMAGE = 1234;
const IRON_SPEAR_LEATHER_DAMAGE = 2850;
const PROVOKED_TICKS = 100;

describe('combat damage - armor material column (the AP asymmetry)', () => {
  // A plate-armored (material 4) target takes 2090 from an iron spear and 950 from a long sword - the
  // anti-armor asymmetry from the real weapontypes: the spear is anti-plate, the sword anti-chain.
  const cases = [
    { job: SOLDIER_SPEAR, armor: PLATE_CLASS, expected: 2090, desc: 'iron spear vs plate' },
    { job: SOLDIER_SPEAR, armor: CHAIN_CLASS, expected: 950, desc: 'iron spear vs chain' },
    { job: SOLDIER_SWORD_LONG, armor: PLATE_CLASS, expected: 950, desc: 'long sword vs plate' },
    { job: SOLDIER_SWORD_LONG, armor: CHAIN_CLASS, expected: 2090, desc: 'long sword vs chain' },
  ];
  for (const { job, armor, expected, desc } of cases) {
    it(`${desc} → ${expected} damage (the material column is the swing's base)`, () => {
      const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
      const attacker = fighterAt(sim, 0, 0, VIKING, job);
      fighterAt(sim, 1, 0, OTHER, null, { armorClass: armor }); // an armored enemy, 2 nodes away (in band [1,2])

      combatSystem(sim.world, ctxOf(sim));

      expect(sim.world.get(attacker, CurrentAtomic).effect).toMatchObject({
        kind: 'attack',
        damage: expected,
      });
    });
  }

  it('an unarmored enemy takes the material-0 column (3800 for the iron spear)', () => {
    const sim = new Simulation({ seed: 1, content: combatCadenceContent(), map: grass(3, 1) });
    const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
    fighterAt(sim, 1, 0, OTHER, null); // no Armor -> material 0
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(attacker, CurrentAtomic).effect).toMatchObject({ damage: 3800 });
  });

  it("a wild animal takes the weapon's animal column, its leather one where the weapon has none", () => {
    const base = combatCadenceContent();
    const withAnimalColumn: ContentSet = {
      ...base,
      weapons: base.weapons.map((w) => ({
        ...w,
        damage: { ...w.damage, [String(WILDLIFE_DAMAGE_COLUMN)]: ANIMAL_DAMAGE },
      })),
    };
    for (const [content, expected] of [
      [withAnimalColumn, ANIMAL_DAMAGE],
      [base, IRON_SPEAR_LEATHER_DAMAGE],
    ] as const) {
      const sim = new Simulation({ seed: 1, content, map: grass(3, 1) });
      const attacker = fighterAt(sim, 0, 0, VIKING, SOLDIER_SPEAR);
      const wolf = fighterAt(sim, 1, 0, WOLF_TRIBE, null);
      sim.world.add(wolf, Anger, { until: sim.tick + PROVOKED_TICKS }); // provoked, so a fair target
      combatSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(attacker, CurrentAtomic).effect).toMatchObject({
        kind: 'attack',
        damage: expected,
      });
    }
  });
});
