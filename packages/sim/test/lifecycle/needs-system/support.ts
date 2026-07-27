export { ctxOf } from '../../fixtures/context.js';

import type { Entity } from '../../../src/ecs/world.js';
import { type Fixed, fx, type Simulation } from '../../../src/index.js';
import { settlerAt } from '../../fixtures/settler.js';

const VIKING = 1;
const WOODCUTTER = 1;

/** Spawn a settler at the origin with the given starting hunger, a viking woodcutter unless told otherwise. */
export function settlerWithHunger(
  sim: Simulation,
  hunger: Fixed,
  identity: { readonly tribe?: number; readonly jobType?: number | null } = {},
): Entity {
  return settlerAt(sim, {
    tribe: identity.tribe ?? VIKING,
    jobType: identity.jobType === undefined ? WOODCUTTER : identity.jobType,
    needs: { hunger },
    position: { x: fx.fromInt(0), y: fx.fromInt(0) },
  });
}
