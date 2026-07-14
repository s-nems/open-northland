import { defineComponent, type Entity } from '../../ecs/world.js';

/**
 * A harvestable resource node placed in the world (a tree, ore vein, berry bush). It yields its `goodType`
 * when a settler runs the good's harvest atomic on its cell; `remaining` is the units left — each completed
 * harvest decrements it (AtomicSystem's harvest effect), so a finite node empties and the planner's
 * `remaining <= 0` gate skips it. `harvestAtomic` is the numeric atomic id to run (the good's
 * `atomicForHarvesting`), kept so the planner picks the atomic from content rather than hardcoding one. The
 * resource occupies the nav node under its {@link Position} (via `nodeAtClamped`).
 */
export const Resource = defineComponent<{
  goodType: number;
  remaining: number;
  harvestAtomic: number;
  /**
   * Opaque render-variant tag a decoded-map spawn carries (the app's species record index — "pine 02"
   * rather than the good's representative "yew 01"); the render keys its exact bob off it via the snapshot.
   * Never read by any sim decision, absent on admin/scene spawns.
   */
  gfxIndex?: number;
}>('Resource');

/** One integer cell offset relative to a placed resource node's anchor tile. */
export interface ResourceFootprintCell {
  readonly dx: number;
  readonly dy: number;
}

/**
 * Data-driven collision/work footprint for a standing {@link Resource} node, copied from its
 * harvest-stage `[GfxLandscape]` record (`LogicWalkBlockArea`, `LogicBuildBlockArea`, `LogicWorkArea`).
 *
 * The marker is deliberately separate from {@link Resource}: old synthetic tests and one-off fixtures
 * that place a bare resource keep the pre-footprint same-tile behavior, while real/imported nodes and
 * acceptance scenes stamp this component from content. `walk` cells enter the dynamic pathfinding
 * overlay, `build` cells reserve the no-building ring, and `work` cells are where a collector stands
 * to run the harvest atomic. The original footprint rows are valency-state keyed; the resolver stamps
 * the highest state (the fresh/full node) so collision is static until the node is removed.
 */
export interface ResourceFootprintData {
  readonly walk: readonly ResourceFootprintCell[];
  readonly build: readonly ResourceFootprintCell[];
  readonly work: readonly ResourceFootprintCell[];
  /** Source `[GfxLandscape].index`, retained for provenance/debugging. */
  readonly sourceGfxIndex: number;
}

export const ResourceFootprint = defineComponent<ResourceFootprintData>('ResourceFootprint');

/**
 * Marks a {@link Resource} node that is felled, not gathered unit-by-unit — a tree the collector chops down
 * over several swings, faithful to the original's `tree → "tree falling" → trunk` lifecycle
 * (`landscapetypes.ini`; the good's `chopsToFell`/`yieldPerNode` params). Present only on a fellable node:
 * the placement code (scenes/vertical-slice/tests) stamps it from the good's `gathering.chopsToFell` (there
 * is no resource-spawn system yet). A {@link MineDeposit} node instead drops one unit per swing and shrinks
 * by level; a node with neither marker is the trivial direct-pickup (a mushroom: one swing onto the back).
 *
 * `chopsLeft` counts the chops still needed — each completed harvest atomic decrements it (yielding nothing
 * onto the settler's back, unlike a single-hit gather), and the node falls when it reaches 0: the standing
 * node is destroyed and its whole `Resource.remaining` yield drops at its cell as a bare {@link Stockpile}
 * trunk pile (a {@link GroundDrop}) the collector then carries off.
 */
export const Felling = defineComponent<{ chopsLeft: number }>('Felling');

/**
 * Marks a {@link Resource} node that is mined, not felled or picked whole — a stone/iron/gold/clay deposit
 * the collector chips one unit at a time, faithful to the original's `mine → ore → pile` pipeline (a mined
 * good has a distinct `landscapeToPickup` "ore" stage, unlike a mushroom whose harvest is its pickup;
 * `bioLandscape 0` in the data). Present only on a mined node, stamped by the placement code from the good's
 * `gathering.depositSize`/`depositLevels` (the same observed calibration route {@link Felling} uses). Each
 * completed harvest atomic drains one unit off `Resource.remaining` and drops it at the node's cell as a
 * bare {@link Stockpile} ore pile (a {@link GroundDrop}); the node is removed when `remaining` hits 0, so a
 * deposit empties over its whole `initial` size, unlike a fell-once tree.
 *
 * `initial` is the deposit's size at spawn (the {@link Resource.remaining} it started with) — the
 * denominator the render's shrink-by-level pick needs (a level is `remaining/initial` bucketed into `levels`
 * visual states, the `[GfxLandscape]` mine record's fill frames). `levels` is that state count (observed =
 * the ls_ground mine gfx's 5 fill states; source basis).
 *
 * `strikesPerUnit`/`strikes` make a unit take several work cycles: each completed harvest atomic advances
 * `strikes`, and only the strike that reaches `strikesPerUnit` chips the unit off (drops the ore, drains
 * `remaining`, resets the counter). Observed calibration like {@link Felling.chopsLeft} — the readable data
 * has no per-unit strike count (`atomicanimations.ini` carries only the single-swing cycle length). A node
 * stamped without the field (older fixtures) behaves as 1 strike per unit.
 */
export const MineDeposit = defineComponent<{
  initial: number;
  levels: number;
  /** Work cycles per chipped unit (≥1; OBSERVED — see the component doc). */
  strikesPerUnit?: number;
  /** Progress toward the next unit (0..strikesPerUnit-1), reset on each chipped unit. */
  strikes?: number;
}>('MineDeposit');

/**
 * A stump / debris decor entity left where a {@link Felling} node fell — the tree-debris the original leaves
 * behind (`ls_trees_dead.bmd` "tree debris", `landscapetype` logic 1: pure-decor, non-blocking, not
 * harvestable). It carries only a {@link Position} and this marker, so it draws (the render keys a per-good
 * debris frame off `goodType`) but takes part in no sim decision. `goodType` records which resource it is
 * the remains of, so a future per-good decor binding can pick the right debris.
 */
export const Stump = defineComponent<{ goodType: number }>('Stump');

/**
 * Marks a bare {@link Stockpile} that is a dropped resource pile — the trunk a felled {@link Felling} node
 * leaves on the ground (also reused for a mined good's per-unit drops). It rides on top of the plain
 * `Stockpile + Position` shape the ground-pile machinery already handles (`nearestGroundPile`, the porter
 * drive), so pickup/delivery consume it unchanged; the marker adds two things a designated delivery flag (an
 * equally-bare `Stockpile`) must not get: (1) it is the target a felling collector's own collect-trunk drive
 * prefers, and (2) it is auto-reaped when emptied, so a long game doesn't accrete an empty pile per felled
 * tree. `goodType` is for legibility/debug; its presence is what the sim keys on.
 */
export const GroundDrop = defineComponent<{ goodType: number }>('GroundDrop');

/**
 * Marks a {@link GroundDrop} pile with the settler that harvested it into being — a felled trunk's or a
 * mined ore unit's owner. Stamped only when the harvester is a flag-bound gatherer (carries a
 * {@link WorkFlag}), it is what makes a gatherer carry off only what it dug itself: the collect drive
 * reclaims a drop only when `by` is its own entity, so a loose pile it did not make (another settler's trunk,
 * a player-dropped heap, a map-seeded pile) is left in peace. A cross-reference id (entity ids are monotonic
 * and never reused, so a dead owner's id can never re-alias a live settler).
 *
 * A drop made by a flagless collector carries none, hashing and collecting exactly as before.
 */
export const HarvestedBy = defineComponent<{ by: Entity }>('HarvestedBy');

/**
 * A wild berry bush — a natural food source anyone can graze, distinct from the job-gated {@link Resource}
 * gathering economy: a hungry settler forages a ripe bush directly (the `forage` atomic) to feed itself, no
 * job or tool needed, and the bush regrows its fruit over time. It is not a {@link Resource} on purpose — it
 * carries no harvest atomic and never enters a gatherer's harvest scans, so bushes stay out of the
 * wood/stone/ore economy and are only ever eaten off.
 *
 * source-basis: the original's `landscapetypes.ini` bush cycle — `bush with fruits` (type 11) on the PICK
 * trigger (`transition 3 <bush naked> 2 0 18`) yields good 18 `fruit` and becomes `bush naked` (type 9),
 * which regrows `naked → flowering (10) → with fruits (11)` on the periodic GROWTH trigger (`transition 7 …`).
 * The single `transition 3` sends `with fruits` straight to `naked`, so one forage empties it — a bush holds
 * exactly one serving.
 *
 * Named divergence from the source: that pick transition produces good 18 `fruit` into the economy, but good
 * 18 has no extracted `gatheringPipeline`, so this model discards the good and feeds the eater directly —
 * wild grazing, not a gather-a-good step. The regrow duration and the two-step flowering stage are likewise
 * named approximations: the trigger-7 period is not decoded, so {@link BerryBush} collapses
 * naked→flowering→fruits into one ripe/bare state timed by `ripeAtTick` (see systems/economy/berries.ts).
 *
 * `ripe` is whether the bush currently holds fruit (forageable). `ripeAtTick` is the absolute tick the
 * BerryGrowthSystem flips a bare bush back to ripe (an exact integer compare, so the snapshot scenery cache
 * only re-clones a bush at the two moments it changes: foraged, and regrown); unused (0) while ripe.
 * `gfxIndex` is the opaque render-variant tag ({@link Resource.gfxIndex}'s twin — the decoded map's
 * fruited-bush `[GfxLandscape]` index) the render keys its bush species off; the sim never reads it.
 */
export const BerryBush = defineComponent<{
  ripe: boolean;
  ripeAtTick: number;
  gfxIndex?: number;
}>('BerryBush');
