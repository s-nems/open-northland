import { defineComponent, type Entity } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/**
 * A standing signpost (the original's guidepost, `ls_guidepost.bmd`) - the scout-erected navigation marker.
 * It stands on one half-cell node and moves only when its owner's building covers it, by a re-add of this
 * component. It blocks a work flag and a rival's building zone on its cell, never movement. `links` are
 * the same-player posts it is connected to, symmetric and in ascending entity order; they are settled when
 * a post rises, falls or moves, as the original keeps each guide's connection list.
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
 * A scout's standing "explore" order: it walks to unseen ground on the landmass it stands on, one leg at a
 * time, in rings outward from `origin` (where the order was given), cutting a leg short once its goal comes
 * into view, and the order ends once nothing walkable there is still unseen. A walk order, a trade change,
 * or the scout's death calls it off.
 */
export interface ExploreSweep {
  readonly origin: NodeId;
  /** The fog-cell ring around `origin` that last held unseen ground, where the next search starts. */
  frontierRing: number;
  /** The last leg issued - where the scout stood and where it was sent - or null once a revealed goal had
   *  nothing left to turn to, or hunger took the scout off it. The leg failed when its route found no way
   *  (`failed`), or when the scout is free again on the node it left from. */
  leg: { readonly from: NodeId; readonly to: NodeId; failed: boolean } | null;
  /** The latest goals of failed legs, which later picks steer around. */
  unreachable: readonly NodeId[];
  /** Such failures since the last walk that got under way. */
  failedLegs: number;
}

export const ExploreOrder = defineComponent<ExploreSweep>('ExploreOrder', 'settlers');

/**
 * How far a civilian plans a walk without signposts, in hex node distance (`nav/hex-distance.ts`) from
 * where it stands: the original's pathfinder range, re-measured from the current position on every leg,
 * so there is no fixed anchor. A goal may lie exactly the range away, but a signpost is caught, and
 * covers a goal, only strictly inside it: the walk compares with `<=`, the guide search with `<`.
 * Original behavior: the normal and carrier walk ranges and the range searches.
 */
export const WALK_RANGE_NODES = 50;
export const CARRIER_WALK_RANGE_NODES = 63;

/**
 * Two same-player signposts link strictly inside this hex distance when a walk of at most
 * {@link SIGNPOST_LINK_STEPS} joins them, whatever the ground's resistance. Project rule: the original
 * links within 40 nodes under the goods search's resistance budget, which on the decoded maps' common
 * resistance 3 and 4 ground linked well under half of the post pairs 32 to 40 nodes apart.
 */
export const SIGNPOST_LINK_RANGE_NODES = 48;

/** The longest walk a link follows, in steps: twice its range, so a lake's long way round still cuts. */
export const SIGNPOST_LINK_STEPS = 2 * SIGNPOST_LINK_RANGE_NODES;

/** Original goods search radius, with a walkable, resistance-limited search rather than a disc. */
export const GOODS_SEARCH_RANGE_NODES = 40;

/** No second same-player signpost may rise inside this hex distance of a standing one (original
 *  placement rule). */
export const SIGNPOST_SPACING_NODES = 16;

/** How far a building placed over its owner's signpost may push the post, in the work-flag search's ring
 *  distance from where it stood. Authored. Past it the post falls rather than jumping to far-off ground. */
export const SIGNPOST_DISPLACE_RADIUS_NODES = 16;
