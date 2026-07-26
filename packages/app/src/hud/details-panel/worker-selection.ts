import type { WorldSnapshot } from '@open-northland/sim';
import { isSettler, num } from '../../game/snapshot.js';

/** At most this many worker sprites in the field (a store dispatches up to ~12; keep the row readable). */
export const MAX_WORKERS = 8;
/** Extra horizontal gap between family groups in a home's residents field, as a fraction of one cell —
 *  members of one family stand close, the next family starts after this breather. */
export const FAMILY_GAP_FRAC = 0.45;

/** The settler ids of a grouped id list (a home's residents), flattened in group order and capped like
 *  the worker scan, plus each drawn slot's leading gap ({@link FAMILY_GAP_FRAC} where a new family
 *  starts). One entity pass resolves which listed ids are live settlers; the rest (a member died between
 *  frames, or was never one) are skipped. */
export function groupedWorkers(
  snapshot: WorldSnapshot,
  groups: readonly (readonly number[])[],
): { ids: number[]; gaps: number[] } {
  const wanted = new Set<number>();
  for (const group of groups) for (const id of group) wanted.add(id);
  const settlers = new Set<number>();
  for (const e of snapshot.entities) {
    if (wanted.has(e.id) && isSettler(e)) settlers.add(e.id);
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

/** The (snapshot-ordered, capped) settler ids bound to `buildingId` — one O(entities) scan. With
 *  `siteCrew` (a construction site — builders are never JobAssignment-bound to it) a settler counts by
 *  its persistent crew membership (`SiteAssignment` — hammering, waiting for material, or detoured, it
 *  stays listed), and a plain hauler shows transiently while depositing there
 *  (`CurrentAtomic.targetEntity`) or on a supply errand for it (`SupplyRun`). A view read, so snapshot
 *  order is fine. */
export function boundWorkers(snapshot: WorldSnapshot, buildingId: number, siteCrew: boolean): number[] {
  const out: number[] = [];
  for (const e of snapshot.entities) {
    if (out.length >= MAX_WORKERS) break;
    if (!isSettler(e)) continue;
    const assignment = e.components.JobAssignment as { workplace?: unknown } | undefined;
    const atomic = e.components.CurrentAtomic as { targetEntity?: unknown } | undefined;
    const supply = e.components.SupplyRun as { site?: unknown } | undefined;
    const crew = e.components.SiteAssignment as { site?: unknown } | undefined;
    const working =
      siteCrew &&
      (num(crew?.site) === buildingId ||
        num(atomic?.targetEntity) === buildingId ||
        num(supply?.site) === buildingId);
    if (num(assignment?.workplace) === buildingId || working) out.push(e.id);
  }
  return out;
}
