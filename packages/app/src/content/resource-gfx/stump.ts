import type { ResourceTypeBinding } from '@open-northland/render';
import type { ContentIr } from '../ir/rows.js';
import { type GatheringNodeRef, nodeRefFrom } from './refs.js';

/**
 * The debris `[GfxLandscape]` record left where a tree is felled - `"tree debris medium"` in
 * `ls_trees_dead.bmd` (logicType 1 = pure decor). Deliberately the debris, not the standing `tree_dead`
 * (logicType 4, an undisturbed dead tree) nor `tree_dead falling` (logicType 5, the mid-fall frame).
 */
export const STUMP_EDIT_NAME = 'tree debris medium';

/** Resolve the stump/debris draw (served atlas stem + bob) from the IR's landscape gfx, matched by
 *  {@link STUMP_EDIT_NAME}, or `undefined` when the record or atlas is absent - the stump then falls back
 *  to the placeholder. Pure. */
export function resolveStumpRef(ir: ContentIr | null): GatheringNodeRef | undefined {
  const record = (ir?.landscapeGfx ?? []).find((g) => g.editName === STUMP_EDIT_NAME);
  return record !== undefined ? nodeRefFrom(record) : undefined;
}

/**
 * Reduce the resolved stump ref to a {@link ResourceTypeBinding} with a single `default` debris frame - a
 * stump draws like a static node, from the dead-tree family. `undefined` when the debris atlas did not
 * load, so the stump falls back to the placeholder rather than borrowing a wrong frame. Pure.
 */
export function buildStumpBinding(
  stump: GatheringNodeRef | undefined,
  loaded: ReadonlySet<string>,
): ResourceTypeBinding | undefined {
  if (stump === undefined || !loaded.has(stump.stem)) return undefined;
  return { byGood: {}, default: { layer: stump.stem, bob: stump.bob } };
}
