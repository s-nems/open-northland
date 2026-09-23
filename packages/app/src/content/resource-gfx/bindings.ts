import type { LayeredBobRef, ResourceTypeBinding, StockpileBinding, WaveLoop } from '@open-northland/render';
import { TREE_BOB } from '../building-gfx/index.js';
import {
  bobRef,
  DEFAULT_RESOURCE_STEM,
  type GatheringLoopRef,
  type GatheringRefs,
  STOCKPILE_PLACEHOLDER_BOB,
} from './refs.js';

/**
 * Reduce the resolved node refs to the renderer's per-good binding: a good whose node stem is the default
 * or a loaded named family binds its own node bob, one whose family failed to load falls back to
 * {@link TREE_BOB} rather than a wrong tree-atlas frame.
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
  const ladder = (node: { stem: string; bobs: readonly number[] }): readonly (LayeredBobRef | null)[] => {
    const atlasFrames = familyFrames?.get(node.stem);
    const anyPresent = atlasFrames !== undefined && node.bobs.some((bob) => atlasFrames.has(bob));
    return node.bobs.map((bob) =>
      anyPresent && !(atlasFrames?.has(bob) ?? true) ? null : bobRef(node.stem, bob),
    );
  };
  const byGood: Record<number, readonly (LayeredBobRef | null)[]> = {};
  for (const [good, node] of Object.entries(refs.nodesByGood)) {
    if (node.stem !== DEFAULT_RESOURCE_STEM && !loaded.has(node.stem)) continue;
    byGood[Number(good)] = ladder(node);
  }
  // An unloaded variant family leaves the node on its per-good representative.
  const byGfxIndex: Record<number, readonly (LayeredBobRef | null)[]> = {};
  for (const [idx, node] of Object.entries(refs.nodesByGfxIndex)) {
    if (node.stem !== DEFAULT_RESOURCE_STEM && !loaded.has(node.stem)) continue;
    byGfxIndex[Number(idx)] = ladder(node);
  }
  return { byGood, byGfxIndex, default: TREE_BOB };
}

/**
 * Reduce the resolved trunk refs (the `landscapeToPickup` stage) to what a loose ground drop draws while
 * its felled wood or chipped ore lies on the ground. Binds the record's whole fewest→most state ladder,
 * indexed by the drop's unit count (`DrawItem.fill`). Same load-then-drop-unloaded rule as
 * {@link buildResourceBinding}.
 */
export function buildTrunkBinding(refs: GatheringRefs, loaded: ReadonlySet<string>): ResourceTypeBinding {
  const byGood: Record<number, readonly LayeredBobRef[]> = {};
  for (const [good, trunk] of Object.entries(refs.trunksByGood)) {
    if (trunk.stem !== DEFAULT_RESOURCE_STEM && !loaded.has(trunk.stem)) continue;
    byGood[Number(good)] = trunk.bobs.map((bob) => bobRef(trunk.stem, bob));
  }
  return { byGood, default: TREE_BOB };
}

/**
 * Reduce the resolved pile and flag refs: each good whose pile atlas loaded binds its per-fill heap frames,
 * and the flag binds the loaded `ls_temp` sign's wave loop. Anything unloaded falls back to the placeholder
 * heap, a bare ref the renderer draws as the sandy marker.
 */
export function buildStockpileBinding(refs: GatheringRefs, loaded: ReadonlySet<string>): StockpileBinding {
  const byGood: Record<number, readonly LayeredBobRef[]> = {};
  for (const [good, pile] of Object.entries(refs.pilesByGood)) {
    if (!loaded.has(pile.stem)) continue;
    byGood[Number(good)] = pile.fillBobs.map((bob) => ({ layer: pile.stem, bob }));
  }
  const flag: WaveLoop<LayeredBobRef> =
    refs.flag !== undefined && loaded.has(refs.flag.stem) ? loopRef(refs.flag) : [STOCKPILE_PLACEHOLDER_BOB];
  return { byGood, flag, default: STOCKPILE_PLACEHOLDER_BOB };
}

function loopRef({ stem, frames: [first, ...rest] }: GatheringLoopRef): WaveLoop<LayeredBobRef> {
  return [{ layer: stem, bob: first }, ...rest.map((bob) => ({ layer: stem, bob }))];
}
