/**
 * Building logic types.
 */
import { BUILDING_KIND, type BuildingKind, BuildingType } from '@open-northland/data';
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
 * `logicmaintype` → {@link BuildingKind}, read off the readable `houses.ini` records themselves:
 * storage is the headquarters + stock houses, home the residences carrying a `logichomesize`,
 * workplace the producers carrying a `logicproduction`, training the barracks/school, tower the
 * defences, vehicle the buildable carts/ships carrying a `logicvehicletype`, and wonder.
 */
const HOUSE_KIND_BY_MAIN_TYPE: Readonly<Record<number, BuildingKind>> = {
  1: BUILDING_KIND.storage,
  2: BUILDING_KIND.home,
  3: BUILDING_KIND.workplace,
  4: BUILDING_KIND.training,
  5: BUILDING_KIND.tower,
  6: BUILDING_KIND.vehicle,
  7: BUILDING_KIND.wonder,
};

/** Unknown `logicmaintype` ids fall back to a stable `maintype_<n>` so a new value never crashes a batch. */
function houseKind(mainType: number | undefined): string {
  if (mainType === undefined) return 'maintype_unknown';
  return HOUSE_KIND_BY_MAIN_TYPE[mainType] ?? `maintype_${mainType}`;
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
