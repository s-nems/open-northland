/**
 * The SEMANTIC terrain classes every sim grid uses — committed clean-room vocabulary, not extracted
 * data (a catalog leaf both `game/sandbox` and `content/` may import without coupling to each other).
 * Scene grids are authored in these ids directly; a real decoded map is RESOLVED into them by
 * `content/collision.ts` (its ground/object lanes joined against the extracted class tables) before
 * it reaches the sim. Keeping the sim-side vocabulary to these four ids is what makes the walk/build
 * flags collision-free: a raw map typeId (1 = the original's "void" plain ground) never lands on a
 * synthetic row with different semantics.
 */

/** Plain ground: walkable and buildable. (The sandbox catalog's GRASS is this id.) */
export const TERRAIN_OPEN = 0;
/** Ground that is neither walkable nor buildable. In authored scene grids this is WATER (the row id
 *  the sandbox table keeps); a resolved real map also lands its border, mountain-face and void-filler
 *  ground here — the class carries the FLAGS, not the one look. */
export const TERRAIN_IMPASSABLE = 1;
/** A landscape object's body (tree trunk / rock / deposit): neither walkable nor buildable. */
export const TERRAIN_BLOCKED = 2;
/** Ground you can walk but not build on: an object's build-exclusion ring, or a real ground class
 *  whose `humancanwalkon 1` lacks `housecanbebuildon` (mountain slopes, snow). */
export const TERRAIN_MARGIN = 3;
