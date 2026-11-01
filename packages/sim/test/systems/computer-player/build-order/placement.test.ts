import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Simulation, type TerrainMap } from '../../../../src/index.js';
import { HOME_FARM_MARGIN_NODES } from '../../../../src/systems/computer-player/build-order/placement.js';
import { buildOrderModule } from '../../../../src/systems/computer-player/index.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { ctxOf, FARM_TYPE, oneLine, placeHq, SEAT, STOCK_TYPE, VIKING } from '../support.js';

/** Synthetic fixture ground ids. */
const GRASS = 0;
const WATER = 1;
/** The fixture's edible good, field-farmed through the `farming` block below. */
const FOOD_GOOD = 3;
const FIELD_RADIUS = 4;
/** How far round a field farm a home counts as standing on its ground. */
const FARM_GROUND_NODES = FIELD_RADIUS + HOME_FARM_MARGIN_NODES;

const MAP_W = 128;
const MAP_H = 40;
const HQ_AT = { x: 100, y: 20 };
const FARM_AT = { x: HQ_AT.x + 6, y: HQ_AT.y };
/** A store on a far western shore, so the seat's reach spans it. */
const STOCK_AT = { x: 25, y: 20 };
/** The far shore's eastern edge: spots there lie near the fan's rim, far enough from the base that
 *  the pull toward it outweighs a farm-side spot's flat penalty. */
const FAR_SHORE_EDGE_X = 36;

/** Water everywhere but the farm's ground (which holds the base) and, when `farShore`, a western shore. */
function islandMap(farShore: boolean): TerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const farmGround = Math.abs(x - FARM_AT.x) + Math.abs(y - FARM_AT.y) <= FARM_GROUND_NODES;
      const shore = farShore && x <= FAR_SHORE_EDGE_X;
      typeIds[y * MAP_W + x] = farmGround || shore ? GRASS : WATER;
    }
  }
  return { resolution: 'half-cell', width: MAP_W, height: MAP_H, typeIds };
}

describe('build-order placement - homes and field farms', () => {
  const base = aiContent();
  const content = parseContentSet({
    ...base,
    goods: base.goods.map((g) =>
      g.id === 'food_simple'
        ? { ...g, farming: { stages: 5, yieldPerField: 1, fieldRadius: FIELD_RADIUS, maxFields: 25 } }
        : g,
    ),
    buildings: base.buildings.map((b) => (b.id === 'work_farm_00' ? { ...b, produces: [FOOD_GOOD] } : b)),
  });

  function homeSpot(farShore: boolean) {
    const sim = new Simulation({ seed: 1, content, map: islandMap(farShore) });
    placeHq(sim, HQ_AT.x, HQ_AT.y);
    for (const [buildingType, at] of [
      [FARM_TYPE, FARM_AT],
      [STOCK_TYPE, STOCK_AT],
    ] as const)
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x: at.x, y: at.y, tribe: VIKING, owner: SEAT });
    sim.step();
    const order = oneLine([{ kind: 'place', building: 'home_level_00', count: 1 }]);
    const home = [...buildOrderModule(order).run(sim.world, { ...ctxOf(sim), content }, SEAT)][0];
    if (home?.kind !== 'placeBuilding') throw new Error('expected the home placement');
    return home;
  }

  it("takes a far spot over the farm's ground, and the farm's ground only when nothing else is left", () => {
    expect(homeSpot(true).x).toBeLessThanOrEqual(FAR_SHORE_EDGE_X);
    const last = homeSpot(false);
    expect(Math.abs(last.x - FARM_AT.x) + Math.abs(last.y - FARM_AT.y)).toBeLessThanOrEqual(
      FARM_GROUND_NODES,
    );
  });
});
