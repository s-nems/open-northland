import type { DiplomacyState } from '@open-northland/sim';
import { playerSwatchHex } from '../../catalog/roster.js';
import { ownerPlayerOf, type SnapshotEntity } from '../../game/snapshot.js';
import { pickableSeat, type ViewerSeat } from '../../game/viewer-seat.js';
import type { HoverOwner } from './model.js';

/** Whose the thing under the cursor is, read against the seat the view shows. */
export interface HoverOwnerContext {
  /** The viewer's own things, or every one on the whole map, keep their store and their plain card. */
  readonly viewer: ViewerSeat;
  /** The roster's authored seat name; absent, the card numbers the seat. */
  readonly seatNameOf?: ((player: number) => string | undefined) | undefined;
  /** The viewer seat's stance toward `owner`; absent, the card names the owner without one. */
  readonly diplomacyStance?: ((owner: number) => DiplomacyState) | undefined;
  /** Owner slot to team-colour slot; default identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
}

/** The owner of another seat's building or person, or null for the viewer's own and an ownerless one
 *  (a scene's ruin or stray). */
export function foreignOwner(ent: SnapshotEntity, ctx: HoverOwnerContext): HoverOwner | null {
  const seat = pickableSeat(ctx.viewer);
  const player = ownerPlayerOf(ent);
  if (seat === null || player === undefined || player === seat) return null;
  const name = ctx.seatNameOf?.(player);
  return {
    player,
    ...(name !== undefined ? { name } : {}),
    stance: ctx.diplomacyStance?.(player) ?? null,
    colour: playerSwatchHex(ctx.playerColourOf?.(player) ?? player),
  };
}
