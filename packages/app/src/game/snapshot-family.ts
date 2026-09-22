import type { ContentSet } from '@open-northland/data';
import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import {
  actorsOf,
  isSettler,
  num,
  positionOf,
  type SnapshotEntity,
  settlerJobType,
  settlerTribeOf,
} from './snapshot-base.js';

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
  let bySeeker = ELIGIBLE_PARTNER.get(snapshot);
  if (bySeeker === undefined) {
    bySeeker = new Map();
    ELIGIBLE_PARTNER.set(snapshot, bySeeker);
  }
  const tribe = settlerTribeOf(seeker);
  const female = isFemale(seeker);
  const key = `${tribe}:${female}`;
  const cached = bySeeker.get(key);
  if (cached !== undefined) return cached;
  const found = scanForPartner(content, snapshot, tribe, female);
  bySeeker.set(key, found);
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
  if (isAdult(e)) return undefined;
  return fathersByChild(snapshot).get(e.id);
}

const fatherIndex = new WeakMap<WorldSnapshot, ReadonlyMap<number, number>>();

/** Every growing child's father, from one walk over the snapshot's actors: a list naming a whole
 *  settlement asks once per child, which a scan per question would turn into a walk per child. */
function fathersByChild(snapshot: WorldSnapshot): ReadonlyMap<number, number> {
  let fathers = fatherIndex.get(snapshot);
  if (fathers === undefined) {
    const built = new Map<number, number>();
    for (const parent of actorsOf(snapshot)) {
      const m = marriageOf(parent);
      if (m === undefined || m.child === null || built.has(m.child)) continue;
      built.set(m.child, isFemale(parent) ? m.spouse : parent.id);
    }
    fathers = built;
    fatherIndex.set(snapshot, built);
  }
  return fathers;
}

/** One family living in a home, mirroring the sim's `familiesOf` grouping unit. */
export interface HomeFamily {
  /** Member entity ids: adults first (couple in ascending id order), then the growing child. */
  readonly members: readonly number[];
  readonly adults: number;
  readonly minors: number;
}

/**
 * Group every home's residents into families, mirroring the sim's `familiesOf`: an adult, its
 * cohabiting spouse and the couple's growing child, with an orphaned minor its own household. `homeSize`
 * caps families rather than settlers. Family order follows the lowest member id.
 */
export function familiesByHome(snapshot: WorldSnapshot): Map<number, HomeFamily[]> {
  interface Group {
    members: number[];
    adults: number;
    minors: number;
  }
  const residents: { e: SnapshotEntity; home: number }[] = [];
  const residentHomes = new Map<number, number>();
  for (const e of actorsOf(snapshot)) {
    const home = residenceHomeOf(e);
    if (home === undefined || !isSettler(e)) continue;
    residents.push({ e, home });
    residentHomes.set(e.id, home);
  }
  // An adult groups with its cohabiting spouse only, so a spouse living elsewhere heads its own family.
  const groupsByHome = new Map<number, Map<number, Group>>();
  const groupByChild = new Map<number, Group>();
  const minors: { e: SnapshotEntity; home: number }[] = [];
  for (const { e, home } of residents) {
    if (!isAdult(e)) {
      minors.push({ e, home });
      continue;
    }
    const marriage = marriageOf(e);
    const spouse =
      marriage !== undefined && residentHomes.get(marriage.spouse) === home ? marriage.spouse : undefined;
    const head = spouse !== undefined && spouse < e.id ? spouse : e.id;
    let groups = groupsByHome.get(home);
    if (groups === undefined) {
      groups = new Map();
      groupsByHome.set(home, groups);
    }
    let group = groups.get(head);
    if (group === undefined) {
      group = { members: [], adults: 0, minors: 0 };
      groups.set(head, group);
    }
    group.members.push(e.id);
    group.adults++;
    const child = marriage?.child;
    if (child !== null && child !== undefined && residentHomes.get(child) === home)
      groupByChild.set(child, group);
  }
  for (const { e, home } of minors) {
    let group = groupByChild.get(e.id);
    if (group === undefined) {
      let groups = groupsByHome.get(home);
      if (groups === undefined) {
        groups = new Map();
        groupsByHome.set(home, groups);
      }
      group = { members: [], adults: 0, minors: 0 };
      groups.set(e.id, group);
    }
    group.members.push(e.id);
    group.minors++;
  }
  const out = new Map<number, HomeFamily[]>();
  for (const [home, groups] of groupsByHome) out.set(home, [...groups.values()]);
  return out;
}
