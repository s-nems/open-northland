import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Equipment,
  type EquipmentSlot,
  Health,
  MISC_EQUIP_SLOTS,
  Owner,
  Position,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, Simulation } from '../../../../src/index.js';
import { ownArmyPoints } from '../../../../src/systems/computer-player/military/enemy-strength.js';
import {
  armyWearsArmour,
  isFitSoldier,
  seatDressesArmy,
} from '../../../../src/systems/computer-player/military/fit.js';
import type { SystemContext } from '../../../../src/systems/context.js';
import { grassCellMap } from '../../../fixtures/terrain.js';
import {
  armedContent,
  SEAT,
  SWORD,
  SWORDSMAN,
  seatEconomy,
  ctxOf as supportCtxOf,
  UNARMED,
  VIKING,
} from '../support.js';

/** Which of the seat's fighters count as its army: armed, and dressed while its army has armour to wear. */

const ARMOR_CHAIN = 62;
const HITPOINTS = 100;

function armouredContent(): ContentSet {
  const base = armedContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: ARMOR_CHAIN, id: 'armor_chain', equip: { category: 'armor' } }],
    armor: [{ typeId: 3, id: 'armor_chain', mainType: 2, goodType: ARMOR_CHAIN, materialType: 3 }],
  });
}

function seatSim(content: ContentSet = armouredContent()): Simulation {
  return new Simulation({ seed: 1, content, map: grassCellMap(16, 6) });
}

/** The decision context over the sim's own content. */
function ctxOf(sim: Simulation): SystemContext {
  return { ...supportCtxOf(sim, sim.tick), content: sim.content };
}

/** A seat fighter of `jobType` at visual cell (x, 2), wearing the sword good when armed and chain when
 *  dressed. */
function fighterAt(sim: Simulation, x: number, jobType: number, dressed: boolean): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(2) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: SEAT });
  sim.world.add(e, Health, { hitpoints: HITPOINTS, max: HITPOINTS });
  sim.world.add(e, Equipment, {
    boots: null,
    tool: null,
    weapon: jobType === SWORDSMAN ? { goodType: SWORD, degreeOfUse: fx.fromInt(0) } : null,
    armor: dressed ? { goodType: ARMOR_CHAIN, degreeOfUse: fx.fromInt(0) } : null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
  return e;
}

describe('the fit soldier - the army the computer seat counts and sends', () => {
  it('never counts a bare-handed soldier, and an undressed one only where the army wears no armour', () => {
    const sim = seatSim();
    const ctx = ctxOf(sim);
    const bare = fighterAt(sim, 1, UNARMED, true);
    const undressed = fighterAt(sim, 2, SWORDSMAN, false);
    const dressed = fighterAt(sim, 3, SWORDSMAN, true);

    expect([bare, undressed, dressed].map((e) => isFitSoldier(sim.world, ctx, e, false))).toEqual([
      false,
      true,
      true,
    ]);
    expect([bare, undressed, dressed].map((e) => isFitSoldier(sim.world, ctx, e, true))).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('dresses the army of a seat whose arms side makes armour, on content that has some', () => {
    const sim = seatSim();
    expect(seatDressesArmy(sim.world, ctxOf(sim), SEAT)).toBe(false); // no strategy yet
    seatEconomy(sim, 'rich', ['ironArms']);
    expect(seatDressesArmy(sim.world, ctxOf(sim), SEAT)).toBe(true);

    const plain = seatSim(armedContent());
    seatEconomy(plain, 'rich', ['ironArms']);
    expect(seatDressesArmy(plain.world, ctxOf(plain), SEAT)).toBe(false);
  });

  it('waits for armour only while the seat has some to fetch, and weighs only its fit soldiers', () => {
    const sim = seatSim();
    fighterAt(sim, 1, UNARMED, true);
    fighterAt(sim, 2, SWORDSMAN, false);
    fighterAt(sim, 3, SWORDSMAN, true);
    seatEconomy(sim, 'rich', ['ironArms']);
    // No barracks, so no armour the seat's errands can fetch: the undressed swordsman fights as he is.
    expect(armyWearsArmour(sim.world, ctxOf(sim), SEAT)).toBe(false);
    expect(ownArmyPoints(sim.world, ctxOf(sim), SEAT).men).toBe(2);
  });
});
