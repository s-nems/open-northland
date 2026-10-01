import { cellAnchorNode, components, nodeOfPosition, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { WOOD_YIELD_PER_NODE } from '../catalog/felling.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  GATHERERS,
  type GathererSpec,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_STONE,
  GOOD_WOOD,
  placeBuiltSandboxBuilding,
  placeFlag,
  placeResourceNode,
  spawnBoundGatherer,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const WIDTH = 24;
const HEIGHT = 18;
const FLAG_AT = { x: 8, y: 8 } as const;
/** Past the deposits, so a collector free to take stone or iron would reach a deposit first. */
const TREES = [
  { x: 13, y: 7 },
  { x: 13, y: 9 },
] as const;
const STONE_AT = { x: 7, y: 6 } as const;
const IRON_AT = { x: 7, y: 10 } as const;
const HQ_AT = { x: 16, y: 14 } as const;
/** Goods the scene stops with their counters at 0; wood and mushrooms stay on. */
const STOPPED_GOODS = [GOOD_STONE, GOOD_MUD] as const;
/** Long enough for the novice to walk to a tree and fell it. */
const RUN_TICKS = 3000;
/** Any zoom but 1 frames the opening view on the collector. */
const INITIAL_ZOOM = 1.2;

function gathererOf(good: number): GathererSpec {
  const spec = GATHERERS.find((g) => g.good === good);
  if (spec === undefined) throw new Error(`gatherer-goods: no gatherer spec for good ${good}`);
  return spec;
}

/** Units left on the resource node anchored at `cell`, or 0 once it is gone. */
function remainingAt(sim: Simulation, cell: { readonly x: number; readonly y: number }): number {
  const anchor = cellAnchorNode(cell.x, cell.y);
  for (const e of sim.world.query(components.Resource, components.Position)) {
    const position = sim.world.get(e, components.Position);
    const at = nodeOfPosition(position.x, position.y);
    if (at.hx === anchor.hx && at.hy === anchor.hy) return sim.world.get(e, components.Resource).remaining;
  }
  return 0;
}

/**
 * A novice collector on a work flag with trees, a stone deposit and an iron deposit in reach, stone and
 * clay stopped by their counters. Real content's `needforgood` gate locks iron and gold for him, so the
 * settler panel's Produkcja shows a gathered, a stopped and a locked good side by side; the fallback
 * catalog has no such gate, so the checks leave iron alone.
 */
export const gathererGoodsScene: SceneDefinition = {
  id: 'gatherer-goods',
  seed: 73,
  terrain: grassTerrain(WIDTH, HEIGHT),
  build: (sim) => {
    for (const tree of TREES) placeResourceNode(sim, gathererOf(GOOD_WOOD), tree.x, tree.y);
    placeResourceNode(sim, gathererOf(GOOD_STONE), STONE_AT.x, STONE_AT.y);
    placeResourceNode(sim, gathererOf(GOOD_IRON), IRON_AT.x, IRON_AT.y);
    placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ_AT.x, HQ_AT.y, HUMAN_PLAYER);
    const flag = placeFlag(sim, FLAG_AT.x, FLAG_AT.y);
    const collector = spawnBoundGatherer(sim, gathererOf(GOOD_WOOD).job, FLAG_AT.x, FLAG_AT.y + 1, flag, {
      fresh: true,
    });
    for (const goodType of STOPPED_GOODS)
      sim.enqueueSetup({ kind: 'setProductionCount', entity: collector, goodType, count: 0 });
  },
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'he works the trees',
      predicate: (sim) =>
        TREES.reduce((sum, tree) => sum + remainingAt(sim, tree), 0) < TREES.length * WOOD_YIELD_PER_NODE,
    },
    {
      label: 'the stopped stone stays whole',
      predicate: (sim) => remainingAt(sim, STONE_AT) === gathererOf(GOOD_STONE).depositUnits,
    },
  ],
};
