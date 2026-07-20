import { type Fixed, systems, type WorldSnapshot } from '@open-northland/sim';

/**
 * Typed read helpers over the frozen {@link WorldSnapshot} — the shared owner/position/kind reads the
 * controls and panels all need, so they stop re-inventing the same `as {...}` casts per file (display
 * panels still cast their own presentation-only fields, e.g. the details panel's needs/carry/stance).
 * These read the snapshot (the allowed one-way flow), never live component stores; every read is
 * defensive (`undefined` on a missing component/field) because a snapshot entity carries only the
 * components it has.
 */

/** One serialized entity of a snapshot. */
export type SnapshotEntity = WorldSnapshot['entities'][number];

/** The entity with `id`, or undefined (linear — panels only resolve the selected few). */
export function entityById(snapshot: WorldSnapshot, id: number): SnapshotEntity | undefined {
  return snapshot.entities.find((e) => e.id === id);
}

/** Narrow an unknown component field to a number, else undefined. */
export function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/** The owning player of an entity (its `Owner.player`), or undefined for a neutral/unowned entity. */
export function ownerPlayerOf(e: SnapshotEntity): number | undefined {
  const owner = e.components.Owner as { player?: unknown } | undefined;
  return num(owner?.player);
}

/** The entity's fixed-point `Position`, or undefined. The snapshot serializes the sim's branded
 *  `Fixed` values as plain numbers; this reader is the one place the brand is restored (by the
 *  sim's own invariant a snapshot Position is fixed-point), so consumers can feed grid seams like
 *  `nodeOfPosition` without minting the brand themselves. */
export function positionOf(e: SnapshotEntity): { x: Fixed; y: Fixed } | undefined {
  const pos = e.components.Position as { x?: unknown; y?: unknown } | undefined;
  const x = num(pos?.x);
  const y = num(pos?.y);
  return x !== undefined && y !== undefined ? { x: x as Fixed, y: y as Fixed } : undefined;
}

/** True when the entity is a settler / a building (carries the marker component). */
export function isSettler(e: SnapshotEntity): boolean {
  return e.components.Settler !== undefined;
}
export function isBuilding(e: SnapshotEntity): boolean {
  return e.components.Building !== undefined;
}
export function isSignpost(e: SnapshotEntity): boolean {
  return e.components.Signpost !== undefined;
}
/** The `buildingType` typeId of a building entity, or undefined if it isn't one / carries none. */
export function buildingTypeOf(e: SnapshotEntity): number | undefined {
  const b = e.components.Building as { buildingType?: unknown } | undefined;
  return num(b?.buildingType);
}

/** The building's tribe (`Building.tribe`), or undefined if it isn't one / carries none. */
export function buildingTribeOf(e: SnapshotEntity): number | undefined {
  const b = e.components.Building as { tribe?: unknown } | undefined;
  return num(b?.tribe);
}

/** The building's construction progress (`Building.built`, fixed-point — `ONE` is finished), or
 *  undefined if it isn't a building / carries none. */
export function builtFractionOf(e: SnapshotEntity): number | undefined {
  const b = e.components.Building as { built?: unknown } | undefined;
  return num(b?.built);
}

/** The settler's current trade (`Settler.jobType`), or undefined for a jobless/idle settler (jobType
 *  `null`) or a non-settler. Drives the right-click "keep the current trade" assignment preference. */
export function settlerJobType(e: SnapshotEntity): number | undefined {
  const s = e.components.Settler as { jobType?: unknown } | undefined;
  return num(s?.jobType);
}

/** The building a settler is employed at (`JobAssignment.workplace`), or undefined when unbound. */
export function workplaceOf(e: SnapshotEntity): number | undefined {
  const a = e.components.JobAssignment as { workplace?: unknown } | undefined;
  return num(a?.workplace);
}

/** The drop-off flag entity a gatherer carries (its `WorkFlag.flag`), or undefined for a non-gatherer. */
export function workFlagOf(e: SnapshotEntity): number | undefined {
  const wf = e.components.WorkFlag as { flag?: unknown } | undefined;
  return num(wf?.flag);
}

// ── Family reads (marriage / residence / child order — the settler action ring + house pick + badges) ──

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
  return boundByMarriage(e, (id) => entityById(snapshot, id));
}

/** {@link isBoundByMarriage} over an arbitrary id→entity lookup, so a caller resolving many settlers
 *  ({@link hasEligiblePartner}) can index the snapshot once instead of re-scanning it per spouse. */
function boundByMarriage(e: SnapshotEntity, lookup: (id: number) => SnapshotEntity | undefined): boolean {
  const marriage = marriageOf(e);
  if (marriage === undefined) return false;
  if (lookup(marriage.spouse) !== undefined) return true;
  const child = marriage.child !== null ? lookup(marriage.child) : undefined;
  return child !== undefined && !isAdult(child);
}

/** The settler's tribe (`Settler.tribe`), or undefined for a non-settler. */
export function settlerTribeOf(e: SnapshotEntity): number | undefined {
  const settler = e.components.Settler as { tribe?: unknown } | undefined;
  return num(settler?.tribe);
}

/** The settler's hunger/fatigue deficits (fixed-point 0..ONE, higher = worse), or undefined for a
 *  non-settler — the need-bubble projection's read. The brand restore mirrors {@link positionOf}. */
export function settlerNeedsOf(e: SnapshotEntity): { hunger: Fixed; fatigue: Fixed } | undefined {
  const settler = e.components.Settler as { hunger?: unknown; fatigue?: unknown } | undefined;
  const hunger = num(settler?.hunger);
  const fatigue = num(settler?.fatigue);
  return hunger !== undefined && fatigue !== undefined
    ? { hunger: hunger as Fixed, fatigue: fatigue as Fixed }
    : undefined;
}

/**
 * Whether any eligible marriage partner for `seeker` exists — the snapshot mirror of the sim's
 * `mayMarry` + `findPartnerFor` filters (same tribe, opposite sex, unmarried adult, not mid-wedding,
 * not away on a mission, positioned), used to grey the ring's marry button instead of offering a
 * silent dead click. The sim command re-validates; a stale frame just mislabels the button. KNOWN
 * GAP: the sim's signpost-confinement filter is not mirrored (the network isn't in the snapshot), so
 * under `setSignpostNavigation` an out-of-area-only match still lights the button and the click
 * cancels — ticketed with the other confinement cues (docs/tickets/app/assign-builder-refusal-cue.md).
 */
export function hasEligiblePartner(snapshot: WorldSnapshot, seeker: SnapshotEntity): boolean {
  const tribe = settlerTribeOf(seeker);
  const seekerFemale = isFemale(seeker);
  // Built on the first candidate that actually carries a `Marriage`: only those resolve a spouse/child, so
  // the common case (an unmarried first candidate) allocates nothing, while the worst case (no partner
  // anywhere) still visits every settler with O(1) lookups instead of a quadratic scan.
  let byId: Map<number, SnapshotEntity> | null = null;
  const lookup = (id: number): SnapshotEntity | undefined => {
    byId ??= new Map(snapshot.entities.map((e) => [e.id, e]));
    return byId.get(id);
  };
  return snapshot.entities.some(
    (e) =>
      e.id !== seeker.id &&
      isSettler(e) &&
      isAdult(e) &&
      isFemale(e) !== seekerFemale &&
      !boundByMarriage(e, lookup) &&
      !isMarrying(e) &&
      positionOf(e) !== undefined &&
      settlerTribeOf(e) === tribe &&
      !systems.isOnMission(settlerJobType(e) ?? null),
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
  for (const e of snapshot.entities) {
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

/**
 * Map each gatherer's drop-off flag entity → its owning gatherer, for the human `player` only
 * (`'any'` — the observer session — keeps every player's gatherers) — the inverse of the
 * gatherer→flag {@link workFlagOf} edge (a flag stores no back-reference, so resolving
 * "which gatherer owns this flag" needs this scan). Lets a click on a flag resolve to the gatherer to
 * select. A gatherer binds to exactly one flag, so the map is 1:1.
 */
export function gathererByFlag(snapshot: WorldSnapshot, player: number | 'any'): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of snapshot.entities) {
    if (player !== 'any' && ownerPlayerOf(e) !== player) continue;
    const flag = workFlagOf(e);
    if (flag !== undefined) out.set(flag, e.id);
  }
  return out;
}
