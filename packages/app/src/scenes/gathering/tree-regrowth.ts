import { cellAnchorNode, components, nodeOfPosition, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import {
  GATHERERS,
  GOOD_WOOD,
  placeFlag,
  placeResourceNode,
  resourceSpecFor,
  spawnBoundGatherer,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const WIDTH = 24;
const HEIGHT = 14;
/** Full-grown trees on every other cell of the top rows: a forest with open ground between its trees. */
const FOREST = { x0: 10, x1: 18, y0: 3, y1: 7, step: 2 } as const;
/**
 * Young trees along the forest's top edge. Their map sections take the growth trigger near tick 1700,
 * so each gains a valency inside the run and the older one becomes fellable.
 */
const SAPLINGS = [
  { x: 11, y: 2, level: 1 },
  { x: 13, y: 2, level: 2 },
  { x: 15, y: 2, level: 1 },
] as const;
const FULL_GROWN = 3;
/** A felled tree's gap in the forest, where three regrowths come due early instead of minutes out. */
const FELLED = { x: 14, y: 4 } as const;
const REGROW_DUE_TICKS = [60, 180, 300] as const;
/** The woodcutter's own grove, out of his flag's reach of the forest. */
const GROVE = [
  { x: 3, y: 11 },
  { x: 5, y: 11 },
  { x: 4, y: 12 },
] as const;
const FLAG_AT = { x: 4, y: 10 } as const;
const FLAG_RADIUS_NODES = 6;
/** Long enough for the novice to fell a grove tree, and for every young tree's section to grow. */
const RUN_TICKS = 3000;
const INITIAL_ZOOM = 1.2;

const { Felling, Position, Resource, TreeGrowth, TreeRegrow } = components;

function wood() {
  const spec = GATHERERS.find((g) => g.good === GOOD_WOOD);
  if (spec === undefined) throw new Error('tree-regrowth: no woodcutter spec');
  return spec;
}

function forestCells(): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let y = FOREST.y0; y <= FOREST.y1; y += FOREST.step) {
    for (let x = FOREST.x0; x <= FOREST.x1; x += FOREST.step) cells.push({ x, y });
  }
  return cells;
}

/** The tree anchored on cell `(x, y)`, or undefined once none stands there. */
function treeAt(sim: Simulation, x: number, y: number) {
  const anchor = cellAnchorNode(x, y);
  for (const e of sim.world.query(Felling, Resource, Position)) {
    const pos = sim.world.get(e, Position);
    const at = nodeOfPosition(pos.x, pos.y);
    if (at.hx === anchor.hx && at.hy === anchor.hy) return e;
  }
  return undefined;
}

function build(sim: Simulation): void {
  const g = wood();
  for (const cell of forestCells()) placeResourceNode(sim, g, cell.x, cell.y);
  for (const { x, y, level } of SAPLINGS) {
    const node = cellAnchorNode(x, y);
    const tree = systems.createResourceNode(sim.world, sim.content, {
      ...resourceSpecFor(g, node.hx, node.hy),
      blockLevel: level,
    });
    if (tree === null) throw new Error('tree-regrowth: no wood footprint');
    systems.startTreeGrowth(sim.world, sim.content, tree, level);
  }
  const felled = cellAnchorNode(FELLED.x, FELLED.y);
  const spec = resourceSpecFor(g, felled.hx, felled.hy);
  for (const dueAtTick of REGROW_DUE_TICKS) {
    sim.world.add(sim.world.create(), TreeRegrow, {
      dueAtTick,
      hx: felled.hx,
      hy: felled.hy,
      goodType: spec.good,
      harvestAtomic: spec.harvestAtomic,
      wood: spec.remaining,
    });
  }
  for (const tree of GROVE) placeResourceNode(sim, g, tree.x, tree.y);
  const flag = placeFlag(sim, FLAG_AT.x, FLAG_AT.y);
  spawnBoundGatherer(sim, g.job, FLAG_AT.x, FLAG_AT.y + 1, flag, { fresh: true, radius: FLAG_RADIUS_NODES });
}

/**
 * Trees regrow as the original grows them: a sapling sprouts in a forest gap a felled tree left, young
 * trees climb a valency on their map section's growth run, and a woodcutter's fall schedules the next
 * regrowth. A sapling holds no wood until it is full-grown.
 */
export const treeRegrowthScene: SceneDefinition = {
  id: 'tree-regrowth',
  seed: 11,
  terrain: grassTerrain(WIDTH, HEIGHT),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'a sapling sprouted in the forest, holding no wood yet',
      predicate: (sim) => {
        const authored = new Set([...forestCells(), ...SAPLINGS].map((c) => treeAt(sim, c.x, c.y)));
        for (const e of sim.world.query(TreeGrowth, Resource)) {
          if (!authored.has(e) && sim.world.get(e, Resource).remaining === 0) return true;
        }
        return false;
      },
    },
    {
      label: 'every young tree grew a valency, the older one into a fellable tree',
      predicate: (sim) =>
        SAPLINGS.every(({ x, y, level }) => {
          const tree = treeAt(sim, x, y);
          if (tree === undefined) return false;
          const grown = sim.world.tryGet(tree, TreeGrowth)?.level ?? FULL_GROWN;
          const fullYield = resourceSpecFor(wood(), x, y).remaining;
          const fellable = grown < FULL_GROWN || sim.world.get(tree, Resource).remaining === fullYield;
          return grown === level + 1 && fellable;
        }),
    },
    {
      label: "the woodcutter's fall scheduled a regrowth",
      predicate: (sim) => [...sim.world.query(TreeRegrow)].length > 0,
    },
  ],
};
