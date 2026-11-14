import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, HomeQuality, Lodgings, Owner } from '../../src/components/index.js';
import { fx, homeFamilyCapacityView, ONE, Simulation } from '../../src/index.js';
import { homeFamilyCapacity, setHouseholdGoodUse } from '../../src/systems/family/home-quality.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

const PLAYER = 0;
const TRIBE = 1;
const HOME = 1;
const FURNITURE = 1;
const BASE_FAMILIES = 1;
const FURNISHED_FAMILIES = 2;
const PIECE = 1000;
/** The level the fixture's furniture serves from, above the first. */
const FURNITURE_LEVEL = 1;

function content() {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      {
        typeId: FURNITURE,
        id: 'furniture',
        homeQuality: {
          effect: 'lodging',
          deliveryValue: PIECE,
          minimumHomeLevel: FURNITURE_LEVEL,
          wear: { child: 100, sleep: 10, meal: 10 },
        },
      },
    ],
    jobs: [],
    buildings: [
      {
        typeId: HOME,
        id: 'home',
        kind: 'home',
        homeSize: BASE_FAMILIES,
        furnishedFamilies: FURNISHED_FAMILIES,
      },
    ],
  });
}

describe('homeFamilyCapacityView', () => {
  it('reads a home off a snapshot as the sim counts its families', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const type = sim.content.buildings.find((b) => b.typeId === HOME);
    if (type === undefined) throw new Error('fixture home type missing');
    const home = sim.world.create();
    sim.world.add(home, Building, { buildingType: HOME, tribe: TRIBE, built: ONE, level: FURNITURE_LEVEL });
    sim.world.add(home, Owner, { player: PLAYER });
    sim.world.add(home, HomeQuality, { cooking: 0, lodging: 0, piety: 0 });
    const both = (): readonly number[] => [
      homeFamilyCapacity(sim.world, ctxOf(sim), home, type),
      homeFamilyCapacityView(sim.snapshot(), home, type, sim.content.goods),
    ];
    const base = [BASE_FAMILIES, BASE_FAMILIES];
    const furnished = [BASE_FAMILIES + FURNISHED_FAMILIES, BASE_FAMILIES + FURNISHED_FAMILIES];

    expect(both()).toEqual(base);
    sim.world.mut(home, HomeQuality).lodging = PIECE;
    expect(both()).toEqual([BASE_FAMILIES + 1, BASE_FAMILIES + 1]);
    // A piece a family lives on counts beside the whole spare one, a broken spare does not.
    sim.world.add(home, Lodgings, { pieces: [1] });
    sim.world.mut(home, HomeQuality).lodging = 2 * PIECE - 1;
    expect(both()).toEqual(furnished);
    sim.world.mut(home, Building).level = FURNITURE_LEVEL - 1;
    expect(both()).toEqual(base);
    sim.world.mut(home, Building).level = FURNITURE_LEVEL;
    sim.world.mut(home, Building).built = fx.fromInt(0);
    expect(both()).toEqual(base);
    sim.world.mut(home, Building).built = ONE;
    setHouseholdGoodUse(sim.world, ctxOf(sim), { player: PLAYER, effect: 'lodging', allowed: false });
    expect(both()).toEqual(base);
  });
});
