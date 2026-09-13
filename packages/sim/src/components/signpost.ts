import { defineComponent } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/**
 * A standing signpost (the original's guidepost, `ls_guidepost.bmd`) - the scout-erected navigation marker.
 * It stands on one half-cell node, never moves, and blocks building placement on its cell but never
 * movement. `navRadius` is the work-area circle it adds to the navigation limit of a settler that reaches
 * its group; `spacingRadius` is the circle no second same-player signpost may be erected inside. Both are
 * integer node-distances on the world metric, carried per signpost rather than read from a constant.
 */
export const Signpost = defineComponent<{ navRadius: number; spacingRadius: number }>('Signpost', 'economy');

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
 * The signpost circle radii, in half-cell nodes on the world metric (one node = 34 px E/W).
 * Approximations: no plaintext or `.cif` data carries the original's guidepost ranges (`landscapes.cif`
 * and `logicdefines.inc` checked), so these are tunable, calibrated against the running original by eye.
 */
export const SIGNPOST_NAV_RADIUS_NODES = 24;
export const SIGNPOST_SPACING_RADIUS_NODES = 18;

/**
 * The civilian settler's own work reach in nodes on the world metric when signpost navigation is on: it may
 * always act within this circle around where it stands, plus any signpost group reachable from inside it.
 * Same approximation basis as the signpost radii above, sized to the gatherer's `DEFAULT_WORK_FLAG_RADIUS`.
 */
export const LOCAL_NAV_RADIUS_NODES = 24;
