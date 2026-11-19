import { cellAnchorNode, components, nodeOfPosition, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import {
  GATHERERS,
  GOOD_WOOD,
  placeFlag,
  placeResourceNode,
  resourceSpecFor,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const CIVILIZATIONS = [1, 2, 3, 4, 7] as const;
const WIDTH = 22;
const HEIGHT = 27;
const WOOD = GATHERERS.find((gatherer) => gatherer.good === GOOD_WOOD);
const ROW_STEP = 4;
const FIRST_ROW = 5;
const FLAG_X = 8;
const COLLECTOR_X = 9;
/** One tree on each side of the flag, so the pair chops facing both ways. */
const TREE_OFFSETS = [
  { dx: 3, dy: 1 },
  { dx: -3, dy: 1 },
] as const;
const FLAG_RADIUS_NODES = 8;
/** A pair shows both civilian heads of every civilization through the chopping. */
const COLLECTORS_PER_ROW = 2;

const { Felling, Position, Resource } = components;

function rowY(row: number): number {
  return FIRST_ROW + row * ROW_STEP;
}

function treeCells(): { x: number; y: number }[] {
  return CIVILIZATIONS.flatMap((_, row) =>
    TREE_OFFSETS.map(({ dx, dy }) => ({ x: FLAG_X + dx, y: rowY(row) + dy })),
  );
}

function build(sim: Simulation): void {
  if (WOOD === undefined) throw new Error('wood-gatherers: missing woodcutter');
  for (const tree of treeCells()) placeResourceNode(sim, WOOD, tree.x, tree.y);
  for (const [row, tribe] of CIVILIZATIONS.entries()) {
    const y = rowY(row);
    const flag = placeFlag(sim, FLAG_X, y);
    for (let i = 0; i < COLLECTORS_PER_ROW; i++) {
      const node = cellAnchorNode(COLLECTOR_X, y + i);
      const e = systems.createSettler(
        sim.world,
        sim.content,
        sim.rng,
        { tribe, jobType: WOOD.job, owner: 0, x: node.hx, y: node.hy },
        sim.names,
      );
      if (e === null) throw new Error('wood-gatherers: missing collector job');
      sim.world.add(e, components.WorkFlag, { flag, radius: FLAG_RADIUS_NODES });
    }
  }
}

/** Whether the tree on `cell` was chopped into or felled. */
function chopped(sim: Simulation, cell: { x: number; y: number }): boolean {
  if (WOOD === undefined) return false;
  const anchor = cellAnchorNode(cell.x, cell.y);
  for (const e of sim.world.query(Felling, Resource, Position)) {
    const pos = sim.world.get(e, Position);
    const at = nodeOfPosition(pos.x, pos.y);
    if (at.hx !== anchor.hx || at.hy !== anchor.hy) continue;
    return sim.world.get(e, Resource).remaining < resourceSpecFor(WOOD, anchor.hx, anchor.hy).remaining;
  }
  return true;
}

export const woodGatherersScene: SceneDefinition = {
  id: 'wood-gatherers',
  seed: 83,
  terrain: grassTerrain(WIDTH, HEIGHT),
  graphicTribes: CIVILIZATIONS,
  build,
  progression: false,
  initialZoom: 0.95,
  runTicks: 1200,
  checks: [
    {
      label: 'the collectors of every civilization have chopped the trees on both sides of their flag',
      predicate: (sim) => treeCells().every((cell) => chopped(sim, cell)),
    },
  ],
};
