import { resolveJobAtomics } from '@open-northland/data';
import { entityById, TICKS_PER_SECOND, type WorldSnapshot } from '@open-northland/sim';
import { num, settlerLearnedOf } from '../../../game/snapshot.js';
import { technologyLabel } from '../../../game/technology.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import {
  buildingDef,
  buildingTitle,
  type Comp,
  goodDef,
  goodLabel,
  isCarrierJob,
  PRODUCTION_UNLIMITED,
  type UnitPanelModelContext,
} from './context.js';
import { goodExperienceLock } from './settler-unlocks.js';

/** Where the settler works: a building the link selects, or a place with no building (a work flag). */
export interface SettlerPlace {
  readonly id: number | null;
  readonly label: string;
}

/** One product row: a good the trade may make or gather here. */
export interface SettlerProductionRow {
  readonly goodType: number;
  readonly goodId?: string;
  readonly label: string;
  /** Why the settler may not make it yet (the tooltip of its lock), null once earned. */
  readonly locked: string | null;
  /** The product's counter, 0..`PRODUCTION_UNLIMITED`, for a crafted and a gathered good alike. */
  readonly count: number;
}

/** The Produkcja section: a craft operator's products in recipe order, or a gatherer's goods in catalog
 *  order, each with its counter. */
export interface SettlerProductionModel {
  readonly kind: 'craft' | 'gather';
  readonly rows: readonly SettlerProductionRow[];
}

export interface SettlerWorkModel {
  readonly place: SettlerPlace | null;
  readonly production: SettlerProductionModel | null;
  /** A lesson in progress, which the status line names. */
  readonly lesson: string | null;
}

const NO_WORK: SettlerWorkModel = { place: null, production: null, lesson: null };

const HIDDEN = Symbol('hidden');
/** The per-good gate both product lists share: hidden while the mission forbids the good, else locked
 *  with the reason, else open. */
type GoodGate = (goodType: number) => string | null | typeof HIDDEN;

/**
 * The settler's place of work and what it makes there. A gatherer's goods follow the sim's forage
 * filter (what the workplace stocks, a good's edible form counting too), a craft operator's the
 * workplace's recipes; a product not yet earned stays listed with the reason it is locked.
 */
export function settlerWork(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  comps: Comp,
  progressionGated: boolean,
): SettlerWorkModel {
  const training = comps.TrainingOrder as
    | { house?: unknown; drillTicksLeft?: number; lesson?: { kind: 'job' | 'good'; typeId: number } }
    | undefined;
  if (training?.lesson !== undefined) {
    const house = num(training.house);
    const houseType = num(
      (entityById(snapshot, house ?? -1)?.components.Building as { buildingType?: unknown } | undefined)
        ?.buildingType,
    );
    return {
      place: {
        id: house ?? null,
        label: houseType === undefined ? messages().hud.schoolTitle : buildingTitle(ctx, houseType),
      },
      production: null,
      lesson: formatMessage(messages().hud.schoolProgress, {
        target: technologyLabel(ctx, training.lesson.kind, training.lesson.typeId),
        seconds: Math.ceil(Math.max(0, training.drillTicksLeft ?? 0) / TICKS_PER_SECOND),
      }),
    };
  }
  const settlerComp = comps.Settler as { tribe?: unknown; jobType?: unknown } | undefined;
  const jobType = num(settlerComp?.jobType);
  const tribe = num(settlerComp?.tribe) ?? 0;
  const owner = num((comps.Owner as { player?: unknown } | undefined)?.player);
  const learned = settlerLearnedOf(comps, 'good');
  const experienceGate: GoodGate = (goodType) => {
    if (!(ctx.goodAllowed?.(goodType, tribe, owner) ?? true)) return HIDDEN;
    if (learned.includes(goodType)) return null;
    return goodExperienceLock(ctx, comps, progressionGated, goodType);
  };
  const counters = productionCounters(comps);
  // A trade the player cannot set the production of (the hunter) lists no products: the sim ignores
  // its counters, so a row would promise a choice that changes nothing.
  const chooses = ctx.jobs.find((job) => job.typeId === jobType)?.changesProduction !== false;

  if (comps.WorkFlag !== undefined) {
    const goods = harvestableGoodsFor(ctx, jobType);
    return {
      place: { id: null, label: messages().hud.workFlag },
      production: chooses ? gatherProduction(ctx, goods, experienceGate, counters) : null,
      lesson: null,
    };
  }
  const siteAssignment = comps.SiteAssignment as { site?: unknown; pinned?: unknown } | undefined;
  const pinnedSiteId = siteAssignment?.pinned === true ? num(siteAssignment.site) : undefined;
  const pinnedType = num(
    (entityById(snapshot, pinnedSiteId ?? -1)?.components.Building as { buildingType?: unknown } | undefined)
      ?.buildingType,
  );
  if (pinnedSiteId !== undefined && pinnedType !== undefined) {
    return {
      place: { id: pinnedSiteId, label: buildingTitle(ctx, pinnedType) },
      production: null,
      lesson: null,
    };
  }
  const workplaceId = num((comps.JobAssignment as { workplace?: unknown } | undefined)?.workplace);
  if (workplaceId === undefined) return NO_WORK;
  const rawType = num(
    (entityById(snapshot, workplaceId)?.components.Building as { buildingType?: unknown } | undefined)
      ?.buildingType,
  );
  const def = buildingDef(ctx, rawType);
  const place: SettlerPlace = { id: workplaceId, label: buildingTitle(ctx, rawType) };
  if (!chooses) return { place, production: null, lesson: null };
  // The gather list wins over the craft list: such a job runs the sim's gather drive, never the craft
  // loop.
  const harvestable = harvestableGoodsFor(ctx, jobType);
  if (harvestable.length > 0) {
    const stored = new Set((def?.stock ?? []).map((slot) => slot.goodType));
    const stocked = harvestable.filter(
      (good) => stored.has(good.typeId) || stored.has(ctx.edibleGoodForm?.(good.typeId) ?? good.typeId),
    );
    const production = gatherProduction(ctx, stocked, experienceGate, counters);
    if (production !== null) return { place, production, lesson: null };
  }
  const craftGate: GoodGate = (goodType) => {
    const gate = experienceGate(goodType);
    if (gate === HIDDEN) return HIDDEN;
    return ctx.technologyReason?.('good', goodType, tribe, owner) ?? gate;
  };
  return { place, production: craftProduction(ctx, def, jobType, counters, craftGate), lesson: null };
}

type GoodEntry = UnitPanelModelContext['goods'][number];

/** The non-farmed goods `jobType` may harvest, in goods-catalog order. Shares `resolveJobAtomics` with
 *  the sim's permission gate, so the list cannot offer what the planner would refuse. */
function harvestableGoodsFor(ctx: UnitPanelModelContext, jobType: number | undefined): GoodEntry[] {
  if (jobType === undefined) return [];
  const allowed = resolveJobAtomics(ctx.jobs).get(jobType);
  if (allowed === undefined) return [];
  return ctx.goods.filter(
    (good) =>
      good.farming === undefined && good.atomics.harvest !== undefined && allowed.has(good.atomics.harvest),
  );
}

function productRow(
  ctx: UnitPanelModelContext,
  goodType: number,
  locked: string | null,
  count: number,
): SettlerProductionRow {
  const id = goodDef(ctx, goodType)?.id;
  return {
    goodType,
    label: goodLabel(ctx, goodType),
    locked,
    count,
    ...(id !== undefined ? { goodId: id } : {}),
  };
}

/** A gatherer's goods with their counters (a good without an entry never stops), or null for none. */
function gatherProduction(
  ctx: UnitPanelModelContext,
  goods: readonly GoodEntry[],
  gate: GoodGate,
  counters: ReadonlyMap<number, number>,
): SettlerProductionModel | null {
  const rows = goods.flatMap((good) => {
    const locked = gate(good.typeId);
    if (locked === HIDDEN) return [];
    return [productRow(ctx, good.typeId, locked, counters.get(good.typeId) ?? PRODUCTION_UNLIMITED)];
  });
  return rows.length === 0 ? null : { kind: 'gather', rows };
}

/**
 * A craft operator's products with their counters, or null when there is nothing to choose. Operator
 * slots follow the sim's `operatorJobsOf`: worker slots minus the carrier transport slot, unless every
 * slot is a carrier one, when the carrier does choose. A product missing from `ProductionCounters`
 * never stops, as does every product of an operator without the component.
 */
function craftProduction(
  ctx: UnitPanelModelContext,
  def: ReturnType<typeof buildingDef>,
  jobType: number | undefined,
  counters: ReadonlyMap<number, number>,
  gate: GoodGate,
): SettlerProductionModel | null {
  if (def === undefined || def.recipes.length === 0 || jobType === undefined) return null;
  const operatorSlots = def.workers.filter((slot) => !isCarrierJob(ctx, slot.jobType));
  const operators = operatorSlots.length > 0 ? operatorSlots : def.workers;
  if (!operators.some((slot) => slot.jobType === jobType)) return null;
  const rows = def.recipes.flatMap((recipe) => {
    const goodType = recipe.outputs[0]?.goodType;
    if (goodType === undefined) return [];
    const locked = gate(goodType);
    if (locked === HIDDEN) return [];
    return [productRow(ctx, goodType, locked, counters.get(goodType) ?? PRODUCTION_UNLIMITED)];
  });
  return rows.length === 0 ? null : { kind: 'craft', rows };
}

/** `ProductionCounters.counters` as the snapshot serializes it: [goodType, count] pairs. */
function productionCounters(comps: Comp): ReadonlyMap<number, number> {
  const raw = (comps.ProductionCounters as { counters?: unknown } | undefined)?.counters;
  const counters = new Map<number, number>();
  if (!Array.isArray(raw)) return counters;
  for (const pair of raw) {
    if (!Array.isArray(pair)) continue;
    const goodType = num(pair[0]);
    const count = num(pair[1]);
    if (goodType !== undefined && count !== undefined) counters.set(goodType, count);
  }
  return counters;
}
