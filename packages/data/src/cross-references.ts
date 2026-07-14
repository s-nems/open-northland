import { type ContentSet, LOGIC_TYPE_NONE } from './schema/index.js';

/**
 * Ensure every numeric type id referenced by buildings/recipes resolves to a defined type.
 * Catches dangling references at load time rather than as a runtime crash mid-game.
 *
 * The work is split into one `check*` per entity family, each taking the prebuilt id-sets so every
 * rule reads independently. The families run in a fixed order and append to one shared list — the
 * order the emitted error report is asserted in (`test/cross-references.test.ts`), so keep it stable.
 */
export function validateCrossReferences(set: ContentSet): void {
  const ids = buildIdSets(set);
  const errors: string[] = [
    ...checkGoodProduction(set, ids),
    ...checkBuildings(set, ids),
    ...checkTribes(set, ids),
    ...checkWeaponsAndArmor(set, ids),
    ...checkAnimals(set, ids),
    ...checkLandscapeGfx(set, ids),
    ...checkGoodLandscape(set, ids),
    ...checkGatheringPipeline(set, ids),
    ...checkTerrainPatterns(set, ids),
    ...checkJobExperience(set, ids),
  ];

  if (errors.length > 0) {
    throw new Error(`Content cross-reference validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

/** The id-sets every `check*` resolves references against, built once from the set. */
interface IdSets {
  readonly goodIds: ReadonlySet<number>;
  readonly jobIds: ReadonlySet<number>;
  readonly buildingIds: ReadonlySet<number>;
  readonly vehicleIds: ReadonlySet<number>;
  readonly tribeIds: ReadonlySet<number>;
  readonly landscapeIds: ReadonlySet<number>;
  /** The actual `.index` values of the gfx table (not its length) — holds even if it is ever
   *  filtered/reordered while keeping original indices. */
  readonly landscapeGfxIndices: ReadonlySet<number>;
}

function buildIdSets(set: ContentSet): IdSets {
  return {
    goodIds: new Set(set.goods.map((g) => g.typeId)),
    jobIds: new Set(set.jobs.map((j) => j.typeId)),
    buildingIds: new Set(set.buildings.map((b) => b.typeId)),
    vehicleIds: new Set(set.vehicles.map((v) => v.typeId)),
    tribeIds: new Set(set.tribes.map((t) => t.typeId)),
    landscapeIds: new Set(set.landscape.map((l) => l.typeId)),
    landscapeGfxIndices: new Set(set.landscapeGfx.map((g) => g.index)),
  };
}

// A good's production inputs (`productionInputGoods`) name other goods consumed to make it.
function checkGoodProduction(set: ContentSet, { goodIds }: IdSets): string[] {
  const errors: string[] = [];
  for (const g of set.goods) {
    for (const inp of g.productionInputs) {
      if (!goodIds.has(inp.goodType))
        errors.push(`good "${g.id}" consumes unknown input goodType ${inp.goodType}`);
    }
  }
  return errors;
}

function checkBuildings(set: ContentSet, { goodIds, jobIds }: IdSets): string[] {
  const errors: string[] = [];
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
  return errors;
}

function checkTribes(set: ContentSet, { goodIds, jobIds, buildingIds, vehicleIds }: IdSets): string[] {
  const errors: string[] = [];
  for (const t of set.tribes) {
    // Each tribe's `setatomic` binding names the job it applies to; that job must exist. (Atomic ids
    // themselves have no master table to resolve against — see AtomicId — so only jobType is checked.)
    for (const b of t.atomicBindings) {
      if (!jobIds.has(b.jobType))
        errors.push(`tribe "${t.id}" binds atomic ${b.atomicId} to unknown jobType ${b.jobType}`);
    }
    // Each `jobEnables*` tech-graph edge: the enabling `jobType` must resolve, and so must its
    // `targetId` within the kind's table — a good, a building (`house`), a job, or a vehicle. The
    // `vehicle` kind keys into the `vehicletypes` `logicvehicletype` namespace (distinct from
    // buildings), resolved against `VehicleType.typeId`.
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
    // table (a job or a good). The `experienceTypes` are not checked: they span an id space wider
    // than the extracted `humanjobexperiencetypes` table (observed need-ids 72/73/75 and the
    // synthetic "school" markers 57/77 for `train`), so resolving them would false-positive.
    for (const r of t.jobRequirements) {
      if (r.target === 'job' && !jobIds.has(r.targetId))
        errors.push(`tribe "${t.id}" ${r.requirement}forjob requires unknown jobType ${r.targetId}`);
      if (r.target === 'good' && !goodIds.has(r.targetId))
        errors.push(`tribe "${t.id}" ${r.requirement}forgood requires unknown goodType ${r.targetId}`);
    }
  }
  return errors;
}

function checkWeaponsAndArmor(set: ContentSet, { goodIds, jobIds }: IdSets): string[] {
  const errors: string[] = [];
  // A weapon's wielding job, when set, must resolve too. Its `goodType` (the good that is the weapon)
  // likewise resolves into the good table — the extractor already drops the `goodtype 0`
  // natural-weapon sentinel to undefined.
  for (const w of set.weapons) {
    if (w.jobType !== undefined && !jobIds.has(w.jobType))
      errors.push(`weapon "${w.id}" references unknown jobType ${w.jobType}`);
    if (w.goodType !== undefined && !goodIds.has(w.goodType))
      errors.push(`weapon "${w.id}" references unknown goodType ${w.goodType}`);
  }
  // An armor's `goodType` (the good that is the armor), when set, must resolve into the good table.
  for (const a of set.armor) {
    if (a.goodType !== undefined && !goodIds.has(a.goodType))
      errors.push(`armor "${a.id}" references unknown goodType ${a.goodType}`);
  }
  return errors;
}

// An animal record keys on `tribeType` (not `type`) — its identity is its owning tribe — so that id
// must resolve into the tribe table (the same dangling-reference class). The extractor already drops
// records with no `tribetype` at all, so every animal here carries one to check.
function checkAnimals(set: ContentSet, { tribeIds }: IdSets): string[] {
  const errors: string[] = [];
  for (const a of set.animals) {
    if (!tribeIds.has(a.tribeType))
      errors.push(`animal "${a.id}" references unknown tribeType ${a.tribeType}`);
  }
  return errors;
}

// A landscape object's `LogicType`, when set, must resolve into the landscape type table — the
// placed object counts as that type on the map's logic lanes (every real record carries 1..87;
// LOGIC_TYPE_NONE is the schema's "pure decor" default for a record that omits the key).
function checkLandscapeGfx(set: ContentSet, { landscapeIds }: IdSets): string[] {
  const errors: string[] = [];
  for (const g of set.landscapeGfx) {
    if (g.logicType !== LOGIC_TYPE_NONE && !landscapeIds.has(g.logicType))
      errors.push(
        `landscapeGfx "${g.editName ?? `#${g.index}`}" references unknown landscape typeId ${g.logicType}`,
      );
  }
  return errors;
}

// A good's landscape references — its `landscapetype` on-the-ground lane and the three
// gathering-stage ids — must resolve into the landscape type table (the same dangling-reference
// class as landscapeGfx). Every real good carries a defined `landscapetype`; only the ~11
// map-gathered goods carry a `gathering` chain.
/** The three ordered stages of a good's gathering chain — the keys both gathering checks walk. */
const GATHERING_STAGES = ['harvest', 'pickup', 'store'] as const;

function checkGoodLandscape(set: ContentSet, { landscapeIds }: IdSets): string[] {
  const errors: string[] = [];
  for (const g of set.goods) {
    if (g.landscapeType !== undefined && !landscapeIds.has(g.landscapeType))
      errors.push(`good "${g.id}" references unknown landscape typeId ${g.landscapeType}`);
    if (g.gathering) {
      for (const stage of GATHERING_STAGES) {
        const id = g.gathering[stage];
        if (id !== undefined && !landscapeIds.has(id))
          errors.push(`good "${g.id}" gathering ${stage} references unknown landscape typeId ${id}`);
      }
    }
  }
  return errors;
}

// Each resolved gathering-pipeline record: its good resolves, every stage's landscape id resolves,
// and every gfx index names a real landscapeGfx record (checked against {@link IdSets.landscapeGfxIndices}).
function checkGatheringPipeline(
  set: ContentSet,
  { goodIds, landscapeIds, landscapeGfxIndices }: IdSets,
): string[] {
  const errors: string[] = [];
  for (const p of set.gatheringPipeline) {
    if (!goodIds.has(p.goodType))
      errors.push(`gatheringPipeline good "${p.goodId}" references unknown goodType ${p.goodType}`);
    for (const stage of GATHERING_STAGES) {
      const s = p[stage];
      if (s === undefined) continue;
      if (!landscapeIds.has(s.landscapeType))
        errors.push(
          `gatheringPipeline good "${p.goodId}" ${stage} references unknown landscape typeId ${s.landscapeType}`,
        );
      for (const idx of s.gfxIndices) {
        if (!landscapeGfxIndices.has(idx))
          errors.push(
            `gatheringPipeline good "${p.goodId}" ${stage} references unknown landscapeGfx index ${idx}`,
          );
      }
    }
  }
  return errors;
}

// A terrainPatterns row's representative pick must exist in the full pattern table when that
// table is carried.
function checkTerrainPatterns(set: ContentSet, _ids: IdSets): string[] {
  if (set.gfxPatterns.length === 0) return [];
  const errors: string[] = [];
  const patternIds = new Set(set.gfxPatterns.map((p) => p.id));
  for (const t of set.terrainPatterns) {
    if (!patternIds.has(t.patternId))
      errors.push(`terrainPattern for typeId ${t.typeId} references unknown patternId ${t.patternId}`);
  }
  return errors;
}

// Each experience track names its owning job (always) and, when good-specific, the good it trains on.
function checkJobExperience(set: ContentSet, { goodIds, jobIds }: IdSets): string[] {
  const errors: string[] = [];
  for (const x of set.jobExperience) {
    if (!jobIds.has(x.jobType))
      errors.push(`jobExperience "${x.id}" references unknown jobType ${x.jobType}`);
    if (x.goodType !== undefined && !goodIds.has(x.goodType))
      errors.push(`jobExperience "${x.id}" references unknown goodType ${x.goodType}`);
  }
  return errors;
}
