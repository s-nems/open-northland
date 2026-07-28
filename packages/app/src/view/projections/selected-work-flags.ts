import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { workFlagOf } from '../../game/snapshot.js';

/**
 * The work flags planted by the selected gatherers (each settler's `WorkFlag.flag`), so the renderer can
 * highlight a selected gatherer's own flag. Resolved through the selection rather than the world: a
 * decoded map holds tens of thousands of entities and a selection is a handful.
 */
export function selectedWorkFlags(
  snapshot: WorldSnapshot,
  selected: ReadonlySet<number>,
): ReadonlySet<number> {
  const flags = new Set<number>();
  for (const id of selected) {
    const entity = entityById(snapshot, id);
    const flag = entity !== undefined ? workFlagOf(entity) : undefined;
    if (flag !== undefined) flags.add(flag);
  }
  return flags;
}
