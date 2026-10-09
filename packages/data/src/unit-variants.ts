import type { UnitVariant } from './schema/actors/tribes.js';
import type { ContentSet } from './schema/content/content-set.js';

export interface UnitIdentity {
  readonly tribe: number;
  readonly jobType: number | null;
  readonly scenario?: boolean | undefined;
}

type VariantTable = Map<number, Map<number, readonly UnitVariant[]>>;
const tables = new WeakMap<ContentSet, VariantTable>();

/** Shared selection for combat, movement, health and animation. A controller flag never enters it. */
export function unitVariantFor(content: ContentSet, unit: UnitIdentity): UnitVariant | undefined {
  if (unit.jobType === null) return undefined;
  let table = tables.get(content);
  if (table === undefined) {
    table = new Map();
    for (const tribe of content.tribes) {
      const jobs = new Map<number, UnitVariant[]>();
      for (const rule of tribe.unitVariants ?? []) {
        const rows = jobs.get(rule.jobType) ?? [];
        rows.push(rule);
        jobs.set(rule.jobType, rows);
      }
      table.set(tribe.typeId, jobs);
    }
    tables.set(content, table);
  }
  return table
    .get(unit.tribe)
    ?.get(unit.jobType)
    ?.find((rule) => rule.scenario === (unit.scenario === true));
}
