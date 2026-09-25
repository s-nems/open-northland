import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Owner,
  Palisade,
  Position,
  SiteAssignment,
  Stockpile,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, positionOfNode, type ScriptLandscapeType, Simulation } from '../../src/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const VIKING = 1;
const HUMAN = 0;
const STONE = 1;
const WOOD = 2;
const IDLE = 0;
const BUILDER = 7;
const BUILD_HOUSE_ATOMIC = 39;
const BUILD_WALL_ATOMIC = 42;
const STORE = 1;
const HOUSE = 2;
const GRASS = 0;
const ROW = 6;

const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [],
  groups: [],
  wall: {
    logicType: 82,
    maxHitpoints: 100,
    repairPerStrike: 3,
    construction: [{ goodType: WOOD, amount: 1 }],
  },
};

function builderContent() {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
      { typeId: WOOD, id: 'wood' },
    ],
    jobs: [
      { typeId: IDLE, id: 'idle' },
      { typeId: BUILDER, id: 'builder', allowedAtomics: [BUILD_HOUSE_ATOMIC, BUILD_WALL_ATOMIC] },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: STORE,
        id: 'headquarters',
        kind: 'storage',
        stock: [
          { goodType: STONE, capacity: 10 },
          { goodType: WOOD, capacity: 10 },
        ],
      },
      {
        typeId: HOUSE,
        id: 'home_small',
        kind: 'home',
        homeSize: 1,
        construction: [{ goodType: STONE, amount: 1 }],
      },
    ],
  });
}

function buildingAt(sim: Simulation, buildingType: number, hx: number, site: boolean): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, ROW));
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: site ? fx.fromInt(0) : ONE, level: 0 });
  sim.world.add(e, Stockpile, {
    amounts: new Map(
      site
        ? []
        : [
            [STONE, 5],
            [WOOD, 5],
          ],
    ),
  });
  if (site) sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

function builderAt(sim: Simulation, hx: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, ROW));
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: BUILDER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

describe('palisade builders', () => {
  it('raise a wall only once no house is left to build, even when the wall is nearer', () => {
    const map = grassNodeMap(48, 12);
    const sim = new Simulation({
      seed: 1,
      content: builderContent(),
      map: { ...map, landscapes: { types: [WALL], placements: [] } },
    });
    buildingAt(sim, STORE, 4, false);
    const house = buildingAt(sim, HOUSE, 40, true);
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: 12,
      y: ROW,
      tribe: VIKING,
      owner: HUMAN,
      underConstruction: true,
    });
    const builder = builderAt(sim, 8);
    sim.step();
    const [wall] = [...sim.world.query(Palisade)];
    if (wall === undefined) throw new Error('expected a wall site');

    let houseDoneAt: number | null = null;
    for (let tick = 0; tick < 4000 && sim.world.has(wall, UnderConstruction); tick++) {
      sim.step();
      if (sim.world.has(house, UnderConstruction)) {
        expect(sim.world.tryGet(builder, SiteAssignment)?.site, `tick ${tick}`).not.toBe(wall);
      } else {
        houseDoneAt ??= tick;
      }
    }
    expect(houseDoneAt).not.toBeNull();
    expect(sim.world.has(wall, UnderConstruction)).toBe(false);
  });
});
