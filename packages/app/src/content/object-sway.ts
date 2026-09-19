import { drawsAsFlatDecor, landscapeTypeIdsNamed } from './ir/joins.js';
import type { ContentIr, LandscapeGfxRow } from './ir/rows.js';

/** The `[landscapetype]` names of vegetation that stands rooted. A falling tree and a felled trunk are
 *  left out. The bush types are absent because every bush record is flat decor with an authored loop. */
const STANDING_VEGETATION_TYPES: ReadonlySet<string> = new Set(['tree']);

/** Shear per unit of height at the peak of a gust. Approximation: the strength the project's own trees
 *  carry in their `runtime.json`; no original data drives it. */
export const STILL_VEGETATION_SWAY = 0.02;

export function standingVegetationTypeIds(landscape: ContentIr['landscape']): ReadonlySet<number> {
  return landscapeTypeIdsNamed(landscape, STANDING_VEGETATION_TYPES);
}

/**
 * The breeze the environment-motion switch adds to a vegetation record the original ships as one still
 * frame, `undefined` for everything else. A record with an authored loop already moves, and a second
 * wind on top would fight it. Flat decor draws as axis-aligned quads that cannot shear.
 */
export function stillVegetationSway(
  record: Pick<LandscapeGfxRow, 'logicType' | 'walkBlockAreas'>,
  animated: boolean,
  standingVegetation: ReadonlySet<number>,
): number | undefined {
  if (animated || drawsAsFlatDecor(record)) return undefined;
  return standingVegetation.has(record.logicType) ? STILL_VEGETATION_SWAY : undefined;
}
