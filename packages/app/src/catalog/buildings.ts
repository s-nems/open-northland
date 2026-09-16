import { type CellTerrainMap, components, type Simulation } from '@open-northland/sim';
import { TERRAIN_OPEN } from './terrain.js';

/**
 * The committed catalog of viking buildings, keyed by `Building.buildingType`, the original's
 * `[GfxHouse]` `LogicType`: the id a `placeBuilding` command stamps and the renderer's bob-lookup key.
 *
 * `typeId`, `id`, `kind`, `buildOnBioPattern` and `canEnableDefenceMode` are transcribed verbatim from `ir.json`'s
 * `buildings`; `label` is hand-authored English. Level suffixes are 1-based for the player even though
 * the ids stay 0-indexed.
 *
 * Scope is the 41 real viking buildings (`typeId` 1..41), every one with a decoded bob. `work_murek`
 * (typeId 55) is omitted because the mod binds no viking bob for it, so it would draw the fallback house.
 * Vehicles (42..46) and wonders (47..54) are not buildings.
 */

/** The viking `[GfxHouse]` `LogicTribeType`, the tribe every building here belongs to. */
export const VIKING = 1;
/** The walkable, buildable grass typeId scene terrain uses, so scene grass resolves against the sim's
 *  `landscape` table. */
export const GRASS = TERRAIN_OPEN;
const { Building } = components;

export interface VikingBuilding {
  /** The `[GfxHouse]` `LogicType`: `Building.buildingType` in the sim, the bob-binding key in render. */
  readonly typeId: number;
  /** Stable machine id, verbatim from `ir.json` (e.g. `"stock_02"`). */
  readonly id: string;
  readonly label: string;
  /** Coarse class from `ir.json`: `home` | `storage` | `workplace` | `tower` | `training`. */
  readonly kind: string;
  readonly buildOnBioPattern?: true;
  readonly canEnableDefenceMode?: true;
}

/** Every viking building in `typeId` order. */
export const VIKING_BUILDINGS: readonly VikingBuilding[] = [
  { typeId: 1, id: 'headquarters', label: 'Headquarters', kind: 'storage', canEnableDefenceMode: true },
  { typeId: 2, id: 'home_level_00', label: 'Home (level 1)', kind: 'home' },
  { typeId: 3, id: 'home_level_01', label: 'Home (level 2)', kind: 'home' },
  { typeId: 4, id: 'home_level_02', label: 'Home (level 3)', kind: 'home' },
  { typeId: 5, id: 'home_level_03', label: 'Home (level 4)', kind: 'home' },
  { typeId: 6, id: 'home_level_04', label: 'Home (level 5)', kind: 'home' },
  { typeId: 7, id: 'stock_00', label: 'Warehouse (level 1)', kind: 'storage' },
  { typeId: 8, id: 'stock_01', label: 'Warehouse (level 2)', kind: 'storage' },
  { typeId: 9, id: 'stock_02', label: 'Warehouse (level 3)', kind: 'storage' },
  { typeId: 10, id: 'work_well_00', label: 'Well', kind: 'workplace', buildOnBioPattern: true },
  { typeId: 11, id: 'work_hive_00', label: 'Beehive / apiary', kind: 'workplace', buildOnBioPattern: true },
  { typeId: 12, id: 'work_farm_00', label: 'Grain farm', kind: 'workplace' },
  { typeId: 13, id: 'work_mill_00', label: 'Mill', kind: 'workplace' },
  { typeId: 14, id: 'work_bakery_00', label: 'Bakery (level 1)', kind: 'workplace' },
  { typeId: 15, id: 'work_bakery_01', label: 'Bakery (level 2)', kind: 'workplace' },
  { typeId: 16, id: 'work_brewery', label: 'Brewery', kind: 'workplace' },
  { typeId: 17, id: 'work_animal_farm', label: 'Animal farm', kind: 'workplace' },
  { typeId: 18, id: 'work_sewery_00', label: 'Tailor / clothier (level 1)', kind: 'workplace' },
  { typeId: 19, id: 'work_sewery_01', label: 'Tailor / clothier (level 2)', kind: 'workplace' },
  { typeId: 20, id: 'work_pottery_00', label: 'Pottery (level 1)', kind: 'workplace' },
  { typeId: 21, id: 'work_pottery_01', label: 'Pottery (level 2)', kind: 'workplace' },
  // typeId 22 is a defence wall, not a pottery: `work_pottery_02` is a pipeline naming artifact, while
  // the mod binds the wall bob (`mur.bmd`) to it, matching the original's eng string 22 "Defence wall".
  { typeId: 22, id: 'work_pottery_02', label: 'Defence wall', kind: 'tower' },
  { typeId: 23, id: 'work_joinery_00', label: 'Joinery (level 1)', kind: 'workplace' },
  { typeId: 24, id: 'work_joinery_01', label: 'Joinery (level 2)', kind: 'workplace' },
  { typeId: 25, id: 'work_joinery_02', label: 'Joinery (level 3)', kind: 'workplace' },
  { typeId: 26, id: 'work_joinery_03', label: 'Joinery (level 4)', kind: 'workplace' },
  { typeId: 27, id: 'work_armory_00', label: 'Armory (level 1)', kind: 'workplace' },
  { typeId: 28, id: 'work_armory_01', label: 'Armory (level 2)', kind: 'workplace' },
  { typeId: 29, id: 'work_mason_hut_00', label: "Mason's hut (level 1)", kind: 'workplace' },
  { typeId: 30, id: 'work_mason_hut_01', label: "Mason's hut (level 2)", kind: 'workplace' },
  { typeId: 31, id: 'work_smithy_00', label: 'Smithy (level 1)', kind: 'workplace' },
  { typeId: 32, id: 'work_smithy_01', label: 'Smithy (level 2)', kind: 'workplace' },
  { typeId: 33, id: 'work_coin_mint', label: 'Coin mint', kind: 'workplace' },
  { typeId: 34, id: 'work_herb_hut', label: 'Herb hut', kind: 'workplace' },
  { typeId: 35, id: 'work_druid_00', label: "Druid's hut (level 1)", kind: 'workplace' },
  { typeId: 36, id: 'work_druid_01', label: "Druid's hut (level 2)", kind: 'workplace' },
  { typeId: 37, id: 'work_temple', label: 'Temple', kind: 'workplace' },
  { typeId: 38, id: 'school', label: 'School', kind: 'training' },
  { typeId: 39, id: 'barracks', label: 'Barracks', kind: 'training', canEnableDefenceMode: true },
  { typeId: 40, id: 'tower_00', label: 'Watchtower (level 1)', kind: 'tower', canEnableDefenceMode: true },
  { typeId: 41, id: 'tower_01', label: 'Watchtower (level 2)', kind: 'tower', canEnableDefenceMode: true },
];

const BY_TYPE_ID: ReadonlyMap<number, VikingBuilding> = new Map(VIKING_BUILDINGS.map((b) => [b.typeId, b]));
const BY_ID: ReadonlyMap<string, VikingBuilding> = new Map(VIKING_BUILDINGS.map((b) => [b.id, b]));

export function vikingBuildingByTypeId(typeId: number): VikingBuilding | undefined {
  return BY_TYPE_ID.get(typeId);
}

export function vikingBuildingById(id: string): VikingBuilding | undefined {
  return BY_ID.get(id);
}

/** Every building whose `id` or `label` contains `query`, case-insensitively. */
export function findVikingBuildings(query: string): VikingBuilding[] {
  const q = query.toLowerCase();
  return VIKING_BUILDINGS.filter((b) => b.id.toLowerCase().includes(q) || b.label.toLowerCase().includes(q));
}

/** Resolve a `typeId` or exact `id` to its catalog row, throwing on an unknown reference. */
export function resolveVikingBuilding(ref: number | string): VikingBuilding {
  const found = typeof ref === 'number' ? vikingBuildingByTypeId(ref) : vikingBuildingById(ref);
  if (found === undefined) throw new Error(`unknown viking building: ${JSON.stringify(ref)}`);
  return found;
}

/** An all-grass cell grid in the scene-authoring shape; the sim seam upsamples it to half-cells. */
export function grassTerrain(width: number, height: number): CellTerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

/** The distinct building typeIds currently placed in the world. */
export function placedBuildingTypes(sim: Simulation): Set<number> {
  const types = new Set<number>();
  for (const e of sim.world.query(Building)) types.add(sim.world.get(e, Building).buildingType);
  return types;
}
