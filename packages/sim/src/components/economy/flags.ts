import { defineComponent, type Entity } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';

/**
 * Binds a field worker to its own flag - the collection point it carries every harvested good to. For
 * an ordinary gatherer it is also the centre of the bounded area it looks for work in:
 *
 *  - it harvests only nodes within `radius` (Manhattan nodes; a hunter's ground counts map points) of
 *    `flag`, and with nothing in range stands idle beside the flag rather than roaming the map;
 *  - it collects only its own harvested drops ({@link HarvestedBy} keyed to it), leaving loose piles alone;
 *  - it delivers its load onto loose ground heaps around `flag`, not into the nearest store.
 *
 * A gatherer without the component roams for the nearest node anywhere and hauls to the nearest store.
 * An unposted fisher carries one so its catch returns to the player's chosen yard; a posted fisher banks
 * directly into its workplace.
 */
export const WorkFlag = defineComponent<{ flag: Entity; radius: number }>('WorkFlag', 'economy');

/**
 * Binds an employed carrier to a {@link DeliveryFlag} marker the player planted: it lifts loose ground
 * goods only within `radius` nodes of `flag` and waits beside it when none lie there, still delivering to
 * its workplace. A workshop carrier looks there for its missing inputs before the stores. Without it a
 * carrier collects wherever its signposts reach. The flag belongs to the carrier, not to the building.
 * Source basis: owner ruling after the CulturesNation mod's porter flag as the owner describes it; the
 * radius and the wait at the flag are owner choices, not measured behavior.
 */
export const HaulFlag = defineComponent<{ flag: Entity; radius: number }>('HaulFlag', 'economy');

/**
 * The node a gatherer is taking up and, once drawn, the stance it approaches it from, kept until the
 * stroke lands so a walk over several planner passes keeps one goal. The stroke cadence
 * (`atomics/stroke-cadence.ts`) decides whether the stance survives a counted stroke. Removed when the
 * node is gone, extracted or claimed by a colleague, when the rung picks another, once the gatherer's
 * counter stops its good, and on any change of trade, flag or gather good.
 */
export const HarvestFocus = defineComponent<{ node: Entity; stance?: NodeId | undefined }>(
  'HarvestFocus',
  'economy',
);

/**
 * Marks a positioned entity as a designated delivery flag - a gatherer's collection point or a carrier's
 * pickup area, and a pure marker storing no goods. The harvest delivered to it piles on the ground around
 * it as separate loose `Stockpile + Position` heaps, so relocating the flag moves only the marker, never
 * the goods already dropped. The render keys the flag graphic, drawn on top of any co-located heap, on its presence.
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
 * The default work radius a newly placed gatherer flag gets: 32 half-cell nodes, about 16 tiles. Original
 * behavior, unconfirmed against the running original: a collector searches a walk flood of about 20 steps
 * around its work centre. This radius is deliberately wider (owner's balance choice).
 */
export const DEFAULT_WORK_FLAG_RADIUS = 32;

/**
 * The hunter's work radius, counted in map points (hex distance) rather than the gatherer's Manhattan
 * nodes. Original behavior, unconfirmed against the running original: a hunter looks for game within 50
 * map points of its work centre. Hunter-only; every other gatherer keeps the default.
 */
export const HUNTER_WORK_FLAG_RADIUS = 50;

/**
 * How many re-plant searches in a row found nothing for a gatherer whose patch is worked out, held on
 * the gatherer while his flag stands on half-cell node (`hx`, `hy`). A record for another node is stale
 * and counts as none. Written by the assistant's flag follow, read by the AI to retire a hopeless post.
 */
export const ReplantMisses = defineComponent<{ hx: number; hy: number; misses: number }>(
  'ReplantMisses',
  'economy',
);
