import type { ContentSet } from '@open-northland/data';
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

export interface UnitPanelModelContext {
  readonly buildings: readonly BuildingDef[];
  readonly goods: readonly GoodDef[];
  /** The content jobs — the worker-row labels resolve a bound settler's job name from here (a building's
   *  worker vs carrier slots), so the panel names them even when they're not in the profession catalog. */
  readonly jobs: readonly JobDef[];
}

export interface Comp {
  readonly [k: string]: unknown;
}

/**
 * A settler's profession name for the panel — resolved through the shared profession catalog + i18n
 * (`catalog/professions.ts` + `i18n/`), so a settler's label always matches the picker's. Any soldier-band
 * job reads "Żołnierz"; idle/unknown falls back to the localized "Bezrobotny".
 */
export function jobLabel(jobType: number | undefined): string {
  const def = professionDefForJob(jobType);
  if (def !== undefined) return professionLabel(def.key);
  return professionLabel('idle');
}

export function buildingDef(ctx: UnitPanelModelContext, typeId: number | undefined): BuildingDef | undefined {
  if (typeId === undefined) return undefined;
  return ctx.buildings.find((b) => b.typeId === typeId);
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
 * drewna", carrier → "Tragarz"); a trade the catalog doesn't carry (a rebased building slot like
 * "Cieśla"/"Druid" — a bound settler's `jobType` is that same rebased id) falls back to its content job
 * name, then to the localized idle label. `undefined` (an unbound settler) resolves to the idle label.
 */
export function jobDisplayName(ctx: UnitPanelModelContext, jobType: number | undefined): string {
  if (jobType === undefined) return jobLabel(undefined);
  return professionDefForJob(jobType) !== undefined
    ? jobLabel(jobType)
    : (ctx.jobs.find((j) => j.typeId === jobType)?.name ?? jobLabel(jobType));
}
