import { TICKS_PER_SECOND } from '@open-northland/sim';
import { bcp47Tag, formatMessage, messages } from '../../i18n/index.js';
import type { SpeedBarLook } from '../dom/system-bar.js';
import { isHeldStatus, type NetClockModel, type NetPlayerRow, type NetPlayerVote } from './model.js';

/** The governed speed steps by hundredths at most; finer digits would only be noise. */
const SPEED_FRACTION_DIGITS = 2;
/** Seconds behind read to a tenth: a tick is a twentieth of a second at ×1. */
const BEHIND_FRACTION_DIGITS = 1;

/** A speed multiplier as the player reads it, in the language's own decimals: ×2,4 in Polish. */
export function formatRoomSpeed(speed: number): string {
  const figure = speed.toLocaleString(bcp47Tag(), { maximumFractionDigits: SPEED_FRACTION_DIGITS });
  return `×${figure}`;
}

/** Ticks behind the clock as wall seconds at ×1. */
export function formatBehind(ticks: number): string {
  const seconds = (ticks / TICKS_PER_SECOND).toLocaleString(bcp47Tag(), {
    minimumFractionDigits: BEHIND_FRACTION_DIGITS,
    maximumFractionDigits: BEHIND_FRACTION_DIGITS,
  });
  return formatMessage(messages().hud.network.seconds, { seconds });
}

/** The status word of a row; a loading member with a reported progress names it. */
export function statusText(row: Pick<NetPlayerRow, 'status' | 'loadingPercent'>): string {
  const copy = messages().hud.network;
  if (row.status === 'loading' && row.loadingPercent !== null) {
    return formatMessage(copy.loadingPercent, { percent: row.loadingPercent });
  }
  return copy.status[row.status];
}

/** The countdown to a kick vote, then its tally. */
export function voteText(vote: NetPlayerVote): string {
  const copy = messages().hud.network;
  return vote.voteInSeconds > 0
    ? formatMessage(copy.voteIn, { seconds: vote.voteInSeconds })
    : formatMessage(copy.voteTally, { yes: vote.yes, needed: vote.needed });
}

/** The held banner's line for each member the clock holds for: who, why, and where the vote stands. */
export function heldLines(players: readonly NetPlayerRow[]): readonly string[] {
  return players
    .filter((row) => isHeldStatus(row.status))
    .map((row) =>
      [row.nick, statusText(row), ...(row.vote === null ? [] : [voteText(row.vote)])].join(' · '),
    );
}

const selfNick = (players: readonly NetPlayerRow[]): string | null =>
  players.find((row) => row.self)?.nick ?? null;

/** The slowed line under a governed clock: who the room is paced for and why, or that it is this
 *  client; null while nobody governs. */
export function slowedText(clock: NetClockModel, players: readonly NetPlayerRow[]): string | null {
  const governor = clock.governor;
  if (governor === null) return null;
  const copy = messages().hud.network;
  const speed = formatRoomSpeed(clock.runningSpeed);
  if (governor.nick === selfNick(players)) return formatMessage(copy.slowedBySelf, { speed });
  return formatMessage(copy.slowedBy, { speed, nick: governor.nick, cause: copy.causes[governor.cause] });
}

/** The clock section's governor line, as the panel words it; null while nobody governs. */
export function governorText(clock: NetClockModel): string | null {
  const governor = clock.governor;
  if (governor === null) return null;
  const copy = messages().hud.network;
  return formatMessage(copy.governor, { nick: governor.nick, cause: copy.causes[governor.cause] });
}

/** What this client's own row says about it, when it trails or paces the room; else null. */
export function ownStateText(players: readonly NetPlayerRow[]): string | null {
  const copy = messages().hud.network;
  const self = players.find((row) => row.self);
  if (self?.status === 'catchingUp') return copy.selfCatchingUp;
  if (self?.status === 'slowing') return copy.selfSlowing;
  return null;
}

/** How the speed segments read for a relayed room: held while it waits for a member, naming who;
 *  slowed while it is paced for one, naming the exact speed and the member, or addressing this client
 *  when it is that member; else plain. */
export function speedBarLook(clock: NetClockModel, players: readonly NetPlayerRow[]): SpeedBarLook | null {
  const copy = messages().hud.network;
  if (clock.held) {
    const nicks = players.filter((row) => isHeldStatus(row.status)).map((row) => row.nick);
    return {
      kind: 'held',
      title: nicks.length === 0 ? copy.heldTitle : formatMessage(copy.barHeld, { nicks: nicks.join(', ') }),
    };
  }
  const governor = clock.governor;
  if (governor === null) return null;
  const speed = formatRoomSpeed(clock.runningSpeed);
  const requested = formatRoomSpeed(clock.requestedSpeed);
  const title =
    governor.nick === selfNick(players)
      ? formatMessage(copy.barGovernedSelf, { speed, requested })
      : formatMessage(copy.barGoverned, { speed, requested, nick: governor.nick });
  return { kind: 'slowed', title, pressed: null };
}
