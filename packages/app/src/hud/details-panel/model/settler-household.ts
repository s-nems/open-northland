import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { JOB_CIVILIST, JOB_IDLE, JOB_SCOUT } from '../../../catalog/jobs.js';
import {
  buildingTypeOf,
  childOrderWaitOf,
  fatherOf,
  isAdult,
  isBoundByMarriage,
  isFemale,
  isMarrying,
  marriageOf,
  residenceHomeOf,
  type SnapshotEntity,
  settlerJobType,
  trainingHouseOf,
  workAreaOf,
  workplaceOf,
} from '../../../game/snapshot.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { buildingTitle, type UnitPanelModelContext } from './context.js';
import { settlerDisplayName, settlerGivenName } from './settler-name.js';
import type { SettlerPlace } from './settler-work.js';

/** What the panel shows a person as: the rows and sections follow it (FOUNDATION.md, "Settler panel").
 *  The residents list's kinds, read the same way. */
export type SettlerRole = 'worker' | 'civilian' | 'soldier' | 'hero' | 'child' | 'woman';

export function settlerRole(ctx: Pick<UnitPanelModelContext, 'jobs'>, ent: SnapshotEntity): SettlerRole {
  const jobType = settlerJobType(ent);
  const job = ctx.jobs.find((j) => j.typeId === jobType);
  if (!isAdult(ent)) return 'child';
  if (job !== undefined && systems.isHeroJobRow(job)) return 'hero';
  if (job !== undefined && systems.isFighterJobRow(job)) return 'soldier';
  if (isFemale(ent)) return 'woman';
  if (jobType === undefined || jobType === JOB_IDLE || jobType === JOB_CIVILIST) return 'civilian';
  return 'worker';
}

/** A control a row offers: `true` when the sim would take it, else the reason it would refuse, which
 *  the faded button carries in its tooltip. */
export type SeatControl = true | string;

/** A Miejsce pracy or Dom row: what it names and the two round buttons after it. */
export interface SettlerSeatRow {
  /** Null reads "brak". */
  readonly target: SettlerPlace | null;
  /** The assign button; null makes the row read-only. */
  readonly assign: SeatControl | null;
  /** The remove button; null leaves its slot blank, as when there is nothing to remove. */
  readonly remove: SeatControl | null;
}

/** The Miejsce pracy row: for a trade that works from a flag (a gatherer, a fisher) the assign pick
 *  also plants the flag on the ground, so the row always offers it. */
export interface SettlerWorkplaceRow extends SettlerSeatRow {
  readonly flag: boolean;
}

/** The Obszar row of a carrier whose post takes a pickup flag: whether a flag stands, the button
 *  that plants or moves it, and the one that takes it away. */
export interface SettlerWorkAreaRow {
  readonly flagged: boolean;
  readonly assign: SeatControl;
  readonly remove: SeatControl | null;
}

export interface SettlerPersonLink {
  readonly id: number;
  readonly label: string;
}

/** The Rodzina row: the spouse and the growing child as links, or "bez pary". */
export interface SettlerFamilyModel {
  readonly partner: SettlerPersonLink | null;
  readonly child: SettlerPersonLink | null;
  /** The find-a-partner button: live for a grown person free to marry, faded while a wedding it started
   *  is under way, null when the person may not marry. */
  readonly marry: SeatControl | null;
  /** The couple's child order, while it waits on the player: what holds it, and the whole sentence. */
  readonly childOnHold: { readonly label: string; readonly tooltip: string } | null;
}

/**
 * The Miejsce pracy row of a worker, or null when there is none to show: a trade no workplace employs
 * (the scout) has no row while it holds no post. Remove releases a building post only; a pinned site
 * and a lesson are left to the action ring.
 */
export function workplaceRow(
  ctx: UnitPanelModelContext,
  ent: SnapshotEntity,
  place: SettlerPlace | null,
  control: SeatControl,
): SettlerWorkplaceRow | null {
  const jobType = settlerJobType(ent);
  const employed = ctx.buildings.some((building) =>
    building.workers.some((slot) => slot.jobType === jobType),
  );
  const flag = jobType !== undefined && ctx.usesWorkFlag?.(jobType) === true;
  if (place === null && !employed && !flag) return null;
  return {
    target: place,
    assign: employed || flag ? control : null,
    remove: workplaceOf(ent) === undefined ? null : control,
    flag,
  };
}

/** The Obszar row, or null for a settler whose post takes no pickup flag. */
export function workAreaRow(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
  control: SeatControl,
): SettlerWorkAreaRow | null {
  if (ctx.holdsHaulFlagPost?.(snapshot, ent) !== true) return null;
  const flagged = workAreaOf(ent) !== undefined;
  return { flagged, assign: control, remove: flagged ? control : null };
}

/** The Dom row: a grown person's own, a child's read-only (it lives where its parents do). */
export function homeRow(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
  role: SettlerRole,
  control: SeatControl,
): SettlerSeatRow | null {
  if (role === 'hero') return null;
  const father = role === 'child' ? fatherOf(snapshot, ent) : undefined;
  const fatherEnt = father === undefined ? undefined : entityById(snapshot, father);
  const home = residenceHomeOf(ent) ?? (fatherEnt === undefined ? undefined : residenceHomeOf(fatherEnt));
  const building = home === undefined ? undefined : entityById(snapshot, home);
  const target =
    home === undefined || building === undefined
      ? null
      : { id: home, label: buildingTitle(ctx, buildingTypeOf(building)) };
  if (role === 'child') return { target, assign: null, remove: null };
  return { target, assign: control, remove: target === null ? null : control };
}

/** The Rodzina row, or null for a hero and a child, who have none. */
export function familyModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
  role: SettlerRole,
  controllable: boolean,
): SettlerFamilyModel | null {
  if (role === 'hero' || role === 'child') return null;
  const marriage = marriageOf(ent);
  const spouse = marriage === undefined ? undefined : entityById(snapshot, marriage.spouse);
  const child = marriage?.child == null ? undefined : entityById(snapshot, marriage.child);
  const partner =
    spouse === undefined ? null : { id: spouse.id, label: settlerDisplayName(ctx, snapshot, spouse) };
  // The sim's `mayMarry`: grown, not married, not in a drill, not a fighter or the scout; a wedding
  // under way fades the button instead of dropping it.
  const eligible =
    controllable &&
    partner === null &&
    !isBoundByMarriage(snapshot, ent) &&
    trainingHouseOf(ent) === undefined &&
    role !== 'soldier' &&
    settlerJobType(ent) !== JOB_SCOUT;
  return {
    partner,
    child:
      child === undefined || isAdult(child) ? null : { id: child.id, label: settlerGivenName(ctx, child) },
    marry: !eligible ? null : isMarrying(ent) ? messages().hud.settlerPanel.weddingUnderWay : true,
    childOnHold: childOnHold(ctx, snapshot, ent, spouse),
  };
}

/** The wife carries the order, so both spouses read it off her. */
function childOnHold(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
  spouse: SnapshotEntity | undefined,
): SettlerFamilyModel['childOnHold'] {
  const wife = isFemale(ent) ? ent : spouse;
  const husband = wife === ent ? spouse : ent;
  const wait = wife === undefined ? undefined : childOrderWaitOf(wife);
  if (wife === undefined || wait === undefined) return null;
  const copy = messages().userMessages.familyBlocked;
  const partner = husband === undefined ? '' : settlerDisplayName(ctx, snapshot, husband);
  return {
    label: copy.short[wait],
    tooltip: `${settlerDisplayName(ctx, snapshot, wife)} ${formatMessage(copy.full[wait], { partner })}`,
  };
}
