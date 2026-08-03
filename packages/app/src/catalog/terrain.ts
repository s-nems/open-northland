/**
 * The semantic terrain classes every sim grid navigates on: authored vocabulary, not extracted data.
 * Scene grids use these ids directly and a decoded map is resolved into them before it reaches the sim,
 * which never navigates the detailed landscape types.
 */

/** The base of the reserved class-id band. Above every real landscape typeId (`landscapetypes.ini` ≤ 87)
 *  and the sandbox's synthetic `1000 + good` band, so a class id never aliases a content typeId. Kept a
 *  multiple of the render's `TILE_COLOURS` length so each class keeps its own flat placeholder colour. */
export const TERRAIN_CLASS_BASE = 9000;

/** Plain ground: walkable and buildable. */
export const TERRAIN_OPEN = TERRAIN_CLASS_BASE + 0;
/** Ground that is neither walkable nor buildable: scene water, and a real map's border, mountain-face
 *  and void-filler ground. The class carries the flags, not one look. */
export const TERRAIN_IMPASSABLE = TERRAIN_CLASS_BASE + 1;
/** A landscape object's body (tree trunk, rock, deposit): neither walkable nor buildable. */
export const TERRAIN_BLOCKED = TERRAIN_CLASS_BASE + 2;
/** Ground you can walk but not build on: an object's build-exclusion ring, or a real ground class
 *  whose `humancanwalkon 1` lacks `housecanbebuildon`. */
export const TERRAIN_MARGIN = TERRAIN_CLASS_BASE + 3;
/** Walkable and buildable like {@link TERRAIN_OPEN}, but crops cannot be sown on it: a real ground class
 *  with walk and build flags but no `biocanplanton`, which `trianglepatterntypes.cif` gives to `land`
 *  alone. Split from OPEN so the farmer's grass-only field gate survives the class resolve. */
export const TERRAIN_BARREN = TERRAIN_CLASS_BASE + 4;

/** One nav-terrain class as a `landscape` row. `plantable` is omitted, defaulting false, off grass. */
export interface NavLandscapeType {
  readonly typeId: number;
  readonly id: string;
  readonly walkable: boolean;
  readonly buildable: boolean;
  readonly plantable?: boolean;
}

/**
 * The five nav-terrain classes as `landscape` rows. Row ids are documentary: landscape rows are only
 * ever looked up by `typeId`.
 */
export const NAV_LANDSCAPE_TYPES: readonly NavLandscapeType[] = [
  { typeId: TERRAIN_OPEN, id: 'grass', walkable: true, buildable: true, plantable: true },
  { typeId: TERRAIN_IMPASSABLE, id: 'water', walkable: false, buildable: false },
  { typeId: TERRAIN_BLOCKED, id: 'landscape_body', walkable: false, buildable: false },
  { typeId: TERRAIN_MARGIN, id: 'landscape_margin', walkable: true, buildable: false },
  { typeId: TERRAIN_BARREN, id: 'barren', walkable: true, buildable: true },
];
