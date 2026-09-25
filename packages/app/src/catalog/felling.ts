/**
 * Felling calibration: the one global source for a felled tree's yield, so it is never re-picked per scene.
 * The strokes that fell a tree come from the feller's experience track, not from here.
 */

/** The whole wood a felled tree drops as its trunk on the ground, then carried off in carry-capacity loads.
 *  Original behavior: a tree falls after ten novice strokes and yields three wood. */
export const WOOD_YIELD_PER_NODE = 3;
