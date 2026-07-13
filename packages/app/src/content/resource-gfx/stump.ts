import type { ResourceTypeBinding } from '@vinland/render';
import type { ContentIr } from '../ir.js';
import { type GatheringNodeRef, nodeRefFrom } from './refs.js';

/**
 * The debris `[GfxLandscape]` record left where a tree is FELLED — `"tree debris medium"` in
 * `ls_trees_dead.bmd` (logicType 1 = pure decor), the stump/remnant a chopped tree leaves behind (the
 * multi-hit harvest's `Stump` decor entity draws it). Deliberately the debris, not the standing
 * `tree_dead` (logicType 4, an undisturbed dead tree) nor the `tree_dead falling` (logicType 5, the
 * mid-fall frame — that transition is the Step-7 falling-animation polish, source basis).
 */
export const STUMP_EDIT_NAME = 'tree debris medium';

/** Resolve the stump/debris draw (served atlas stem + bob) from the IR's landscape gfx, matched by
 *  {@link STUMP_EDIT_NAME}, or `undefined` when the record/atlas is absent (a checkout without the
 *  dead-tree atlas, or an older `content/` — the stump then falls back to the placeholder). Mirrors the
 *  flag resolution in {@link import('./refs.js').resolveGatheringRefs}. Pure. */
export function resolveStumpRef(ir: ContentIr | null): GatheringNodeRef | undefined {
  const record = (ir?.landscapeGfx ?? []).find((g) => g.editName === STUMP_EDIT_NAME);
  return record !== undefined ? nodeRefFrom(record) : undefined;
}

/**
 * Reduce the resolved stump ref to the renderer's per-good {@link ResourceTypeBinding} (the same shape a
 * resource node uses — a stump draws like a static node, from the dead-tree family): a single `default`
 * debris frame, since the only fellable resource in this step is the tree (Step 4 adds per-good drops).
 * Returns `undefined` when the debris atlas did not load, so the binding is omitted and the stump falls
 * back to the placeholder rather than borrowing a wrong frame. Pure + unit-tested.
 */
export function buildStumpBinding(
  stump: GatheringNodeRef | undefined,
  loaded: ReadonlySet<string>,
): ResourceTypeBinding | undefined {
  if (stump === undefined || !loaded.has(stump.stem)) return undefined;
  return { byGood: {}, default: { layer: stump.stem, bob: stump.bob } };
}
