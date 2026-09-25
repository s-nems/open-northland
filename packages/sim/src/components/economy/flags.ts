import { defineComponent, type Entity } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';

/**
 * Binds a field worker to its own flag - the collection point it carries every harvested good to. For
 * an ordinary gatherer it is also the centre of the bounded area it looks for work in:
 *
 *  - it harvests only nodes within `radius` (integer node-distance) of `flag`, and with nothing in range
 *    stands idle beside the flag rather than roaming the map;
 *  - it collects only its own harvested drops ({@link HarvestedBy} keyed to it), leaving loose piles alone;
 *  - it delivers its load onto loose ground heaps around `flag`, not into the nearest store;
 *  - `goodType` narrows new harvest targets to one map good; absence accepts every good the job may harvest.
 *
 * A gatherer without the component roams for the nearest node anywhere and hauls to the nearest store.
 * An unposted fisher carries one so its catch returns to the player's chosen yard; a posted fisher banks
 * directly into its workplace.
 */
export const WorkFlag = defineComponent<{ flag: Entity; radius: number; goodType?: number | undefined }>(
  'WorkFlag',
  'economy',
);

/**
 * A building-employed gatherer's single-good harvest pick - the flag-less sibling of {@link WorkFlag}'s
 * `goodType`. An employed gatherer roams only for goods its workplace's stockpile stores; this narrows that
 * set to one. Absent means every stored good. Removed on any employment change, since a new workplace stores
 * a different set.
 */
export const GatherSelection = defineComponent<{ goodType: number }>('GatherSelection', 'economy');

/**
 * The node a gatherer is taking up and, once drawn, the stance it approaches it from. The stance is
 * drawn at random from the node's work area when the approach starts and kept until the stroke lands,
 * so a walk that takes several planner passes keeps one goal. After a counted stroke
 * (`atomics/stroke-cadence.ts`) a transform keeps the node and drops the stance, so the next approach
 * draws a fresh one, while a split-up keeps both, so the next stroke starts where the last was struck;
 * the gatherer rung returns to the node ahead of any scan, which completes the stroke count banked on it
 * rather than scattering it over the nearest nodes. Removed when the node is gone, extracted or claimed
 * by a colleague, or when the rung picks another.
 */
export const HarvestFocus = defineComponent<{ node: Entity; stance?: NodeId | undefined }>(
  'HarvestFocus',
  'economy',
);

/**
 * Marks a positioned entity as a designated delivery flag - a gatherer's collection point, and a pure
 * marker storing no goods. The harvest delivered to it piles on the ground around it as separate loose
 * `Stockpile + Position` heaps, so relocating the flag moves only the marker, never the goods already
 * dropped. The render keys the flag graphic, drawn on top of any co-located heap, on its presence.
 */
export const DeliveryFlag = defineComponent<Record<string, never>>('DeliveryFlag', 'economy');

/** A flag gatherer's typed navigation intent for its current yard candidate. `failed` is set only when the
 * matching budgeted PathRequest fails, so the next delivery plan resumes after `goal` instead of mistaking
 * an unrelated failed route for yard progress. Removed when pileup starts or the flag binding is dropped. */
export const YardDeliveryRoute = defineComponent<{
  flag: Entity;
  goodType: number;
  goal: NodeId;
  failed: boolean;
}>('YardDeliveryRoute', 'economy');

/**
 * The default work radius a newly placed gatherer flag gets: 24 half-cell nodes, about 12 tiles. A named
 * approximation - the original's collector work-area size is unknown - sized so a gatherer reaches a
 * decent patch around its flag without roaming the whole map.
 */
export const DEFAULT_WORK_FLAG_RADIUS = 24;

/**
 * The hunter's work radius in the same node-distance, wider than the gatherer default because a hunter
 * ranges after mobile game that scatters on every shot. Hunter-only; every other gatherer keeps the
 * default. A named approximation - the original's hunter range is unknown - calibrated against kills
 * taken per sweep and how far the crew ends up standing from its flag.
 */
export const HUNTER_WORK_FLAG_RADIUS = 48;
