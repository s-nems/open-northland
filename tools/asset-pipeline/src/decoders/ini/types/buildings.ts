/**
 * Building logic types and the cross-table recipe fill (produce-atomic animation lengths → production ticks).
 */
import { type AtomicAnimation, BuildingType, type GoodType, type TribeType } from '@open-northland/data';
import {
  findProps,
  getInt,
  getIntList,
  getStr,
  makeSource,
  type RuleSection,
  type SourceRef,
  slug,
} from '../grammar.js';

/**
 * Coarse building class from the original `logichousetype` `logicmaintype`. The mapping is taken from
 * the readable `houses.ini` records themselves (OpenVikings decodes formats, not house semantics):
 *   1 = storage (headquarters + the stock houses), 2 = home (residences with a `logichomesize`),
 *   3 = workplace (production, carries `logicproduction`), 4 = training (barracks/school),
 *   5 = tower (defence), 6 = vehicle (buildable carts/ships, carries `logicvehicletype`),
 *   7 = wonder. Unknown ids fall back to a stable `maintype_<n>` so a new value never crashes a batch.
 */
function houseKind(mainType: number | undefined): string {
  switch (mainType) {
    case 1:
      return 'storage';
    case 2:
      return 'home';
    case 3:
      return 'workplace';
    case 4:
      return 'training';
    case 5:
      return 'tower';
    case 6:
      return 'vehicle';
    case 7:
      return 'wonder';
    default:
      return `maintype_${mainType ?? 'unknown'}`;
  }
}

/**
 * Extracts `[logichousetype]` sections (the mod's readable `DataCnmd/types/houses.ini`, preferred over
 * the base game's encrypted `housetypes.cif` per AGENTS.md golden rule #4) into validated
 * {@link BuildingType} IR. Unlike the other type tables a house record keys its id on `logictype` (not
 * `type`) and its name on `debugname`. Captured per record:
 *   - `logicworker <jobType> <count>`  -> {@link WorkerSlot}[] (the worker the building employs;
 *     `jobType` is cross-checked against the job table by `validateCrossReferences`).
 *   - `logicstock <goodType> <capacity> <initial>` -> {@link StockSlot}[] (per-good storage slots;
 *     `goodType` cross-checked against the good table).
 *   - `logicproduction <goodType>` -> `produces` (output good ids only — the input side is the
 *     output-side join {@link fillBuildingRecipes} does after this, see {@link BuildingType.produces}).
 *   - `logichomesize` -> `homeSize` (population-capacity tier, on `home` buildings).
 * `kind` is mapped from `logicmaintype` ({@link houseKind}). Throws on a section missing the required
 * numeric `logictype` (matches {@link extractGoods}'s throw-on-malformed stance). The combat/graphics
 * extras (`debugcolor`, `logicCanEnableDefenceMode`, `logicSchoolSize`, `logicvehicletype`, the
 * `logicbuildon*`/`logicignore*` placement flags) are intentionally skipped — they belong with the
 * later construction/combat/placement systems, not this type-table slice.
 */
export function extractBuildings(sections: readonly RuleSection[], src: SourceRef): BuildingType[] {
  const buildings: BuildingType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'logichousetype') continue;
    const typeId = getInt(sec, 'logictype');
    if (typeId === undefined) {
      throw new Error(`ini: [logichousetype] without a numeric \`logictype\` in ${src.file}`);
    }
    const name = getStr(sec, 'debugname');
    const workers: { jobType: number; count: number }[] = [];
    for (const p of findProps(sec, 'logicworker')) {
      const jobType = Number.parseInt(p.values[0] ?? '', 10);
      const count = Number.parseInt(p.values[1] ?? '', 10);
      if (Number.isNaN(jobType) || Number.isNaN(count)) continue;
      workers.push({ jobType, count });
    }
    const stock: { goodType: number; capacity: number; initial: number }[] = [];
    for (const p of findProps(sec, 'logicstock')) {
      const goodType = Number.parseInt(p.values[0] ?? '', 10);
      const capacity = Number.parseInt(p.values[1] ?? '', 10);
      const initial = Number.parseInt(p.values[2] ?? '', 10);
      if (Number.isNaN(goodType) || Number.isNaN(capacity)) continue;
      stock.push({ goodType, capacity, initial: Number.isNaN(initial) ? 0 : initial });
    }
    buildings.push(
      BuildingType.parse({
        typeId,
        id: name ? slug(name) : `house_${typeId}`,
        kind: houseKind(getInt(sec, 'logicmaintype')),
        homeSize: getInt(sec, 'logichomesize') ?? 0,
        workers,
        stock,
        produces: getIntList(sec, 'logicproduction'),
        source: makeSource(src, 'logichousetype'),
      }),
    );
  }
  return buildings;
}

/** Ticks for one production cycle when no produce-atomic animation length resolves (unpinned). */
const DEFAULT_RECIPE_TICKS = 20;

/**
 * Builds a last-wins `(jobType, atomicId) -> animation-name` lookup over one tribe's `setatomic`
 * bindings. `setatomic` is kept in file order with repeats; the original resolves a `(job, atomic)`
 * pair as last-wins (a later config line overrides an earlier one), so a plain `Map.set` in binding
 * order yields the engine's effective table.
 */
function tribeBindingLookup(tribe: TribeType): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of tribe.atomicBindings) m.set(`${b.jobType}:${b.atomicId}`, b.animation);
  return m;
}

/**
 * Resolves the faithful per-cycle tick count for one producing building, or `undefined` when the
 * chain can't be followed (so the caller falls back to {@link DEFAULT_RECIPE_TICKS}).
 *
 * The chain is: the building's worker `jobType` + the primary produced good's `atomicForProduction`
 * (`GoodAtomics.produce`) form the `(jobType, atomicId)` key into the reference tribe's `setatomic`
 * table -> an animation name -> that {@link AtomicAnimation}'s `length`. "Primary" = the first
 * `produces` good (file order) whose produce-atomic resolves all the way to a positive animation length;
 * later goods are tried only as a fallback so a building always pins to a real length when any of its
 * outputs can.
 *
 * Approximated on two axes (source basis): (a) production length varies per tribe in the source (e.g.
 * viking coiner=200 vs frank coiner=60), so pinning to one reference tribe loses the per-tribe spread (a
 * per-tribe recipe table is the fully-faithful model, deferred); (b) a multi-output workplace has one
 * `length` per output atomic, collapsed here to the primary output's (the merged-recipe model carries a
 * single `ticks`).
 */
function resolveRecipeTicks(
  building: BuildingType,
  goodById: ReadonlyMap<number, GoodType>,
  refTribeLookup: ReadonlyMap<string, string>,
  lengthByAnimation: ReadonlyMap<string, number>,
): number | undefined {
  const jobType = building.workers[0]?.jobType;
  if (jobType === undefined) return undefined;
  for (const outputGood of building.produces) {
    const atomicId = goodById.get(outputGood)?.atomics.produce;
    if (atomicId === undefined) continue;
    const animation = refTribeLookup.get(`${jobType}:${atomicId}`);
    if (animation === undefined) continue;
    const length = lengthByAnimation.get(animation);
    if (length !== undefined && length > 0) return length;
  }
  return undefined;
}

/**
 * Fills each producing building's `recipe` by the output-side join: a workplace's `produces` names the
 * output good(s) it makes, and a `[goodtype]`'s `productionInputGoods` (extracted onto
 * {@link GoodType.productionInputs}) names what producing that good consumes — so joining a building's
 * outputs through the goods table materializes the inputs the original house table never carried
 * directly. Cross-table, so it runs after `extractGoods`/`extractBuildings`/`extractTribes`/
 * `extractAtomicAnimations`, before `parseContentSet`.
 *
 * Returns new building records (the input array is left untouched). For each building with a non-empty
 * `produces`:
 *   - `recipe.outputs` = each produced good at amount 1 (one unit per cycle — the original house
 *     table carries no per-good output quantity, only which good; uniform 1 is the faithful default,
 *     matching the `logicproduction <good>` semantics). A repeated `logicproduction` id is summed
 *     into one output (symmetry with the input side + the production system's per-good stockpile model).
 *   - `recipe.inputs` = the merged `productionInputs` of every produced good, summed per input
 *     goodType (a workplace making several goods consumes the union of their inputs per cycle).
 *     Both sides are emitted in ascending goodType order — deterministic, source-order-independent.
 *   - `recipe.ticks` = the produce-atomic animation length resolved through the reference tribe
 *     (the lowest-`typeId` tribe — deterministic) by {@link resolveRecipeTicks}, falling back to
 *     {@link DEFAULT_RECIPE_TICKS} only when no produced good's produce-atomic resolves a length.
 *     Approximated (source basis): the source length varies per tribe and per output; the
 *     reference-tribe primary-output length is the faithful-leaning single value the merged recipe can
 *     carry until a per-tribe recipe table lands.
 *
 * A building that already carries a `recipe` (e.g. a future explicit override) is left as-is. A
 * building with empty `produces` gets no recipe (it is not a producer) and is returned unchanged.
 * `tribes`/`atomicAnimations` may be empty — then every recipe falls back to {@link DEFAULT_RECIPE_TICKS}.
 */
export function fillBuildingRecipes(
  buildings: readonly BuildingType[],
  goods: readonly GoodType[],
  tribes: readonly TribeType[] = [],
  atomicAnimations: readonly AtomicAnimation[] = [],
): BuildingType[] {
  const inputsByGood = new Map<number, readonly { goodType: number; amount: number }[]>();
  const goodById = new Map<number, GoodType>();
  for (const g of goods) {
    inputsByGood.set(g.typeId, g.productionInputs);
    goodById.set(g.typeId, g);
  }
  // Reference tribe = the lowest-typeId tribe (deterministic, source-order-independent). Production
  // length varies per tribe (see resolveRecipeTicks); one reference tribe is pinned for the single
  // building-type-level `ticks`. The animation length lookup is keyed by name (the `setatomic` join).
  const refTribe = tribes.reduce<TribeType | undefined>(
    (lo, t) => (lo === undefined || t.typeId < lo.typeId ? t : lo),
    undefined,
  );
  const refTribeLookup = refTribe ? tribeBindingLookup(refTribe) : new Map<string, string>();
  const lengthByAnimation = new Map<string, number>();
  for (const a of atomicAnimations) lengthByAnimation.set(a.name, a.length);

  return buildings.map((b) => {
    if (b.recipe !== undefined || b.produces.length === 0) return b;

    const mergedInputs = new Map<number, number>();
    const mergedOutputs = new Map<number, number>();
    for (const outputGood of b.produces) {
      mergedOutputs.set(outputGood, (mergedOutputs.get(outputGood) ?? 0) + 1);
      for (const inp of inputsByGood.get(outputGood) ?? []) {
        mergedInputs.set(inp.goodType, (mergedInputs.get(inp.goodType) ?? 0) + inp.amount);
      }
    }
    const sortedPairs = (m: Map<number, number>): { goodType: number; amount: number }[] =>
      [...m].sort(([a], [c]) => a - c).map(([goodType, amount]) => ({ goodType, amount }));

    const recipe = {
      inputs: sortedPairs(mergedInputs),
      outputs: sortedPairs(mergedOutputs),
      ticks: resolveRecipeTicks(b, goodById, refTribeLookup, lengthByAnimation) ?? DEFAULT_RECIPE_TICKS,
    };
    return BuildingType.parse({ ...b, recipe });
  });
}
