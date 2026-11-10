import { cellAnchorNode, components, nodeOfPosition, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import {
  GATHERERS,
  type GathererSpec,
  GOOD_MUSHROOM,
  GOOD_WOOD,
  placeFlag,
  placeResourceNode,
  resourceSpecFor,
  spawnBoundGatherer,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const WIDTH = 24;
const HEIGHT = 14;
/** Saplings on every other cell of the top rows: a young forest, low enough to show the mushrooms that
 *  sprout between its trees, which a grown forest's crowns would hide. */
const FOREST = { x0: 10, x1: 18, y0: 3, y1: 7, step: 2 } as const;
const SAPLING_LEVEL = 1;
/** Mushrooms along the forest's lower edge, close enough that their regrowths reach its gaps. */
const MUSHROOMS = [
  { x: 12, y: 10 },
  { x: 14, y: 10 },
  { x: 16, y: 10 },
] as const;
/** A picked mushroom's spot in the forest, where three regrowths come due early instead of minutes out. */
const PICKED = { x: 13, y: 6 } as const;
const REGROW_DUE_TICKS = [60, 180, 300] as const;
/** The collector's flag below the mushrooms. */
const FLAG_AT = { x: 14, y: 12 } as const;
const FLAG_RADIUS_NODES = 8;
/** Long enough for every early regrowth and for the collector to pick a mushroom. */
const RUN_TICKS = 600;
const INITIAL_ZOOM = 1.2;

const { Position, Regrowth, Resource } = components;

function gatherer(good: number): GathererSpec {
  const spec = GATHERERS.find((g) => g.good === good);
  if (spec === undefined) throw new Error(`mushroom-regrowth: no gatherer spec for good ${good}`);
  return spec;
}

function forestCells(): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let y = FOREST.y0; y <= FOREST.y1; y += FOREST.step) {
    for (let x = FOREST.x0; x <= FOREST.x1; x += FOREST.step) cells.push({ x, y });
  }
  return cells;
}

function plantSapling(sim: Simulation, wood: GathererSpec, x: number, y: number): void {
  const node = cellAnchorNode(x, y);
  const tree = systems.createResourceNode(sim.world, sim.content, {
    ...resourceSpecFor(wood, node.hx, node.hy),
    blockLevel: SAPLING_LEVEL,
  });
  if (tree === null) throw new Error('mushroom-regrowth: no wood footprint');
  systems.startTreeGrowth(sim.world, sim.content, tree, SAPLING_LEVEL);
}

function build(sim: Simulation): void {
  const wood = gatherer(GOOD_WOOD);
  const mushroom = gatherer(GOOD_MUSHROOM);
  for (const cell of forestCells()) plantSapling(sim, wood, cell.x, cell.y);
  for (const cell of MUSHROOMS) placeResourceNode(sim, mushroom, cell.x, cell.y);
  const picked = cellAnchorNode(PICKED.x, PICKED.y);
  const spec = resourceSpecFor(mushroom, picked.hx, picked.hy);
  for (const dueAtTick of REGROW_DUE_TICKS) {
    sim.world.add(sim.world.create(), Regrowth, {
      kind: 'mushroom',
      dueAtTick,
      hx: picked.hx,
      hy: picked.hy,
      goodType: spec.good,
      harvestAtomic: spec.harvestAtomic,
    });
  }
  const flag = placeFlag(sim, FLAG_AT.x, FLAG_AT.y);
  spawnBoundGatherer(sim, mushroom.job, FLAG_AT.x, FLAG_AT.y + 1, flag, {
    fresh: true,
    radius: FLAG_RADIUS_NODES,
  });
}

/** Whether a mushroom stands on a node no authored mushroom took. */
function sproutedMushroom(sim: Simulation): boolean {
  const authored = new Set(
    MUSHROOMS.map(({ x, y }) => {
      const node = cellAnchorNode(x, y);
      return `${node.hx},${node.hy}`;
    }),
  );
  for (const e of sim.world.query(Resource, Position)) {
    if (sim.world.get(e, Resource).goodType !== GOOD_MUSHROOM) continue;
    const pos = sim.world.get(e, Position);
    const at = nodeOfPosition(pos.x, pos.y);
    if (!authored.has(`${at.hx},${at.hy}`)) return true;
  }
  return false;
}

/**
 * Mushrooms regrow as the original regrows them: a picked mushroom may sprout again in the forest
 * minutes later, and every pick a collector makes schedules one such regrowth.
 */
export const mushroomRegrowthScene: SceneDefinition = {
  id: 'mushroom-regrowth',
  seed: 11,
  terrain: grassTerrain(WIDTH, HEIGHT),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    { label: 'a mushroom sprouted in the forest', predicate: sproutedMushroom },
    {
      label: "the collector's pick scheduled a mushroom's regrowth",
      predicate: (sim) =>
        [...sim.world.query(Regrowth)].some((e) => {
          const regrowth = sim.world.get(e, Regrowth);
          return regrowth.kind === 'mushroom' && regrowth.dueAtTick > sim.tick;
        }),
    },
  ],
};
