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

// Snapshot reads for the marriage / residence / child-order feature: the settler action ring, the
// assign-home pick, and the door/family badges.

/** True when the settler is female (carries the sim's `Female` marker). */
export function isFemale(e: SnapshotEntity): boolean {
  return e.components.Female !== undefined;
}

/** True when the settler is grown: a born-young settler carries `Age` until adulthood. */
export function isAdult(e: SnapshotEntity): boolean {
  return e.components.Age === undefined;
}

/** The settler's `Marriage` (spouse id + the couple's growing child), or undefined when unmarried. */
export function marriageOf(e: SnapshotEntity): { spouse: number; child: number | null } | undefined {
  const m = e.components.Marriage as { spouse?: unknown; child?: unknown } | undefined;
  const spouse = num(m?.spouse);
  if (spouse === undefined) return undefined;
  const child = num(m?.child);
  return { spouse, child: child ?? null };
}

/** True while the settler is mid-wedding (walking to / kissing its match). */
export function isMarrying(e: SnapshotEntity): boolean {
  return e.components.Wedding !== undefined;
}

/**
 * Whether the settler is bound by a live marriage — the snapshot mirror of the sim's widowing rule
 * (`mayMarry`): bound while the spouse lives, and a widowed parent stays bound until the couple's
 * child grows up; a dead-spouse marriage with no growing child is dissolved (the component lingers
 * until the next wedding overwrites it — a destroyed spouse is simply absent from the snapshot).
 */
export function isBoundByMarriage(snapshot: WorldSnapshot, e: SnapshotEntity): boolean {
  const marriage = marriageOf(e);
  if (marriage === undefined) return false;
  if (entityById(snapshot, marriage.spouse) !== undefined) return true;
  const child = marriage.child !== null ? entityById(snapshot, marriage.child) : undefined;
  return child !== undefined && !isAdult(child);
}

/**
 * Whether any eligible marriage partner for `seeker` exists — the snapshot mirror of the sim's
 * `mayMarry` + `findPartnerFor` filters (same tribe, opposite sex, unmarried adult, not mid-wedding,
 * not away on a mission, positioned), used to drop the ring's marry button instead of offering a
 * silent dead click. The sim command re-validates; a stale frame just mislabels the button. KNOWN
 * GAP: the sim's signpost-confinement filter is not mirrored (the network isn't in the snapshot), so
 * under `setSignpostNavigation` an out-of-area-only match still offers the button and the click
 * cancels.
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
  const cached = bySeeker.get(seeker.id);
  if (cached !== undefined) return cached;
  const found = scanForPartner(content, snapshot, seeker);
  bySeeker.set(seeker.id, found);
  return found;
}

/** Keyed by snapshot, then by seeker id, so the ring's per-frame button derivation costs one pass per
 *  tick. `seeker` must be an entity OF `snapshot`: its id keys the memo while the object carries the
 *  filters. `content` stays outside the key because a session holds one {@link ContentSet}. */
const ELIGIBLE_PARTNER = new WeakMap<WorldSnapshot, Map<number, boolean>>();

/** The pass behind {@link hasEligiblePartner}. `isBoundByMarriage` runs last: it is the only clause that
 *  searches the snapshot (two binary lookups), so the marker and tribe reads sieve the candidates first. */
function scanForPartner(content: ContentSet, snapshot: WorldSnapshot, seeker: SnapshotEntity): boolean {
  const tribe = settlerTribeOf(seeker);
  const seekerFemale = isFemale(seeker);
  return snapshot.entities.some(
    (e) =>
      e.id !== seeker.id &&
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

/** The home building the settler lives in (`Residence.home`), or undefined for the homeless. */
export function residenceHomeOf(e: SnapshotEntity): number | undefined {
  const r = e.components.Residence as { home?: unknown } | undefined;
  return num(r?.home);
}

/** A woman's standing make-child order ('female' | 'male'), or undefined when none stands. */
export function childOrderOf(e: SnapshotEntity): 'female' | 'male' | undefined {
  const o = e.components.ChildOrder as { child?: unknown } | undefined;
  return o?.child === 'female' || o?.child === 'male' ? o.child : undefined;
}

/** True while a resident couple makes love in this home (the hearts overlay reads it). */
export function isMakingLove(e: SnapshotEntity): boolean {
  return e.components.MakingLove !== undefined;
}

/**
 * Whose given name this settler's displayed surname derives from: a married woman takes her husband's
 * (the family shares one surname), a growing child its father's (resolved through either parent's
 * `Marriage.child` back-edge), everyone else their own (undefined). Ids are stable, so a dead father
 * still anchors the family name.
 */
export function surnameSourceOf(snapshot: WorldSnapshot, e: SnapshotEntity): number | undefined {
  const marriage = marriageOf(e);
  if (marriage !== undefined && isFemale(e)) return marriage.spouse;
  if (isAdult(e)) return undefined;
  for (const parent of snapshot.entities) {
    const m = marriageOf(parent);
    if (m?.child !== e.id) continue;
    return isFemale(parent) ? m.spouse : parent.id;
  }
  return undefined;
}

/** One family living in a home — the snapshot mirror of the sim's `familiesOf` grouping unit. */
export interface HomeFamily {
  /** Member entity ids: adults first (couple in ascending id order), then the growing child. */
  readonly members: readonly number[];
  readonly adults: number;
  readonly minors: number;
}

/**
 * Group every home's residents into families — the snapshot mirror of the sim's `familiesOf` (an adult +
 * its cohabiting spouse + the couple's growing child; an orphaned minor is its own household). `homeSize`
 * caps FAMILIES, so the door badges, the assign-home highlight, and the home panel all consume this one
 * grouping. One entity pass; family order follows the lowest member id.
 */
export function familiesByHome(snapshot: WorldSnapshot): Map<number, HomeFamily[]> {
  interface Group {
    members: number[];
    adults: number;
    minors: number;
  }
  // Pass 1 — collect residents with their homes (the snapshot's entity order is ascending id).
  const residents: { e: SnapshotEntity; home: number }[] = [];
  const residentHomes = new Map<number, number>();
  for (const e of actorsOf(snapshot)) {
    const home = residenceHomeOf(e);
    if (home === undefined || !isSettler(e)) continue;
    residents.push({ e, home });
    residentHomes.set(e.id, home);
  }
  // Pass 2 — adults group with their cohabiting spouse; each couple's growing child is noted by id.
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
  // Pass 3 — minors join their parents' group; an orphan holds its own family slot.
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
