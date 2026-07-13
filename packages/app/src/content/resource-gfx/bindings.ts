import type { LayeredBobRef, ResourceTypeBinding, StockpileBinding } from '@vinland/render';
import { TREE_BOB } from '../building-gfx/index.js';
import { bobRef, DEFAULT_RESOURCE_STEM, type GatheringRefs, STOCKPILE_PLACEHOLDER_BOB } from './refs.js';

/**
 * The gathering-economy render BINDINGS: reduce the resolved {@link GatheringRefs} to the renderer's
 * per-good {@link ResourceTypeBinding} (standing nodes + felled trunks) and {@link StockpileBinding}
 * (delivered ground piles + a delivery flag). Each applies the same loaded-then-drop-unloaded rule — a
 * good whose atlas family failed to load is dropped so it falls back to the default rather than borrowing
 * a wrong frame. Pure + unit-tested.
 */

/**
 * Reduce the resolved node refs to the renderer's per-good {@link ResourceTypeBinding}: each good whose
 * node stem is the default family OR a LOADED named family binds its own node bob; a good whose family
 * failed to load is dropped (it falls back to the {@link TREE_BOB} default rather than borrowing a wrong
 * bob from the tree atlas — the same no-wrong-borrow rule the building families use). Pure + unit-tested.
 *
 * `familyFrames` (stem → the frame ids its LOADED atlas actually holds) marks data-pinned INVISIBLE
 * levels: when a record's level names a bob its own atlas doesn't have while its OTHER levels do, that
 * level binds `null` — the renderer then draws NOTHING for it. This is the original's freshly-sown wheat
 * (`wheat mine 01` state 1 → bob 4000, an out-of-atlas sentinel; states 2–5 are real frames). A good
 * whose levels are ALL missing keeps its refs instead — that is a genuinely broken binding and should
 * surface as the placeholder, not vanish.
 */
export function buildResourceBinding(
  refs: GatheringRefs,
  loaded: ReadonlySet<string>,
  familyFrames?: ReadonlyMap<string, ReadonlySet<number>>,
): ResourceTypeBinding {
  const byGood: Record<number, readonly (LayeredBobRef | null)[]> = {};
  for (const [good, node] of Object.entries(refs.nodesByGood)) {
    if (node.stem !== DEFAULT_RESOURCE_STEM && !loaded.has(node.stem)) continue; // unloaded family → drop
    // Per-level frames (empty→full) — the renderer indexes them by a mined deposit's shrink-by-level fill;
    // a non-mined node has a single-frame list, drawn at any level.
    const atlasFrames = familyFrames?.get(node.stem);
    const anyPresent = atlasFrames !== undefined && node.bobs.some((bob) => atlasFrames.has(bob));
    byGood[Number(good)] = node.bobs.map((bob) =>
      anyPresent && !(atlasFrames?.has(bob) ?? true) ? null : bobRef(node.stem, bob),
    );
  }
  // The per-VARIANT table (a decoded-map node's own species/decal) — same load-then-drop-unloaded rule,
  // so a variant whose family atlas failed to load falls back to the per-good representative, never a
  // wrong frame.
  const byGfxIndex: Record<number, readonly LayeredBobRef[]> = {};
  for (const [idx, node] of Object.entries(refs.nodesByGfxIndex)) {
    if (node.stem !== DEFAULT_RESOURCE_STEM && !loaded.has(node.stem)) continue;
    byGfxIndex[Number(idx)] = node.bobs.map((bob) => bobRef(node.stem, bob));
  }
  return { byGood, byGfxIndex, default: TREE_BOB };
}

/**
 * Reduce the resolved trunk refs (the `landscapeToPickup` stage) to the renderer's per-good
 * {@link ResourceTypeBinding} — the graphic a loose {@link import('@vinland/sim').GroundDrop} draws while
 * its felled wood / chipped ore lies on the ground waiting to be carried off. Binds the record's whole
 * fewest→most state ladder: the resolver indexes it by the drop's unit count (`DrawItem.fill`), so one
 * dug ore draws the single-piece frame and a stacked drop grows — the original's state ≡ remaining-units
 * read. Same load-then-drop-unloaded rule as {@link buildResourceBinding}; the `TREE_BOB` default is a
 * visible fallback for a good with no bound trunk. Pure + unit-tested.
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
 * Reduce the resolved pile + flag refs to the renderer's {@link StockpileBinding}: each good whose pile
 * atlas LOADED binds its per-fill heap frames; the flag binds the loaded `ls_temp` sign. A good whose pile
 * atlas failed to load is dropped, and an unloaded flag / a held pile with no frames falls back to the
 * placeholder heap (a bare ref, which the renderer draws as the sandy marker — never a wrong atlas frame).
 * Pure + unit-tested.
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
