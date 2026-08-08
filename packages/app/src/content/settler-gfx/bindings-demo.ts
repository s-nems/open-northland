import type {
  BuildingBobRef,
  BuildingOverlayRef,
  ConstructionLayerRef,
  DirectionalAnim,
  ResourceTypeBinding,
  SpriteBindings,
  StockpileBinding,
} from '@open-northland/render';
import { HARVEST_ATOMIC } from '../../catalog/atomics.js';
import { HOUSE_BOB, TREE_BOB, VIKING_HOUSE01_BOBS } from '../building-gfx/index.js';
import type { BobSeqRow } from '../ir/rows.js';
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
 * The demo binding into the human atlases - the render twin of the global sandbox content. `building` and
 * `resource` resolve in their own per-kind layers, so their ids index the house/tree bobs rather than the
 * body's.
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
  upgradeByType?: Readonly<Record<number, readonly ConstructionLayerRef[]>>,
): SpriteBindings {
  const walk = directionalAnimFromSeq(seqByName, WALK_SEQ, {}, FALLBACK_WALK);
  // The wait plays as one direction: its length is not a clean ×8, so the original plays the whole loop
  // locked to a facing.
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
    // Chop binds only to the harvest atomic: with no generic `acting` swing, an unmapped action (a deposit
    // or pickup, atomics 22/23) stands still instead of replaying the 15-frame axe swing at ~4× speed.
    settler: {
      idle: wait,
      moving: walk,
      byAtomic: { [HARVEST_ATOMIC]: chop },
      // The data has no loaded wait loop, so loaded-idle holds a still standing pose.
      carrying: { idle: standWood, moving: walkWood },
    },
    // Each viking building type draws its own house bob (the `[GfxHouse]` `LogicType` → `GfxBobId` join),
    // the extracted `buildingBobs` overlaid onto the transcribed VIKING_HOUSE01_BOBS. A type in neither
    // falls back to the representative HOUSE_BOB.
    building: {
      byType: { ...VIKING_HOUSE01_BOBS, ...houseBobsByType },
      default: HOUSE_BOB,
      // Construction-stage layers per type (the `GfxBobConstructionLayer` join) - the progress-gated stage
      // stack an under-construction building draws instead of the finished body.
      ...(constructionByType !== undefined && Object.keys(constructionByType).length > 0
        ? { constructionByType }
        : {}),
      // Upgrade-overlay layers per type (the `upgrade === 1` rows - the next tier's body revealing over
      // the still-standing old one).
      ...(upgradeByType !== undefined && Object.keys(upgradeByType).length > 0 ? { upgradeByType } : {}),
      // Animated state overlays per type (the type-4 `GfxOverlay` join) - the mill's rotor over its
      // bladeless body, still while idle and spinning while the mill produces.
      ...(overlayByType !== undefined && Object.keys(overlayByType).length > 0 ? { overlayByType } : {}),
    },
    // Each gathered good draws its own standing node (the `landscapeToHarvest` join), overlaid onto the
    // yew fallback.
    resource: resourceBinding ?? TREE_BOB,
    // Dropped ground piles draw their good's own `ls_goods` heap, growing with the pile's contents; a bare
    // pile draws the delivery flag.
    ...(stockpileBinding !== undefined ? { stockpile: stockpileBinding } : {}),
    // A felled tree's stump draws the dead-tree debris frame (`ls_trees_dead`).
    ...(stumpBinding !== undefined ? { stump: stumpBinding } : {}),
    // A freshly-felled trunk on the ground draws its good's `landscapeToPickup` log, distinct from the
    // tidy delivered heap.
    ...(trunkBinding !== undefined ? { trunk: trunkBinding } : {}),
    // A wild berry bush draws its ripe/flowering/bare frame by `DrawItem.level` (3 = ripe, 1 = bare).
    ...(berryBushBinding !== undefined ? { berrybush: berryBushBinding } : {}),
  };
}
