import { type Simulation, type TerrainMap, components } from '@vinland/sim';

/**
 * The committed catalog of viking buildings — the SINGLE SOURCE OF TRUTH that maps a human name to the
 * one key the whole engine shares: `Building.buildingType` (the `typeId`, the original's `[GfxHouse]`
 * `LogicType`). That typeId is what {@link placeVikingBuilding} stamps on the sim entity AND what the
 * renderer keys its per-type bob lookup on (`content/building-gfx.ts` `buildingBobRefsByType`), so naming a
 * building here is enough to place it on the map AND draw its own graphic — no guessing, no reaching into
 * the gitignored `content/ir.json`.
 *
 * The `typeId`/`id`/`kind` are transcribed verbatim from `ir.json`'s `buildings` (the pipeline output);
 * `label` is our own clean-room English naming for semantic lookup ("warehouse level 2" → `stock_02`).
 * `test/viking-buildings.test.ts` pins every row back to `ir.json` (id + kind match, and the typeId has a
 * bound bob) whenever `content/` is present, so this table cannot silently drift from the real data.
 *
 * Scope: the 41 real viking buildings (`typeId` 1..41), every one of which has a decoded bob. `work_murek`
 * (typeId 55) is intentionally omitted — the mod binds no viking bob for it (its wall graphic is bound to
 * typeId 22 `work_pottery_02` instead), so it would draw the fallback house, not its own structure.
 * Vehicles (42..46) and Wonders (47..54) are out of scope (not "buildings").
 */

/** The viking `LogicTribeType` (the `[GfxHouse]` `LogicTribeType 1`) — the tribe every building here belongs to. */
export const VIKING = 1;
/** The all-walkable, buildable grass landscape typeId used by scene terrain. */
export const GRASS = 0;
/** The `home` building class — the only kind the ConstructionSystem upgrades up a level chain. */
export const HOME_KIND = 'home';

const { Building } = components;

/** One viking building type: the shared `typeId` key + its stable id, English label, and coarse class. */
export interface VikingBuilding {
  /** The `[GfxHouse]` `LogicType` — `Building.buildingType` in the sim, the bob-binding key in the renderer. */
  readonly typeId: number;
  /** Stable machine id, verbatim from `ir.json` (e.g. `"stock_02"`). */
  readonly id: string;
  /** Human English label for semantic lookup (e.g. `"Warehouse (level 2)"`) — our clean-room naming. */
  readonly label: string;
  /** Coarse class from `ir.json`: `home` | `storage` | `workplace` | `tower` | `training`. */
  readonly kind: string;
}

/**
 * Every viking building, in `typeId` order. The raw typeIds live HERE (their definition) and nowhere else
 * — code elsewhere refers to a building by id/label through the lookups below, never by a bare number.
 */
export const VIKING_BUILDINGS: readonly VikingBuilding[] = [
  { typeId: 1, id: 'headquarters', label: 'Headquarters', kind: 'storage' },
  { typeId: 2, id: 'home_level_00', label: 'Home (level 0)', kind: 'home' },
  { typeId: 3, id: 'home_level_01', label: 'Home (level 1)', kind: 'home' },
  { typeId: 4, id: 'home_level_02', label: 'Home (level 2)', kind: 'home' },
  { typeId: 5, id: 'home_level_03', label: 'Home (level 3)', kind: 'home' },
  { typeId: 6, id: 'home_level_04', label: 'Home (level 4)', kind: 'home' },
  { typeId: 7, id: 'stock_00', label: 'Warehouse (level 0)', kind: 'storage' },
  { typeId: 8, id: 'stock_01', label: 'Warehouse (level 1)', kind: 'storage' },
  { typeId: 9, id: 'stock_02', label: 'Warehouse (level 2)', kind: 'storage' },
  { typeId: 10, id: 'work_well_00', label: 'Well', kind: 'workplace' },
  { typeId: 11, id: 'work_hive_00', label: 'Beehive / apiary', kind: 'workplace' },
  { typeId: 12, id: 'work_farm_00', label: 'Grain farm', kind: 'workplace' },
  { typeId: 13, id: 'work_mill_00', label: 'Mill', kind: 'workplace' },
  { typeId: 14, id: 'work_bakery_00', label: 'Bakery (level 0)', kind: 'workplace' },
  { typeId: 15, id: 'work_bakery_01', label: 'Bakery (level 1)', kind: 'workplace' },
  { typeId: 16, id: 'work_brewery', label: 'Brewery', kind: 'workplace' },
  { typeId: 17, id: 'work_animal_farm', label: 'Animal farm', kind: 'workplace' },
  { typeId: 18, id: 'work_sewery_00', label: 'Tailor / clothier (level 0)', kind: 'workplace' },
  { typeId: 19, id: 'work_sewery_01', label: 'Tailor / clothier (level 1)', kind: 'workplace' },
  { typeId: 20, id: 'work_pottery_00', label: 'Pottery (level 0)', kind: 'workplace' },
  { typeId: 21, id: 'work_pottery_01', label: 'Pottery (level 1)', kind: 'workplace' },
  // typeId 22 is a DEFENCE WALL, not a pottery: the id `work_pottery_02` is a pipeline naming artifact
  // (the type sits in the slot after the two potteries), but its kind is `tower` and the mod binds the
  // wall bob ("Mur h", mur.bmd) to it — matching the original's eng string 22 "Defence wall". id + kind
  // are carried verbatim (the drift test pins them to ir.json); the label names the real function.
  { typeId: 22, id: 'work_pottery_02', label: 'Defence wall', kind: 'tower' },
  { typeId: 23, id: 'work_joinery_00', label: 'Joinery (level 0)', kind: 'workplace' },
  { typeId: 24, id: 'work_joinery_01', label: 'Joinery (level 1)', kind: 'workplace' },
  { typeId: 25, id: 'work_joinery_02', label: 'Joinery (level 2)', kind: 'workplace' },
  { typeId: 26, id: 'work_joinery_03', label: 'Joinery (level 3)', kind: 'workplace' },
  { typeId: 27, id: 'work_armory_00', label: 'Armory (level 0)', kind: 'workplace' },
  { typeId: 28, id: 'work_armory_01', label: 'Armory (level 1)', kind: 'workplace' },
  { typeId: 29, id: 'work_mason_hut_00', label: "Mason's hut (level 0)", kind: 'workplace' },
  { typeId: 30, id: 'work_mason_hut_01', label: "Mason's hut (level 1)", kind: 'workplace' },
  { typeId: 31, id: 'work_smithy_00', label: 'Smithy (level 0)', kind: 'workplace' },
  { typeId: 32, id: 'work_smithy_01', label: 'Smithy (level 1)', kind: 'workplace' },
  { typeId: 33, id: 'work_coin_mint', label: 'Coin mint', kind: 'workplace' },
  { typeId: 34, id: 'work_herb_hut', label: 'Herb hut', kind: 'workplace' },
  { typeId: 35, id: 'work_druid_00', label: "Druid's hut (level 0)", kind: 'workplace' },
  { typeId: 36, id: 'work_druid_01', label: "Druid's hut (level 1)", kind: 'workplace' },
  { typeId: 37, id: 'work_temple', label: 'Temple', kind: 'workplace' },
  { typeId: 38, id: 'school', label: 'School', kind: 'training' },
  { typeId: 39, id: 'barracks', label: 'Barracks', kind: 'training' },
  { typeId: 40, id: 'tower_00', label: 'Watchtower (level 0)', kind: 'tower' },
  { typeId: 41, id: 'tower_01', label: 'Watchtower (level 1)', kind: 'tower' },
];

const BY_TYPE_ID: ReadonlyMap<number, VikingBuilding> = new Map(VIKING_BUILDINGS.map((b) => [b.typeId, b]));
const BY_ID: ReadonlyMap<string, VikingBuilding> = new Map(VIKING_BUILDINGS.map((b) => [b.id, b]));

/** The building with this `typeId`, or `undefined`. */
export function vikingBuildingByTypeId(typeId: number): VikingBuilding | undefined {
  return BY_TYPE_ID.get(typeId);
}

/** The building with this exact `id` (e.g. `"stock_02"`), or `undefined`. */
export function vikingBuildingById(id: string): VikingBuilding | undefined {
  return BY_ID.get(id);
}

/** Every building whose `id` or `label` contains `query` (case-insensitive) — the fuzzy "what is X?" lookup. */
export function findVikingBuildings(query: string): VikingBuilding[] {
  const q = query.toLowerCase();
  return VIKING_BUILDINGS.filter((b) => b.id.toLowerCase().includes(q) || b.label.toLowerCase().includes(q));
}

/** Resolve a building reference (its `typeId` or exact `id`) to its catalog row, or throw on an unknown ref. */
export function resolveVikingBuilding(ref: number | string): VikingBuilding {
  const found = typeof ref === 'number' ? vikingBuildingByTypeId(ref) : vikingBuildingById(ref);
  if (found === undefined) throw new Error(`unknown viking building: ${JSON.stringify(ref)}`);
  return found;
}

/**
 * Place a viking building on the map by name — the game-ready ergonomic over the ONE mutation seam
 * (`placeBuilding`). `ref` is the building's `typeId` or its `id` (e.g. `'stock_02'`); it is placed
 * **fully built** for `tribe` {@link VIKING} at `(x, y)`. This is exactly what a build menu / a builder
 * finishing construction would call — the caller never handles a raw typeId.
 */
export function placeVikingBuilding(sim: Simulation, ref: number | string, x: number, y: number): void {
  sim.enqueue({
    kind: 'placeBuilding',
    buildingType: resolveVikingBuilding(ref).typeId,
    x,
    y,
    tribe: VIKING,
  });
}

/** An all-grass terrain grid of the given size (every cell walkable, buildable {@link GRASS}). */
export function grassTerrain(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

/** The distinct building typeIds currently placed in the world — the check helper scenes assert on. */
export function placedBuildingTypes(sim: Simulation): Set<number> {
  const types = new Set<number>();
  for (const e of sim.world.query(Building)) types.add(sim.world.get(e, Building).buildingType);
  return types;
}
