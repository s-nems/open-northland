import type { RelayReason, ServerMessage } from '@open-northland/net-protocol';
import type { Member } from './member.js';
import type { Waiting } from './waiting.js';

const MS_PER_SECOND = 1000;

export type KickOutcome =
  | { readonly refused: RelayReason }
  | { readonly tally: ServerMessage; readonly kicked: Member | null };

/** One yes for kicking the member in seat `player`, allowed once its countdown is over; the vote
 *  passes at half of the other connected members, rounded up. */
export function castKickVote(
  members: ReadonlyMap<string, Member>,
  waiting: Waiting,
  voter: Member,
  player: number,
  now: number,
): KickOutcome {
  const target = [...members.values()].find((member) => member.seat === player);
  if (target === undefined) return { refused: { code: 'seatEmpty', player } };
  if (target === voter) return { refused: { code: 'voteSelf' } };
  if (!waiting.isWaitedFor(target.token)) return { refused: { code: 'notWaitedFor', nick: target.nick } };
  if (!waiting.voteOpen(target.token, now)) {
    return {
      refused: {
        code: 'voteNotOpen',
        seconds: Math.ceil(waiting.voteAfterMs(target.token, now) / MS_PER_SECOND),
      },
    };
  }
  const voters = waiting.vote(target.token, voter.token);
  let electorate = 0;
  for (const member of members.values()) if (member.connected && member !== target) electorate++;
  const needed = Math.ceil(electorate / 2);
  const yes = [...voters].flatMap((token) => {
    const member = members.get(token);
    return member?.connected === true && member !== target ? [member.nick] : [];
  });
  return {
    tally: { kind: 'kickVote', player, nick: target.nick, yes, needed },
    kicked: yes.length >= needed ? target : null,
  };
}
