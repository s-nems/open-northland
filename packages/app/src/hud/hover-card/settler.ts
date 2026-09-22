import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { isSettler, isWildlife, settlerJobType } from '../../game/snapshot.js';
import { jobDisplayName, type UnitPanelModelContext } from '../details-panel/model/context.js';
import { settlerGivenName } from '../details-panel/model/settler-name.js';
import type { SettlerHoverModel } from './model.js';

/**
 * What the cursor card over a settler says: who it is and what it does, on one line. Short on purpose -
 * the details panel owns the rest, including the surname, and the card has to stay readable over a
 * crowded settlement.
 */

/** The content slice a settler's name and trade are read through; a game hands it its own panel context. */
export type SettlerHoverContext = Pick<UnitPanelModelContext, 'jobs' | 'mapText'>;

/** The card's model for the settler under the cursor, or null when `entityId` is not a person. Wildlife
 *  and livestock draw as settlers too, and neither carries a name or a trade. */
export function settlerHoverModel(
  snapshot: WorldSnapshot,
  entityId: number,
  ctx: SettlerHoverContext,
): SettlerHoverModel | null {
  const ent = entityById(snapshot, entityId);
  if (ent === undefined || !isSettler(ent) || isWildlife(ent)) return null;
  return {
    kind: 'settler',
    entityId,
    title: settlerGivenName(ctx, ent),
    profession: jobDisplayName(ctx, settlerJobType(ent)),
  };
}
