import { defineComponent, type Entity } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/**
 * A standing signpost (the original's guidepost, `ls_guidepost.bmd`) - the scout-erected navigation marker.
 * It stands on one half-cell node, never moves, and blocks building placement on its cell but never
 * movement. `links` are the same-player posts it is connected to, symmetric and in ascending entity
 * order; they are settled when a post rises or falls, as the original keeps each guide's connection
 * list (macOS symbols `an original routine`).
 */
export const Signpost = defineComponent<{ links: readonly Entity[] }>('Signpost', 'economy');

/**
 * The scout's pending "erect a signpost here" order - the `placeSignpost` command's en-route marker. The
 * scout walks to `goal` under a normal `PlayerOrder`, then the build-guide hammer atomic's `erectSignpost`
 * effect spawns the post. Dropped when the walk fails, a need interrupts it, or the spot became illegal
 * meanwhile.
 */
export const ErectSignpostOrder = defineComponent<{ goal: NodeId }>('ErectSignpostOrder', 'settlers');

/**
 * A scout's standing "explore around here" order: it walks to unexplored ground within
 * {@link EXPLORE_RADIUS_NODES} of `centre`, one point at a time, and the order ends once nothing inside
 * that circle is still unseen. A walk order, a trade change, or the scout's death calls it off.
 *
 * `leg` is the last leg issued - where the scout stood and where it was sent. Re-picking that same pair
 * means the walk never started, so the sweep gives up rather than re-issuing it every tick.
 */
export const ExploreOrder = defineComponent<{
  centre: NodeId;
  leg: { from: NodeId; to: NodeId } | null;
}>('ExploreOrder', 'settlers');

/**
 * How far from its explore centre a scout will walk to reveal ground, in half-cell nodes on the world
 * metric. Approximation, sized to the signpost work circle: the original searches a fixed box around the
 * scout's work centre, whose unit is not readable here.
 */
export const EXPLORE_RADIUS_NODES = 40;

/**
 * How far a civilian plans a walk without signposts, in hex node distance (`nav/hex-distance.ts`) from
 * where it stands: the original's pathfinder range, re-measured from the current position on every leg,
 * so there is no fixed anchor. A goal may lie exactly the range away, but a signpost is caught, and
 * covers a goal, only strictly inside it: the walk compares with `<=`, the guide search with `<`. Byte
 * evidence: `an original routine`/`Carrier`, the original data 0x4f1308, and the searches
 * an original routine / an original routine.
 */
export const WALK_RANGE_NODES = 50;
export const CARRIER_WALK_RANGE_NODES = 63;

/**
 * Two same-player signposts link when their hex distance is under this and walkable ground joins them
 * within it. Byte evidence: the guide connection flood's radius (the original an original routine).
 */
export const SIGNPOST_LINK_RANGE_NODES = 40;

/** No second same-player signpost may rise inside this hex distance of a standing one. Byte evidence:
 *  the original an original routine. */
export const SIGNPOST_SPACING_NODES = 16;

/** The post's standing fog eye, in nodes on the world metric. Authored, no original counterpart. */
export const SIGNPOST_VISION_NODES = 24;
