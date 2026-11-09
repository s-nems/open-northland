import { type ContentSet, parseContentSet } from '@open-northland/data';
import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import { createResourceNode, startTreeGrowth } from '../../src/systems/index.js';
import { testContent } from './content.js';

export const WOOD = 1;
export const CHOP_ATOMIC = 24;
/** A tree record shaped like the original's `yew 01`: three valency states, blocking only full-grown. */
export const TREE_GFX = 290;
const TREE_LOGIC = 4;
/** `landscapetypes.ini`'s tree row: grows one valency on the growth trigger, falls on the fell event. */
const TREE_TRANSITIONS = [
  [7, TREE_LOGIC, 2, 1, 0],
  [11, 5, 2, 0, 0],
];
const TREE_LOGIC_MAX_VALENCY = 5;
export const TREE_MAX_LEVEL = 3;
/** A tree record whose valency stops at 1, like the original's `tree_dead 03`: never fellable. */
export const DEAD_TREE_GFX = 336;

/** {@link testContent} with wood's harvest stage on {@link TREE_GFX} and the tree logic type it grows by. */
export function treeContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    landscape: [
      ...base.landscape,
      {
        typeId: TREE_LOGIC,
        id: 'tree',
        maxValency: TREE_LOGIC_MAX_VALENCY,
        transitions: TREE_TRANSITIONS,
      },
    ],
    landscapeGfx: [
      ...base.landscapeGfx,
      {
        index: TREE_GFX,
        editName: 'yew 01',
        logicType: TREE_LOGIC,
        maxValency: TREE_MAX_LEVEL,
        isWorkable: true,
        walkBlockAreas: [[TREE_MAX_LEVEL, 0, 0, 1]],
        buildBlockAreas: [[TREE_MAX_LEVEL, -1, 0, 3]],
        workAreas: [[TREE_MAX_LEVEL, -1, 0, 1]],
      },
      {
        index: DEAD_TREE_GFX,
        editName: 'tree_dead 03',
        logicType: TREE_LOGIC,
        maxValency: 1,
        isWorkable: true,
      },
    ],
    gatheringPipeline: [
      ...base.gatheringPipeline,
      {
        goodType: WOOD,
        goodId: 'wood',
        harvest: { landscapeType: TREE_LOGIC, gfxIndices: [TREE_GFX, DEAD_TREE_GFX] },
      },
    ],
  });
}

/** A tree of `gfxIndex` holding `wood` full-grown, at valency `level` on half-cell node `(hx, hy)`,
 *  growing when below full. */
export function treeAt(
  sim: Simulation,
  hx: number,
  hy: number,
  level: number,
  { gfxIndex = TREE_GFX, wood = TREE_MAX_LEVEL }: { gfxIndex?: number; wood?: number } = {},
): Entity {
  const tree = createResourceNode(sim.world, sim.content, {
    good: WOOD,
    x: hx,
    y: hy,
    remaining: wood,
    harvestAtomic: CHOP_ATOMIC,
    felling: true,
    gfxIndex,
    blockLevel: level,
  });
  if (tree === null) throw new Error('tree record missing from the fixture content');
  startTreeGrowth(sim.world, sim.content, tree, level);
  return tree;
}
