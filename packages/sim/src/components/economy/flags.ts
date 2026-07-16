import { defineComponent, type Entity } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';

/**
 * Binds a **gatherer to its own flag** — the collection point it carries every harvested good to, and the
 * centre of the bounded area it looks for work in. The whole of the user-specified gatherer behaviour keys
 * on it (the AI planner's harvest/collect drive, `planGatherer`):
 *
 *  - a bound gatherer HARVESTS only nodes within `radius` (integer node-distance) of `flag`; nothing in
 *    range → it walks to and stands idle beside its flag rather than roaming the map;
 *  - it collects ONLY its own harvested drops ({@link HarvestedBy} keyed to it), leaving loose piles alone;
 *  - it DELIVERS its load to `flag` (`deliveryTargetFor`), spreading it onto loose ground heaps AROUND the
 *    flag (the flag is a marker, not a store), not merely into the nearest store.
 *  - `goodType` narrows new harvest targets to one map good; absence accepts every good the job may harvest.
 *
 * `flag` references a positioned {@link DeliveryFlag} MARKER (no {@link Stockpile} — it stores nothing; the
 * harvest piles on the GROUND around it as separate loose heaps, so moving the flag never moves the goods);
 * `radius` is a named work-area size (the original's collector work radius is not decoded, so it is an
 * OBSERVED/tunable approximation carried as data, not a magic constant in code).
 *
 * The **separate-optional-component pattern**: a gatherer WITHOUT it falls back to the prior roam-and-haul
 * behaviour (nearest node anywhere, nearest trunk of its trade, nearest store), so every existing scene,
 * test, and golden — none of which stamp a WorkFlag — is byte-identical. Only an explicitly flag-bound
 * gatherer opts into the new behaviour.
 */
export const WorkFlag = defineComponent<{ flag: Entity; radius: number; goodType?: number }>('WorkFlag');

/**
 * A **building-employed gatherer's** single-good harvest pick — the flag-less sibling of
 * {@link WorkFlag.goodType}. An employed gatherer (a {@link JobAssignment} at a stocking building, no
 * flag) roams only for goods its workplace's stockpile stores; this narrows that set to one good (the
 * `setGatherGood` command with no live flag). Absent = every stored good. Removed on any employment
 * change (a new workplace stores a different set) and by the command's `null` reset — the
 * separate-optional-component pattern, so unstamped settlers and existing goldens are byte-identical.
 */
export const GatherSelection = defineComponent<{ goodType: number }>('GatherSelection');

/**
 * Marks a positioned entity as a **designated delivery flag** — a gatherer's collection point. A flag is a
 * pure MARKER: `Position + DeliveryFlag` and NOTHING else (no {@link Stockpile}), because it stores no
 * goods — the harvest a gatherer delivers piles on the GROUND around it as separate loose `Stockpile+Position`
 * heaps, each pinned to its own tile. That separation is the whole point: relocating the flag ({@link
 * setWorkFlag}) moves only the marker, never the goods already dropped (they "never teleport"). Its presence
 * is also what render keys on to draw the flag graphic ON TOP of any co-located goods heap. Stamped on every
 * flag the scene/command creates ({@link WorkFlag} targets, `setWorkFlag`). Inert on the golden slice (which
 * has no flags), so the hash is untouched — the separate-optional-component pattern.
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
 * The default work radius (integer node-distance on the half-cell lattice) a newly placed gatherer flag
 * gets — used by the `setWorkFlag` command, the spawn-time auto-plant, and the sandbox scene binding. 24
 * half-cell nodes ≈ 12 tiles (a ~24-tile-wide work area). A named approximation, not a source-pinned value:
 * the original's collector work-area size is not decoded, so this is observed/tunable (chosen "sporawy" so a
 * gatherer reaches a decent patch around its flag without roaming the whole map).
 */
export const DEFAULT_WORK_FLAG_RADIUS = 24;
