import { landscapeTypeIdsNamed } from '../ir/joins.js';
import type { ContentIr } from '../ir/rows.js';

/**
 * The `[landscapetype]` names of low vegetation the see-through view fades with the buildings and trees:
 * a bush in every stage, wheat and herbs. They draw as flat decor under every unit, so they hide nobody;
 * the view fades them to show the ground a thicket or a field covers. A project choice, not an original
 * behavior.
 */
const SEE_THROUGH_TYPES: ReadonlySet<string> = new Set([
  'bush',
  'bush naked',
  'bush flowering',
  'bush with fruits',
  'wheat (growing)',
  'wheat (harvested)',
  'wheat',
  'herbmine',
  'herbore',
  'herb',
]);

export function seeThroughTypeIds(landscape: ContentIr['landscape']): ReadonlySet<number> {
  return landscapeTypeIdsNamed(landscape, SEE_THROUGH_TYPES);
}
