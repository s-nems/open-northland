import type { ContentSet } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import { localizedBuildingName } from '../../../catalog/building-i18n.js';
import { vikingBuildingByTypeId } from '../../../catalog/buildings.js';
import { professionDefForJob } from '../../../catalog/professions.js';
import { currentLocale, messages, professionLabel } from '../../../i18n/index.js';

/**
 * The shared context both panel-model halves resolve names through: the content sets the panel was built
 * with, plus the building/good/job def + display-label lookups over them. Keeping these in one place lets
 * a settler's profession label and a building's worker-slot label resolve identically, so they never drift.
 */

export type BuildingDef = ContentSet['buildings'][number];
export type GoodDef = ContentSet['goods'][number];
export type JobDef = ContentSet['jobs'][number];
export type JobExperienceDef = ContentSet['jobExperience'][number];
export type TribeDef = ContentSet['tribes'][number];

export interface UnitPanelModelContext {
  readonly buildings: readonly BuildingDef[];
  readonly goods: readonly GoodDef[];
  /** The content jobs — the worker-row labels resolve a bound settler's job name from here (a building's
   *  worker vs carrier slots), so the panel names them even when they're not in the profession catalog. */
  readonly jobs: readonly JobDef[];
  /** The content experience tracks — the Doświadczenie rows resolve a specialization's label (its good
   *  or owning job) and its per-repeat accrual rate from here. */
  readonly jobExperience: readonly JobExperienceDef[];
  /** The content tribes — the Doświadczenie section's upcoming-unlock rows read a settler tribe's
   *  `needforjob` requirement table from here. */
  readonly tribes: readonly TribeDef[];
  /** The sim's livestock-workplace classification (`isLivestockWorkplaceType`), so the panel hides the
   *  slaughter recipe the sim's recipe table drops there. Absent = no filtering (tests, plain views). */
  readonly isLivestockWorkplace?: ((typeId: number) => boolean) | undefined;
  /** The sim's livestock-good classification (`livestockTribeOfGood`): the internal fed-animal token
   *  goods, hidden from every player-facing list (stock rows, product rows, craft toggles). */
  readonly isLivestockGood?: ((goodType: number) => boolean) | undefined;
  /** The meat byproduct good every completed feed batch lands (`livestockMeatGoodOf`) - the second
   *  icon of a livestock chain row; null/absent without one in content. */
  readonly livestockMeatGood?: number | null | undefined;
}

export interface Comp {
  readonly [k: string]: unknown;
}

/**
 * A settler's profession name for the panel — resolved through the shared profession catalog + i18n
 * (`catalog/professions.ts` + `i18n/`), so a settler's label always matches the picker's. Any soldier-band
 * job reads "Żołnierz"; idle/unknown falls back to the localized "Cywil".
 */
function jobLabel(jobType: number | undefined): string {
  const def = professionDefForJob(jobType);
  if (def !== undefined) return professionLabel(def.key);
  return professionLabel('idle');
}

export function buildingDef(ctx: UnitPanelModelContext, typeId: number | undefined): BuildingDef | undefined {
  if (typeId === undefined) return undefined;
  return ctx.buildings.find((b) => b.typeId === typeId);
}

/** A building def's recipes minus the slaughter production the sim drops at a livestock workplace
 *  (the `isLivestockWorkplace` seam mirrors the sim's recipe table, `core/content-index/production.ts`)
 *  - so no panel row shows a production bar that no cycle can ever move. */
export function visibleRecipes(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
): BuildingDef['recipes'] {
  const recipes = def?.recipes ?? [];
  if (def === undefined || ctx.isLivestockWorkplace?.(def.typeId) !== true) return recipes;
  return recipes.filter((r) => r.inputs.length > 0);
}

/** A building def's production outputs: one line per per-product recipe (its first output), minus the
 *  internal fed-animal tokens (`isLivestockGood` - a chain's real products are its converter's wares),
 *  else a unit-amount entry per `produces` good, else empty - the one source the settler Praca product
 *  and the building Produkcja list must agree on. */
export function recipeOutputs(
  ctx: UnitPanelModelContext,
  def: BuildingDef | undefined,
): { goodType: number; amount: number }[] {
  const fromRecipes = visibleRecipes(ctx, def)
    .flatMap((r) => r.outputs)
    .filter((o) => ctx.isLivestockGood?.(o.goodType) !== true);
  if (fromRecipes.length > 0) return fromRecipes;
  return def?.produces?.map((goodType) => ({ goodType, amount: 1 })) ?? [];
}

export function buildingTitle(ctx: UnitPanelModelContext, typeId: number | undefined): string {
  if (typeId === undefined) return messages().hud.build;
  const catalog = vikingBuildingByTypeId(typeId);
  // The panel title reads the same localized name the build menu shows (catalog/building-i18n.ts —
  // "Farma", "Chata"), falling back to the English catalog label for a building not yet localized.
  if (catalog !== undefined) return localizedBuildingName(catalog.id, catalog.label, currentLocale());
  return buildingDef(ctx, typeId)?.id ?? `#${typeId}`;
}

export function goodDef(ctx: UnitPanelModelContext, goodType: number): GoodDef | undefined {
  return ctx.goods.find((g) => g.typeId === goodType);
}

/** A good's display name: its localized content `name` (the pipeline's per-locale good-name table,
 *  loaded by the browser entries — "Mąka"), falling back to the machine id on a bare checkout. */
export function goodLabel(ctx: UnitPanelModelContext, goodType: number): string {
  const def = goodDef(ctx, goodType);
  return def?.name ?? def?.id ?? `#${goodType}`;
}

/**
 * A job's display name — shared by a building's worker-slot rows and a settler's own profession title, so
 * the two never drift. The shared profession catalog + i18n names a known job (a gatherer → "Zbieracz
 * drewna", carrier → "Tragarz"); the life-stage roles (baby/child/woman/civilist — not picker
 * professions) resolve by their content job SLUG through `messages().lifeStage`; a trade the catalog
 * doesn't carry (a rebased building slot like "Cieśla"/"Druid" — a bound settler's `jobType` is that same
 * rebased id) falls back to its content job name, then to the localized idle label. `undefined` (an
 * unbound settler) resolves to the idle label.
 */
export function jobDisplayName(ctx: UnitPanelModelContext, jobType: number | undefined): string {
  if (jobType === undefined) return jobLabel(undefined);
  if (professionDefForJob(jobType) !== undefined) return jobLabel(jobType);
  const job = ctx.jobs.find((j) => j.typeId === jobType);
  const stages: Readonly<Record<string, string | undefined>> = messages().lifeStage;
  const stage = job?.id !== undefined ? stages[job.id] : undefined;
  return stage ?? job?.name ?? jobLabel(jobType);
}

/** Whether a job slot is the transport trade — the sim's own carrier rule ({@link systems.isCarrierJobRow}),
 *  read over the panel's content slice so the HUD cannot classify it differently. */
export function isCarrierJob(ctx: UnitPanelModelContext, jobType: number): boolean {
  const job = ctx.jobs.find((j) => j.typeId === jobType);
  return job !== undefined && systems.isCarrierJobRow(job);
}
