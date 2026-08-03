import type { LayeredBobRef, ResourceTypeBinding, StockpileBinding } from '@open-northland/render';
import { TREE_BOB } from '../building-gfx/index.js';
import { bobRef, DEFAULT_RESOURCE_STEM, type GatheringRefs, STOCKPILE_PLACEHOLDER_BOB } from './refs.js';

/**
 * The gathering-economy render bindings: reduce the resolved {@link GatheringRefs} to the renderer's
 * per-good {@link ResourceTypeBinding} (standing nodes + felled trunks) and {@link StockpileBinding}
 * (delivered ground piles + a delivery flag). Each applies the same loaded-then-drop-unloaded rule, so a
 * good whose atlas family failed to load falls back to the default rather than borrowing a wrong frame.
 * Pure.
 */

/**
 * Reduce the resolved node refs to the renderer's per-good {@link ResourceTypeBinding}: each good whose
 * node stem is the default or a loaded named family binds its own node bob; a good whose family failed to
 * load falls back to the {@link TREE_BOB} default rather than a wrong tree-atlas frame. Pure.
 *
 * `familyFrames` (stem → the frame ids its loaded atlas actually holds) marks data-pinned invisible levels:
 * a level naming a bob its own atlas lacks, while its other levels resolve, binds `null` and draws nothing.
 * That is the original's freshly-sown wheat (`wheat mine 01` state 1 → bob 4000, an out-of-atlas sentinel;
 * states 2-5 are real frames). A good whose levels are all missing keeps its refs, so a genuinely broken
 * binding surfaces as the placeholder instead of vanishing.
 */
export function buildResourceBinding(
  refs: GatheringRefs,
  loaded: ReadonlySet<string>,
  familyFrames?: ReadonlyMap<string, ReadonlySet<number>>,
): ResourceTypeBinding {
  const byGood: Record<number, readonly (LayeredBobRef | null)[]> = {};
  for (const [good, node] of Object.entries(refs.nodesByGood)) {
    if (node.stem !== DEFAULT_RESOURCE_STEM && !loaded.has(node.stem)) continue; // unloaded family → drop
    // Per-level frames, empty→full; a non-mined node has a single-frame list drawn at any level.
    const atlasFrames = familyFrames?.get(node.stem);
    const anyPresent = atlasFrames !== undefined && node.bobs.some((bob) => atlasFrames.has(bob));
    byGood[Number(good)] = node.bobs.map((bob) =>
      anyPresent && !(atlasFrames?.has(bob) ?? true) ? null : bobRef(node.stem, bob),
    );
  }
  // The per-variant table (a decoded-map node's own species/decal) - same load-then-drop rule; an
  // unloaded variant family falls back to the per-good representative.
  const byGfxIndex: Record<number, readonly LayeredBobRef[]> = {};
  for (const [idx, node] of Object.entries(refs.nodesByGfxIndex)) {
    if (node.stem !== DEFAULT_RESOURCE_STEM && !loaded.has(node.stem)) continue;
    byGfxIndex[Number(idx)] = node.bobs.map((bob) => bobRef(node.stem, bob));
  }
  return { byGood, byGfxIndex, default: TREE_BOB };
}

/**
 * Reduce the resolved trunk refs (the `landscapeToPickup` stage) to the renderer's per-good
 * {@link ResourceTypeBinding} - what a loose ground drop draws while its felled wood or chipped ore lies on
 * the ground. Binds the record's whole fewest→most state ladder, indexed by the drop's unit count
 * (`DrawItem.fill`), the original's state ≡ remaining-units read. Same load-then-drop-unloaded rule as
 * {@link buildResourceBinding}. Pure.
 */
export function buildTrunkBinding(refs: GatheringRefs, loaded: ReadonlySet<string>): ResourceTypeBinding {
  const byGood: Record<number, readonly LayeredBobRef[]> = {};
  for (const [good, trunk] of Object.entries(refs.trunksByGood)) {
    if (trunk.stem !== DEFAULT_RESOURCE_STEM && !loaded.has(trunk.stem)) continue; // unloaded family → drop
    byGood[Number(good)] = trunk.bobs.map((bob) => bobRef(trunk.stem, bob));
  }
  return { byGood, default: TREE_BOB };
}

/**
 * Reduce the resolved pile and flag refs to the renderer's {@link StockpileBinding}: each good whose pile
 * atlas loaded binds its per-fill heap frames, and the flag binds the loaded `ls_temp` sign. Anything
 * unloaded falls back to the placeholder heap, a bare ref the renderer draws as the sandy marker. Pure.
 */
export function buildStockpileBinding(refs: GatheringRefs, loaded: ReadonlySet<string>): StockpileBinding {
  const byGood: Record<number, readonly LayeredBobRef[]> = {};
  for (const [good, pile] of Object.entries(refs.pilesByGood)) {
    if (!loaded.has(pile.stem)) continue; // unloaded pile family → drop (falls to the placeholder heap)
    byGood[Number(good)] = pile.fillBobs.map((bob) => ({ layer: pile.stem, bob }));
  }
  const flag: LayeredBobRef =
    refs.flag !== undefined && loaded.has(refs.flag.stem)
      ? { layer: refs.flag.stem, bob: refs.flag.bob }
      : STOCKPILE_PLACEHOLDER_BOB;
  return { byGood, flag, default: STOCKPILE_PLACEHOLDER_BOB };
}
