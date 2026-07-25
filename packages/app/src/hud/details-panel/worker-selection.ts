import type { WorldSnapshot } from '@open-northland/sim';
import { isSettler, num } from '../../game/snapshot.js';

/** At most this many worker sprites in the field (a store dispatches up to ~12; keep the row readable). */
export const MAX_WORKERS = 8;
/** Extra horizontal gap between family groups in a home's residents field, as a fraction of one cell —
 *  members of one family stand close, the next family starts after this breather. */
export const FAMILY_GAP_FRAC = 0.45;

/** A snapshot entity, as `buildSpriteScene` consumes it — the narrowed scene reuses these objects. */
type WorkerEntity = WorldSnapshot['entities'][number];

/** The entities of a grouped id list (a home's residents), flattened in group order and capped like
 *  the worker scan, plus each drawn slot's leading gap ({@link FAMILY_GAP_FRAC} where a new family
 *  starts). One entity pass builds the id→entity map; missing ids (a member died between frames)
 *  are skipped. */
export function groupedEntities(
  snapshot: WorldSnapshot,
  groups: readonly (readonly number[])[],
): { entities: WorkerEntity[]; gaps: number[] } {
  const wanted = new Set<number>();
  for (const group of groups) for (const id of group) wanted.add(id);
  const byId = new Map<number, WorkerEntity>();
  for (const e of snapshot.entities) {
    if (wanted.has(e.id) && isSettler(e)) byId.set(e.id, e);
  }
  const entities: WorkerEntity[] = [];
  const gaps: number[] = [];
  for (const group of groups) {
    let firstOfGroup = true;
    for (const id of group) {
      if (entities.length >= MAX_WORKERS) return { entities, gaps };
      const e = byId.get(id);
      if (e === undefined) continue;
      gaps.push(firstOfGroup && entities.length > 0 ? FAMILY_GAP_FRAC : 0);
      entities.push(e);
      firstOfGroup = false;
    }
  }
  return { entities, gaps };
}

/** The (snapshot-ordered, capped) settler entities bound to `buildingId` — one O(entities) scan, whose
 *  result also narrows the overlay's sprite-scene build. With `siteCrew` (a construction site — builders
 *  are never JobAssignment-bound to it) a settler counts by its persistent crew membership
 *  (`SiteAssignment` — hammering, waiting for material, or detoured, it stays listed), and a plain
 *  hauler shows transiently while depositing there (`CurrentAtomic.targetEntity`) or on a supply
 *  errand for it (`SupplyRun`). A view read, so snapshot order is fine. */
export function boundWorkers(snapshot: WorldSnapshot, buildingId: number, siteCrew: boolean): WorkerEntity[] {
  const out: WorkerEntity[] = [];
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
    if (num(assignment?.workplace) === buildingId || working) out.push(e);
  }
  return out;
}
