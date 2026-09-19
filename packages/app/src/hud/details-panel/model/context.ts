import type { ContentSet } from '@open-northland/data';
import { systems, type TradeOffer, type TraderView } from '@open-northland/sim';
import { localizedBuildingName } from '../../../catalog/building-i18n.js';
import { vikingBuildingByTypeId } from '../../../catalog/buildings.js';
import { professionDefForJob } from '../../../catalog/professions.js';
import { currentLocale, messages, professionLabel } from '../../../i18n/index.js';

export type BuildingDef = ContentSet['buildings'][number];
export type GoodDef = ContentSet['goods'][number];
export type JobDef = ContentSet['jobs'][number];
export type JobExperienceDef = ContentSet['jobExperience'][number];
export type TribeDef = ContentSet['tribes'][number];

export interface UnitPanelModelContext {
  /** The seat allowed to issue player-scoped orders from this panel. */
  readonly localPlayer?: number | undefined;
  readonly goodAllowed?: ((good: number, tribe: number, player?: number) => boolean) | undefined;
  readonly technologyReason?:
    | ((kind: 'job' | 'house' | 'good', typeId: number, tribe: number, player?: number) => string | null)
    | undefined;
  readonly buildings: readonly BuildingDef[];
  readonly goods: readonly GoodDef[];
  /** The content jobs, so the panel can name a bound settler's job even when it is not in the profession
   *  catalog. */
  readonly jobs: readonly JobDef[];
  /** The content experience tracks: a specialization's label and its per-repeat accrual rate. */
  readonly jobExperience: readonly JobExperienceDef[];
  /** The content tribes, whose `needforjob` table the upcoming-unlock rows read. */
  readonly tribes: readonly TribeDef[];
  /** The sim's livestock-workplace classification. Absent = no filtering. */
  readonly isLivestockWorkplace?: ((typeId: number) => boolean) | undefined;
  /** The sim's livestock-good classification: the species goods, whose stock row counts a farm's herd
   *  rather than a ware on a shelf. */
  readonly isLivestockGood?: ((goodType: number) => boolean) | undefined;
  /** The sim's dish→edible mapping: a gatherer's workplace counts as stocking a dish when it slots the
   *  edible, since the deposit converts. Absent = no conversion. */
  readonly edibleGoodForm?: ((goodType: number) => number) | undefined;
  /** The map's own string by id, which names a settler the map or its script named. Absent, or a
   *  missing id, leaves the generated name. */
  readonly mapText?: ((stringId: number) => string | undefined) | undefined;
  /** The sim's trader read seam (`Simulation.traderView`); absent hides the Handel section. */
  readonly traderView?: ((entity: number) => TraderView | undefined) | undefined;
  /** The sim's agreement read seam (`Simulation.tradeOffersAt`); absent lists no offers on a house. */
  readonly tradeOffersAt?: ((house: number) => readonly TradeOffer[]) | undefined;
}

export interface Comp {
  readonly [k: string]: unknown;
}

/** A settler's profession name from the shared profession catalog, so it matches the picker's label;
 *  idle or unknown falls back to the localized idle label. */
function jobLabel(jobType: number | undefined): string {
  const def = professionDefForJob(jobType);
  if (def !== undefined) return professionLabel(def.key);
  return professionLabel('idle');
}

export function buildingDef(ctx: UnitPanelModelContext, typeId: number | undefined): BuildingDef | undefined {
  if (typeId === undefined) return undefined;
  return ctx.buildings.find((b) => b.typeId === typeId);
}

/** A building def's production outputs: its recipes' outputs minus the species goods, which the herd
 *  rows carry instead, else a unit-amount entry per `produces` good, else empty. */
export function recipeOutputs(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
): { goodType: number; amount: number }[] {
  const fromRecipes = (def?.recipes ?? [])
    .flatMap((r) => r.outputs)
    .filter((o) => ctx.isLivestockGood?.(o.goodType) !== true);
  if (fromRecipes.length > 0) return fromRecipes;
  return def?.produces?.map((goodType) => ({ goodType, amount: 1 })) ?? [];
}

export function buildingTitle(ctx: UnitPanelModelContext, typeId: number | undefined): string {
  if (typeId === undefined) return messages().hud.build;
  const catalog = vikingBuildingByTypeId(typeId);
  // The same localized name the build menu shows, falling back to the English catalog label.
  if (catalog !== undefined) return localizedBuildingName(catalog.id, catalog.label, currentLocale());
  return buildingDef(ctx, typeId)?.id ?? `#${typeId}`;
}

export function goodDef(ctx: UnitPanelModelContext, goodType: number): GoodDef | undefined {
  return ctx.goods.find((g) => g.typeId === goodType);
}

/** A good's display name: its localized content `name`, falling back to the machine id on a checkout
 *  without the per-locale good-name table. */
export function goodLabel(ctx: UnitPanelModelContext, goodType: number): string {
  const def = goodDef(ctx, goodType);
  return def?.name ?? def?.id ?? `#${goodType}`;
}

/**
 * A job's display name, shared by the worker-slot rows and a settler's profession title. Life-stage roles
 * (baby/child/woman/civilist, not picker professions) are keyed by the content job's string id through
 * the locale catalog. Every hero role is shown as the generic profession "Hero": maps reuse one hero
 * body for different named characters, so the job id is not a reliable personal name.
 */
export function jobDisplayName(ctx: UnitPanelModelContext, jobType: number | undefined): string {
  if (jobType === undefined) return jobLabel(undefined);
  if (professionDefForJob(jobType) !== undefined) return jobLabel(jobType);
  const job = ctx.jobs.find((j) => j.typeId === jobType);
  const stages: Readonly<Record<string, string | undefined>> = messages().lifeStage;
  const stage = job?.id !== undefined ? stages[job.id] : undefined;
  const hero = job !== undefined && systems.isHeroJobRow(job) ? messages().heroNames.hero_unarmed : undefined;
  return stage ?? hero ?? job?.name ?? jobLabel(jobType);
}

/**
 * A hero's conventional name when no map-authored name exists. This is only a fallback: mission maps
 * reuse the same visual/job role for Ykol, Loke and Hatchie, and their `ScriptedName` must win.
 */
export function heroFallbackName(
  ctx: UnitPanelModelContext,
  jobType: number | undefined,
): string | undefined {
  const job = ctx.jobs.find((j) => j.typeId === jobType);
  if (job === undefined || !systems.isHeroJobRow(job)) return undefined;
  const heroes: Readonly<Record<string, string | undefined>> = messages().heroNames;
  return heroes[job.id];
}

/** Whether a job slot is the transport trade, decided by the sim's own carrier rule over the panel's
 *  content slice so the HUD cannot classify it differently. */
export function isCarrierJob(ctx: UnitPanelModelContext, jobType: number): boolean {
  const job = ctx.jobs.find((j) => j.typeId === jobType);
  return job !== undefined && systems.isCarrierJobRow(job);
}
