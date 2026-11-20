import { z } from 'zod';
import { MapModules } from './schema.js';

/** The file a map folder may hold beside the original's own: what this engine adds to the map. Its
 *  name is reserved in every map folder, and the map's identity never comes from it. */
export const MAP_ADDITIONS_FILE = 'opennorthland.json';
export const MAP_ADDITIONS_VERSION = 1;

/** The longest folder name a mode may name its map by. */
const MAX_FOLDER_NAME = 128;
const stringId = z.number().int().nonnegative();
/** The session's resource yield factors (`RESOURCE_YIELD_FACTORS` in the lockstep package). */
const ORE_YIELD_FACTORS = [2, 3, 5] as const;

/** The most landscape object edits one file may list. */
const MAX_OBJECT_EDITS = 1000;
/** The largest half-cell coordinate an edit may name; the import holds it to the map's own size. */
const MAX_MAP_POINT = 4096;
/** The largest growth level or wall strength a `map.dat` stores for an object. */
const MAX_OBJECT_LEVEL = 255;
/** The player slots a `map.dat` can give an object to. */
const MAX_OBJECT_OWNER = 19;
const MAX_OBJECT_NAME = 64;

/** One landscape object of the map: its `[GfxLandscape]` EditName, its level and the player slot that
 *  owns it, null for nobody's. */
export const MapObject = z.strictObject({
  type: z.string().min(1).max(MAX_OBJECT_NAME),
  level: z.number().int().min(0).max(MAX_OBJECT_LEVEL),
  owner: z.number().int().min(0).max(MAX_OBJECT_OWNER).nullable(),
});
export type MapObject = z.infer<typeof MapObject>;

/** The object at half-cell node (`hx`, `hy`) changed from `from` to `to`; null on either side is no
 *  object. `from` must describe what `map.dat` holds there, so an edit written for another map fails. */
export const MapObjectEdit = z.strictObject({
  hx: z.number().int().min(0).max(MAX_MAP_POINT),
  hy: z.number().int().min(0).max(MAX_MAP_POINT),
  from: MapObject.nullable(),
  to: MapObject.nullable(),
});
export type MapObjectEdit = z.infer<typeof MapObjectEdit>;

/** A map that is another map played by other rules: the folder name of that map, and this mode's name
 *  and one-line description as ids in its own string table. */
export const MapAdditionsMode = z.strictObject({
  of: z.string().min(1).max(MAX_FOLDER_NAME),
  name: stringId,
  detail: stringId.optional(),
});
export type MapAdditionsMode = z.infer<typeof MapAdditionsMode>;

/** The room settings a lobby starts at when the map is chosen; the host may still change them. */
export const MapRoomDefaults = z.strictObject({
  /** The ore richness, one of the factors a room offers. */
  oreYield: z.union(ORE_YIELD_FACTORS.map((factor) => z.literal(factor))).optional(),
});
export type MapRoomDefaults = z.infer<typeof MapRoomDefaults>;

/**
 * `opennorthland.json` as a map folder holds it. A reader accepts exactly its own `version`; each
 * module carries a version of its own beside it.
 */
export const MapAdditionsFile = z.strictObject({
  version: z.literal(MAP_ADDITIONS_VERSION),
  mode: MapAdditionsMode.optional(),
  roomDefaults: MapRoomDefaults.optional(),
  /** Edits to the landscape objects `map.dat` places, applied in order as the map is read. */
  objects: z.array(MapObjectEdit).min(1).max(MAX_OBJECT_EDITS).optional(),
  /** The rules the simulation adds over the map's script. */
  modules: MapModules.optional(),
});
export type MapAdditionsFile = z.infer<typeof MapAdditionsFile>;
