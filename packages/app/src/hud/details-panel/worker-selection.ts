import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { workerRoleOf } from '../../game/sandbox/index.js';
import { actorsOf, isSettler, num, shelterOf } from '../../game/snapshot.js';

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

/** Who the flat field draws for `buildingId`: everyone the building holds. Its posted staff and crew
 *  ({@link boundWorkers}) first, then the crowd that ran in under an alarm ({@link shelteringIn}) - the
 *  posted men keep their places because this strip is their only click target, and the townspeople follow
 *  them into a field that squeezes to fit. */
export function fieldWorkers(snapshot: WorldSnapshot, buildingId: number, siteCrew: boolean): number[] {
  const sheltering = shelteringIn(snapshot, buildingId);
  if (sheltering.length === 0) return boundWorkers(snapshot, buildingId, siteCrew);
  const claimed = new Set(sheltering);
  const staff = boundWorkers(snapshot, buildingId, siteCrew).filter((id) => !claimed.has(id));
  return [...staff, ...sheltering];
}

/** The settlers sheltering in `buildingId`, those already inside (`Resting` there) before the ones still
 *  running to it, so a squeezed field keeps the men under cover. Uncapped: the sim admits no more claims
 *  than the building's own `shelterCapacity`, and it grants none at all until defence mode is raised. */
function shelteringIn(snapshot: WorldSnapshot, buildingId: number): number[] {
  const inside: number[] = [];
  const running: number[] = [];
  for (const e of actorsOf(snapshot)) {
    if (!isSettler(e) || shelterOf(e) !== buildingId) continue;
    const rest = e.components.Resting as { at?: unknown } | undefined;
    (num(rest?.at) === buildingId ? inside : running).push(e.id);
  }
  return [...inside, ...running];
}

/** The (capped) settler ids to draw for `buildingId`, most-belonging first: its GARRISON, then the rest of
 *  its POSTED staff (bound by `JobAssignment`), then - with `siteCrew` (a construction site - builders are
 *  never JobAssignment-bound to it) - the crew raising it, counted by persistent crew membership
 *  (`SiteAssignment` - hammering, waiting for material, or detoured, it stays listed) plus a plain hauler
 *  showing transiently while depositing there (`CurrentAtomic.targetEntity`) or on a supply errand for it
 *  (`SupplyRun`). Posted first because a site's build crew is usually older than the posting and would
 *  otherwise fill the cap with the very settlers the strip above is NOT counting. Within each group,
 *  snapshot order - a view read, so ascending id is fine.
 *
 *  The garrison leads because this strip is its ONLY click target: a man holding a tower is `Resting`, so
 *  the map neither draws nor picks him, and the projection gives him no badge row either. A full big tower
 *  posts 12 (`logicworker` 4/4/4) against a field that fits {@link MAX_WORKERS}, so without the split the
 *  men past the cap would be unselectable - and a walk order is how a posting is cancelled.
 *
 *  A recruit on a barracks drill (`TrainingOrder`) is listed last, from the order to the last repetition,
 *  so a crowded field drops a visitor rather than a working post. It is the only
 *  sight of him for the half of that the map hides him, standing frozen inside the house. */
export function boundWorkers(snapshot: WorldSnapshot, buildingId: number, siteCrew: boolean): number[] {
  const garrison: number[] = [];
  const posted: number[] = [];
  const crew: number[] = [];
  const drilling: number[] = [];
  // Each bucket stops at the field's capacity, and the whole scan stops once the garrison alone fills it:
  // nothing below it could be drawn. This runs per sim tick while a building panel is open.
  const push = (into: number[], id: number): void => {
    if (into.length < MAX_WORKERS) into.push(id);
  };
  for (const e of actorsOf(snapshot)) {
    if (garrison.length >= MAX_WORKERS) break;
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
    if (num(assignment?.workplace) === buildingId) push(mansAPost(e) ? garrison : posted, e.id);
    else if (raising) push(crew, e.id);
    else if (num(drill?.house) === buildingId) push(drilling, e.id);
  }
  return [...garrison, ...posted, ...crew, ...drilling].slice(0, MAX_WORKERS);
}

/** Whether this settler's trade is a tower post rather than ordinary work at its building. */
function mansAPost(e: { components: Record<string, unknown> }): boolean {
  const jobType = num((e.components.Settler as { jobType?: unknown } | undefined)?.jobType);
  return jobType !== undefined && workerRoleOf(jobType) === 'garrison';
}
