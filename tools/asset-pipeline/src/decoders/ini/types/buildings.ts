import { BUILDING_KIND, type BuildingKind, BuildingType } from '@open-northland/data';
import type { RuleSection } from '../grammar.js';
import { makeSource, type SourceRef, slug } from '../ir-fields.js';
import { findProps, getInt, getIntList, getStr } from '../props.js';

/** The source names no kind: these `logicmaintype` ids are observed from the `houses.ini` records. */
const HOUSE_KIND_BY_MAIN_TYPE: Readonly<Record<number, BuildingKind>> = {
  1: BUILDING_KIND.storage,
  2: BUILDING_KIND.home,
  3: BUILDING_KIND.workplace,
  4: BUILDING_KIND.training,
  5: BUILDING_KIND.tower,
  6: BUILDING_KIND.vehicle,
  7: BUILDING_KIND.wonder,
};

function houseKind(mainType: number | undefined): BuildingType['kind'] {
  if (mainType === undefined) return 'maintype_unknown';
  return HOUSE_KIND_BY_MAIN_TYPE[mainType] ?? `maintype_${mainType}`;
}

/**
 * A house record keys its id on `logictype`, not the `type` every other table uses, and its name on
 * `debugname`. `logicbuildonbiopattern` is retained because it directly gates placement; unrelated
 * graphics and placement extras (`debugcolor`, `logicvehicletype`, other `logicbuildon*`/`logicignore*`)
 * remain outside this type-table slice.
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
        schoolSize: getInt(sec, 'logicSchoolSize'),
        homeSize: getInt(sec, 'logichomesize') ?? 0,
        buildOnBioPattern: getInt(sec, 'logicbuildonbiopattern') === 1,
        canEnableDefenceMode: getInt(sec, 'logicCanEnableDefenceMode') === 1,
        workers,
        stock,
        produces: getIntList(sec, 'logicproduction'),
        source: makeSource(src, 'logichousetype'),
      }),
    );
  }
  return buildings;
}
