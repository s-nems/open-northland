import type {
  BuildingTypeBinding,
  DirectionalAnim,
  FishBinding,
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
 * The demo binding into the human atlases. `building` and `resource` resolve in their own per-kind layers,
 * so their ids index the house and tree bobs rather than the body's. Every layered binding is optional: an
 * absent one degrades to the transcribed viking constant or the kind's own placeholder.
 */
export function buildHumanBindings(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  layered: {
    readonly building?: BuildingTypeBinding;
    readonly resource?: ResourceTypeBinding;
    readonly stockpile?: StockpileBinding;
    readonly stump?: ResourceTypeBinding;
    readonly trunk?: ResourceTypeBinding;
    readonly berrybush?: ResourceTypeBinding;
    readonly chest?: ResourceTypeBinding;
    readonly fish?: FishBinding;
  } = {},
): SpriteBindings {
  const walk = directionalAnimFromSeq(seqByName, WALK_SEQ, {}, FALLBACK_WALK);
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
    settler: {
      idle: wait,
      moving: walk,
      // Chop is deliberately the only bound atomic, so a deposit or pickup stands still rather than
      // replaying the axe swing.
      byAtomic: { [HARVEST_ATOMIC]: chop },
      // The data has no loaded wait loop, so loaded-idle holds a still standing pose.
      carrying: { idle: standWood, moving: walkWood },
    },
    // Each building type draws its own house bob (the `[GfxHouse]` `LogicType` → `GfxBobId` join), per
    // tribe; without one the transcribed viking constant backs the types it covers.
    building: layered.building ?? { byType: VIKING_HOUSE01_BOBS, default: HOUSE_BOB },
    // Each gathered good draws its own standing node (the `landscapeToHarvest` join), over the yew fallback.
    resource: layered.resource ?? TREE_BOB,
    // Dropped ground piles draw their good's own `ls_goods` heap, growing with the pile's contents; a bare
    // pile draws the delivery flag.
    ...(layered.stockpile !== undefined ? { stockpile: layered.stockpile } : {}),
    // A felled tree's stump draws the dead-tree debris frame (`ls_trees_dead`).
    ...(layered.stump !== undefined ? { stump: layered.stump } : {}),
    // A freshly-felled trunk draws its good's `landscapeToPickup` log, distinct from the delivered heap.
    ...(layered.trunk !== undefined ? { trunk: layered.trunk } : {}),
    // A wild berry bush draws its frame by `DrawItem.level` (3 = ripe, 1 = bare).
    ...(layered.berrybush !== undefined ? { berrybush: layered.berrybush } : {}),
    // A closed chest draws its own `ls_chest` record frame, wooden or magical.
    ...(layered.chest !== undefined ? { chest: layered.chest } : {}),
    // A swarm draws one representative fish; the original draws one independently moving bob per unit.
    ...(layered.fish !== undefined ? { fish: layered.fish } : {}),
  };
}
