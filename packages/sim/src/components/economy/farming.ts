import { defineComponent, type Entity } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';

/**
 * Marks a {@link Resource} node that is a **sown field** — the wheat a farm's worker plants, waters and
 * reaps, faithful to the original's field-farming vocabulary (`goodtypes.ini` wheat: `atomicForPlanting
 * 34` / `atomicForCultivating 35` / `atomicForHarvesting 29`, `isProducedOnMapFlag 1`; the field's
 * growth states are the `landscapetypes.ini` `wheat (growing)` lane, `maximumValency 5`). Stamped by the
 * `sow` atomic effect from the good's content `farming` block; the CropGrowthSystem advances it and the
 * farmer drive (planFarmer) works it. The loop: sown at `stage` 1 with `Resource.remaining` **0** (a
 * growing field yields nothing — the remaining-0 gate is what keeps every generic harvest scan off an
 * unripe field), grows a stage each {@link ticksPerStage} ticks ONLY while `watered` — watering is the growth
 * FUEL, and each stage step consumes it (a named approximation: the engine's watering semantics are
 * not decoded; see systems/economy/farming.ts),
 * and at the final stage (`stage === stages`) becomes ripe: `Resource.remaining` is set to `yieldUnits`,
 * so the reap swing (the plain `harvest` effect, branched by THIS marker) drops the whole yield as a
 * ground sheaf pile ({@link GroundDrop}, the good's `landscapeToPickup` look) and removes the field.
 *
 * `farm` is the workplace whose worker sowed it — the farm's OWN fields are the ones its farmers water/
 * reap (two farms never work each other's fields); a stale id after demolition just strands a wild field
 * (harvest-scannable once ripe, else inert). A field blocks neither walking nor building: it carries a
 * {@link ResourceFootprint} declaring empty walk/build areas, which is how the original's wheat landscape
 * reads (`allowedonland 1`, no block areas). No golden/scene sows, so every existing hash holds.
 */
export const Crop = defineComponent<{
  goodType: number;
  /** The farm workplace this field belongs to (a cross-reference id; ids are never reused). */
  farm: Entity;
  /** Current growth stage, 1..{@link stages}; ripe at the top stage. */
  stage: number;
  /** Total growth stages (the content `farming.stages`, snapshotted at sow). */
  stages: number;
  /** Whole ticks accumulated toward the next stage (exact integer compare, like CurrentAtomic). */
  growth: number;
  /** THIS field's ticks per growth stage, drawn at sow from the content's nominal rate and its
   *  `growthSpreadPercent` band by a hash of the node — so fields planted together ripen apart
   *  (systems/economy/farming.ts `stageTicksAt`). */
  ticksPerStage: number;
  /** Whether the field holds a live watering — the GROWTH FUEL: only a watered field grows, and each
   *  stage step consumes the watering (thirsty again until a farmer returns with the can — see
   *  systems/economy/farming.ts). */
  watered: boolean;
  /** Units the ripe field releases (the content `farming.yieldPerField`, snapshotted at sow). */
  yieldUnits: number;
}>('Crop');

/**
 * A farmer's **in-flight field intent** — which node its current farm action (reap / sheaf pickup /
 * sow / water) targets. Stamped by the planFarmer drive when it issues the action and removed the
 * moment the settler replans (ai.ts), so it exists exactly while the farmer is walking to or swinging
 * at the target. Its ONE purpose is work division: the planner folds every live FarmTask into the
 * tick's claim set, so a second farmer never picks a node a colleague is already en route to — the
 * fix for two farmers shadowing each other sowing/reaping the same spot (and what makes N farmers
 * scale field throughput ~N×). `sow` marks a plant-walk, which also counts toward the farm's field
 * cap while the field doesn't exist yet. A stale task (the target raced away, the farmer got
 * preempted) over-claims one node for at most the ticks until that farmer replans — self-correcting.
 * Inert on every golden that farms nothing (the separate-component pattern).
 */
export const FarmTask = defineComponent<{
  /** The farm workplace the action serves (the `byFarm` sow-count key). */
  farm: Entity;
  /** The claimed half-cell node (a `NodeId` — the crop/sheaf node, or the free node being sown). */
  node: NodeId;
  /** True for a sow intent — it reserves one of the farm's crew-scaled field slots while in flight. */
  sow: boolean;
}>('FarmTask');

/**
 * A settler WAITING INSIDE its workplace — stamped by a drive whose settler is at its building with
 * nothing to do this tick (the farmer between field chores), and removed the moment it replans
 * (ai.ts, beside the FarmTask release), so it exists exactly while the settler idles at the door.
 * PURELY a render fact: the original's off-duty workers wait inside the house, not lined up at the
 * door — the render hides a Resting settler (it "went in") and it steps back out the tick work
 * appears. No sim decision reads it. Inert on every golden that farms nothing.
 */
export const Resting = defineComponent<{
  /** The workplace the settler waits inside (a completed building — the drive only rests at home). */
  at: Entity;
}>('Resting');
