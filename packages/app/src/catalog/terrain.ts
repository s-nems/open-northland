/**
 * The semantic terrain classes every sim grid navigates on — committed clean-room vocabulary, not
 * extracted data (a catalog leaf both `game/sandbox` and `content/` may import without coupling to
 * each other). Scene grids are authored in these ids directly; a real decoded map is resolved into
 * them by `content/collision.ts` (its ground/object lanes joined against the extracted class tables)
 * before it reaches the sim. The sim never navigates the detailed landscape types — always these five
 * classes.
 *
 * The ids sit in a reserved high band ({@link TERRAIN_CLASS_BASE}) disjoint from any content set's
 * detailed landscape typeIds; `content/real-content.ts` `mergeRealContent` injects
 * {@link NAV_LANDSCAPE_TYPES} so a real-content sim resolves them through its `landscape` table too.
 */

/** The base of the reserved class-id band. Above every real landscape typeId (`landscapetypes.ini`
 *  ≤ 87) and the sandbox's synthetic resource-landscape band (`1000 + good`), so a class id never
 *  aliases a content typeId. Kept a multiple of the render's `TILE_COLOURS` length (5, `render`'s
 *  `gpu/terrain/geometry.ts`) so `flatTileColour(TERRAIN_CLASS_BASE + k) === TILE_COLOURS[k]`: the
 *  flat placeholder ground keeps each class's own colour after the re-band. */
export const TERRAIN_CLASS_BASE = 9000;

/** Plain ground: walkable and buildable. (The sandbox catalog's GRASS is this id.) */
export const TERRAIN_OPEN = TERRAIN_CLASS_BASE + 0;
/** Ground that is neither walkable nor buildable. In authored scene grids this is WATER; a resolved
 *  real map also lands its border, mountain-face and void-filler ground here — the class carries the
 *  flags, not the one look. */
export const TERRAIN_IMPASSABLE = TERRAIN_CLASS_BASE + 1;
/** A landscape object's body (tree trunk / rock / deposit): neither walkable nor buildable. */
export const TERRAIN_BLOCKED = TERRAIN_CLASS_BASE + 2;
/** Ground you can walk but not build on: an object's build-exclusion ring, or a real ground class
 *  whose `humancanwalkon 1` lacks `housecanbebuildon` (mountain slopes, snow). */
export const TERRAIN_MARGIN = TERRAIN_CLASS_BASE + 3;
/** BARREN open ground: walkable and buildable like {@link TERRAIN_OPEN}, but crops cannot be sown on
 *  it — a real ground class with walk+build flags but no `biocanplanton` (sand, beach, desert stone;
 *  `trianglepatterntypes.cif` gives that flag to `land` alone). Split from OPEN so the farmer drive's
 *  grass-only field gate survives the semantic-class resolve. */
export const TERRAIN_BARREN = TERRAIN_CLASS_BASE + 4;

/** One sim nav-terrain class as a `landscape` row: the walk/build/plant flags `buildTerrainGraph`
 *  resolves a class id into. `plantable` is omitted (schema-default false) on every class but grass. */
export interface NavLandscapeType {
  readonly typeId: number;
  readonly id: string;
  readonly walkable: boolean;
  readonly buildable: boolean;
  readonly plantable?: boolean;
}

/**
 * The five nav-terrain classes as `landscape` rows — the walk/build/plant flags a collision-resolved
 * grid (`content/collision.ts`) or an authored scene grid navigates on. Row ids keep the authored-scene
 * reading (class 0 shows as grass, class 1 as water) but are documentary: landscape rows are only ever
 * looked up by `typeId`.
 */
export const NAV_LANDSCAPE_TYPES: readonly NavLandscapeType[] = [
  // Grass is the one plantable class — the original's `biocanplanton` ground flag
  // (trianglepatterntypes.cif) belongs to `land` alone, so grain fields land here and nowhere else.
  { typeId: TERRAIN_OPEN, id: 'grass', walkable: true, buildable: true, plantable: true },
  { typeId: TERRAIN_IMPASSABLE, id: 'water', walkable: false, buildable: false },
  { typeId: TERRAIN_BLOCKED, id: 'landscape_body', walkable: false, buildable: false },
  { typeId: TERRAIN_MARGIN, id: 'landscape_margin', walkable: true, buildable: false },
  // Sand/beach/desert stone: open for walking and building, closed to the plough (no `biocanplanton`).
  { typeId: TERRAIN_BARREN, id: 'barren', walkable: true, buildable: true },
];
