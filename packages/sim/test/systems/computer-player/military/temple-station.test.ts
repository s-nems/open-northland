import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { AssistantRecruit, Building, Owner, Settler } from '../../../../src/components/index.js';
import { CommandQueue } from '../../../../src/core/command-queue.js';
import type { Command } from '../../../../src/core/commands/index.js';
import { PersonalNames } from '../../../../src/core/personal-names.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { EventBuffer, Rng, Simulation, type TerrainMap } from '../../../../src/index.js';
import { type HalfCellNode, hexDistanceBetween } from '../../../../src/nav/halfcell.js';
import type { TerrainGraph } from '../../../../src/nav/terrain/index.js';
import { militaryModule, RALLY_HOLD_RADIUS_NODES } from '../../../../src/systems/computer-player/index.js';
import {
  seatTempleAnchors,
  TEMPLE_STATION_INSET_NODES,
  templeStationToward,
} from '../../../../src/systems/computer-player/military/temple-station.js';
import type { SystemContext } from '../../../../src/systems/context.js';
import { dynamicBlockOverlay } from '../../../../src/systems/footprint/index.js';
import { TEMPLE_AURA_RANGE } from '../../../../src/systems/lifecycle/temple-aura.js';
import { MILITARY_MODE } from '../../../../src/systems/readviews/index.js';
import { interactionCell } from '../../../../src/systems/settlers/targets/index.js';
import { manhattan } from '../../../../src/systems/spatial/metric.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';

/** Where a seat with a temple stations its waiting army: inside the temple's aura, nearest its door. */

const VIKING = 1;
const SEAT = 2;
const GRASS = 0;
const WATER = 1;
const BARRACKS_TYPE = 12;
const TEMPLE_TYPE = 30;
const SPEARMAN = 32;
const FIST = 31;
const HQ_TYPE = 1;
const FOE = 3;
/** The enemy seat the campaign marches on, far from the seat's barracks and temple. */
const FOE_HQ = { x: 60, y: 85 };
const ROW = 40;
const STATION_REACH = TEMPLE_AURA_RANGE - TEMPLE_STATION_INSET_NODES;
const BARRACKS = { x: 30, y: 30 };
/** Far enough east of the barracks that its door lies well outside the aura. */
const FAR_TEMPLE = { x: 110, y: 30 };

function templeContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      { typeId: TEMPLE_TYPE, id: 'work_temple', kind: 'workplace', prayerSite: 'temple' },
    ],
  });
}

function terrainOf(sim: Simulation): TerrainGraph {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: the fixture map builds no terrain graph');
  return terrain;
}

function ctxOf(sim: Simulation, content: ContentSet): SystemContext {
  return {
    content,
    rng: new Rng(1),
    names: new PersonalNames(1, []),
    tick: 0,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    terrain: terrainOf(sim),
  };
}

function hex(a: HalfCellNode, x: number, y: number): number {
  return hexDistanceBetween(a.hx, a.hy, x, y);
}

describe('templeStationToward - the nearest spot inside a temple aura', () => {
  function stationOn(map: TerrainMap, temples: readonly HalfCellNode[], toward: { x: number; y: number }) {
    const content = aiContent();
    const sim = new Simulation({ seed: 1, content, map });
    const terrain = terrainOf(sim);
    const blocked = dynamicBlockOverlay(sim.world, ctxOf(sim, content), terrain);
    const station = templeStationToward(terrain, blocked, temples, terrain.nodeAt(toward.x, toward.y));
    return station === null ? null : terrain.coordsOf(station);
  }

  it('keeps a door that already lies inside the aura', () => {
    const temple = { hx: 40, hy: ROW };
    expect(stationOn(grassNodeMap(128, 96), [temple], { x: 40 + STATION_REACH, y: ROW })).toEqual({
      x: 40 + STATION_REACH,
      y: ROW,
    });
  });

  it('steps a far door in to the inset rim, on the line toward the temple', () => {
    const temple = { hx: 100, hy: ROW };
    const at = stationOn(grassNodeMap(128, 96), [temple], { x: 20, y: ROW });
    expect(at).toEqual({ x: 100 - STATION_REACH, y: ROW });
  });

  it('takes the temple whose aura lies nearest', () => {
    const near = { hx: 70, hy: ROW };
    const far = { hx: 120, hy: ROW };
    const at = stationOn(grassNodeMap(128, 96), [far, near], { x: 10, y: ROW });
    expect(at).toEqual({ x: 70 - STATION_REACH, y: ROW });
  });

  it('has no station when every temple stands across water', () => {
    const width = 128;
    const height = 96;
    const waterX = 60;
    const typeIds = new Array<number>(width * height).fill(GRASS);
    for (let y = 0; y < height; y++) typeIds[y * width + waterX] = WATER;
    const map: TerrainMap = { resolution: 'half-cell', width, height, typeIds };
    // A rim that reaches back over the water to the door's bank still serves.
    expect(stationOn(map, [{ hx: 70, hy: ROW }], { x: 10, y: ROW })).toEqual({
      x: 70 - STATION_REACH,
      y: ROW,
    });
    expect(stationOn(map, [{ hx: 120, hy: ROW }], { x: 10, y: ROW })).toBeNull();
  });
});

describe('military module - the army waits inside its temple aura', () => {
  function templeSim(): { sim: Simulation; content: ContentSet; door: { x: number; y: number } } {
    const content = templeContent();
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(128, 96) });
    for (const [buildingType, at] of [
      [BARRACKS_TYPE, BARRACKS],
      [TEMPLE_TYPE, FAR_TEMPLE],
    ] as const) {
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner: SEAT });
      sim.step();
    }
    const terrain = terrainOf(sim);
    const door = terrain.coordsOf(interactionCell(sim.world, ctxOf(sim, content), terrain, buildingOf(sim)));
    return { sim, content, door };
  }

  function buildingOf(sim: Simulation, buildingType = BARRACKS_TYPE): Entity {
    for (const e of sim.world.query(Building, Owner)) {
      if (sim.world.get(e, Building).buildingType === buildingType) return e;
    }
    throw new Error(`setup: building ${buildingType} missing`);
  }

  function spawn(sim: Simulation, count: number, at: { x: number; y: number }, jobType = SPEARMAN): Entity[] {
    const before = new Set(sim.world.query(Settler));
    for (let i = 0; i < count; i++) {
      const x = at.x + 2 * (i % 8);
      const y = at.y + 2 * Math.floor(i / 8);
      sim.enqueueSetup({ kind: 'spawnSettler', jobType, x, y, tribe: VIKING, owner: SEAT });
    }
    sim.step();
    const spawned = [...sim.world.query(Settler)].filter((e) => !before.has(e));
    for (const entity of spawned) sim.enqueueSetup({ kind: 'setStance', entity, mode: MILITARY_MODE.ATTACK });
    sim.step();
    return spawned;
  }

  function walks(commands: readonly Command[]): { entity: Entity; x: number; y: number }[] {
    return commands.flatMap((c) =>
      c.kind === 'attackMoveUnit' ? [{ entity: c.entity, x: c.x, y: c.y }] : [],
    );
  }

  function run(sim: Simulation, content: ContentSet): Command[] {
    return [...militaryModule.run(sim.world, ctxOf(sim, content), SEAT)];
  }

  it('finds the finished temple of the seat', () => {
    const { sim, content } = templeSim();
    const temple = sim.world.get(buildingOf(sim, TEMPLE_TYPE), Building);
    expect(temple.built).toBeGreaterThan(0);
    expect(seatTempleAnchors(sim.world, ctxOf(sim, content), SEAT)).toHaveLength(1);
  });

  it('calls the armed men at the barracks door into the aura, toward the door', () => {
    const { sim, content, door } = templeSim();
    const men = spawn(sim, 4, door);
    const temple = seatTempleAnchors(sim.world, ctxOf(sim, content), SEAT)[0];
    if (temple === undefined) throw new Error('setup: no temple');

    const called = walks(run(sim, content));
    expect(called.map((w) => w.entity).sort((a, b) => a - b)).toEqual(men);
    for (const w of called) expect(hex(temple, w.x, w.y)).toBeLessThanOrEqual(TEMPLE_AURA_RANGE);
    // The nearest side of the aura: closer to the door than the temple is.
    for (const w of called) expect(hex(temple, w.x, w.y)).toBeGreaterThan(STATION_REACH / 2);
  });

  it('keeps the band too small to march waiting inside the aura while an enemy stands to march on', () => {
    const { sim, content, door } = templeSim();
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ_TYPE, ...FOE_HQ, tribe: VIKING, owner: FOE });
    sim.step();
    const men = spawn(sim, 2, door);
    const temple = seatTempleAnchors(sim.world, ctxOf(sim, content), SEAT)[0];
    if (temple === undefined) throw new Error('setup: no temple');

    const called = walks(run(sim, content));
    expect(called.map((w) => w.entity).sort((a, b) => a - b)).toEqual(men);
    for (const w of called) expect(hex(temple, w.x, w.y)).toBeLessThanOrEqual(TEMPLE_AURA_RANGE);
  });

  it('leaves a recruit awaiting his weapon at the barracks door', () => {
    const { sim, content, door } = templeSim();
    spawn(sim, 2, door);
    const [recruit] = spawn(sim, 1, { x: door.x + RALLY_HOLD_RADIUS_NODES + 4, y: door.y });
    if (recruit === undefined) throw new Error('setup: no recruit');
    sim.world.add(recruit, AssistantRecruit, {
      intent: 'trainSword',
      armed: false,
      barracks: buildingOf(sim),
    });
    sim.enqueueSetup({ kind: 'setJob', entity: recruit, jobType: FIST });
    sim.step();

    const terrain = terrainOf(sim);
    const doorNode = terrain.nodeAt(door.x, door.y);
    const his = walks(run(sim, content)).find((w) => w.entity === recruit);
    if (his === undefined) throw new Error('expected the recruit called in');
    expect(manhattan(terrain, terrain.nodeAt(his.x, his.y), doorNode)).toBeLessThanOrEqual(
      RALLY_HOLD_RADIUS_NODES,
    );
  });
});
