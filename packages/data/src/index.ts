export * from './schema.js';

import { type BuildingType, ContentSet, type GoodType, type JobType, TerrainMapFile } from './schema.js';

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
 * Parse + validate one decoded terrain grid file (`content/maps/<id>.json`) into the structural
 * `TerrainMap` the sim consumes. This is the loader boundary: the build tool / app reads the JSON
 * (I/O — not allowed in the pure sim) and validates the shape + the `typeIds.length === width*height`
 * invariant here, so a malformed file fails loudly at load rather than as an out-of-bounds read in
 * `buildTerrainGraph`. The returned value is structurally a sim `TerrainMap` and feeds straight into
 * `new Simulation({ map })` / `scenario(content, { map })` in place of a synthetic grid. Throws a zod
 * error with a readable path on a malformed file.
 */
export function parseTerrainMap(raw: unknown): TerrainMapFile {
  return TerrainMapFile.parse(raw);
}

/**
 * Ensure every numeric type id referenced by buildings/recipes resolves to a defined type.
 * Catches dangling references at load time rather than as a runtime crash mid-game.
 */
export function validateCrossReferences(set: ContentSet): void {
  const goodIds = new Set(set.goods.map((g) => g.typeId));
  const jobIds = new Set(set.jobs.map((j) => j.typeId));
  const errors: string[] = [];

  // A good's production inputs (`productionInputGoods`) name other goods consumed to make it.
  for (const g of set.goods) {
    for (const inp of g.productionInputs) {
      if (!goodIds.has(inp.goodType))
        errors.push(`good "${g.id}" consumes unknown input goodType ${inp.goodType}`);
    }
  }

  for (const b of set.buildings) {
    for (const w of b.workers) {
      if (!jobIds.has(w.jobType)) errors.push(`building "${b.id}" references unknown jobType ${w.jobType}`);
    }
    for (const s of b.stock) {
      if (!goodIds.has(s.goodType))
        errors.push(`building "${b.id}" references unknown goodType ${s.goodType}`);
    }
    for (const g of b.produces) {
      if (!goodIds.has(g)) errors.push(`building "${b.id}" produces unknown goodType ${g}`);
    }
    if (b.recipe) {
      for (const io of [...b.recipe.inputs, ...b.recipe.outputs]) {
        if (!goodIds.has(io.goodType))
          errors.push(`building "${b.id}" recipe references unknown goodType ${io.goodType}`);
      }
    }
  }

  // Each tribe's `setatomic` binding names the job it applies to; that job must exist. (Atomic ids
  // themselves have no master table to resolve against — see AtomicId — so only jobType is checked.)
  for (const t of set.tribes) {
    for (const b of t.atomicBindings) {
      if (!jobIds.has(b.jobType))
        errors.push(`tribe "${t.id}" binds atomic ${b.atomicId} to unknown jobType ${b.jobType}`);
    }
  }

  // A weapon's wielding job, when set, must resolve too (same dangling-reference class).
  for (const w of set.weapons) {
    if (w.jobType !== undefined && !jobIds.has(w.jobType))
      errors.push(`weapon "${w.id}" references unknown jobType ${w.jobType}`);
  }

  // Each experience track names its owning job (always) and, when good-specific, the good it trains on.
  for (const x of set.jobExperience) {
    if (!jobIds.has(x.jobType))
      errors.push(`jobExperience "${x.id}" references unknown jobType ${x.jobType}`);
    if (x.goodType !== undefined && !goodIds.has(x.goodType))
      errors.push(`jobExperience "${x.id}" references unknown goodType ${x.goodType}`);
  }

  if (errors.length > 0) {
    throw new Error(`Content cross-reference validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

/** Lookup helpers — build maps once, index many times. */
export function indexById<T extends { typeId: number }>(items: readonly T[]): ReadonlyMap<number, T> {
  return new Map(items.map((i) => [i.typeId, i]));
}
