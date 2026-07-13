import { Position, Resource } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, type Fixed, fx, type Simulation } from '../../../src/index.js';
import { ctxOf } from '../../fixtures/context.js';
import { settlerAt } from '../../fixtures/settler.js';
import { grassCellMap as grassMap } from '../../fixtures/terrain.js';

export { ctxOf, grassMap };

const WOOD = 1;
const WOODCUTTER = 1;

/** The ¾·ONE need level at which a survival drive (eat/sleep/pray/forage) fires — used bare as an
 *  exactly-at-threshold start. */
export const NEED_THRESHOLD: Fixed = fx.div(fx.fromInt(3), fx.fromInt(4));

/** A need level one whole unit (`ONE`) past `v` — unambiguously over a drive threshold. */
export function justAbove(v: Fixed): Fixed {
  return fx.add(v, fx.fromInt(1));
}

export interface NeedLevels {
  readonly hunger?: Fixed;
  readonly fatigue?: Fixed;
  readonly piety?: Fixed;
  readonly enjoyment?: Fixed;
}

/** The terrain node at a visual cell anchor, when the simulation has a map. */
export function cellOf(sim: Simulation, x: number, y: number): number | undefined {
  const node = cellAnchorNode(x, y);
  return sim.terrain?.nodeAt(node.hx, node.hy);
}

/** A woodcutter with only the requested needs raised above their zero defaults. */
export function needsSettlerAt(sim: Simulation, x: number, y: number, needs: NeedLevels): Entity {
  return settlerAt(sim, { jobType: WOODCUTTER, needs, position: { x: fx.fromInt(x), y: fx.fromInt(y) } });
}

/** A harvestable fixture tree used to prove that a need drive outranks ordinary work. */
export function treeAt(sim: Simulation, x: number, y: number): Entity {
  const entity = sim.world.create();
  sim.world.add(entity, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(entity, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 24 });
  return entity;
}

/** The complete system context for direct system calls in need-drive tests. */
