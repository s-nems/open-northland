import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Equipment,
  type EquipmentSlot,
  Health,
  MISC_EQUIP_SLOTS,
  Owner,
  Position,
  Stockpile,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { fx, Simulation } from '../../../../src/index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import { ownArmyPoints } from '../../../../src/systems/computer-player/military/enemy-strength.js';
import {
  armourWaiters,
  isFitSoldier,
  NO_ARMOUR_WAIT,
  seatDressesArmy,
} from '../../../../src/systems/computer-player/military/fit.js';
import type { SystemContext } from '../../../../src/systems/context.js';
import { grassCellMap, grassNodeMap } from '../../../fixtures/terrain.js';
import {
  armedContent,
  BARRACKS_TYPE,
  SEAT,
  STOCK_TYPE,
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

function seatSim(content: ContentSet = armouredContent(), map = grassCellMap(16, 6)): Simulation {
  return new Simulation({ seed: 1, content, map });
}

/** A map with room for a barracks and a store beside the men, and where they stand. */
const STORE_MAP = { width: 64, height: 32 };
const BARRACKS_AT = { x: 30, y: 16 };
const STORE_AT = { x: 46, y: 16 };
/** Armed men without armour, more than the one piece in store dresses. */
const UNDRESSED = 10;

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
  it('never counts a bare-handed soldier, nor an undressed one waiting for armour', () => {
    const sim = seatSim();
    const ctx = ctxOf(sim);
    const bare = fighterAt(sim, 1, UNARMED, true);
    const undressed = fighterAt(sim, 2, SWORDSMAN, false);
    const dressed = fighterAt(sim, 3, SWORDSMAN, true);

    const men = [bare, undressed, dressed];
    expect(men.map((e) => isFitSoldier(sim.world, ctx, e, NO_ARMOUR_WAIT))).toEqual([false, true, true]);
    const waiting = new Set([undressed]);
    expect(men.map((e) => isFitSoldier(sim.world, ctx, e, waiting))).toEqual([false, false, true]);
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
    expect(armourWaiters(sim.world, ctxOf(sim), SEAT)).toEqual(new Set());
    expect(ownArmyPoints(sim.world, ctxOf(sim), SEAT).men).toBe(2);
  });

  it('holds back only as many undressed men as the armour its errands can fetch dresses', () => {
    const sim = armouredSeat();
    for (let i = 0; i < UNDRESSED; i++) fighterAt(sim, 1 + i, SWORDSMAN, false);
    expect(ownArmyPoints(sim.world, ctxOf(sim), SEAT).men).toBe(UNDRESSED);
    stockArmour(sim, 1);
    expect(armourWaiters(sim.world, ctxOf(sim), SEAT).size).toBe(1);
    expect(ownArmyPoints(sim.world, ctxOf(sim), SEAT).men).toBe(UNDRESSED - 1);
  });

  it('holds back an undressed man at home for the armour, not one away whom no errand reaches', () => {
    const sim = armouredSeat();
    // The lowest id rides aboard, away from the stores.
    const away = fighterAt(sim, 1, SWORDSMAN, false);
    sim.world.remove(away, Position);
    const home = fighterAt(sim, 2, SWORDSMAN, false);
    stockArmour(sim, 1);
    expect([...armourWaiters(sim.world, ctxOf(sim), SEAT)]).toEqual([home]);
  });
});

/** A dressing seat with a barracks and a store its errands reach, and no men yet. */
function armouredSeat(): Simulation {
  const sim = seatSim(armouredContent(), grassNodeMap(STORE_MAP.width, STORE_MAP.height));
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  for (const [buildingType, at] of [
    [BARRACKS_TYPE, BARRACKS_AT],
    [STOCK_TYPE, STORE_AT],
  ] as const) {
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType, ...at, tribe: VIKING, owner: SEAT });
  }
  sim.step();
  seatEconomy(sim, 'rich', ['ironArms']);
  return sim;
}

/** Put `pieces` of chain into the seat's store. */
function stockArmour(sim: Simulation, pieces: number): void {
  const store = ownedBuildings(sim.world, SEAT).find(
    (e) => sim.world.get(e, Building).buildingType === STOCK_TYPE,
  );
  if (store === undefined) throw new Error('setup: no store');
  sim.world.mut(store, Stockpile).amounts.set(ARMOR_CHAIN, pieces);
}
