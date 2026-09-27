import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { isSettler, isWildlife, settlerJobType } from '../../game/snapshot.js';
import { healthBar } from '../details-panel/model/bars.js';
import { jobDisplayName, type UnitPanelModelContext } from '../details-panel/model/context.js';
import { settlerGivenName } from '../details-panel/model/settler-name.js';
import type { SettlerHoverModel } from './model.js';
import { foreignOwner, type HoverOwnerContext } from './owner.js';

/**
 * What the cursor card over a settler says: who it is and what it does, on one line. Short on purpose -
 * the details panel owns the rest, including the surname, and the card has to stay readable over a
 * crowded settlement. Owner rule: another seat's person adds its owner and its health.
 */

/** The content slice a settler's name and trade are read through, and whose the person is. */
export type SettlerHoverContext = Pick<UnitPanelModelContext, 'jobs' | 'mapText'> & HoverOwnerContext;

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
    title: settlerGivenName(ctx, ent),
    profession: jobDisplayName(ctx, settlerJobType(ent)),
    owner,
    health: owner !== null ? healthBar(ent) : null,
  };
}
