import { defineComponent, type Entity } from '../../ecs/world.js';

/**
 * A harvestable resource node placed in the world (a tree, ore vein, berry bush). It yields its `goodType`
 * when a settler runs the good's harvest atomic on its cell; `remaining` is the units left — each completed
 * harvest decrements it, so a finite node empties and the planner's `remaining <= 0` gate skips it.
 * `harvestAtomic` is the numeric atomic id to run (the good's `atomicForHarvesting`). The resource occupies
 * the nav node under its {@link Position} (via `nodeAtClamped`).
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
 * `walk` cells enter the dynamic pathfinding overlay, `build` cells reserve the no-building ring, and `work`
 * cells are where a collector stands to run the harvest atomic. This is the ONLY declaration of what a node
 * blocks, so a node that blocks nothing says so with empty `walk`/`build` rather than by omitting the
 * component: absence means "no declaration", and the placement rule then assumes a body (a bare fixture tree
 * keeps the pre-footprint same-tile behaviour).
 *
 * The original footprint rows are valency-state keyed; the resolver stamps the highest state (the fresh/full
 * node) so collision is static until the node is removed.
 */
export interface ResourceFootprintData {
  readonly walk: readonly ResourceFootprintCell[];
  readonly build: readonly ResourceFootprintCell[];
  readonly work: readonly ResourceFootprintCell[];
  /** Source `[GfxLandscape].index`, retained for provenance/debugging. Absent on a footprint the sim
   *  declares itself (a sown field), which stands for no landscape record. Never read by a decision. */
  readonly sourceGfxIndex?: number;
}

export const ResourceFootprint = defineComponent<ResourceFootprintData>('ResourceFootprint');

/**
 * Marks a {@link Resource} node that is felled rather than gathered unit-by-unit — a tree the collector chops
 * down over several swings, faithful to the original's `tree → "tree falling" → trunk` lifecycle
 * (`landscapetypes.ini`; the good's `chopsToFell`/`yieldPerNode` params). Stamped by the placement code from
 * `gathering.chopsToFell` (there is no resource-spawn system yet).
 *
 * `chopsLeft` counts the chops still needed: each completed harvest atomic decrements it, yielding nothing
 * onto the settler's back, and the node falls at 0 — the standing node is destroyed and its whole
 * `Resource.remaining` yield drops at its cell as a bare {@link Stockpile} trunk pile (a {@link GroundDrop}).
 * A {@link MineDeposit} node instead drops one unit per swing; a node with neither marker is the direct
 * pickup (a mushroom: one swing onto the back).
 */
export const Felling = defineComponent<{ chopsLeft: number }>('Felling');

/**
 * Marks a {@link Resource} node that is mined — a stone/iron/gold/clay deposit the collector chips one unit
 * at a time, faithful to the original's `mine → ore → pile` pipeline (a mined good has a distinct
 * `landscapeToPickup` "ore" stage, unlike a mushroom whose harvest is its pickup; `bioLandscape 0` in the
 * data). Stamped by the placement code from the good's `gathering.depositSize`/`depositLevels`. Each chipped
 * unit drains one off `Resource.remaining` and drops at the node's cell as a bare {@link Stockpile} ore pile
 * (a {@link GroundDrop}); the node is removed when `remaining` hits 0.
 *
 * `initial` is the deposit's size at spawn — the denominator for the render's shrink-by-level pick (a level is
 * `remaining/initial` bucketed into `levels` visual states, the `[GfxLandscape]` mine record's fill frames).
 * `levels` is that state count (observed = the ls_ground mine gfx's 5 fill states).
 *
 * `strikesPerUnit`/`strikes` make a unit take several work cycles: each completed harvest atomic advances
 * `strikes`, and only the strike reaching `strikesPerUnit` chips the unit off and resets the counter. The
 * count is an observed calibration — the readable data has none (`atomicanimations.ini` carries only the
 * single-swing cycle length). A node stamped without the field behaves as 1 strike per unit.
 */
export const MineDeposit = defineComponent<{
  initial: number;
  levels: number;
  /** Work cycles per chipped unit (≥1; observed calibration — see the component doc). */
  strikesPerUnit?: number;
  /** Progress toward the next unit (0..strikesPerUnit-1), reset on each chipped unit. */
  strikes?: number;
}>('MineDeposit');

/**
 * A stump / debris decor entity left where a {@link Felling} node fell (`ls_trees_dead.bmd` "tree debris",
 * `landscapetype` logic 1: pure-decor, non-blocking, not harvestable). It carries only a {@link Position} and
 * this marker, so it draws but takes part in no sim decision. `goodType` records which resource it is the
 * remains of, so a future per-good decor binding can pick the right debris.
 */
export const Stump = defineComponent<{ goodType: number }>('Stump');

/**
 * Marks a bare {@link Stockpile} that is a dropped resource pile — the trunk a felled {@link Felling} node
 * leaves on the ground, also reused for a mined good's per-unit drops. It rides on the plain
 * `Stockpile + Position` shape the ground-pile machinery already handles (`nearestGroundPile`, the porter
 * drive), so pickup/delivery consume it unchanged; the marker adds the two things a designated delivery flag
 * (an equally-bare `Stockpile`) must not get: a felling collector's collect-trunk drive prefers it, and it is
 * auto-reaped when emptied so a long game doesn't accrete an empty pile per felled tree. `goodType` is for
 * legibility/debug; its presence is what the sim keys on.
 */
export const GroundDrop = defineComponent<{ goodType: number }>('GroundDrop');

/**
 * Marks a {@link GroundDrop} pile with the settler that harvested it into being. Stamped only when the
 * harvester is a flag-bound gatherer (carries a {@link WorkFlag}), it is what makes a gatherer carry off only
 * what it dug itself: the collect drive reclaims a drop only when `by` is its own entity, so a loose pile it
 * did not make (another settler's trunk, a player-dropped heap, a map-seeded pile) is left in peace. Entity
 * ids are monotonic and never reused, so a dead owner's id can never re-alias a live settler. A drop made by
 * a flagless collector carries none.
 */
export const HarvestedBy = defineComponent<{ by: Entity }>('HarvestedBy');

/**
 * A wild berry bush — a natural food source anyone can graze, distinct from the job-gated {@link Resource}
 * gathering economy: a hungry settler forages a ripe bush directly (the `forage` atomic), no job or tool
 * needed, and the bush regrows over time. Deliberately not a {@link Resource}: it carries no harvest atomic
 * and never enters a gatherer's harvest scans.
 *
 * source-basis: the original's `landscapetypes.ini` bush cycle — `bush with fruits` (type 11) on the PICK
 * trigger (`transition 3 <bush naked> 2 0 18`) yields good 18 `fruit` and becomes `bush naked` (type 9),
 * which regrows `naked → flowering (10) → with fruits (11)` on the periodic GROWTH trigger (`transition 7 …`).
 * The single `transition 3` sends `with fruits` straight to `naked`, so a bush holds exactly one serving.
 *
 * The regrow is modelled as those three discrete `stage`s (`bare` = naked, `flowering`, `ripe` = with
 * fruits) so the two source growth steps read on the map: a foraged bush is `bare`, blooms `flowering` at
 * the midpoint of its regrow, then holds fruit again. Only a `ripe` bush is forageable.
 *
 * Named divergence: the pick transition produces good 18 `fruit` into the economy, but good 18 has no
 * extracted `gatheringPipeline`, so this model discards the good and feeds the eater directly — wild grazing,
 * not a gather-a-good step. The regrow duration is approximated (the trigger-7 period is not decoded — see
 * systems/economy/berries.ts); the two growth steps are equal halves, so `flowering` lands at exactly half.
 *
 * `stage` is the bush's current growth state. `nextStageAtTick` is the absolute tick the BerryGrowthSystem
 * advances a regrowing bush to its next stage (absolute, not a countdown: an exact integer compare, so the
 * snapshot scenery cache re-clones a bush only at its three transitions per cycle); unused (0) while `ripe`.
 * `gfxIndex` is the render-variant tag (see {@link Resource.gfxIndex}).
 */
export type BerryBushStage = 'bare' | 'flowering' | 'ripe';
export const BerryBush = defineComponent<{
  stage: BerryBushStage;
  nextStageAtTick: number;
  gfxIndex?: number;
}>('BerryBush');
