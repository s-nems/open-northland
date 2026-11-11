import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Female,
  HomeQuality,
  Marriage,
  Owner,
  Position,
  Residence,
} from '../../../src/components/index.js';
import { fx, ONE } from '../../../src/core/fixed.js';
import { TICKS_PER_SECOND } from '../../../src/core/loop.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import type { TerrainMap } from '../../../src/nav/terrain/index.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';
import { grassNodeMap, waterColumnMap } from '../../fixtures/terrain.js';

/** The assistant's "found families" switch: homeless women take the nearest open home, housed single
 *  women wed. The home here holds {@link HOME_SIZE} families, {@link FURNISHED} more while furnished. */

const VIKING = 1;
const PLAYER = 0;
const WOMAN = 5;
const CIVILIST = 6;
const HOME = 2;
const HOME_SIZE = 2;
const FURNISHED = 1;
const FURNITURE = 1;
const PIECE = 1000;
const SLEEP_WEAR = 10;
const ROW = 4;
/** Long enough for a couple a few cells apart to walk together and kiss. */
const WEDDING_TICKS = 3000;

function content(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      {
        typeId: FURNITURE,
        id: 'furniture',
        homeQuality: {
          effect: 'lodging',
          deliveryValue: PIECE,
          capacity: PIECE,
          fetchBelow: PIECE,
          minimumHomeLevel: 0,
          wear: { child: PIECE, sleep: SLEEP_WEAR, meal: SLEEP_WEAR },
        },
      },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOMAN, id: 'woman' },
      { typeId: CIVILIST, id: 'civilist' },
    ],
    landscape: [
      { typeId: 0, id: 'grass', walkable: true, buildable: true },
      { typeId: 1, id: 'water', walkable: false, buildable: false },
    ],
    buildings: [
      { typeId: HOME, id: 'home_level_00', kind: 'home', homeSize: HOME_SIZE, furnishedFamilies: FURNISHED },
    ],
  });
}

function simOn(map: TerrainMap = grassNodeMap(96, 16)): Simulation {
  return new Simulation({ seed: 1, content: content(), map });
}

function homeAt(sim: Simulation, x: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(ROW) });
  sim.world.add(e, Building, { buildingType: HOME, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

function adultAt(sim: Simulation, x: number, female: boolean): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(ROW) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: female ? WOMAN : CIVILIST,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: PLAYER });
  if (female) sim.world.add(e, Female, { female: true });
  return e;
}

function switchOn(sim: Simulation): void {
  sim.enqueueSetup({ kind: 'setAssistantFoundFamilies', player: PLAYER, enabled: true });
}

function beat(sim: Simulation): void {
  for (let i = 0; i <= TICKS_PER_SECOND; i++) sim.step();
}

const homeOf = (sim: Simulation, e: Entity): Entity | undefined => sim.world.tryGet(e, Residence)?.home;

function furnish(sim: Simulation, home: Entity, lodging = PIECE): void {
  sim.world.add(home, HomeQuality, { cooking: 0, lodging, piety: 0 });
}

describe('assistant family founding', () => {
  it('leaves the women alone while the switch is off', () => {
    const sim = simOn();
    homeAt(sim, 10);
    const woman = adultAt(sim, 12, true);
    adultAt(sim, 14, false);
    expect(sim.assistantFoundsFamilies(PLAYER)).toBe(false);

    for (let i = 0; i < WEDDING_TICKS; i++) sim.step();

    expect(homeOf(sim, woman)).toBeUndefined();
    expect(sim.world.has(woman, Marriage)).toBe(false);
  });

  it('moves each homeless woman into her nearest home with a free family slot', () => {
    const sim = simOn();
    const west = homeAt(sim, 10);
    const east = homeAt(sim, 40);
    const women = [adultAt(sim, 36, true), adultAt(sim, 38, true), adultAt(sim, 42, true)];
    switchOn(sim);

    beat(sim);

    // The east home holds two families, so the third woman takes the far one.
    expect(women.map((e) => homeOf(sim, e))).toEqual([east, east, west]);
  });

  it('weds a housed woman and leaves a homeless one single', () => {
    const sim = simOn();
    const home = homeAt(sim, 10);
    const housed = [adultAt(sim, 12, true), adultAt(sim, 14, true)];
    const homeless = adultAt(sim, 16, true);
    const men = [adultAt(sim, 18, false), adultAt(sim, 20, false), adultAt(sim, 22, false)];
    switchOn(sim);

    for (let i = 0; i < WEDDING_TICKS && housed.some((e) => !sim.world.has(e, Marriage)); i++) sim.step();

    expect(housed.map((e) => homeOf(sim, e))).toEqual([home, home]);
    expect(housed.every((e) => sim.world.has(e, Marriage))).toBe(true);
    expect(homeOf(sim, homeless)).toBeUndefined();
    expect(sim.world.has(homeless, Marriage)).toBe(false);
    expect(men.filter((e) => sim.world.has(e, Marriage))).toHaveLength(housed.length);
  });

  it('gives no woman a home across water, and takes a farther home on her own bank', () => {
    const sim = simOn(waterColumnMap(48, 8, 12));
    homeAt(sim, 9);
    const woman = adultAt(sim, 15, true);
    switchOn(sim);

    beat(sim);
    expect(homeOf(sim, woman)).toBeUndefined();

    const ashore = homeAt(sim, 40);
    beat(sim);
    expect(homeOf(sim, woman)).toBe(ashore);
  });

  it("counts a furnished home's extra family slots", () => {
    const sim = simOn();
    const home = homeAt(sim, 10);
    furnish(sim, home);
    const women = [adultAt(sim, 12, true), adultAt(sim, 14, true), adultAt(sim, 16, true)];
    switchOn(sim);

    beat(sim);

    expect(women.map((e) => homeOf(sim, e))).toEqual([home, home, home]);
  });
});
