import { entityById, groupedBy, indexesOf, type WorldSnapshot } from '@open-northland/sim';
import { workerRoleOf } from '../../game/sandbox/index.js';
import {
  isSettler,
  num,
  shelterersOf,
  siteCrewOf,
  staffOf,
  supplyRunsTo,
  trainingHouseOf,
} from '../../game/snapshot.js';

/** Cap on the settler sprites drawn in one field; the field squeezes its cells to fit them. */
export const MAX_WORKERS = 8;
/** Extra horizontal gap between family groups in a home's residents field, as a fraction of one cell. */
export const FAMILY_GAP_FRAC = 0.45;

/** The settler ids of a grouped id list (a home's residents), flattened in group order and capped, plus
 *  each drawn slot's leading gap. A listed id that is gone or was never a settler is skipped. */
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

/** Everyone `buildingId` holds: its posted staff and crew first, then the crowd that ran in under an
 *  alarm, so the posted men keep their places in a squeezed field. */
export function fieldWorkers(snapshot: WorldSnapshot, buildingId: number, siteCrew: boolean): number[] {
  const sheltering = shelteringIn(snapshot, buildingId);
  if (sheltering.length === 0) return boundWorkers(snapshot, buildingId, siteCrew);
  const claimed = new Set(sheltering);
  const staff = boundWorkers(snapshot, buildingId, siteCrew).filter((id) => !claimed.has(id));
  return [...staff, ...sheltering];
}

/** The settlers sheltering in `buildingId`, those already inside (`Resting` there) before the ones still
 *  running to it. Uncapped: the sim admits no more claims than the building's own `shelterCapacity`. */
function shelteringIn(snapshot: WorldSnapshot, buildingId: number): number[] {
  const inside: number[] = [];
  const running: number[] = [];
  for (const e of shelterersOf(snapshot, buildingId)) {
    const rest = e.components.Resting as { at?: unknown } | undefined;
    (num(rest?.at) === buildingId ? inside : running).push(e.id);
  }
  return [...inside, ...running];
}

/** The capped settler ids to draw for `buildingId`, most-belonging first: garrison, the rest of its posted
 *  staff, the crew raising a construction site (`siteCrew`), then a recruit on a barracks drill. The
 *  garrison leads because a man holding a tower is `Resting`, so the map neither draws nor picks him and
 *  this strip is the only way to select him. */
export function boundWorkers(snapshot: WorldSnapshot, buildingId: number, siteCrew: boolean): number[] {
  const garrison: number[] = [];
  const posted: number[] = [];
  for (const e of staffOf(snapshot, buildingId)) (mansAPost(e) ? garrison : posted).push(e.id);
  if (garrison.length >= MAX_WORKERS) return garrison.slice(0, MAX_WORKERS);
  // Each settler is listed once, under the first of its bonds: staff, then crew, then drill.
  const listed = new Set([...garrison, ...posted]);
  const crew = siteCrew ? raisingCrew(snapshot, buildingId).filter((id) => !listed.has(id)) : [];
  for (const id of crew) listed.add(id);
  const drilling: number[] = [];
  for (const e of indexesOf(snapshot).get(TRAINEES).get(buildingId) ?? []) {
    if (!listed.has(e.id)) drilling.push(e.id);
  }
  return [...garrison, ...posted, ...crew, ...drilling].slice(0, MAX_WORKERS);
}

const ATOMIC_TARGETS = groupedBy(
  (e) =>
    isSettler(e)
      ? num((e.components.CurrentAtomic as { targetEntity?: unknown } | undefined)?.targetEntity)
      : undefined,
  'atomic targets',
  { values: ['CurrentAtomic'], presence: ['Settler'] },
);

const TRAINEES = groupedBy((e) => (isSettler(e) ? trainingHouseOf(e) : undefined), 'trainees', {
  values: ['TrainingOrder'],
  presence: ['Settler'],
});

/** The settlers raising `site`, ascending by id: its assigned builders, the ones working on it right now
 *  and the ones supplying it. */
function raisingCrew(snapshot: WorldSnapshot, site: number): number[] {
  const ids = new Set<number>();
  for (const e of siteCrewOf(snapshot, site)) if (isSettler(e)) ids.add(e.id);
  for (const e of indexesOf(snapshot).get(ATOMIC_TARGETS).get(site) ?? []) ids.add(e.id);
  for (const e of supplyRunsTo(snapshot, site)) ids.add(e.id);
  return [...ids].sort((a, b) => a - b);
}

/** Whether this settler's trade is a tower post rather than ordinary work at its building. */
function mansAPost(e: { components: Record<string, unknown> }): boolean {
  const jobType = num((e.components.Settler as { jobType?: unknown } | undefined)?.jobType);
  return jobType !== undefined && workerRoleOf(jobType) === 'garrison';
}
