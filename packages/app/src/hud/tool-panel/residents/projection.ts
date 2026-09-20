import type { ContentSet } from '@open-northland/data';
import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { JOB_CIVILIST, JOB_IDLE } from '../../../catalog/jobs.js';
import {
  actorsOf,
  buildingTypeOf,
  isAdult,
  isBoundByMarriage,
  isFemale,
  isMarrying,
  isSettler,
  isWildlife,
  marriageOf,
  num,
  ownerPlayerOf,
  residenceHomeOf,
  type SnapshotEntity,
  settlerJobType,
  workFlagOf,
  workplaceOf,
} from '../../../game/snapshot.js';
import { buildingTitle, jobDisplayName } from '../../details-panel/model/context.js';
import { settlerDisplayName } from '../../details-panel/model/settler-name.js';
import type { ResidentKind, ResidentLack, ResidentRow } from './rows.js';

/** The mead's content id, the same slug the assistant's mead grant resolves. */
export const MEAD_GOOD_ID = 'mead';

export interface ResidentsProjectionContext {
  readonly localPlayer: number;
  /** The running content: the job roles and the workplaces' worker slots. */
  readonly content: ContentSet;
  /** The map's own string by id, which names a settler the map named. */
  readonly mapText?: ((stringId: number) => string | undefined) | undefined;
  /** The mead good's type id; without one in the content nobody lacks mead. */
  readonly meadGood: number | undefined;
}

interface WornSlots {
  readonly boots: boolean;
  readonly tool: boolean;
  readonly weapon: boolean;
  readonly misc: readonly number[];
}

function wornSlots(ent: SnapshotEntity): WornSlots {
  const eq = ent.components.Equipment as
    | { boots?: unknown; tool?: unknown; weapon?: unknown; misc?: unknown }
    | undefined;
  const held = (slot: unknown): boolean => slot !== null && slot !== undefined;
  const misc = Array.isArray(eq?.misc) ? eq.misc : [];
  return {
    boots: held(eq?.boots),
    tool: held(eq?.tool),
    weapon: held(eq?.weapon),
    misc: misc.flatMap((slot: unknown) => {
      const goodType = num((slot as { goodType?: unknown } | null)?.goodType);
      return goodType === undefined ? [] : [goodType];
    }),
  };
}

function kindOf(content: ContentSet, ent: SnapshotEntity, jobType: number | null): ResidentKind {
  if (!isAdult(ent)) return 'child';
  if (systems.isHeroJob(content, jobType)) return 'hero';
  if (systems.isSoldierJob(content, jobType)) return 'soldier';
  if (isFemale(ent)) return 'woman';
  if (jobType === null || jobType === JOB_IDLE || jobType === JOB_CIVILIST) return 'civilian';
  return 'worker';
}

/**
 * What the resident goes without. The groups follow the original subjects window: no home and no
 * partner skip soldiers and heroes, no children counts the women, no weapon the soldiers. The worn
 * lacks ask only a man whose equipment may change (the sim's `mayChangeEquipment`), so a woman and a
 * hero lack no shoes, tool, weapon or mead. Two are this project's own: no post is a worker whose trade
 * a workplace employs, standing at none and tied to no work flag; no mead is such a man with a job and
 * no bottle, the people the assistant's mead grant reaches. Approximation: the sim tracks a couple's
 * one growing child, so "no children" means none growing now, not a family history.
 */
function lacksOf(
  ctx: ResidentsProjectionContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
  kind: ResidentKind,
  jobType: number | null,
  postedTrades: ReadonlySet<number>,
): ResidentLack[] {
  if (kind === 'child') return [];
  const fighter = kind === 'soldier' || kind === 'hero';
  const worn = wornSlots(ent);
  const lacks: ResidentLack[] = [];
  if (!fighter && residenceHomeOf(ent) === undefined) lacks.push('home');
  if (
    kind === 'worker' &&
    jobType !== null &&
    postedTrades.has(jobType) &&
    workplaceOf(ent) === undefined &&
    workFlagOf(ent) === undefined
  ) {
    lacks.push('post');
  }
  // The assistant hands no tool to a scout, so the list asks none of one.
  if (kind === 'worker' && !systems.isScoutJob(ctx.content, jobType) && !worn.tool) lacks.push('tool');
  const dressable = kind !== 'hero' && kind !== 'woman';
  if (dressable && !worn.boots) lacks.push('shoes');
  if (!fighter && !isBoundByMarriage(snapshot, ent) && !isMarrying(ent)) lacks.push('partner');
  if (kind === 'woman' && !hasGrowingChild(snapshot, ent)) lacks.push('children');
  if (kind === 'soldier' && !worn.weapon) lacks.push('weapon');
  if (dressable && ctx.meadGood !== undefined && jobType !== null && !worn.misc.includes(ctx.meadGood)) {
    lacks.push('mead');
  }
  return lacks;
}

/** The sim's own test of a couple's child: the id lingers on the marriage after the child grew up
 *  or died, so only a living minor counts. */
function hasGrowingChild(snapshot: WorldSnapshot, ent: SnapshotEntity): boolean {
  const child = marriageOf(ent)?.child ?? null;
  const living = child === null ? undefined : entityById(snapshot, child);
  return living !== undefined && !isAdult(living);
}

/** The trades some workplace employs: a builder or a scout works in the open and needs no post. */
function tradesWithPosts(content: ContentSet): ReadonlySet<number> {
  const trades = new Set<number>();
  for (const building of content.buildings) {
    for (const slot of building.workers ?? []) trades.add(slot.jobType);
  }
  return trades;
}

const postedTradesByContent = new WeakMap<ContentSet, ReadonlySet<number>>();

/**
 * The seat's people as the residents window lists them, in snapshot order: humans the local player
 * owns, so animals, vehicles and other seats' people stay out. One walk over the snapshot's actors;
 * pull it only while the window is open.
 */
export function residentRows(snapshot: WorldSnapshot, ctx: ResidentsProjectionContext): ResidentRow[] {
  let postedTrades = postedTradesByContent.get(ctx.content);
  if (postedTrades === undefined) {
    postedTrades = tradesWithPosts(ctx.content);
    postedTradesByContent.set(ctx.content, postedTrades);
  }
  const nameCtx = { jobs: ctx.content.jobs, mapText: ctx.mapText };
  const rows: ResidentRow[] = [];
  for (const ent of actorsOf(snapshot)) {
    if (!isSettler(ent) || isWildlife(ent) || ownerPlayerOf(ent) !== ctx.localPlayer) continue;
    const jobType = settlerJobType(ent) ?? null;
    const kind = kindOf(ctx.content, ent, jobType);
    const workplace = workplaceOf(ent);
    const workplaceEnt = workplace === undefined ? undefined : entityById(snapshot, workplace);
    const ageTicks = num((ent.components.Age as { ticks?: unknown } | undefined)?.ticks);
    rows.push({
      id: ent.id,
      name: settlerDisplayName(nameCtx, snapshot, ent),
      kind,
      female: isFemale(ent),
      jobType,
      profession: jobDisplayName(nameCtx, jobType ?? undefined),
      ageYears: ageTicks === undefined ? null : Math.floor(ageTicks / systems.TICKS_PER_AGE_YEAR),
      workplace: workplaceEnt === undefined ? '' : buildingTitle(ctx.content, buildingTypeOf(workplaceEnt)),
      lacks: lacksOf(ctx, snapshot, ent, kind, jobType, postedTrades),
    });
  }
  return rows;
}
