import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { workerRoleOf } from '../../../game/sandbox/index.js';
import {
  homeFamiliesOf,
  isAdult,
  isFemale,
  isSettler,
  num,
  type SnapshotEntity,
  settlerJobType,
  shelterersOf,
  siteCrewOf,
  staffOf,
  supplyRunsTo,
  trainingHouseOf,
} from '../../../game/snapshot.js';
import { entitiesUnder, idsGroupedBy } from '../../../game/snapshot-id-index.js';
import { messages } from '../../../i18n/index.js';
import { type BuildingDef, jobDisplayName, type UnitPanelModelContext } from './context.js';
import { settlerDisplayName } from './settler-name.js';

/** The figure a person's well shows: a soldier in steel, a woman, a man, or a smaller child. */
export type PersonLook = 'man' | 'woman' | 'soldier' | 'child';

export interface StaffPerson {
  readonly entity: number;
  readonly name: string;
  readonly job: string;
  readonly look: PersonLook;
}

/** One run of wells: a worker slot's trade, the sheltering crowd, a family. */
export interface StaffGroup {
  readonly key: string;
  /** The line's label; empty for a family, which stands beside the others without one. */
  readonly label: string;
  readonly people: readonly StaffPerson[];
  /** The seats the group has, as empty wells after its people; null has no fixed number. */
  readonly capacity: number | null;
  /** The trade a free seat takes, for a worker slot's line. */
  readonly jobType: number | null;
}

/**
 * Who belongs to the building: a workplace's posted staff per trade (with the crowd sheltering under
 * an alarm and the recruits drilling there), a home's families, or the crew raising a site. The count
 * on the section's rule is the filled and the declared seats (the families for a home).
 */
export interface BuildingStaffModel {
  readonly kind: 'workers' | 'residents' | 'crew';
  readonly groups: readonly StaffGroup[];
  readonly count: { readonly filled: number; readonly capacity: number } | null;
}

const TRAINEES = idsGroupedBy((e) => (isSettler(e) ? trainingHouseOf(e) : undefined), 'trainees', {
  values: ['TrainingOrder'],
  presence: ['Settler'],
});

/** Settlers hammering at a site, by the site. Only the `construct` action counts: a blow or a meal
 *  aimed at the same building is no work on it. */
const HAMMERING = idsGroupedBy(
  (e) => {
    if (!isSettler(e)) return undefined;
    const effect = (e.components.CurrentAtomic as { effect?: { kind?: unknown; site?: unknown } } | undefined)
      ?.effect;
    return effect?.kind === 'construct' ? num(effect.site) : undefined;
  },
  'hammering settlers',
  { values: ['CurrentAtomic'], presence: ['Settler'] },
);

function personOf(ctx: UnitPanelModelContext, snapshot: WorldSnapshot, e: SnapshotEntity): StaffPerson {
  const jobType = settlerJobType(e);
  const job = ctx.jobs.find((row) => row.typeId === jobType);
  const look: PersonLook = !isAdult(e)
    ? 'child'
    : job !== undefined && systems.isFighterJobRow(job)
      ? 'soldier'
      : isFemale(e)
        ? 'woman'
        : 'man';
  return {
    entity: e.id,
    name: settlerDisplayName(ctx, snapshot, e),
    job: jobDisplayName(ctx, jobType),
    look,
  };
}

/** The settlers raising `site`, ascending by id: its assigned builders, the ones working on it right now
 *  and the ones supplying it. */
export function raisingCrew(snapshot: WorldSnapshot, site: number): SnapshotEntity[] {
  const crew = new Map<number, SnapshotEntity>();
  for (const e of siteCrewOf(snapshot, site)) if (isSettler(e)) crew.set(e.id, e);
  for (const e of entitiesUnder(snapshot, HAMMERING, site)) crew.set(e.id, e);
  for (const e of supplyRunsTo(snapshot, site)) if (isSettler(e)) crew.set(e.id, e);
  return [...crew.values()].sort((a, b) => a.id - b.id);
}

/** The settlers sheltering in `building`, those already inside (`Resting` there) before the ones still
 *  running to it. The sim admits no more claims than the building's own `shelterCapacity`. */
export function shelteringIn(snapshot: WorldSnapshot, building: number): SnapshotEntity[] {
  const inside: SnapshotEntity[] = [];
  const running: SnapshotEntity[] = [];
  for (const e of shelterersOf(snapshot, building)) {
    const rest = e.components.Resting as { at?: unknown } | undefined;
    (num(rest?.at) === building ? inside : running).push(e);
  }
  return [...inside, ...running];
}

/** A workplace's posted staff, one group per declared `workers` slot in content order, then any trade
 *  posted outside the slots; a tower's garrison is a slot like any other. */
function workerGroups(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  building: number,
): StaffGroup[] {
  const byJob = new Map<number, SnapshotEntity[]>();
  for (const e of staffOf(snapshot, building)) {
    const jobType = settlerJobType(e);
    if (jobType === undefined) continue;
    const list = byJob.get(jobType);
    if (list === undefined) byJob.set(jobType, [e]);
    else list.push(e);
  }
  const groups: StaffGroup[] = (def?.workers ?? []).map((slot) => ({
    key: `job:${slot.jobType}`,
    label: jobDisplayName(ctx, slot.jobType),
    people: (byJob.get(slot.jobType) ?? []).map((e) => personOf(ctx, snapshot, e)),
    capacity: slot.count,
    jobType: slot.jobType,
  }));
  const slotted = new Set((def?.workers ?? []).map((slot) => slot.jobType));
  for (const [jobType, people] of byJob) {
    if (slotted.has(jobType)) continue;
    groups.push({
      key: `job:${jobType}`,
      label: jobDisplayName(ctx, jobType),
      people: people.map((e) => personOf(ctx, snapshot, e)),
      capacity: null,
      jobType,
    });
  }
  return groups;
}

/** The crew raising `site`: its builders, the ones hammering at it and the ones supplying it. */
export function siteCrew(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  site: number,
): BuildingStaffModel {
  return {
    kind: 'crew',
    groups: [
      {
        key: 'crew',
        label: '',
        people: raisingCrew(snapshot, site).map((e) => personOf(ctx, snapshot, e)),
        capacity: null,
        jobType: null,
      },
    ],
    count: null,
  };
}

/** Who belongs to the house, standing or still a site: a home's families, else its workers with the
 *  crowd sheltering there and the recruits drilling there. */
export function buildingStaff(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  ent: SnapshotEntity,
): BuildingStaffModel | null {
  const copy = messages().hud.buildingPanel;
  if (def?.kind === 'home') {
    const families = homeFamiliesOf(snapshot, ent.id) ?? [];
    const groups = families.map((family, index) => {
      const people = family.members.flatMap((id) => {
        const e = entityById(snapshot, id);
        return e === undefined || !isSettler(e) ? [] : [e];
      });
      // Adults first, the man before the woman, then the child.
      const adults = people.filter(isAdult).sort((a, b) => Number(isFemale(a)) - Number(isFemale(b)));
      const minors = people.filter((e) => !isAdult(e));
      return {
        key: `family:${family.members[0] ?? index}`,
        label: '',
        people: [...adults, ...minors].map((e) => personOf(ctx, snapshot, e)),
        capacity: null,
        jobType: null,
      };
    });
    return { kind: 'residents', groups, count: { filled: families.length, capacity: def.homeSize } };
  }
  const groups = workerGroups(ctx, snapshot, def, ent.id);
  // A worker posted here who shelters here too keeps its trade's line.
  const posted = new Set(groups.flatMap((group) => group.people.map((person) => person.entity)));
  const sheltering = shelteringIn(snapshot, ent.id).filter((e) => !posted.has(e.id));
  if (sheltering.length > 0) {
    groups.push({
      key: 'sheltered',
      label: copy.sheltered,
      people: sheltering.map((e) => personOf(ctx, snapshot, e)),
      capacity: def?.shelterCapacity ?? null,
      jobType: null,
    });
  }
  const drilling = entitiesUnder(snapshot, TRAINEES, ent.id);
  if (drilling.length > 0) {
    groups.push({
      key: 'trainees',
      label: copy.trainees,
      people: drilling.map((e) => personOf(ctx, snapshot, e)),
      capacity: null,
      jobType: null,
    });
  }
  if (groups.length === 0) return null;
  const slots = (def?.workers ?? []).reduce((sum, slot) => sum + slot.count, 0);
  return { kind: 'workers', groups, count: slots > 0 ? { filled: posted.size, capacity: slots } : null };
}

/** The tower posts manned at `building`, or null for a house with no garrison seat. */
export function garrisonPosts(
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  building: number,
): number | null {
  if (!(def?.workers ?? []).some((slot) => workerRoleOf(slot.jobType) === 'garrison')) return null;
  return staffOf(snapshot, building).filter((e) => {
    const jobType = settlerJobType(e);
    return jobType !== undefined && workerRoleOf(jobType) === 'garrison';
  }).length;
}
