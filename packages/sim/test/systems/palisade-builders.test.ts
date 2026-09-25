import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  CurrentAtomic,
  Damaged,
  Health,
  Owner,
  Palisade,
  Position,
  SiteAssignment,
  Stockpile,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, positionOfNode, type ScriptLandscapeType, Simulation } from '../../src/index.js';
import { REPAIR_CREW_LIMIT } from '../../src/systems/economy/repair.js';
import { resolveCombatHit } from '../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import { REPAIR_CALM_TICKS } from '../../src/systems/settlers/drives/economy/repair.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
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

  it('mend a damaged wall with the hammer once it is quiet and no house is left to build', () => {
    const map = grassNodeMap(48, 12);
    const sim = new Simulation({
      seed: 2,
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
    });
    const builder = builderAt(sim, 8);
    sim.step();
    const [wall] = [...sim.world.query(Palisade)];
    if (wall === undefined) throw new Error('expected a standing wall');
    resolveCombatHit(sim.world, ctxOf(sim), sim.world.create(), wall, { damage: 30 }, [], 'melee');
    const hitTick = sim.tick;

    let houseDoneAt: number | null = null;
    let repairTicks = 0;
    while (sim.world.has(wall, Damaged) && sim.tick < hitTick + 6000) {
      sim.step();
      const atWall = sim.world.tryGet(builder, SiteAssignment)?.site === wall;
      if (!sim.world.has(house, UnderConstruction)) houseDoneAt ??= sim.tick;
      if (atWall) {
        expect(sim.tick - hitTick, 'a crew waits out the calm period').toBeGreaterThanOrEqual(
          REPAIR_CALM_TICKS,
        );
        expect(houseDoneAt, 'walls wait for the houses').not.toBeNull();
        const swing = sim.world.tryGet(builder, CurrentAtomic);
        if (swing?.effect.kind === 'repair') {
          expect(swing.atomicId).toBe(BUILD_WALL_ATOMIC);
          repairTicks++;
        }
      }
    }
    expect(repairTicks).toBeGreaterThan(0);
    expect(sim.world.get(wall, Health).hitpoints).toBe(WALL.wall?.maxHitpoints);
    expect(sim.world.has(wall, UnderConstruction)).toBe(false);
  });

  it('mend a damaged wall before raising a new segment, even when the segment is nearer', () => {
    const map = grassNodeMap(48, 12);
    const sim = new Simulation({
      seed: 3,
      content: builderContent(),
      map: { ...map, landscapes: { types: [WALL], placements: [] } },
    });
    buildingAt(sim, STORE, 4, false);
    const place = (x: number, extra: object): void =>
      sim.enqueueSetup({
        kind: 'placePalisade',
        gfxIndex: WALL.typeId,
        x,
        y: ROW,
        tribe: VIKING,
        owner: HUMAN,
        ...extra,
      });
    place(12, { underConstruction: true });
    place(24, { valency: 70 });
    builderAt(sim, 8);
    sim.step();
    const [segment, damaged] = [...sim.world.query(Palisade)].sort((a, b) => a - b);
    if (segment === undefined || damaged === undefined) throw new Error('expected a site and a wall');

    for (let tick = 0; tick < 4000 && sim.world.has(segment, UnderConstruction); tick++) {
      sim.step();
      if (!sim.world.has(segment, UnderConstruction)) {
        expect(sim.world.has(damaged, Damaged), 'the damaged wall was mended first').toBe(false);
      }
    }
    expect(sim.world.has(segment, UnderConstruction)).toBe(false);
    expect(sim.world.get(damaged, Health).hitpoints).toBe(WALL.wall?.maxHitpoints);
  });

  it('cap the crew at a damaged wall at the building repair limit', () => {
    const map = grassNodeMap(48, 12);
    const sim = new Simulation({
      seed: 4,
      content: builderContent(),
      map: { ...map, landscapes: { types: [WALL], placements: [] } },
    });
    buildingAt(sim, STORE, 4, false);
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: 24,
      y: ROW,
      tribe: VIKING,
      owner: HUMAN,
      valency: 10,
    });
    const builders = [16, 18, 20, 28, 30, 32, 34].map((hx) => builderAt(sim, hx));
    sim.step();
    const [wall] = [...sim.world.query(Palisade)];
    if (wall === undefined) throw new Error('expected a standing wall');

    let largest = 0;
    for (let tick = 0; tick < 600 && sim.world.has(wall, Damaged); tick++) {
      sim.step();
      const crew = builders.filter((b) => sim.world.tryGet(b, SiteAssignment)?.site === wall).length;
      largest = Math.max(largest, crew);
    }
    expect(largest).toBeGreaterThan(1);
    expect(largest).toBeLessThanOrEqual(REPAIR_CREW_LIMIT);
  });
});
