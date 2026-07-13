import type {
  BuildingBobRef,
  BuildingOverlayRef,
  ConstructionLayerRef,
  DirectionalAnim,
  ResourceTypeBinding,
  SpriteBindings,
  StockpileBinding,
} from '@vinland/render';
import { HARVEST_ATOMIC } from '../../catalog/atomics.js';
import { HOUSE_BOB, TREE_BOB, VIKING_HOUSE01_BOBS } from '../building-gfx/index.js';
import type { BobSeqRow } from '../ir.js';
import { directionalAnimFromSeq, singleDirAnim } from './seq-anim.js';
import {
  CHOP_PHASE_START,
  CHOP_SEQ,
  FALLBACK_CHOP,
  FALLBACK_WAIT,
  FALLBACK_WALK,
  FALLBACK_WALK_WOOD,
  WAIT_SEQ,
  WALK_SEQ,
  WALK_WOOD_SEQ,
} from './sequences.js';

/**
 * The demo binding into the human atlases — the render twin of the global sandbox content.
 * The settler's walk/chop ranges are derived from `seqByName` (the extracted `bobSequences` for
 * `cr_hum_body_00.bmd`), so there are no hard-coded frame ids left here; an absent manifest falls back to
 * the known-good `FALLBACK_*` ranges. The building's per-type bobs **overlay** the extracted
 * `houseBobsByType` (the `buildingBobs` join, see {@link import('../building-gfx/index.js').buildingBobRefsByType})
 * onto the transcribed {@link VIKING_HOUSE01_BOBS} **per type**: real data wins where present, the constant
 * covers any of its five known types the data is missing (so a partial/absent IR degrades gracefully
 * type-by-type instead of dropping a whole family to the generic box). A `houseBobsByType` value may be
 * layer-qualified (a `{ layer, bob }` {@link BuildingBobRef} into a named
 * {@link import('@vinland/render').SpriteSheet.families} atlas — the HQ's viking4 family); the constant's
 * values are bare ids drawn from the default `building` layer. `building`/`resource` resolve in their own
 * per-kind layers (see {@link import('../sprite-sheet/index.js').loadHumanSpriteSheet}'s `kindLayers`), so their
 * ids index the house/tree bobs, not the body's.
 */
export function buildHumanBindings(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  houseBobsByType?: Readonly<Record<number, BuildingBobRef>>,
  constructionByType?: Readonly<Record<number, readonly ConstructionLayerRef[]>>,
  resourceBinding?: ResourceTypeBinding,
  stockpileBinding?: StockpileBinding,
  stumpBinding?: ResourceTypeBinding,
  trunkBinding?: ResourceTypeBinding,
  berryBushBinding?: ResourceTypeBinding,
  overlayByType?: Readonly<Record<number, BuildingOverlayRef>>,
): SpriteBindings {
  const walk = directionalAnimFromSeq(seqByName, WALK_SEQ, {}, FALLBACK_WALK);
  // Idle is the WAIT animation played as ONE direction (its length isn't a clean ×8, so it isn't a
  // directional cycle — the original plays it locked to a facing; source basis). The FULL loop, so a
  // standing settler breathes — not a frozen frame, and not a truncated facing-sliced 1/8 excerpt.
  const wait: DirectionalAnim = singleDirAnim(seqByName.get(WAIT_SEQ)) ?? FALLBACK_WAIT;
  const chop = directionalAnimFromSeq(seqByName, CHOP_SEQ, { phaseStart: CHOP_PHASE_START }, FALLBACK_CHOP);
  const walkWood = directionalAnimFromSeq(seqByName, WALK_WOOD_SEQ, {}, FALLBACK_WALK_WOOD);
  const standWood = directionalAnimFromSeq(
    seqByName,
    WALK_WOOD_SEQ,
    { frames: 1 },
    { ...FALLBACK_WALK_WOOD, frames: 1 },
  );
  return {
    // CHOP is bound ONLY to the harvest atomic. There is intentionally no generic `acting` swing: an
    // unmapped action (a carrier/woodcutter depositing or picking up — atomics 22/23) falls back to a
    // STANDING pose, NOT a borrowed woodcut swing. Borrowing it made a 4-tick deposit replay the 15-frame
    // axe swing at ~4× speed (a fast, truncated chop) — the very glitch this binding removes.
    //
    // `carrying` is the loaded-gait override: once the woodcutter picks up its wood it walks the loaded
    // gait instead of the empty walk, and stands a loaded pose while it deposits. The chop still wins
    // while harvesting because a settler only carries *after* the harvest.
    settler: {
      idle: wait,
      moving: walk,
      byAtomic: { [HARVEST_ATOMIC]: chop },
      // Loaded-idle stays a still standing pose: the data has no loaded WAIT loop (hands full), and a
      // carrier only stands loaded for the brief deposit transient, so a hold reads fine here.
      carrying: { idle: standWood, moving: walkWood },
    },
    // Each viking building type draws its own house bob (the `[GfxHouse]` `LogicType` → `GfxBobId` join),
    // data-driven from the extracted `buildingBobs` IR overlaid onto the transcribed VIKING_HOUSE01_BOBS:
    // real data wins per type, the constant backs its five known types when the IR is partial/absent
    // ({...undefined} / {...{}} spread to nothing → just the constant). A type in NEITHER falls back to
    // the representative HOUSE_BOB via BuildingTypeBinding.default.
    building: {
      byType: { ...VIKING_HOUSE01_BOBS, ...houseBobsByType },
      default: HOUSE_BOB,
      // Construction-stage layers per type (the `GfxBobConstructionLayer` join) — an under-construction
      // building draws its progress-gated stage stack instead of the finished body. Absent/empty when
      // the IR is missing (`{...undefined}` spreads to nothing → no table → body draw at every progress).
      ...(constructionByType !== undefined && Object.keys(constructionByType).length > 0
        ? { constructionByType }
        : {}),
      // Animated state overlays per type (the type-4 `GfxOverlay` join) — the mill's rotor drawn on
      // top of its bladeless body: still while idle, spinning while the mill produces. Absent/empty
      // when the IR predates the `buildingOverlays` lane (no overlay — the body draws as before).
      ...(overlayByType !== undefined && Object.keys(overlayByType).length > 0 ? { overlayByType } : {}),
    },
    // Each gathered good draws its own standing node (the `landscapeToHarvest` join, built from the
    // Step-1 gathering pipeline — a tree for wood, a rock for stone, a mine for iron/gold/clay, a
    // mushroom), overlaid onto the yew fallback. Absent (a checkout without the join) → the plain
    // TREE_BOB every resource used to draw. See resource-gfx.ts.
    resource: resourceBinding ?? TREE_BOB,
    // Dropped ground piles draw their good's own `ls_goods` heap (growing with the pile's contents) and a
    // bare/empty pile draws the delivery flag. Omitted (no join) → a stockpile draws the placeholder heap.
    ...(stockpileBinding !== undefined ? { stockpile: stockpileBinding } : {}),
    // A felled tree's stump draws the dead-tree/debris frame (`ls_trees_dead`). Omitted (no join) → the
    // stump draws the placeholder. See resource-gfx.ts (resolveStumpRef).
    ...(stumpBinding !== undefined ? { stump: stumpBinding } : {}),
    // A freshly-felled trunk on the ground (a GroundDrop) draws its good's `landscapeToPickup` log —
    // distinct from the tidy delivered heap. Omitted (no join) → the drop draws the placeholder.
    ...(trunkBinding !== undefined ? { trunk: trunkBinding } : {}),
    // A wild berry bush draws its fruited/bare frame (the `bush with fruits`/`bush naked` records) by
    // `DrawItem.level` (2 = ripe, 1 = bare). Omitted (no join) → the bush draws the placeholder.
    ...(berryBushBinding !== undefined ? { berrybush: berryBushBinding } : {}),
  };
}
