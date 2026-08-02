import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { actorsOf, isSettler, num } from '../../game/snapshot.js';

/** At most this many worker sprites in the field (a store dispatches up to ~12; keep the row readable). */
export const MAX_WORKERS = 8;
/** Extra horizontal gap between family groups in a home's residents field, as a fraction of one cell -
 *  members of one family stand close, the next family starts after this breather. */
export const FAMILY_GAP_FRAC = 0.45;

/** The settler ids of a grouped id list (a home's residents), flattened in group order and capped like
 *  the worker scan, plus each drawn slot's leading gap ({@link FAMILY_GAP_FRAC} where a new family
 *  starts). A listed id that is gone or was never a settler is skipped. */
export function groupedWorkers(
  snapshot: WorldSnapshot,
  groups: readonly (readonly number[])[],
): { ids: number[]; gaps: number[] } {
  const wanted = new Set<number>();
  for (const group of groups) for (const id of group) wanted.add(id);
  const settlers = new Set<number>();
  for (const id of wanted) {
    const e = entityById(snapshot, id);
    if (e !== undefined && isSettler(e)) settlers.add(id);
  }
  const ids: number[] = [];
  const gaps: number[] = [];
  for (const group of groups) {
    let firstOfGroup = true;
    for (const id of group) {
      if (ids.length >= MAX_WORKERS) return { ids, gaps };
      if (!settlers.has(id)) continue;
      gaps.push(firstOfGroup && ids.length > 0 ? FAMILY_GAP_FRAC : 0);
      ids.push(id);
      firstOfGroup = false;
    }
  }
  return { ids, gaps };
}

/** The (capped) settler ids to draw for `buildingId`, most-belonging first: its POSTED staff (bound by
 *  `JobAssignment`), then - with `siteCrew` (a construction site - builders are never JobAssignment-bound
 *  to it) - the crew raising it, counted by persistent crew membership (`SiteAssignment` - hammering,
 *  waiting for material, or detoured, it stays listed) plus a plain hauler showing transiently while
 *  depositing there (`CurrentAtomic.targetEntity`) or on a supply errand for it (`SupplyRun`). Posted
 *  first because a site's build crew is usually older than the posting and would otherwise fill the cap
 *  with the very settlers the strip above is NOT counting. Within each group, snapshot order - a view
 *  read, so ascending id is fine.
 *
 *  A recruit on a barracks drill (`TrainingOrder`) is listed last, from the order to the last repetition,
 *  so a crowded field drops a visitor rather than a working post. It is the only
 *  sight of him for the half of that the map hides him, standing frozen inside the house. */
export function boundWorkers(snapshot: WorldSnapshot, buildingId: number, siteCrew: boolean): number[] {
  const posted: number[] = [];
  const crew: number[] = [];
  const drilling: number[] = [];
  for (const e of actorsOf(snapshot)) {
    if (!isSettler(e)) continue;
    const assignment = e.components.JobAssignment as { workplace?: unknown } | undefined;
    const atomic = e.components.CurrentAtomic as { targetEntity?: unknown } | undefined;
    const supply = e.components.SupplyRun as { site?: unknown } | undefined;
    const site = e.components.SiteAssignment as { site?: unknown } | undefined;
    const drill = e.components.TrainingOrder as { house?: unknown } | undefined;
    const raising =
      siteCrew &&
      (num(site?.site) === buildingId ||
        num(atomic?.targetEntity) === buildingId ||
        num(supply?.site) === buildingId);
    if (num(assignment?.workplace) === buildingId) posted.push(e.id);
    else if (raising) crew.push(e.id);
    else if (num(drill?.house) === buildingId) drilling.push(e.id);
  }
  return [...posted, ...crew, ...drilling].slice(0, MAX_WORKERS);
}
