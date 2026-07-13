import { beforeEach } from 'vitest';
import type { Entity } from '../../../src/ecs/world.js';
import type { Simulation } from '../../../src/index.js';
import { ctxOf } from '../../fixtures/context.js';
import { settlerAt } from '../../fixtures/settler.js';
import { clearComponentStores } from '../../fixtures/stores.js';

export { ctxOf };

/**
 * ProgressionSystem (XP-accrual half) — completing a work atomic trains a settler's `(job, good)`
 * specialization. The fixture's woodcutter (job 1) has a wood-specific track (typeId 1, good 1,
 * `experienceFactor` 10) and a general track (typeId 2, no good, factor 1); XP is keyed by the
 * track's typeId on `Settler.experience`. Goods: 1 = wood; the wood harvest atomic is 24.
 */

export const WOODCUTTER = 1;
export const WOOD = 1;
export const WOOD_TRACK = 1; // fixture jobExperience typeId for "woodcutter wood"
export const GENERAL_TRACK = 2; // fixture jobExperience typeId for "woodcutter general"

beforeEach(clearComponentStores);

export function makeSettler(sim: Simulation, jobType: number | null): Entity {
  return settlerAt(sim, { jobType, tribe: 1 });
}
