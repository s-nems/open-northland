import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  Health,
  MissionObjectId,
  Position,
  Stockpile,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, type Simulation } from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import type { MissionResultOp } from '../../src/systems/missions/index.js';
import { missionObjects } from '../../src/systems/missions/index.js';
import { firingSim, HUT, HUT_LARGE, houseContent, LOAD_PASS, POINT, VIKING } from './support.js';

const ID = 5;
const WOOD = 1;
/** A fixture wonder: one typeId whose `[GfxHouse]` record draws three levels, with a wood shelf. */
const WONDER = 40;
const WONDER_TOP = 2;

function setHouse(typeId: number, built = true): MissionResultOp {
  return {
    opcode: 'SetHouse',
    player: 1,
    houseName: { typeId, tribe: VIKING },
    level: 0,
    built,
    point: POINT,
    objectId: ID,
  };
}

function extend(level: number): MissionResultOp {
  return { opcode: 'SetHouseExtensionLevel', objectId: ID, amount: level };
}

function wonderContent(): ContentSet {
  const base = houseContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: WONDER,
        id: 'wonder',
        kind: 'wonder',
        hitpoints: 1000,
        stock: [{ goodType: WOOD, capacity: 10 }],
      },
    ],
    buildingBobs: [
      ...base.buildingBobs,
      ...[0, 1, WONDER_TOP].map((level) => ({
        tribeId: VIKING,
        typeId: WONDER,
        level,
        bmd: 'wonders',
        paletteName: 'wonders',
        bobId: level,
      })),
    ],
  });
}

function house(sim: Simulation): Entity {
  const [e, ...rest] = missionObjects(sim.world, ID);
  if (e === undefined || rest.length > 0) throw new Error('expected one house');
  return e;
}

function failures(sim: Simulation): unknown[] {
  return sim.events.current().filter((e) => e.kind === 'missionResultFailed');
}

describe('SetHouseExtensionLevel', () => {
  it('sets the house again at the next type of its chain, finished, on the same anchor', () => {
    const before = firingSim([setHouse(HUT)], houseContent());
    before.run(LOAD_PASS);
    const sim = firingSim([setHouse(HUT), extend(1)], houseContent());
    sim.run(LOAD_PASS);
    const e = house(sim);
    expect(e).not.toBe(house(before));
    expect(sim.world.get(e, Building)).toMatchObject({ buildingType: HUT_LARGE, level: 1, built: ONE });
    expect(sim.world.get(e, Health)).toEqual({ hitpoints: 300, max: 300 });
    expect(sim.world.get(e, MissionObjectId).id).toBe(ID);
    const at = sim.world.get(e, Position);
    const was = before.world.get(house(before), Position);
    expect(nodeOfPosition(at.x, at.y)).toEqual(nodeOfPosition(was.x, was.y));
    // A fresh house, not an upgrade: nothing announces one.
    expect(sim.events.current().filter((ev) => ev.kind === 'buildingUpgraded')).toEqual([]);
  });

  it('drops the old house stock', () => {
    const goods: MissionResultOp = { opcode: 'AddGoodsToHouses', objectId: ID, good: WOOD, amount: 3 };
    const stocked = firingSim([setHouse(WONDER), goods], wonderContent());
    stocked.run(LOAD_PASS);
    expect(stocked.world.get(house(stocked), Stockpile).amounts.get(WOOD)).toBe(3);
    const sim = firingSim([setHouse(WONDER), goods, extend(1)], wonderContent());
    sim.run(LOAD_PASS);
    expect(sim.world.get(house(sim), Stockpile).amounts.get(WOOD)).toBeUndefined();
  });

  it('finishes a construction site', () => {
    const sim = firingSim([setHouse(HUT, false), extend(0)], houseContent());
    sim.run(LOAD_PASS);
    const e = house(sim);
    expect(sim.world.has(e, UnderConstruction)).toBe(false);
    expect(sim.world.get(e, Building)).toMatchObject({ buildingType: HUT, level: 0, built: ONE });
  });

  it('walks back down the chain', () => {
    const sim = firingSim([setHouse(HUT), extend(1), extend(0)], houseContent());
    sim.run(LOAD_PASS);
    expect(sim.world.get(house(sim), Building)).toMatchObject({ buildingType: HUT, level: 0 });
  });

  it('keeps a wonder on its one type and moves it to the level its record draws', () => {
    const sim = firingSim([setHouse(WONDER), extend(1), extend(WONDER_TOP)], wonderContent());
    sim.run(LOAD_PASS);
    expect(sim.world.get(house(sim), Building)).toMatchObject({ buildingType: WONDER, level: WONDER_TOP });
    expect(failures(sim)).toEqual([]);
  });

  it('fails a level the type does not reach and leaves the house standing', () => {
    const sim = firingSim([setHouse(WONDER), extend(WONDER_TOP + 1)], wonderContent());
    sim.run(LOAD_PASS);
    expect(sim.world.get(house(sim), Building)).toMatchObject({ buildingType: WONDER, level: 0 });
    expect(failures(sim)).toEqual([
      { kind: 'missionResultFailed', mission: 0, opcode: 'SetHouseExtensionLevel' },
    ]);
  });
});
