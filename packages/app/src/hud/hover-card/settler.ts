import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { settlerName } from '../../game/character-names/index.js';
import { isSettler, isWildlife, type SnapshotEntity, settlerJobType } from '../../game/snapshot.js';
import { jobDisplayName, type UnitPanelModelContext } from '../details-panel/model/context.js';
import { productSelectionLabel, settlerProductSelection } from '../details-panel/model/settler-work.js';
import type { SettlerHoverModel } from './model.js';
import { foreignOwner, type HoverOwnerContext } from './owner.js';

/**
 * What the cursor card over a settler says: who it is and what it does, on one line. Short on purpose -
 * the details panel owns the rest, and the card has to stay readable over a
 * crowded settlement. Owner rules: another seat's person adds a line naming its owner; the viewer's own
 * worker names the goods it is set to make after its trade, or "everything" while every open one runs.
 */

/** The details panel's reads, which the own worker's products come through, and whose the person is. */
export type SettlerHoverContext = UnitPanelModelContext & HoverOwnerContext;

/** The card's model for the settler under the cursor, or null when `entityId` is not a person. Wildlife
 *  and livestock draw as settlers too, and neither carries a name or a trade. */
export function settlerHoverModel(
  snapshot: WorldSnapshot,
  entityId: number,
  ctx: SettlerHoverContext,
): SettlerHoverModel | null {
  const ent = entityById(snapshot, entityId);
  if (ent === undefined || !isSettler(ent) || isWildlife(ent)) return null;
  const owner = foreignOwner(ent, ctx);
  return {
    kind: 'settler',
    entityId,
    title: settlerName(ctx, ent),
    profession: jobDisplayName(ctx, settlerJobType(ent)),
    products: owner === null ? selectedProducts(ctx, snapshot, ent) : null,
    owner,
  };
}

/** The products the worker is set to make, named; every open one running reads as one word. */
function selectedProducts(
  ctx: SettlerHoverContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
): string | null {
  const selection = settlerProductSelection(ctx, snapshot, ent);
  return selection === null ? null : productSelectionLabel(selection);
}
