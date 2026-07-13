import { defineComponent, type Entity } from '../../ecs/world.js';

/**
 * A harvestable resource node placed in the world (a tree, ore vein, berry bush). It yields its
 * `goodType` when a settler runs the good's harvest atomic on its cell; `remaining` is the units
 * left — each completed harvest decrements it (AtomicSystem's harvest effect), so a finite node
 * empties and the planner's `remaining <= 0` gate then skips it. `harvestAtomic` is the
 * numeric atomic id to run (the good's `atomicForHarvesting`), kept so the planner stays data-driven
 * — it picks the atomic from content, never hardcodes one. The resource occupies the nav node under
 * its {@link Position} (via `nodeAtClamped`).
 */
export const Resource = defineComponent<{
  goodType: number;
  remaining: number;
  harvestAtomic: number;
  /**
   * OPAQUE render-variant tag a decoded-map spawn carries (the APP's species record index — "pine 02"
   * rather than the good's representative "yew 01"); the render keys its exact original bob off it via
   * the snapshot. Never read by any sim decision, and absent on admin/scene spawns — an absent field
   * hashes exactly as before, so pre-variant goldens are untouched.
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
 * Marks a {@link Resource} node that is **felled**, not gathered unit-by-unit — a tree the collector
 * chops down over several swings, faithful to the original's `tree → "tree falling" → trunk` lifecycle
 * (`landscapetypes.ini`; the good's `chopsToFell`/`yieldPerNode` gathering params). Present only on a
 * fellable node: today the **placement code** (scenes / vertical-slice / tests) stamps it from the good's
 * `gathering.chopsToFell` (there is no resource-spawn *system* yet — the content→`Felling` gate lands
 * when the map/resource spawn path does). A {@link MineDeposit} node (stone/iron/gold/clay) instead drops
 * one unit to the ground per swing and shrinks by level; a node with neither marker is the trivial
 * direct-pickup (a mushroom: one swing onto the back, then gone). This is the **separate-component
 * pattern** the codebase uses for opt-in behaviour ({@link Vehicle}, `Health`, `Owner`): a node without
 * it hashes and plans exactly as before, so the goldens/scenes that place plain resources are untouched.
 *
 * `chopsLeft` counts the chops still needed to fell the node — each completed harvest atomic decrements
 * it (yielding NOTHING onto the settler's back, unlike a single-hit gather), and the node falls when it
 * reaches 0: the standing node is destroyed (so the planner never sees a depleted stump-to-be again) and
 * its whole `Resource.remaining` yield drops at its cell as a bare {@link Stockpile} trunk pile (a
 * {@link GroundDrop}) the collector then carries off. Determinism: a plain integer counter, mutated only
 * by the AtomicSystem's harvest effect in the store's deterministic order.
 */
export const Felling = defineComponent<{ chopsLeft: number }>('Felling');

/**
 * Marks a {@link Resource} node that is **mined**, not felled or picked whole — a stone/iron/gold/clay
 * deposit the collector chips one unit at a time, faithful to the original's `mine → ore → pile`
 * pipeline (a mined good has a DISTINCT `landscapeToPickup` "ore" stage, unlike a mushroom whose harvest
 * IS its pickup; `bioLandscape 0` in the data — the "mined vs living" split). Present only on a mined
 * node, stamped by the placement code from the good's `gathering.depositSize`/`depositLevels` (the same
 * observed calibration route {@link Felling} uses; there is no resource-spawn *system* yet). Its harvest
 * behaviour: each completed harvest atomic drains one unit off `Resource.remaining` and drops it at the
 * node's cell as a bare {@link Stockpile} ore pile (a {@link GroundDrop}, exactly the felled-trunk shape
 * the collector then carries off), and the node is **removed** when `remaining` hits 0 — so a deposit
 * empties over its whole `initial` size, unlike a fell-once tree.
 *
 * `initial` is the deposit's size at spawn (the {@link Resource.remaining} the node started with) — the
 * denominator the render's shrink-by-level pick needs (a level is `remaining/initial` bucketed into
 * `levels` visual states, the `[GfxLandscape]` mine record's fill frames; `render`'s scene builder does
 * that pure integer computation off the snapshot, the way it already derives a pile's heap `fill`).
 * `levels` is that state count (OBSERVED = the ls_ground mine gfx's 5 fill states; source basis).
 *
 * `strikesPerUnit`/`strikes` make a unit take SEVERAL work cycles: each completed harvest atomic
 * advances `strikes`, and only the strike that reaches `strikesPerUnit` chips the unit off (drops the
 * ore, drains `remaining`, resets the counter). OBSERVED calibration like {@link Felling.chopsLeft} —
 * the readable data has no per-unit strike count (`atomicanimations.ini` carries only the single-swing
 * cycle length), and one swing per unit read as "podchodzi, raz wali i już wykopane". A legacy node
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
 * A **stump / debris** decor entity left where a {@link Felling} node fell — the tree-debris the
 * original leaves behind (`ls_trees_dead.bmd` "tree debris", `landscapetype` logic 1: a pure-decor
 * landscape, non-blocking and not harvestable). It carries only a {@link Position} and this marker, so
 * it draws (the render side keys a per-good debris frame off `goodType`) but takes part in no sim
 * decision — the planner's resource/stockpile/building scans never see it. `goodType` records which
 * resource it is the remains of (a chopped tree → wood), so a future per-good decor binding can pick
 * the right debris. Inert on every golden that fells nothing (the separate-component pattern).
 */
export const Stump = defineComponent<{ goodType: number }>('Stump');

/**
 * Marks a bare {@link Stockpile} that is a **dropped resource pile** — the trunk a felled {@link Felling}
 * node leaves on the ground (Step 4 reuses it for a mined good's per-unit ground drops). It rides ON TOP
 * of the plain `Stockpile + Position` shape the existing ground-pile machinery already handles
 * (`nearestGroundPile`, the porter drive), so pickup/delivery consume it unchanged; the marker adds two
 * things a *designated* delivery flag (an equally-bare `Stockpile`) must NOT get: (1) it is the target a
 * felling collector's own collect-trunk drive prefers, and (2) it is **auto-reaped when emptied** (a
 * collected trunk vanishes, unlike a persistent flag), so a long game doesn't accrete an empty pile per
 * felled tree. A pure marker (`goodType` for legibility/debug); its presence is what the sim keys on.
 */
export const GroundDrop = defineComponent<{ goodType: number }>('GroundDrop');

/**
 * Marks a {@link GroundDrop} pile with the settler that HARVESTED it into being — a felled trunk's or a
 * mined ore unit's owner. It is stamped only when the harvester is a **flag-bound gatherer** (carries a
 * {@link WorkFlag}), and it is what makes a gatherer carry off **only what it dug itself**: the gatherer's
 * collect drive reclaims a drop only when `by` is its own entity, so a loose pile it did not make (another
 * settler's trunk, a player-dropped heap, a map-seeded pile) is left in peace. A pure cross-reference id
 * (entity ids are monotonic and never reused, so a dead owner's id can never re-alias a live settler).
 *
 * The **separate-optional-component pattern** ({@link Vehicle}/`Health`/{@link WorkFlag}): a drop made by a
 * flagless collector (the golden slice / vertical-slice woodcutter) carries none, hashing and collecting
 * exactly as before — the ownership rule is inert wherever no flag-bound gatherer harvests.
 */
export const HarvestedBy = defineComponent<{ by: Entity }>('HarvestedBy');

/**
 * A **wild berry bush** — a natural food source anyone can graze, distinct from the job-gated
 * {@link Resource} gathering economy: a hungry settler forages a RIPE bush directly (the `forage`
 * atomic) to feed itself, no job or tool needed, and the bush regrows its fruit over time. It is NOT a
 * {@link Resource} on purpose — it carries no harvest atomic and never enters a gatherer's harvest
 * scans, so bushes stay out of the wood/stone/ore economy and are only ever eaten off.
 *
 * source-basis: the original's `landscapetypes.ini` bush cycle — `bush with fruits` (type 11) on the
 * PICK trigger (`transition 3 <bush naked> 2 0 18`) yields good 18 `fruit` and becomes `bush naked`
 * (type 9), which regrows `naked → flowering (10) → with fruits (11)` on the periodic GROWTH trigger
 * (`transition 7 …`). The single `transition 3` sends `with fruits` STRAIGHT to `naked` (skipping
 * flowering), so one forage empties it — a bush holds exactly ONE serving.
 *
 * NAMED DIVERGENCE from the source: that pick transition *produces* good 18 `fruit` INTO the economy,
 * but good 18 has no extracted `gatheringPipeline` (no fruit-gatherer trade to hook into), so this model
 * discards the good and feeds the eater DIRECTLY — wild grazing, not a gather-a-good step. The regrow
 * DURATION and the two-step flowering stage are likewise NAMED APPROXIMATIONS: the trigger-7 period is
 * not decoded, so {@link BerryBush} collapses naked→flowering→fruits into one ripe/bare state timed by
 * `ripeAtTick` (see systems/economy/berries.ts).
 *
 * `ripe` is whether the bush currently holds fruit (forageable). `ripeAtTick` is the absolute tick the
 * BerryGrowthSystem flips a bare bush back to ripe (an exact integer compare, like {@link CurrentAtomic}'s
 * `elapsed` — no accumulated fixed-point fraction, and no per-tick component churn, so the snapshot
 * scenery cache only re-clones a bush at the two moments it actually changes: foraged, and regrown);
 * unused (0) while ripe. `gfxIndex` is the OPAQUE render-variant tag ({@link Resource.gfxIndex}'s twin —
 * the decoded map's fruited-bush `[GfxLandscape]` index, e.g. "bush 01 fruits") the render keys its
 * exact bush species off; the sim never reads it, and it is absent on a scene/synthetic spawn.
 *
 * The **separate-optional-component pattern** ({@link Vehicle}/{@link Crop}): no golden/vertical-slice
 * places a bush, so every existing hash holds. Determinism: plain boolean + integers, mutated only by
 * the `forage` effect (AtomicSystem) and the BerryGrowthSystem in deterministic store order.
 */
export const BerryBush = defineComponent<{
  ripe: boolean;
  ripeAtTick: number;
  gfxIndex?: number;
}>('BerryBush');
