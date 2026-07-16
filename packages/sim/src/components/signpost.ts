import { defineComponent } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';

/**
 * A standing **signpost** (the original's guidepost, `ls_guidepost.bmd`) — the scout-erected navigation
 * marker. A signpost entity is `Position + Owner + Signpost`: it stands on one half-cell node, never
 * moves, blocks building placement on its cell (never movement — see `footprint/placement.ts`), and
 * anchors two circles:
 *
 *  - `navRadius` — the navigation work-area circle. When signpost navigation is on
 *    ({@link import('./rules.js').signpostNavigationEnabled}), a civilian settler may only work/walk
 *    within the union of its local radius and the circles of a connected signpost group it can reach
 *    (see `systems/signposts/network.ts`). Overlapping circles of one player's signposts form a group.
 *  - `spacingRadius` — the minimum-spacing circle: no second same-player signpost may be erected inside it.
 *
 * Radii are integer node-distances on the world metric (the vision-ellipse convention). Carried as data
 * per signpost (not read from a constant at query time) so future content-driven variants stay possible.
 */
export const Signpost = defineComponent<{ navRadius: number; spacingRadius: number }>('Signpost');

/**
 * The scout's pending "erect a signpost here" order — the `placeSignpost` command's en-route marker.
 * The scout walks to `goal` under a normal `PlayerOrder`; the SignpostOrderSystem starts the one-shot
 * build-guide hammer atomic on arrival and the signpost spawns when it completes (`erectSignpost`
 * effect). Dropped when the walk fails, a need interrupts it, or the spot became illegal meanwhile.
 */
export const ErectSignpostOrder = defineComponent<{ goal: NodeId }>('ErectSignpostOrder');

/**
 * The signpost circle radii, in half-cell nodes on the world metric (the `SCOUT_VISION_NODES`
 * convention: one node = 34 px E/W). Named approximations, not source-pinned values: the original's
 * guidepost ranges live only in the game executables (no plaintext/.cif data carries them —
 * landscapes.cif and logicdefines.inc checked), so these are user-tunable, calibrated against the
 * running original by eye.
 */
export const SIGNPOST_NAV_RADIUS_NODES = 40;
export const SIGNPOST_SPACING_RADIUS_NODES = 16;

/**
 * The civilian settler's own work reach (nodes, world metric) when signpost navigation is on: a settler
 * may always act within this circle around where it stands, plus any signpost group whose circles it can
 * reach from inside that local circle. Same approximation basis as the signpost radii above; sized to the
 * gatherer's `DEFAULT_WORK_FLAG_RADIUS` scale so an unbound settler keeps a useful nearby patch.
 */
export const LOCAL_NAV_RADIUS_NODES = 24;
