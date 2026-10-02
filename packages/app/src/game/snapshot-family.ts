import type { ContentSet } from '@open-northland/data';
import {
  type components,
  entityById,
  firstDifference,
  indexesOf,
  type SnapshotIndexSpec,
  systems,
  type WorldSnapshot,
  withComponent,
} from '@open-northland/sim';
import {
  ACTOR_PRESENCE,
  isActor,
  isSettler,
  num,
  positionOf,
  type SnapshotEntity,
  settlerJobType,
  settlerTribeOf,
} from './snapshot-base.js';
import { entitiesOfIds, idsGroupedBy } from './snapshot-id-index.js';

// Snapshot reads for the marriage, residence and child-order feature.

export function isFemale(e: SnapshotEntity): boolean {
  return e.components.Female !== undefined;
}

/** True when the settler is grown: a born-young settler carries `Age` until adulthood. */
export function isAdult(e: SnapshotEntity): boolean {
  return e.components.Age === undefined;
}

/** `child` is the couple's growing child, `null` while they have none. */
export function marriageOf(e: SnapshotEntity): { spouse: number; child: number | null } | undefined {
  const m = e.components.Marriage as { spouse?: unknown; child?: unknown } | undefined;
  const spouse = num(m?.spouse);
  if (spouse === undefined) return undefined;
  const child = num(m?.child);
  return { spouse, child: child ?? null };
}

/** True from the walk to the match through the kiss. */
export function isMarrying(e: SnapshotEntity): boolean {
  return e.components.Wedding !== undefined;
}

/**
 * The snapshot mirror of the sim's widowing rule: bound while the spouse lives, and a widowed parent
 * stays bound until the couple's child grows up. The component lingers after that, until the next
 * wedding overwrites it.
 */
export function isBoundByMarriage(snapshot: WorldSnapshot, e: SnapshotEntity): boolean {
  const marriage = marriageOf(e);
  if (marriage === undefined) return false;
  if (entityById(snapshot, marriage.spouse) !== undefined) return true;
  const child = marriage.child !== null ? entityById(snapshot, marriage.child) : undefined;
  return child !== undefined && !isAdult(child);
}

/**
 * Whether any eligible marriage partner for `seeker` exists: the snapshot mirror of the sim's
 * `mayMarry` and `findPartnerFor` filters, so the UI can drop a dead marry button. The sim command
 * re-validates. The signpost-confinement filter is not mirrored, because the network is not in the
 * snapshot, so under `setSignpostNavigation` an out-of-area-only match still offers the button.
 */
export function hasEligiblePartner(
  content: ContentSet,
  snapshot: WorldSnapshot,
  seeker: SnapshotEntity,
): boolean {
  let byKind = ELIGIBLE_PARTNER.get(snapshot);
  if (byKind === undefined) {
    byKind = new Map();
    ELIGIBLE_PARTNER.set(snapshot, byKind);
  }
  const tribe = settlerTribeOf(seeker);
  const female = isFemale(seeker);
  const key = `${tribe}:${female}`;
  const cached = byKind.get(key);
  if (cached !== undefined) return cached;
  const found = scanForPartner(content, snapshot, tribe, female);
  byKind.set(key, found);
  return found;
}

/** Keyed by snapshot, then by the seeker's tribe and sex, the only seeker fields a partner depends on, so
 *  a large group scans once per kind of seeker; `content` stays outside the key because a session holds
 *  one {@link ContentSet}. */
const ELIGIBLE_PARTNER = new WeakMap<WorldSnapshot, Map<string, boolean>>();

/** `isBoundByMarriage` runs last because it is the only clause that searches the snapshot. A partner is
 *  of the other sex, so the seeker never matches itself. */
function scanForPartner(
  content: ContentSet,
  snapshot: WorldSnapshot,
  tribe: number | undefined,
  seekerFemale: boolean,
): boolean {
  return snapshot.entities.some(
    (e) =>
      isSettler(e) &&
      isAdult(e) &&
      isFemale(e) !== seekerFemale &&
      !isMarrying(e) &&
      settlerTribeOf(e) === tribe &&
      positionOf(e) !== undefined &&
      !systems.isOnMission(content, settlerJobType(e) ?? null) &&
      !isBoundByMarriage(snapshot, e),
  );
}

export function residenceHomeOf(e: SnapshotEntity): number | undefined {
  const r = e.components.Residence as { home?: unknown } | undefined;
  return num(r?.home);
}

/** A woman's standing make-child order, or undefined when none stands. */
export function childOrderOf(e: SnapshotEntity): 'female' | 'male' | undefined {
  const o = e.components.ChildOrder as { child?: unknown } | undefined;
  return o?.child === 'female' || o?.child === 'male' ? o.child : undefined;
}

/** Why a standing child order is not moving: the sim's recorded blocker, or a larder no food reaches. */
export type ChildOrderWait = components.ChildOrderBlocker | 'noFood';

const CHILD_ORDER_BLOCKERS: readonly components.ChildOrderBlocker[] = [
  'noHome',
  'homeUnbuilt',
  'livesApart',
  'husbandAway',
];

/**
 * Why a woman's standing child order waits, or undefined while it runs or none stands. A blocked
 * assistant booking reads as running: the assistant gives it back on its next beat.
 */
export function childOrderWaitOf(e: SnapshotEntity): ChildOrderWait | undefined {
  const order = e.components.ChildOrder as { blocked?: unknown; foodSearchMissed?: unknown } | undefined;
  if (order === undefined) return undefined;
  const blocked = CHILD_ORDER_BLOCKERS.find((reason) => reason === order.blocked);
  if (blocked !== undefined) return e.components.AssistantChildOrder === undefined ? blocked : undefined;
  return order.foodSearchMissed === true ? 'noFood' : undefined;
}

/** True while a resident couple makes love in this home (the hearts overlay reads it). */
export function isMakingLove(e: SnapshotEntity): boolean {
  return e.components.MakingLove !== undefined;
}

/**
 * Whose given name this settler's displayed surname derives from: a married woman takes her husband's,
 * a growing child its father's, everyone else their own. Ids are stable, so a dead father still anchors
 * the family name.
 */
export function surnameSourceOf(snapshot: WorldSnapshot, e: SnapshotEntity): number | undefined {
  const marriage = marriageOf(e);
  if (marriage !== undefined && isFemale(e)) return marriage.spouse;
  return fatherOf(snapshot, e);
}

/** A growing child's father, which its home and surname follow; undefined for an adult. */
export function fatherOf(snapshot: WorldSnapshot, e: SnapshotEntity): number | undefined {
  return isAdult(e) ? undefined : fatherOfChild(snapshot, e.id);
}

/** The child `marriageOf` reports, read without its allocation: the key runs on every touched actor. */
function marriageChildOf(e: SnapshotEntity): number | undefined {
  const m = e.components.Marriage as { spouse?: unknown; child?: unknown } | undefined;
  return num(m?.spouse) !== undefined ? num(m?.child) : undefined;
}

/** The actors naming each child in their `Marriage`, ascending by id. A marriage keeps naming its child
 *  after it grows up, so the groups gather every parent a settlement ever had. */
const PARENTS = idsGroupedBy((e) => (isActor(e) ? marriageChildOf(e) : undefined), 'parents', {
  values: ['Marriage'],
  presence: ACTOR_PRESENCE,
});

/** A growing child's father, named by its lowest-id parent: a list naming a whole settlement asks once
 *  per child, so the parents come from a maintained index rather than a walk per question. */
function fatherOfChild(snapshot: WorldSnapshot, child: number): number | undefined {
  const parentId = indexesOf(snapshot).get(PARENTS).get(child)?.[0];
  const parent = parentId === undefined ? undefined : entityById(snapshot, parentId);
  if (parent === undefined) return undefined;
  const marriage = marriageOf(parent);
  if (marriage === undefined) return undefined;
  return isFemale(parent) ? marriage.spouse : parent.id;
}

/** One family living in a home, mirroring the sim's `familiesOf` grouping unit. */
export interface HomeFamily {
  /** Member entity ids: adults first (couple in ascending id order), then the growing child. */
  readonly members: readonly number[];
  readonly adults: number;
  readonly minors: number;
}

const residentHomeOf = (e: SnapshotEntity): number | undefined =>
  isSettler(e) ? residenceHomeOf(e) : undefined;

const RESIDENTS = idsGroupedBy(residentHomeOf, 'residents', { values: ['Residence'], presence: ['Settler'] });

/** Whether two objects of one entity group identically: a family reads only the home, adulthood and the
 *  marriage's spouse and child. */
function sameFamilyFacts(previous: SnapshotEntity, next: SnapshotEntity): boolean {
  // The mirror keeps the objects of the components a change left alone.
  const was = previous.components;
  const is = next.components;
  if (
    was.Residence === is.Residence &&
    was.Marriage === is.Marriage &&
    was.Age === is.Age &&
    (was.Settler === undefined) === (is.Settler === undefined)
  )
    return true;
  if (residentHomeOf(previous) !== residentHomeOf(next) || isAdult(previous) !== isAdult(next)) return false;
  const wasMarriage = marriageOf(previous);
  const isMarriage = marriageOf(next);
  return wasMarriage?.spouse === isMarriage?.spouse && wasMarriage?.child === isMarriage?.child;
}

/** Each home's grouped families, built on read and dropped when a change may regroup that home: every
 *  fact a grouping reads belongs to the home's own residents. */
const FAMILIES: SnapshotIndexSpec<Map<number, readonly HomeFamily[]>> = {
  name: 'families',
  reads: { values: ['Residence', 'Marriage'], presence: ['Settler', 'Age'] },
  empty: () => new Map(),
  add: (families, e) => forgetHomeOf(families, e),
  remove: (families, e) => forgetHomeOf(families, e),
  replace: (families, previous, next) => {
    if (sameFamilyFacts(previous, next)) return;
    forgetHomeOf(families, previous);
    forgetHomeOf(families, next);
  },
  // A fresh walk groups nothing, so each grouping still held is checked against its home's residents.
  differs: (families, _fresh, current) => {
    const settlers = current.get(withComponent('Settler'));
    for (const [home, grouped] of families) {
      const residents = current.get(RESIDENTS).get(home);
      if (residents === undefined) return `home ${home}, which nobody lives in`;
      const where = firstDifference(
        grouped,
        groupFamilies(entitiesOfIds(settlers, residents)),
        `home ${home}`,
      );
      if (where !== null) return where;
    }
    return null;
  },
};

function forgetHomeOf(families: Map<number, readonly HomeFamily[]>, e: SnapshotEntity): void {
  const home = residentHomeOf(e);
  if (home !== undefined) families.delete(home);
}

/**
 * The families living in `home`, mirroring the sim's `familiesOf`: an adult, its cohabiting spouse and
 * the couple's growing child, with an orphaned minor its own household. `homeSize` caps families rather
 * than settlers. Undefined for a home nobody lives in.
 */
export function homeFamiliesOf(snapshot: WorldSnapshot, home: number): readonly HomeFamily[] | undefined {
  const residents = indexesOf(snapshot).get(RESIDENTS).get(home);
  if (residents === undefined) return undefined;
  const families = indexesOf(snapshot).get(FAMILIES);
  let grouped = families.get(home);
  if (grouped === undefined) {
    grouped = groupFamilies(entitiesOfIds(snapshot.entities, residents));
    families.set(home, grouped);
  }
  return grouped;
}

/** Adult families in the order their lowest member appears, then the orphaned minors. */
function groupFamilies(residents: readonly SnapshotEntity[]): HomeFamily[] {
  interface Group {
    members: number[];
    adults: number;
    minors: number;
  }
  const living = new Set(residents.map((e) => e.id));
  // An adult groups with its cohabiting spouse only, so a spouse living elsewhere heads its own family.
  const groups = new Map<number, Group>();
  const groupByChild = new Map<number, Group>();
  const minors: SnapshotEntity[] = [];
  for (const e of residents) {
    if (!isAdult(e)) {
      minors.push(e);
      continue;
    }
    const marriage = marriageOf(e);
    const spouse = marriage !== undefined && living.has(marriage.spouse) ? marriage.spouse : undefined;
    const head = spouse !== undefined && spouse < e.id ? spouse : e.id;
    let group = groups.get(head);
    if (group === undefined) {
      group = { members: [], adults: 0, minors: 0 };
      groups.set(head, group);
    }
    group.members.push(e.id);
    group.adults++;
    const child = marriage?.child;
    if (child !== null && child !== undefined && living.has(child)) groupByChild.set(child, group);
  }
  for (const e of minors) {
    let group = groupByChild.get(e.id);
    if (group === undefined) {
      group = { members: [], adults: 0, minors: 0 };
      groups.set(e.id, group);
    }
    group.members.push(e.id);
    group.minors++;
  }
  return [...groups.values()];
}
