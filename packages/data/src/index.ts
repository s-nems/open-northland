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
    for (const c of b.construction) {
      if (!goodIds.has(c.goodType))
        errors.push(`building "${b.id}" construction needs unknown goodType ${c.goodType}`);
    }
    if (b.recipe) {
      for (const io of [...b.recipe.inputs, ...b.recipe.outputs]) {
        if (!goodIds.has(io.goodType))
          errors.push(`building "${b.id}" recipe references unknown goodType ${io.goodType}`);
      }
    }
  }

  const buildingIds = new Set(set.buildings.map((b) => b.typeId));
  const vehicleIds = new Set(set.vehicles.map((v) => v.typeId));

  // Each tribe's `setatomic` binding names the job it applies to; that job must exist. (Atomic ids
  // themselves have no master table to resolve against — see AtomicId — so only jobType is checked.)
  for (const t of set.tribes) {
    for (const b of t.atomicBindings) {
      if (!jobIds.has(b.jobType))
        errors.push(`tribe "${t.id}" binds atomic ${b.atomicId} to unknown jobType ${b.jobType}`);
    }
    // Each `jobEnables*` tech-graph edge: the enabling `jobType` must resolve, and so must its
    // `targetId` within the kind's table — a good, a building (`house`), a job, or a vehicle. The
    // `vehicle` kind keys into the `vehicletypes` `type` (`logicvehicletype`) namespace — distinct
    // from buildings — which the `vehicles` table now extracts (`VehicleType.typeId`), so it is
    // resolvable: the real `jobEnablesVehicle` ids (1..5) are a subset of the vehicle typeIds (1..6).
    for (const e of t.jobEnables) {
      if (!jobIds.has(e.jobType))
        errors.push(`tribe "${t.id}" jobEnables-edge has unknown jobType ${e.jobType}`);
      if (e.kind === 'good' && !goodIds.has(e.targetId))
        errors.push(`tribe "${t.id}" job ${e.jobType} enables unknown goodType ${e.targetId}`);
      if (e.kind === 'house' && !buildingIds.has(e.targetId))
        errors.push(`tribe "${t.id}" job ${e.jobType} enables unknown buildingType ${e.targetId}`);
      if (e.kind === 'job' && !jobIds.has(e.targetId))
        errors.push(`tribe "${t.id}" job ${e.jobType} enables unknown jobType ${e.targetId}`);
      if (e.kind === 'vehicle' && !vehicleIds.has(e.targetId))
        errors.push(`tribe "${t.id}" job ${e.jobType} enables unknown vehicleType ${e.targetId}`);
    }
    // Each `{need,train}for{job,good}` requirement: its `targetId` resolves within the `target`
    // table (a job or a good). The `experienceTypes` are NOT checked: they span an id space wider
    // than the extracted `humanjobexperiencetypes` table (observed need-ids 72/73/75 and the
    // synthetic "school" markers 57/77 for `train`), so resolving them would false-positive — same
    // stance as the `vehicle` jobEnables kind above.
    for (const r of t.jobRequirements) {
      if (r.target === 'job' && !jobIds.has(r.targetId))
        errors.push(`tribe "${t.id}" ${r.requirement}forjob requires unknown jobType ${r.targetId}`);
      if (r.target === 'good' && !goodIds.has(r.targetId))
        errors.push(`tribe "${t.id}" ${r.requirement}forgood requires unknown goodType ${r.targetId}`);
    }
  }

  // A weapon's wielding job, when set, must resolve too (same dangling-reference class).
  for (const w of set.weapons) {
    if (w.jobType !== undefined && !jobIds.has(w.jobType))
      errors.push(`weapon "${w.id}" references unknown jobType ${w.jobType}`);
  }

  // An armor's `goodType` (the good that IS the armor), when set, must resolve into the good table.
  for (const a of set.armor) {
    if (a.goodType !== undefined && !goodIds.has(a.goodType))
      errors.push(`armor "${a.id}" references unknown goodType ${a.goodType}`);
  }

  // An animal record keys on `tribeType` (not `type`) — its identity is its owning tribe — so that id
  // must resolve into the tribe table (the same dangling-reference class). The extractor already drops
  // records with no `tribetype` at all, so every animal here carries one to check.
  const tribeIds = new Set(set.tribes.map((t) => t.typeId));
  for (const a of set.animals) {
    if (!tribeIds.has(a.tribeType))
      errors.push(`animal "${a.id}" references unknown tribeType ${a.tribeType}`);
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
