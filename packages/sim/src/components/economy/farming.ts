import { defineComponent, type Entity } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';

/**
 * Marks a {@link Resource} node that is a sown field, faithful to the original's field-farming vocabulary
 * (`goodtypes.ini` wheat: `atomicForPlanting 34` / `atomicForCultivating 35` / `atomicForHarvesting 29`,
 * `isProducedOnMapFlag 1`; the growth states are the `landscapetypes.ini` `wheat (growing)` lane,
 * `maximumValency 5`). Sown at `stage` 1 with `Resource.remaining` 0 - that gate is what keeps every
 * generic harvest scan off an unripe field - and ripe at the top stage, where `Resource.remaining` becomes
 * `yieldUnits` so the reap swing drops the whole yield as a {@link GroundDrop} sheaf pile and removes the
 * field. Only the farm that sowed a field waters and reaps it.
 *
 * A field blocks neither walking nor building - it carries a {@link ResourceFootprint} declaring empty
 * walk/build areas, which is how the original's wheat landscape reads (`allowedonland 1`, no block areas).
 */
export const Crop = defineComponent<{
  goodType: number;
  /** The farm workplace this field belongs to (a cross-reference id; ids are never reused). */
  farm: Entity;
  /** Current growth stage, 1..`stages`; ripe at the top stage. */
  stage: number;
  /** Total growth stages (the content `farming.stages`, snapshotted at sow). */
  stages: number;
  /** Whole ticks accumulated toward the next stage (exact integer compare, like CurrentAtomic). */
  growth: number;
  /** This field's ticks per growth stage, drawn at sow from the content's nominal rate and its
   *  `growthSpreadPercent` band by a hash of the node, so fields planted together ripen apart. */
  ticksPerStage: number;
  /** Whether the field holds a live watering: only a watered field grows, and a stage step consumes it. */
  watered: boolean;
  /** Units the ripe field releases (the content `farming.yieldPerField`, snapshotted at sow). */
  yieldUnits: number;
}>('Crop');

/**
 * A farmer's in-flight field intent - which node its current farm action (reap / sheaf pickup / sow / water)
 * targets. Stamped when the drive issues the action and removed on replan, so it exists exactly while the
 * farmer is walking to or swinging at the target. Its one purpose is work division: every live task joins
 * the tick's claim set, so a second farmer never picks a node a colleague is already en route to.
 */
export const FarmTask = defineComponent<{
  /** The farm workplace the action serves (the `byFarm` sow-count key). */
  farm: Entity;
  /** The claimed half-cell node (a `NodeId` - the crop/sheaf node, or the free node being sown). */
  node: NodeId;
  /** True for a sow intent - it reserves one of the farm's crew-scaled field slots while in flight. */
  sow: boolean;
}>('FarmTask');

/**
 * A {@link Crop} field cut off from its farm - no work stance is both unblocked and routable from the farm's
 * door. The field is destroyed once the state holds for a sustained span, returning its `maxFields` slot to
 * the plot.
 */
export const StrandedField = defineComponent<{
  /** Tick the sweep first observed the field cut off; cleared the moment a route exists again. */
  since: number;
}>('StrandedField');

/**
 * A settler that has stepped inside a building, shed the moment nothing holds it in. Mostly a render fact -
 * the render hides the settler and it steps back out the tick work appears (observation: the original's
 * off-duty workers wait inside the house, not at the door). Several drives also read it as the is-inside
 * test.
 */
export const Resting = defineComponent<{
  /** The completed building the settler is inside. */
  at: Entity;
}>('Resting');
