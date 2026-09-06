import { Position, Resource } from '../../../src/components/index.js';
import { ULP } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, type Fixed, fx, type NodeId, type Simulation } from '../../../src/index.js';
import { ctxOf } from '../../fixtures/context.js';
import { settlerAt } from '../../fixtures/settler.js';
import { grassCellMap as grassMap } from '../../fixtures/terrain.js';

export { ctxOf, grassMap };

const WOOD = 1;
const WOODCUTTER = 1;

/** The one level every need drive fires at - used bare as an exactly-at-threshold start. */
export { NEED_DRIVE_THRESHOLD } from '../../../src/systems/index.js';

/** The smallest need level strictly past `v`, for a fixture that must clear a threshold rather than sit
 *  on it. */
export function justAbove(v: Fixed): Fixed {
  return fx.add(v, ULP);
}

export interface NeedLevels {
  readonly hunger?: Fixed;
  readonly fatigue?: Fixed;
  readonly piety?: Fixed;
  readonly enjoyment?: Fixed;
}

/** The terrain node at a visual cell anchor, when the simulation has a map. */
export function cellOf(sim: Simulation, x: number, y: number): NodeId | undefined {
  const node = cellAnchorNode(x, y);
  return sim.terrain?.nodeAt(node.hx, node.hy);
}

/** A settler of `jobType` (a woodcutter by default) with only the requested needs raised above zero. */
export function needsSettlerAt(
  sim: Simulation,
  x: number,
  y: number,
  needs: NeedLevels,
  jobType: number = WOODCUTTER,
): Entity {
  return settlerAt(sim, { jobType, needs, position: { x: fx.fromInt(x), y: fx.fromInt(y) } });
}

/** A harvestable fixture tree used to prove that a need drive outranks ordinary work. */
export function treeAt(sim: Simulation, x: number, y: number): Entity {
  const entity = sim.world.create();
  sim.world.add(entity, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(entity, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 24 });
  return entity;
}

/** The complete system context for direct system calls in need-drive tests. */
