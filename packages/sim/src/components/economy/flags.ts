import { defineComponent, type Entity } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';

/**
 * Binds a gatherer to its own flag - the collection point it carries every harvested good to, and the
 * centre of the bounded area it looks for work in:
 *
 *  - it harvests only nodes within `radius` (integer node-distance) of `flag`, and with nothing in range
 *    stands idle beside the flag rather than roaming the map;
 *  - it collects only its own harvested drops ({@link HarvestedBy} keyed to it), leaving loose piles alone;
 *  - it delivers its load onto loose ground heaps around `flag`, not into the nearest store;
 *  - `goodType` narrows new harvest targets to one map good; absence accepts every good the job may harvest.
 *
 * `radius` is a named work-area size carried as data rather than a constant in code, since the original's
 * collector work radius is not decoded. A gatherer without the component roams for the nearest node
 * anywhere and hauls to the nearest store.
 */
export const WorkFlag = defineComponent<{ flag: Entity; radius: number; goodType?: number }>('WorkFlag');

/**
 * A building-employed gatherer's single-good harvest pick - the flag-less sibling of
 * {@link WorkFlag.goodType}. An employed gatherer roams only for goods its workplace's stockpile stores;
 * this narrows that set to one. Absent means every stored good. Removed on any employment change, since a
 * new workplace stores a different set.
 */
export const GatherSelection = defineComponent<{ goodType: number }>('GatherSelection');

/**
 * Marks a positioned entity as a designated delivery flag - a gatherer's collection point, and a pure
 * marker: `Position + DeliveryFlag` and nothing else, because it stores no goods. The harvest delivered to
 * it piles on the ground around it as separate loose `Stockpile + Position` heaps, so relocating the flag
 * moves only the marker, never the goods already dropped. The render keys the flag graphic, drawn on top of
 * any co-located heap, on its presence.
 */
export const DeliveryFlag = defineComponent<Record<string, never>>('DeliveryFlag');

/** A flag gatherer's typed navigation intent for its current yard candidate. `failed` is set only when the
 * matching budgeted PathRequest fails, preserving provenance while needs/combat temporarily take priority;
 * the next delivery plan then resumes after `goal` instead of mistaking an unrelated failed route for yard
 * progress. Removed when pileup starts or the flag binding is dropped. */
export const YardDeliveryRoute = defineComponent<{
  flag: Entity;
  goodType: number;
  goal: NodeId;
  failed: boolean;
}>('YardDeliveryRoute');

/**
 * The default work radius a newly placed gatherer flag gets: 24 half-cell nodes, about 12 tiles. A named
 * approximation, not a source-pinned value - the original's collector work-area size is not decoded - sized
 * so a gatherer reaches a decent patch around its flag without roaming the whole map.
 */
export const DEFAULT_WORK_FLAG_RADIUS = 24;

/**
 * The hunter's work radius in the same node-distance, wider than the gatherer default because a hunter
 * ranges after mobile game that scatters on every shot. Hunter-only; every other gatherer keeps the
 * default. A named approximation - the original's hunter range is not decoded - calibrated against kills
 * taken per sweep and how far the crew ends up standing from its flag.
 */
export const HUNTER_WORK_FLAG_RADIUS = 48;
