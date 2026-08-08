import { defineComponent, type Entity } from '../../ecs/world.js';

/**
 * A harvestable resource node (a tree, ore vein, berry bush) yielding its `goodType` to the good's harvest
 * atomic (`harvestAtomic`, the good's `atomicForHarvesting`). `remaining` is the units left; the planner's
 * `remaining <= 0` gate skips an emptied node. The node occupies the nav node under its `Position`.
 */
export const Resource = defineComponent<{
  goodType: number;
  remaining: number;
  harvestAtomic: number;
  /** Opaque render-variant tag a decoded-map spawn carries (the app's species record index). Never read by
   *  a sim decision, absent on admin/scene spawns. */
  gfxIndex?: number;
  /** Swings banked toward the next plucked unit on a bare node whose trade plays several strokes per unit
   *  (`workRepeatsFor`, the extracted `baserepeatcounter`). Absent until first advanced and deleted when a
   *  unit frees. */
  strikes?: number;
}>('Resource');

/**
 * The still-buried yields of a multi-good {@link Resource} node, in extraction order: when the current good
 * drains, the deplete seam re-arms the node as the head layer instead of removing it. Built interleaved for
 * a carcass, whose two stages alternate per pluck (`landscapetypes.ini` 79 `cadaver_leather` / 80
 * `cadaver_meat`). Which stage a fresh kill opens with is not readable; meat-first is an approximation.
 */
export interface ResourceLayer {
  goodType: number;
  amount: number;
  harvestAtomic: number;
  gfxIndex?: number;
}

export const ResourceLayers = defineComponent<{ layers: ResourceLayer[] }>('ResourceLayers');

/** One integer cell offset relative to a placed resource node's anchor tile. */
export interface ResourceFootprintCell {
  readonly dx: number;
  readonly dy: number;
}

/**
 * Data-driven collision/work footprint for a standing {@link Resource} node, copied from its harvest-stage
 * `[GfxLandscape]` record (`LogicWalkBlockArea`, `LogicBuildBlockArea`, `LogicWorkArea`). `walk` cells enter
 * the dynamic pathfinding overlay, `build` cells reserve the no-building ring, and `work` cells are where a
 * collector stands. A node that blocks nothing says so with empty `walk`/`build`: an absent component means
 * "no declaration", and the placement rule then assumes a body.
 *
 * The original footprint rows are valency-state keyed; the resolver stamps the highest state, so collision
 * is static until the node is removed.
 */
export interface ResourceFootprintData {
  readonly walk: readonly ResourceFootprintCell[];
  readonly build: readonly ResourceFootprintCell[];
  readonly work: readonly ResourceFootprintCell[];
  /** Source `[GfxLandscape].index`, kept for provenance. Absent on a footprint the sim declares itself,
   *  which stands for no landscape record. Never read by a decision. */
  readonly sourceGfxIndex?: number;
}

export const ResourceFootprint = defineComponent<ResourceFootprintData>('ResourceFootprint');

/**
 * Marks a {@link Resource} node that is felled rather than gathered unit-by-unit, faithful to the original's
 * `tree -> "tree falling" -> trunk` lifecycle (`landscapetypes.ini`; the good's `chopsToFell` param).
 * `chopsLeft` counts the chops still needed, each yielding nothing onto the settler's back; the node falls
 * at 0, dropping its whole `Resource.remaining` at its cell as a {@link GroundDrop} trunk pile.
 */
export const Felling = defineComponent<{ chopsLeft: number }>('Felling');

/**
 * Marks a {@link Resource} node that is mined one unit at a time, faithful to the original's
 * `mine -> ore -> pile` pipeline (a mined good has a distinct `landscapeToPickup` "ore" stage, unlike a
 * mushroom whose harvest is its pickup). Each chipped unit drains one off `Resource.remaining` and drops at
 * the node's cell as a {@link GroundDrop} ore pile; the node is removed when `remaining` hits 0.
 *
 * `initial` is the deposit's full size - the denominator for the render's shrink-by-level pick - and stays
 * the full size for a node placed already part-mined, so both spawn paths share one ladder. `levels` is that
 * visual state count, per node: the `[GfxLandscape]` record's own for a map placement, the good's uniform
 * fallback otherwise.
 */
export const MineDeposit = defineComponent<{
  initial: number;
  levels: number;
  /** Work cycles per chipped unit (>= 1); a node stamped without it behaves as 1. Observed calibration: the
   *  readable data carries only the single-swing cycle length (`atomicanimations.ini`). */
  strikesPerUnit?: number;
  /** Progress toward the next unit (0..strikesPerUnit-1), reset on each chipped unit. */
  strikes?: number;
}>('MineDeposit');

/**
 * A stump/debris decor entity left where a {@link Felling} node fell (`ls_trees_dead.bmd` "tree debris",
 * `landscapetype` logic 1: pure decor, non-blocking, not harvestable). It takes part in no sim decision;
 * `goodType` records which resource it is the remains of.
 */
export const Stump = defineComponent<{ goodType: number }>('Stump');

/**
 * Marks a bare `Stockpile` that is a dropped resource pile. It rides on the plain `Stockpile +
 * Position` shape the ground-pile machinery already handles, and the marker adds the two things a
 * designated delivery flag must not get: a felling collector's collect-trunk drive prefers it, and it is
 * auto-reaped when emptied. `goodType` is for legibility; its presence is what the sim keys on.
 */
export const GroundDrop = defineComponent<{ goodType: number }>('GroundDrop');

/**
 * Names the settler whose harvest made this {@link GroundDrop}. Stamped only for a flag-bound gatherer
 * (one carrying a `WorkFlag`), whose collect drive reclaims a drop only when `by` is its own entity,
 * so a pile it did not make is left in peace. Entity ids are never reused, so a dead owner's id cannot
 * re-alias a live settler.
 */
export const HarvestedBy = defineComponent<{ by: Entity }>('HarvestedBy');

/** Names the hunter whose shot left this carcass {@link Resource}; absent on a node not shot into being. */
export const KilledBy = defineComponent<{ by: Entity }>('KilledBy');

/**
 * A wild berry bush a hungry settler forages directly (the `forage` atomic), no job or tool needed, and
 * which regrows over time. Deliberately not a {@link Resource}: it carries no harvest atomic and never
 * enters a gatherer's harvest scans. Only a `ripe` bush is forageable.
 *
 * Source basis: the `landscapetypes.ini` bush cycle - `bush with fruits` (11) on the PICK trigger
 * (`transition 3 <bush naked> 2 0 18`) yields good 18 `fruit` and becomes `bush naked` (9), which regrows
 * `naked -> flowering (10) -> with fruits (11)` on the periodic GROWTH trigger (`transition 7 ...`). The
 * single `transition 3` means a bush holds exactly one serving.
 *
 * Named divergence: good 18 has no extracted `gatheringPipeline`, so the pick feeds the eater directly
 * instead of producing a good. Approximation: the regrow duration (the trigger-7 period is not decoded),
 * split into two equal steps, so `flowering` lands at exactly half.
 *
 * `nextStageAtTick` is an absolute tick, not a countdown, so the snapshot scenery cache re-clones a bush
 * only at its transitions; unused (0) while `ripe`. `gfxIndex` is the render-variant tag.
 */
export type BerryBushStage = 'bare' | 'flowering' | 'ripe';
export const BerryBush = defineComponent<{
  stage: BerryBushStage;
  nextStageAtTick: number;
  gfxIndex?: number;
}>('BerryBush');
