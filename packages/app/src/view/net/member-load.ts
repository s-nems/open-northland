import type { RoomMemberView } from '@open-northland/net-protocol';
import { formatMessage, messages } from '../../i18n/index.js';

/** Decimals shown of a member's tick cost. */
const TICK_COST_DECIMALS = 1;

/** The load a member last reported with its acknowledgements, or an empty string before its first. */
export function memberLoadText(member: Pick<RoomMemberView, 'load'> | undefined): string {
  const load = member?.load;
  if (load == null) return '';
  return formatMessage(messages().networkRoom.load, {
    ms: load.tickMs.toFixed(TICK_COST_DECIMALS),
    buffered: load.buffered,
  });
}
