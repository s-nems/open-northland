import { entityById, homeFamilyCapacityView, systems, type WorldSnapshot } from '@open-northland/sim';
import { settlerName } from '../../../game/character-names/index.js';
import { workerRoleOf } from '../../../game/sandbox/index.js';
import { entitiesUnder, idsGroupedBy } from '../../../game/snapshot/id-index.js';
import {
  holdsSeat,
  homeFamiliesOf,
  isAdult,
  isFemale,
  isSettler,
  num,
  ownerPlayerOf,
  routeCallersAt,
  SEAT_ORDERS,
  type SnapshotEntity,
  seatHouseOf,
  settlerJobType,
  shelterersOf,
  siteCrewOf,
  staffOf,
  supplyRunsTo,
} from '../../../game/snapshot/index.js';
import { messages } from '../../../i18n/index.js';
import {
  type BuildingDef,
  goodLabel,
  isCarrierJob,
  jobDisplayName,
  type UnitPanelModelContext,
} from './context.js';

/** The figure a person's well shows: a soldier in steel, a woman, a man, or a smaller child. */
export type PersonLook = 'man' | 'woman' | 'soldier' | 'child';

export interface StaffPerson {
  readonly entity: number;
  readonly name: string;
  readonly job: string;
  readonly look: PersonLook;
  /** What this person is set to make at this house, as localized good names: the running products the
   *  worker's own panel lists with its counters. It overrides the line's pool; absent keeps the pool. */
  readonly makes?: readonly string[] | undefined;
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
  /** What a worker of this line works on at this house, as localized good names, so the well's tooltip
   *  can name the resource. A gathering trade names the goods the building stocks; a craft operator one
   *  entry per recipe. The pool stands for the line's seats and for a worker without a product choice
   *  of its own; a worker's own selection overrides it (StaffPerson.makes). Empty for a trade that
   *  neither gathers nor operates the craft here, and absent off a workplace's staff. */
  readonly makes?: readonly string[] | undefined;
}

/**
 * Who belongs to the building: a workplace's posted staff per trade (with the crowd sheltering under
 * an alarm and the recruits and coin-drillers there), a home's families, or the crew raising a site.
 * The count on the section's rule is the filled and the declared seats (the families for a home).
 */
export interface BuildingStaffModel {
  readonly kind: 'workers' | 'residents' | 'crew';
  readonly groups: readonly StaffGroup[];
  readonly count: { readonly filled: number; readonly capacity: number } | null;
  /** The fighters posted at a house with tower seats, which "Release the garrison" sends out; null for
   *  any other house. */
  readonly garrison: readonly number[] | null;
}

/** Recruits, pupils and coin-drillers by the house whose seats they share, seated or queued. */
const TRAINEES = idsGroupedBy((e) => (isSettler(e) ? seatHouseOf(e) : undefined), 'trainees', {
  values: SEAT_ORDERS,
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

function personOf(ctx: UnitPanelModelContext, e: SnapshotEntity): StaffPerson {
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
    name: settlerName(ctx, e),
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

/** The settlers by their job, each list in the given order; a settler without one is left out. */
function byJobType(settlers: Iterable<SnapshotEntity>): Map<number, SnapshotEntity[]> {
  const byJob = new Map<number, SnapshotEntity[]>();
  for (const e of settlers) {
    const jobType = settlerJobType(e);
    if (jobType === undefined) continue;
    const list = byJob.get(jobType);
    if (list === undefined) byJob.set(jobType, [e]);
    else list.push(e);
  }
  return byJob;
}

/** A workplace's posted staff, one group per declared `workers` slot in content order, then any trade
 *  posted outside the slots; a tower's garrison is a slot like any other. */
function workerGroups(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  building: number,
): StaffGroup[] {
  const byJob = byJobType(staffOf(snapshot, building));
  const person = (e: SnapshotEntity): StaffPerson => ({
    ...personOf(ctx, e),
    ...makesForPerson(ctx, snapshot, e),
  });
  const groups: StaffGroup[] = (def?.workers ?? []).map((slot) => ({
    key: `job:${slot.jobType}`,
    label: jobDisplayName(ctx, slot.jobType),
    people: (byJob.get(slot.jobType) ?? []).map(person),
    capacity: slot.count,
    jobType: slot.jobType,
    ...makesOf(ctx, def, slot.jobType),
  }));
  const slotted = new Set((def?.workers ?? []).map((slot) => slot.jobType));
  for (const [jobType, people] of byJob) {
    if (slotted.has(jobType)) continue;
    groups.push({
      key: `job:${jobType}`,
      label: jobDisplayName(ctx, jobType),
      people: people.map(person),
      capacity: null,
      jobType,
      ...makesOf(ctx, def, jobType),
    });
  }
  return groups;
}

/**
 * A worker line's goods, as `StaffGroup.makes` carries them: what this trade works on at this house, as
 * localized good names. A gathering trade names the goods the house stocks — the same narrowing the sim
 * applies to a building-employed roamer; a craft operator names one entry per recipe, in recipe order, the
 * rotation pool the sim's craft loop walks. A trade that neither gathers nor operates the craft here (a
 * posted carrier, the sheltering crowd) leaves the field out.
 */
function makesOf(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
  jobType: number | null,
): { makes: readonly string[] } | Record<string, never> {
  if (jobType === null) return {};
  const gathered = gatheredGoodsOf(ctx, def, jobType);
  if (gathered !== null) return { makes: gathered };
  const crafted = craftedGoodsOf(ctx, def, jobType);
  return crafted === null ? {} : { makes: crafted };
}

/**
 * What this posted worker is set to make, from the production counters the worker's own panel edits:
 * the open products with a running count, in recipe order, each a localized good name. An empty list
 * means every product is stopped, so the well keeps the bare trade; no production choice here (the
 * seam absent, the trade listing none) leaves the line's pool standing.
 */
function makesForPerson(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
): { makes: readonly string[] } | Record<string, never> {
  const rows = ctx.productionOf?.(snapshot, ent)?.rows;
  if (rows === undefined) return {};
  return { makes: rows.filter((row) => row.locked === null && row.count > 0).map((row) => row.label) };
}

/**
 * The goods a gathering trade works on here, or null when the trade gathers nothing off the map: the
 * trade's goods this house stocks, the same narrowing the sim applies to a building-employed roamer (an
 * employed gatherer forages only what its workplace stocks, a dish banked in its edible form included).
 * A type declaring no stock slots leaves its gatherer unfiltered, so the whole trade's goods stand.
 */
function gatheredGoodsOf(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
  jobType: number,
): readonly string[] | null {
  const trade = ctx.gatherGoods?.(jobType) ?? [];
  if (trade.length === 0) return null;
  const stored = def?.stock ?? [];
  // The sim's `storedGoodsByBuilding` is absent for a slot-less type, which leaves its roamer unfiltered.
  const slots = stored.length === 0 ? null : new Set(stored.map((slot) => slot.goodType));
  const stocked =
    slots === null
      ? trade
      : trade.filter(
          (goodType) => slots.has(goodType) || slots.has(ctx.edibleGoodForm?.(goodType) ?? goodType),
        );
  return stocked.map((goodType) => goodLabel(ctx, goodType));
}

/**
 * The products a craft operator of this house turns out, in recipe order, or null when the trade runs no
 * craft here. Each recipe contributes its first output, the product the sim's cycle names, and the
 * operator slots follow the sim's rule: any slot trade but a carrier or a gatherer, else every slot,
 * since a type with none of those has its lone carrier run the craft.
 */
function craftedGoodsOf(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
  jobType: number,
): readonly string[] | null {
  if (def === undefined || def.recipes.length === 0) return null;
  if (!operatorSlotsOf(ctx, def).some((slot) => slot.jobType === jobType)) return null;
  return def.recipes
    .flatMap((recipe) => recipe.outputs[0]?.goodType ?? [])
    .map((goodType) => goodLabel(ctx, goodType));
}

/** The sim's operator-slot rule over a type's worker slots: the trades that are neither carriers nor
 *  gatherers, or all of them when that leaves nothing. */
function operatorSlotsOf(
  ctx: UnitPanelModelContext,
  def: BuildingDef,
): readonly { readonly jobType: number; readonly count: number }[] {
  const operators = def.workers.filter(
    (slot) => !isCarrierJob(ctx, slot.jobType) && (ctx.gatherGoods?.(slot.jobType) ?? []).length === 0,
  );
  return operators.length > 0 ? operators : def.workers;
}

/** The owner's traders whose route stops at the house, one line per trade. A route takes no seat, so
 *  the line has no fixed number and no part in the section's count. */
function routeGroups(ctx: UnitPanelModelContext, snapshot: WorldSnapshot, ent: SnapshotEntity): StaffGroup[] {
  const owner = ownerPlayerOf(ent);
  const traders = routeCallersAt(snapshot, ent.id).filter((e) => {
    const jobType = settlerJobType(e);
    return ownerPlayerOf(e) === owner && jobType !== undefined && ctx.isTraderJob?.(jobType) === true;
  });
  return [...byJobType(traders)].map(([jobType, people]) => ({
    key: `route:${jobType}`,
    label: jobDisplayName(ctx, jobType),
    people: people.map((e) => personOf(ctx, e)),
    capacity: null,
    jobType,
  }));
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
        people: raisingCrew(snapshot, site).map((e) => personOf(ctx, e)),
        capacity: null,
        jobType: null,
      },
    ],
    count: null,
    garrison: null,
  };
}

/** Who belongs to the house, standing or still a site: a home's families, else its workers with the
 *  traders whose route stops there, the crowd sheltering there and the recruits and coin-drillers drilling
 *  there. */
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
        people: [...adults, ...minors].map((e) => personOf(ctx, e)),
        capacity: null,
        jobType: null,
      };
    });
    return {
      kind: 'residents',
      groups,
      count: { filled: families.length, capacity: homeFamilyCapacityView(snapshot, ent.id, def, ctx.goods) },
      garrison: null,
    };
  }
  const groups = workerGroups(ctx, snapshot, def, ent.id);
  const posted = groups.reduce((sum, group) => sum + group.people.length, 0);
  const garrison = hasGarrisonSeat(def)
    ? groups.flatMap((group) =>
        group.jobType !== null && workerRoleOf(group.jobType) === 'garrison'
          ? group.people.map((person) => person.entity)
          : [],
      )
    : null;
  groups.push(...routeGroups(ctx, snapshot, ent));
  // A worker posted here or a trader calling here who shelters here too keeps its trade's line.
  const listed = new Set(groups.flatMap((group) => group.people.map((person) => person.entity)));
  const sheltering = shelteringIn(snapshot, ent.id).filter((e) => !listed.has(e.id));
  if (sheltering.length > 0) {
    groups.push({
      key: 'sheltered',
      label: copy.sheltered,
      people: sheltering.map((e) => personOf(ctx, e)),
      capacity: def?.shelterCapacity ?? null,
      jobType: null,
    });
  }
  const trainees = entitiesUnder(snapshot, TRAINEES, ent.id);
  const seated = trainees.filter(holdsSeat);
  const queued = trainees.filter((e) => !holdsSeat(e));
  if (seated.length > 0)
    groups.push({
      key: 'trainees',
      label: copy.trainees,
      people: seated.map((e) => personOf(ctx, e)),
      capacity: null,
      jobType: null,
    });
  if (queued.length > 0)
    groups.push({
      key: 'traineesQueued',
      label: copy.traineesQueued,
      people: queued.map((e) => personOf(ctx, e)),
      capacity: null,
      jobType: null,
    });
  if (groups.length === 0) return null;
  const slots = (def?.workers ?? []).reduce((sum, slot) => sum + slot.count, 0);
  return {
    kind: 'workers',
    groups,
    count: slots > 0 ? { filled: posted, capacity: slots } : null,
    garrison,
  };
}

const hasGarrisonSeat = (def: BuildingDef | undefined): boolean =>
  (def?.workers ?? []).some((slot) => workerRoleOf(slot.jobType) === 'garrison');

/** The tower posts manned at `building`, or null for a house with no garrison seat. */
export function garrisonPosts(
  snapshot: WorldSnapshot,
  def: BuildingDef | undefined,
  building: number,
): number | null {
  if (!hasGarrisonSeat(def)) return null;
  return staffOf(snapshot, building).filter((e) => {
    const jobType = settlerJobType(e);
    return jobType !== undefined && workerRoleOf(jobType) === 'garrison';
  }).length;
}
