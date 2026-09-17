import { firstByTypeId } from './lookup.js';
import {
  type ContentSet,
  type JobEnablesKind,
  type JobRequirementTarget,
  LOGIC_TYPE_NONE,
} from './schema/index.js';

/** Reject a set whose numeric references dangle, at load rather than as a crash mid-game. */
export function validateCrossReferences(set: ContentSet): void {
  const ids = buildIdSets(set);
  const errors = CHECKS.flatMap((check) => check(set, ids));

  if (errors.length > 0) {
    throw new Error(`Content cross-reference validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

type CrossReferenceCheck = (set: ContentSet, ids: IdSets) => readonly string[];

/** Every check, in the order their errors are reported; the combined report's order is asserted. */
const CHECKS: readonly CrossReferenceCheck[] = [
  checkGoodProduction,
  checkBuildings,
  checkTribes,
  checkWeaponsAndArmor,
  checkAnimals,
  checkHuntPrey,
  checkLandscapeGfx,
  checkGoodLandscape,
  checkGatheringPipeline,
  checkTerrainPatterns,
  checkJobs,
  checkJobExperience,
  checkVehicles,
];

/** The id-sets every `check*` resolves references against, built once from the set. */
interface IdSets {
  readonly goodIds: ReadonlySet<number>;
  readonly jobIds: ReadonlySet<number>;
  readonly buildingIds: ReadonlySet<number>;
  readonly vehicleIds: ReadonlySet<number>;
  readonly tribeIds: ReadonlySet<number>;
  readonly landscapeIds: ReadonlySet<number>;
  /** Keyed by each record's own `.index`, which need not match its position in the table. */
  readonly landscapeGfxIndices: ReadonlySet<number>;
  readonly patternIds: ReadonlySet<number>;
  readonly armorIds: ReadonlySet<number>;
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
    patternIds: new Set(set.gfxPatterns.map((p) => p.id)),
    armorIds: new Set(set.armor.map((a) => a.typeId)),
  };
}

function checkGoodProduction(set: ContentSet, { goodIds, buildingIds }: IdSets): string[] {
  const errors: string[] = [];
  for (const g of set.goods) {
    for (const inp of g.productionInputs) {
      if (!goodIds.has(inp.goodType))
        errors.push(`good "${g.id}" consumes unknown input goodType ${inp.goodType}`);
    }
    if (g.vehicleHouse !== undefined && !buildingIds.has(g.vehicleHouse))
      errors.push(`good "${g.id}" opens unknown vehicle house buildingType ${g.vehicleHouse}`);
  }
  return errors;
}

function checkBuildings(set: ContentSet, { goodIds, jobIds, vehicleIds }: IdSets): string[] {
  const errors: string[] = [];
  for (const b of set.buildings) {
    for (const w of b.workers) {
      if (!jobIds.has(w.jobType)) errors.push(`building "${b.id}" references unknown jobType ${w.jobType}`);
    }
    if (b.vehicleType !== undefined && !vehicleIds.has(b.vehicleType))
      errors.push(`building "${b.id}" spawns unknown vehicleType ${b.vehicleType}`);
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
    for (const recipe of b.recipes) {
      for (const io of [...recipe.inputs, ...recipe.outputs]) {
        if (!goodIds.has(io.goodType))
          errors.push(`building "${b.id}" recipe references unknown goodType ${io.goodType}`);
      }
    }
    if (b.refillsOwnStock && b.recipes.length > 0)
      errors.push(`building "${b.id}" refills its own stock and also carries a recipe`);
  }
  return errors;
}

interface ReferenceTarget {
  readonly idSet: keyof IdSets;
  readonly label: string;
}

const JOB_ENABLES_TARGET: Readonly<Record<JobEnablesKind, ReferenceTarget>> = {
  good: { idSet: 'goodIds', label: 'goodType' },
  house: { idSet: 'buildingIds', label: 'buildingType' },
  job: { idSet: 'jobIds', label: 'jobType' },
  vehicle: { idSet: 'vehicleIds', label: 'vehicleType' },
};

const JOB_REQUIREMENT_TARGET: Readonly<Record<JobRequirementTarget, ReferenceTarget>> = {
  job: { idSet: 'jobIds', label: 'jobType' },
  good: { idSet: 'goodIds', label: 'goodType' },
};

function checkTribes(set: ContentSet, ids: IdSets): string[] {
  const { jobIds } = ids;
  const errors: string[] = [];
  for (const t of set.tribes) {
    const walkJob = t.walkStepReduction?.jobType;
    if (walkJob !== undefined && !jobIds.has(walkJob))
      errors.push(`tribe "${t.id}" walkStepReduction has unknown jobType ${walkJob}`);
    // Atomic ids resolve against no extracted table (see `AtomicId`), so only the binding's job is checked.
    for (const b of t.atomicBindings) {
      if (!jobIds.has(b.jobType))
        errors.push(`tribe "${t.id}" binds atomic ${b.atomicId} to unknown jobType ${b.jobType}`);
    }
    for (const e of t.jobEnables) {
      if (!jobIds.has(e.jobType))
        errors.push(`tribe "${t.id}" jobEnables-edge has unknown jobType ${e.jobType}`);
      const target = JOB_ENABLES_TARGET[e.kind];
      if (!ids[target.idSet].has(e.targetId))
        errors.push(`tribe "${t.id}" job ${e.jobType} enables unknown ${target.label} ${e.targetId}`);
    }
    for (const row of t.technology?.houses ?? []) {
      if (!ids.buildingIds.has(row.house))
        errors.push(`tribe "${t.id}" technology references unknown buildingType ${row.house}`);
      for (const job of row.jobs)
        if (!jobIds.has(job))
          errors.push(`tribe "${t.id}" house ${row.house} requires unknown jobType ${job}`);
      for (const good of row.goods)
        if (!ids.goodIds.has(good))
          errors.push(`tribe "${t.id}" house ${row.house} requires unknown goodType ${good}`);
    }
    for (const r of t.jobRequirements) {
      const target = JOB_REQUIREMENT_TARGET[r.target];
      if (!ids[target.idSet].has(r.targetId))
        errors.push(
          `tribe "${t.id}" ${r.requirement}for${r.target} requires unknown ${target.label} ${r.targetId}`,
        );
    }
  }
  return errors;
}

function checkWeaponsAndArmor(set: ContentSet, { goodIds, jobIds }: IdSets): string[] {
  const errors: string[] = [];
  // The extractor drops the `goodtype 0` natural-weapon sentinel to undefined, so an absent goodType
  // is not a dangling reference.
  for (const w of set.weapons) {
    if (w.jobType !== undefined && !jobIds.has(w.jobType))
      errors.push(`weapon "${w.id}" references unknown jobType ${w.jobType}`);
    if (w.goodType !== undefined && !goodIds.has(w.goodType))
      errors.push(`weapon "${w.id}" references unknown goodType ${w.goodType}`);
  }
  for (const a of set.armor) {
    if (a.goodType !== undefined && !goodIds.has(a.goodType))
      errors.push(`armor "${a.id}" references unknown goodType ${a.goodType}`);
  }
  return errors;
}

// An animal record keys on `tribeType`, not `type`: its identity is its owning tribe.
function checkAnimals(set: ContentSet, { tribeIds }: IdSets): string[] {
  const errors: string[] = [];
  for (const a of set.animals) {
    if (!tribeIds.has(a.tribeType))
      errors.push(`animal "${a.id}" references unknown tribeType ${a.tribeType}`);
  }
  return errors;
}

// Every yield good must share one harvest atomic: a carcass is one node re-armed good-to-good in
// place, and the sim's resource dormancy index captures a node's atomic once at spawn.
function checkHuntPrey(set: ContentSet, { tribeIds }: IdSets): string[] {
  const errors: string[] = [];
  const goods = new Map(set.goods.map((g) => [g.typeId, g]));
  for (const p of set.huntPrey) {
    if (!tribeIds.has(p.tribeType)) errors.push(`huntPrey references unknown tribeType ${p.tribeType}`);
    const atomics = new Set<number>();
    for (const y of p.yields) {
      const good = goods.get(y.goodType);
      if (good === undefined)
        errors.push(`huntPrey tribe ${p.tribeType} yields unknown goodType ${y.goodType}`);
      else if (good.atomics.harvest === undefined)
        errors.push(`huntPrey tribe ${p.tribeType} yields good "${good.id}" with no harvest atomic`);
      else atomics.add(good.atomics.harvest);
    }
    if (atomics.size > 1)
      errors.push(`huntPrey tribe ${p.tribeType} yields goods with differing harvest atomics`);
  }
  return errors;
}

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

/** The ordered stages of a good's gathering chain. */
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

// An empty pattern table means the set does not carry it, not that every representative pick dangles.
function checkTerrainPatterns(set: ContentSet, { patternIds }: IdSets): string[] {
  if (set.gfxPatterns.length === 0) return [];
  const errors: string[] = [];
  for (const t of set.terrainPatterns) {
    if (!patternIds.has(t.patternId))
      errors.push(`terrainPattern for typeId ${t.typeId} references unknown patternId ${t.patternId}`);
  }
  return errors;
}

// `resolveJobAtomics` tolerates a dangling or cyclic `baseJob` by inheriting nothing, which would
// leave a job quietly short of atomics, so both faults are caught here instead.
function checkJobs(set: ContentSet, { armorIds, jobIds }: IdSets): string[] {
  const errors: string[] = [];
  const firstRows = firstByTypeId(set.jobs);
  for (const j of firstRows.values()) {
    if (j.fixedArmorType !== undefined && !armorIds.has(j.fixedArmorType))
      errors.push(`job "${j.id}" references unknown fixed armorType ${j.fixedArmorType}`);
    if (j.baseJob === undefined) continue;
    if (!jobIds.has(j.baseJob)) {
      errors.push(`job "${j.id}" references unknown base jobType ${j.baseJob}`);
      continue;
    }
    const seen = new Set<number>([j.typeId]);
    for (let at: number | undefined = j.baseJob; at !== undefined; at = firstRows.get(at)?.baseJob) {
      if (seen.has(at)) {
        errors.push(`job "${j.id}" sits on a base jobType cycle through ${at}`);
        break;
      }
      seen.add(at);
    }
  }
  return errors;
}

function checkJobExperience(set: ContentSet, { goodIds, jobIds }: IdSets): string[] {
  const errors: string[] = [];
  for (const x of set.jobExperience) {
    if (!jobIds.has(x.jobType))
      errors.push(`jobExperience "${x.id}" references unknown jobType ${x.jobType}`);
    for (const goodType of x.goodTypes) {
      if (!goodIds.has(goodType))
        errors.push(`jobExperience "${x.id}" references unknown goodType ${goodType}`);
    }
  }
  return errors;
}

// `jobId` is not checked: a synthetic set may carry a vehicle without its `JOB_TYPE_VEHICLE_*` job.
function checkVehicles(set: ContentSet, { jobIds, vehicleIds }: IdSets): string[] {
  const errors: string[] = [];
  for (const v of set.vehicles) {
    for (const job of v.passengerJobs) {
      if (!jobIds.has(job)) errors.push(`vehicle "${v.id}" admits unknown passenger jobType ${job}`);
    }
    if (v.transformVehicleType !== undefined && !vehicleIds.has(v.transformVehicleType))
      errors.push(`vehicle "${v.id}" transforms into unknown vehicleType ${v.transformVehicleType}`);
  }
  return errors;
}
