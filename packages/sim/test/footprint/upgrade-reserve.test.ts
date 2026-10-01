import { footprintCellDx, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  type NodeArea,
  type NodeGridAnswer,
  nodeGridUpgradeReserve,
  type ScriptLandscapeType,
  Simulation,
} from '../../src/index.js';
import {
  grassMap,
  HUT_FOOTPRINT,
  placementContent,
  VIKING,
  WOODCUTTER,
} from './building-placement/support.js';

/** A wall or road skirts the ground a standing building keeps for its upgrade, and its answer names it. */

const GROWING_HUT = 11;
const GROWN_HUT = 12;
const GROWING_AT = { hx: 6, hy: 6 } as const;
const GROWN_AT = { hx: 20, hy: 6 } as const;
/** `HUT_FOOTPRINT`'s family body cell its level-0 body does not cover. */
const GROWTH = { dx: 1, dy: 1 } as const;
const AREA: NodeArea = { minHx: 0, minHy: 0, maxHx: 31, maxHy: 15 };
const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [{ dx: 0, dy: 0 }],
  groups: [],
  wall: { maxHitpoints: 100, repairPerStrike: 3, construction: [{ goodType: 5, amount: 1 }] },
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
        footprint: { ...HUT_FOOTPRINT, blocked: HUT_FOOTPRINT.familyBody },
      },
    ],
  });
}

function placed(sim: Simulation, buildingType: number, at: { hx: number; hy: number }): Entity {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.hx, y: at.hy, tribe: VIKING, force: true });
  sim.step();
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType === buildingType) return e;
  }
  throw new Error(`building ${buildingType} was not placed`);
}

function grownSim(): { sim: Simulation; growing: Entity } {
  const sim = new Simulation({
    seed: 1,
    content: upgradeContent(),
    map: { ...grassMap(16, 8), landscapes: { types: [WALL], placements: [] } },
  });
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

const growthNode = `${GROWING_AT.hx + footprintCellDx(GROWING_AT.hy, GROWTH)},${GROWING_AT.hy + GROWTH.dy}`;

describe('upgrade ground in wall and road answers', () => {
  it('names only the growth of a building that can still upgrade', () => {
    const { sim } = grownSim();
    expect(reserveNodes(sim.roadSiteAnswer(AREA))).toEqual([growthNode]);
    expect(reserveNodes(sim.palisadeAnswer(WALL.typeId, AREA))).toEqual([growthNode]);
  });

  it('drops the growth once the building stands at its top tier', () => {
    const { sim, growing } = grownSim();
    sim.world.mut(growing, Building).buildingType = GROWN_HUT;
    expect(reserveNodes(sim.roadSiteAnswer(AREA))).toEqual([]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
