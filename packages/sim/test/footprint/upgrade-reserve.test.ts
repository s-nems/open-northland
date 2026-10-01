import { footprintCellDx, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Palisade, Position, RoadSite, Stockpile } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  type NodeArea,
  type NodeGridAnswer,
  nodeGridAccepts,
  nodeGridUpgradeReserve,
  nodeOfPosition,
  type ScriptLandscapeType,
  Simulation,
} from '../../src/index.js';
import { layRoad } from '../../src/systems/roads/index.js';
import {
  grassMap,
  HUT_FOOTPRINT,
  placementContent,
  terrainOf,
  VIKING,
  WOODCUTTER,
} from './building-placement/support.js';

/** A wall or road skirts the ground a standing building keeps for its upgrade unless told to take it, and
 *  the upgrade razes what was built there. */

const GROWING_HUT = 11;
const GROWN_HUT = 12;
const GROWING_AT = { hx: 6, hy: 6 } as const;
const GROWN_AT = { hx: 20, hy: 6 } as const;
/** Two more growing huts, for the road laid and the road ordered on their growth. */
const ROADED_AT = { hx: 14, hy: 6 } as const;
const ORDERED_AT = { hx: 26, hy: 6 } as const;
/** `HUT_FOOTPRINT`'s family body cell its level-0 body does not cover. */
const GROWTH = { dx: 1, dy: 1 } as const;
const AREA: NodeArea = { minHx: 0, minHy: 0, maxHx: 31, maxHy: 15 };
const WALL_GOOD = 5;
const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [{ dx: 0, dy: 0 }],
  groups: [],
  wall: { maxHitpoints: 100, repairPerStrike: 3, construction: [{ goodType: WALL_GOOD, amount: 1 }] },
};

function upgradeContent() {
  const base = placementContent();
  const hut = { kind: 'workplace', workers: [{ jobType: WOODCUTTER, count: 1 }], stock: [], recipes: [] };
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      { ...hut, typeId: GROWING_HUT, id: 'growing_hut', upgradeTarget: GROWN_HUT, footprint: HUT_FOOTPRINT },
      {
        ...hut,
        typeId: GROWN_HUT,
        id: 'grown_hut',
        // A bill keeps an upgrade a site until it is finished on purpose.
        construction: [{ goodType: WALL_GOOD, amount: 1 }],
        footprint: { ...HUT_FOOTPRINT, blocked: HUT_FOOTPRINT.familyBody },
      },
    ],
  });
}

function buildingAt(sim: Simulation, at: { hx: number; hy: number }): Entity {
  for (const e of sim.world.query(Building, Position)) {
    const { x, y } = sim.world.get(e, Position);
    const node = nodeOfPosition(x, y);
    if (node.hx === at.hx && node.hy === at.hy) return e;
  }
  throw new Error(`no building at ${at.hx},${at.hy}`);
}

function placed(sim: Simulation, buildingType: number, at: { hx: number; hy: number }): Entity {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.hx, y: at.hy, tribe: VIKING, force: true });
  sim.step();
  return buildingAt(sim, at);
}

function wallMapSim(): Simulation {
  return new Simulation({
    seed: 1,
    content: upgradeContent(),
    map: { ...grassMap(16, 8), landscapes: { types: [WALL], placements: [] } },
  });
}

function grownSim(): { sim: Simulation; growing: Entity } {
  const sim = wallMapSim();
  const growing = placed(sim, GROWING_HUT, GROWING_AT);
  placed(sim, GROWN_HUT, GROWN_AT);
  return { sim, growing };
}

function reserveNodes(answer: NodeGridAnswer | null): string[] {
  if (answer === null) throw new Error('no answer');
  const nodes: string[] = [];
  for (let hy = AREA.minHy; hy <= AREA.maxHy; hy++) {
    for (let hx = AREA.minHx; hx <= AREA.maxHx; hx++) {
      if (nodeGridUpgradeReserve(answer, hx, hy)) nodes.push(`${hx},${hy}`);
    }
  }
  return nodes;
}

function growthOf(at: { hx: number; hy: number }): { hx: number; hy: number } {
  return { hx: at.hx + footprintCellDx(at.hy, GROWTH), hy: at.hy + GROWTH.dy };
}

const growth = growthOf(GROWING_AT);
const growthNode = `${growth.hx},${growth.hy}`;

function orderWall(sim: Simulation, at: { hx: number; hy: number }, overUpgradeGround?: boolean): void {
  sim.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: WALL.typeId,
    x: at.hx,
    y: at.hy,
    tribe: VIKING,
    underConstruction: true,
    ...(overUpgradeGround === undefined ? {} : { overUpgradeGround }),
  });
  sim.step();
}

function orderRoad(sim: Simulation, at: { hx: number; hy: number }, overUpgradeGround?: boolean): void {
  sim.enqueueSetup({
    kind: 'placeRoadSite',
    x: at.hx,
    y: at.hy,
    tribe: VIKING,
    ...(overUpgradeGround === undefined ? {} : { overUpgradeGround }),
  });
  sim.step();
}

/** Goods on the ground or in a wall or road site: everything held outside a building. */
function goodsOutsideBuildings(sim: Simulation): number {
  let held = 0;
  for (const e of sim.world.query(Stockpile)) {
    if (sim.world.has(e, Building)) continue;
    for (const amount of sim.world.get(e, Stockpile).amounts.values()) held += amount;
  }
  return held;
}

describe('upgrade ground in wall and road answers', () => {
  it('names only the growth of a building that can still upgrade', () => {
    const { sim } = grownSim();
    expect(reserveNodes(sim.roadSiteAnswer(AREA))).toEqual([growthNode]);
    expect(reserveNodes(sim.palisadeAnswer(WALL.typeId, AREA))).toEqual([growthNode]);
  });

  it('accept the growth only for a line told to take upgrade ground', () => {
    const { sim } = grownSim();
    const road = sim.roadSiteAnswer(AREA);
    if (road === null) throw new Error('no answer');
    expect(nodeGridAccepts(road, growth.hx, growth.hy)).toBe(false);
    expect(nodeGridAccepts(road, growth.hx, growth.hy, true)).toBe(true);
  });

  it('drops the growth once the building stands at its top tier', () => {
    const { sim, growing } = grownSim();
    sim.world.mut(growing, Building).buildingType = GROWN_HUT;
    expect(reserveNodes(sim.roadSiteAnswer(AREA))).toEqual([]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});

describe('a line over upgrade ground', () => {
  it('takes the growth only when told to', () => {
    const sim = wallMapSim();
    placed(sim, GROWING_HUT, GROWING_AT);
    orderWall(sim, growth);
    orderRoad(sim, growth);
    expect([...sim.world.query(Palisade)]).toHaveLength(0);
    expect([...sim.world.query(RoadSite)]).toHaveLength(0);

    orderWall(sim, growth, true);
    expect([...sim.world.query(Palisade)]).toHaveLength(1);
  });

  it('goes when the upgrade starts, and nothing it held comes back', () => {
    const sim = wallMapSim();
    const walled = placed(sim, GROWING_HUT, GROWING_AT);
    const paved = placed(sim, GROWING_HUT, ROADED_AT);
    const ordered = placed(sim, GROWING_HUT, ORDERED_AT);
    orderWall(sim, growth, true);
    for (const wall of sim.world.query(Palisade)) sim.world.mut(wall, Stockpile).amounts.set(WALL_GOOD, 1);
    const terrain = terrainOf(sim);
    const roaded = growthOf(ROADED_AT);
    layRoad(sim.world, terrain, [terrain.nodeAt(roaded.hx, roaded.hy)]);
    orderRoad(sim, growthOf(ORDERED_AT), true);
    for (const site of sim.world.query(RoadSite)) sim.world.mut(site, Stockpile).amounts.set(WALL_GOOD, 1);
    expect(goodsOutsideBuildings(sim)).toBe(2);

    for (const building of [walled, paved, ordered]) sim.enqueueSetup({ kind: 'upgradeBuilding', building });
    sim.step();

    expect([...sim.world.query(Palisade)]).toHaveLength(0);
    expect([...sim.world.query(RoadSite)]).toHaveLength(0);
    expect(terrain.isRoad(terrain.nodeAt(roaded.hx, roaded.hy))).toBe(false);
    expect(goodsOutsideBuildings(sim)).toBe(0);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('still refuses upgrade ground another body also stands on', () => {
    const sim = wallMapSim();
    placed(sim, GROWING_HUT, GROWING_AT);
    placed(sim, GROWN_HUT, growth);
    orderWall(sim, growth, true);
    expect([...sim.world.query(Palisade)]).toHaveLength(0);
  });

  it('is razed again as the upgrade finishes, when it was ordered while the upgrade stood', () => {
    const sim = wallMapSim();
    const hut = placed(sim, GROWING_HUT, GROWING_AT);
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: hut });
    sim.step();
    orderWall(sim, growth, true);
    expect([...sim.world.query(Palisade)]).toHaveLength(1);

    sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: hut });
    sim.step();

    expect(sim.world.get(hut, Building).buildingType).toBe(GROWN_HUT);
    expect([...sim.world.query(Palisade)]).toHaveLength(0);
  });

  it('waits on the upgrade ground of a building site through that site finishing', () => {
    const sim = wallMapSim();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: GROWING_HUT,
      x: GROWING_AT.hx,
      y: GROWING_AT.hy,
      tribe: VIKING,
      underConstruction: true,
      force: true,
    });
    sim.step();
    const site = buildingAt(sim, GROWING_AT);
    orderRoad(sim, growth, true);

    sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: site });
    sim.step();

    expect([...sim.world.query(RoadSite)]).toHaveLength(1);
    expect(goodsOutsideBuildings(sim)).toBe(0);
  });
});
