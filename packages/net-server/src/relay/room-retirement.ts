import type { Deliver } from './member.js';
import type { Room } from './room.js';

/** Release every membership before a terminal notification can trigger a new room action. */
export function retireRoomMembers(
  room: Room,
  detach: (token: string) => void,
  deliver: Deliver,
  reason?: string,
): void {
  const tokens = room.memberTokens();
  for (const token of tokens) detach(token);
  if (reason === undefined) return;
  for (const token of tokens) {
    const member = room.memberOf(token);
    if (!member?.connected) continue;
    deliver(member, { kind: 'error', reason });
    deliver(member, { kind: 'left' });
  }
}
