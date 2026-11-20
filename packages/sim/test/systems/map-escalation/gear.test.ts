import { type ContentSet, type MapModulesInput, type MapNotice, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Equipment, Settler, Stance, Weapon } from '../../../src/components/index.js';
import { TICKS_PER_SECOND } from '../../../src/core/loop.js';
import type { Entity } from '../../../src/ecs/world.js';
import type { Simulation } from '../../../src/index.js';
import { damageTakenBy } from '../../../src/systems/equipment/index.js';
import { WEAPON_MAIN_TYPE } from '../../../src/systems/readviews/index.js';
import { ctxOf } from '../../fixtures/context.js';
import {
  AMULET_NOTICE,
  AMULET_SECONDS,
  BOWMAN,
  DEFENSE_AMULET,
  FORTRESS,
  GEARED,
  gearContent,
  keepWorld,
  LEATHER,
  LIGHT_ARMOR_NOTICE,
  LIGHT_ARMOR_SECONDS,
  ownedFighters,
  RAIDER,
  REFILL_EVERY_SECONDS,
  runToSecond,
  SHOES,
  SIEGE,
  SPEARMAN,
  VIKING,
  WOOL,
} from '../../fixtures/map-escalation/keep.js';

const IRON_SPEARMAN = 33;
const WOODEN_SPEAR = 70;
const IRON_SPEAR = 71;
const IRON_SPEAR_WEAPON = 9;
const STRENGTH_AMULET = 72;
const HEAL_DRAUGHT = 73;

/** {@link gearContent} with the two spears as weapon goods that arm their classes, a second amulet and a
 *  healing draught. */
function weaponContent(): ContentSet {
  const base = gearContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: WOODEN_SPEAR, id: 'spear_wooden', weight: 0, equip: { category: 'weapon' } },
      { typeId: IRON_SPEAR, id: 'spear_iron', weight: 0, equip: { category: 'weapon' } },
      { typeId: STRENGTH_AMULET, id: 'amulet_strength', weight: 0, equip: { category: 'misc' } },
      { typeId: HEAL_DRAUGHT, id: 'potion_heal_big', weight: 0, equip: { category: 'misc' } },
    ],
    jobs: [...base.jobs, { typeId: IRON_SPEARMAN, id: 'soldier_spear_iron' }],
    weapons: [
      ...base.weapons.map((row) => (row.jobType === SPEARMAN ? { ...row, goodType: WOODEN_SPEAR } : row)),
      {
        typeId: IRON_SPEAR_WEAPON,
        id: 'viking_spear_iron',
        tribeType: VIKING,
        jobType: IRON_SPEARMAN,
        goodType: IRON_SPEAR,
        mainType: WEAPON_MAIN_TYPE.SPEAR,
        minRange: 1,
        maxRange: 2,
      },
    ],
  });
}

function gearOf(sim: Simulation, e: Entity) {
  const eq = sim.world.tryGet(e, Equipment);
  return {
    armor: eq?.armor?.goodType ?? null,
    boots: eq?.boots?.goodType ?? null,
    misc: (eq?.misc ?? []).flatMap((slot) => (slot === null ? [] : [slot.goodType])),
  };
}

function gearSteps(sim: Simulation, seconds: number): { step: number; notice?: MapNotice }[] {
  const seen: { step: number; notice?: MapNotice }[] = [];
  while (sim.tick < seconds * TICKS_PER_SECOND) {
    sim.step();
    for (const ev of sim.events.current())
      if (ev.kind === 'mapEscalationGearStep')
        seen.push({ step: ev.step, ...(ev.notice === undefined ? {} : { notice: ev.notice }) });
  }
  return seen;
}

describe('map escalation - gear', () => {
  it('gears every soldier of the gear seats at each step, and each one they gain later with every step passed', () => {
    const { sim, garrison } = keepWorld(GEARED, gearContent());
    expect(gearSteps(sim, LIGHT_ARMOR_SECONDS + 1)).toEqual([{ step: 1, notice: LIGHT_ARMOR_NOTICE }]);
    const band = ownedFighters(sim, RAIDER);
    expect(band.length).toBeGreaterThan(0);
    for (const e of [...garrison, ...band]) {
      expect(gearOf(sim, e)).toMatchObject({ boots: SHOES, misc: [] });
      expect([WOOL, LEATHER]).toContain(gearOf(sim, e).armor);
    }

    expect(gearSteps(sim, AMULET_SECONDS + 1)).toEqual([{ step: 2, notice: AMULET_NOTICE }]);
    for (const e of garrison) expect(gearOf(sim, e).misc).toEqual([DEFENSE_AMULET]);
    // The cap grew at 30 s, so the next refill beat brings a newcomer.
    runToSecond(sim, AMULET_SECONDS + REFILL_EVERY_SECONDS + 1);
    const newcomers = ownedFighters(sim, FORTRESS).filter((e) => !garrison.includes(e));
    expect(newcomers.length).toBeGreaterThan(0);
    for (const e of newcomers) {
      expect(gearOf(sim, e)).toMatchObject({ boots: SHOES, misc: [DEFENSE_AMULET] });
      expect(damageTakenBy(sim.world, ctxOf(sim), e, 10)).toBe(5);
    }
  });

  it('swaps a soldier’s weapon for the better one of its class, trade and combat weapon with it, keeping his stance', () => {
    const config: MapModulesInput = {
      siege: SIEGE,
      gearSchedule: {
        version: 1,
        seats: [FORTRESS],
        steps: [
          { atSeconds: LIGHT_ARMOR_SECONDS, weaponUpgrades: [{ from: 'spear_wooden', to: 'spear_iron' }] },
        ],
      },
    };
    const { sim, garrison } = keepWorld(config, weaponContent());
    const stances = garrison.map((e) => sim.world.get(e, Stance).mode);
    expect(garrison.map((e) => sim.world.get(e, Equipment).weapon?.goodType)).toEqual(
      garrison.map(() => WOODEN_SPEAR),
    );
    runToSecond(sim, LIGHT_ARMOR_SECONDS + 1);
    for (const [i, e] of garrison.entries()) {
      expect(sim.world.get(e, Settler).jobType).toBe(IRON_SPEARMAN);
      expect(sim.world.get(e, Equipment).weapon?.goodType).toBe(IRON_SPEAR);
      expect(sim.world.get(e, Weapon).weaponTypeId).toBe(IRON_SPEAR_WEAPON);
      expect(sim.world.get(e, Stance).mode).toBe(stances[i]);
    }
    // The next refill beat brings a spearman of the mix, who takes up the iron spear too; a bowman keeps
    // his bow.
    runToSecond(sim, LIGHT_ARMOR_SECONDS + 2 * REFILL_EVERY_SECONDS + 1);
    const newcomers = ownedFighters(sim, FORTRESS).filter((e) => !garrison.includes(e));
    expect(newcomers.length).toBeGreaterThan(0);
    for (const e of newcomers) expect([IRON_SPEARMAN, BOWMAN]).toContain(sim.world.get(e, Settler).jobType);
    expect(newcomers.some((e) => sim.world.get(e, Settler).jobType === IRON_SPEARMAN)).toBe(true);
  });

  it('gives a second, different amulet on the extra chance beside a sure draught', () => {
    const config: MapModulesInput = {
      siege: SIEGE,
      gearSchedule: {
        version: 1,
        seats: [FORTRESS],
        steps: [
          {
            atSeconds: AMULET_SECONDS,
            notice: AMULET_NOTICE,
            grants: [
              { goods: ['amulet_defense', 'amulet_strength'], extraChancePct: 100 },
              { goods: ['potion_heal_big'] },
            ],
          },
        ],
      },
    };
    const { sim, garrison } = keepWorld(config, weaponContent());
    runToSecond(sim, AMULET_SECONDS + 1);
    for (const e of garrison)
      expect([...gearOf(sim, e).misc].sort((a, b) => a - b)).toEqual([
        DEFENSE_AMULET,
        STRENGTH_AMULET,
        HEAL_DRAUGHT,
      ]);
  });
});
