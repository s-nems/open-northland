export * from './schema.js';

import { ContentSet, type GoodType, type BuildingType, type JobType } from './schema.js';

/**
 * Parse + validate a content set (typically the contents of content/ assembled into one object).
 * Throws a zod error with a readable path if anything is malformed.
 */
export function parseContentSet(raw: unknown): ContentSet {
  const set = ContentSet.parse(raw);
  validateCrossReferences(set);
  return set;
}

/**
 * Ensure every numeric type id referenced by buildings/recipes resolves to a defined type.
 * Catches dangling references at load time rather than as a runtime crash mid-game.
 */
export function validateCrossReferences(set: ContentSet): void {
  const goodIds = new Set(set.goods.map((g) => g.typeId));
  const jobIds = new Set(set.jobs.map((j) => j.typeId));
  const errors: string[] = [];

  for (const b of set.buildings) {
    for (const w of b.workers) {
      if (!jobIds.has(w.jobType)) errors.push(`building "${b.id}" references unknown jobType ${w.jobType}`);
    }
    for (const s of b.stock) {
      if (!goodIds.has(s.goodType)) errors.push(`building "${b.id}" references unknown goodType ${s.goodType}`);
    }
    if (b.recipe) {
      for (const io of [...b.recipe.inputs, ...b.recipe.outputs]) {
        if (!goodIds.has(io.goodType)) errors.push(`building "${b.id}" recipe references unknown goodType ${io.goodType}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Content cross-reference validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

/** Lookup helpers — build maps once, index many times. */
export function indexById<T extends { typeId: number }>(items: readonly T[]): ReadonlyMap<number, T> {
  return new Map(items.map((i) => [i.typeId, i]));
}

export type { GoodType, BuildingType, JobType };
