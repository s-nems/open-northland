import { RelayRefusal } from '@open-northland/net-client';
import {
  type CompatibilityIssue,
  closingCode,
  type RelayReason,
  type RelayReasonCode,
  type ServerMessage,
} from '@open-northland/net-protocol';
import { otherRelease } from '../build-version.js';
import { errorText } from '../diag/error-text.js';
import { formatMessage, type Messages, messages } from '../i18n/index.js';
import type { LinkReport } from '../session/worker/net-protocol.js';
import { outdatedHint, type RunningGame, runningGame, type VersionGap } from '../update/outdated.js';
import type { FailureSource } from './connection.js';

type ProtocolRefusal = Extract<RelayReason, { readonly code: 'protocolUnsupported' }>;

/** A relay reason worded for the player, as a clause for a surrounding template. */
export function relayReasonText(
  reason: RelayReason,
  copy: Messages = messages(),
  game?: RunningGame,
): string {
  const templates: Readonly<
    Record<Exclude<RelayReasonCode, 'incompatible' | 'protocolUnsupported'>, string>
  > = copy.networkRelay.reasons;
  switch (reason.code) {
    case 'incompatible':
      return compatibilityIssueText(reason, copy);
    case 'protocolUnsupported':
      return versionGapText(refusalGap(reason), copy, game);
    case 'seatModeUnavailable':
      return formatMessage(templates[reason.code], {
        seat: seatNumber(reason.player),
        mode: copy.networkRoom[reason.mode],
      });
    case 'noSeat':
    case 'seatNotClaimable':
    case 'seatEmpty':
    case 'seatTribeUnavailable':
    case 'seatDifficultyUnavailable':
      return formatMessage(templates[reason.code], { seat: seatNumber(reason.player) });
    case 'seatTaken':
      return formatMessage(templates[reason.code], { seat: seatNumber(reason.player), nick: reason.nick });
    case 'colorTaken':
      return formatMessage(templates[reason.code], { wearer: seatNumber(reason.wearer) });
    case 'malformed':
      return templates[reason.code];
    default: {
      const { code, ...values } = reason;
      return formatMessage(templates[code], values);
    }
  }
}

/** Seats travel as 0-based indices; players count them from 1, as the lobby shows them. */
function seatNumber(player: number): number {
  return player + 1;
}

/** A room member whose files differ from the creator's, as one line for the lobby. */
export function compatibilityIssueText(issue: CompatibilityIssue, copy: Messages = messages()): string {
  const net = copy.net;
  if (issue.kind === 'version' && issue.version !== undefined && issue.expected !== undefined)
    return formatMessage(net.compatibilityVersion, {
      nick: issue.nick,
      version: issue.version,
      expected: issue.expected,
    });
  return formatMessage(issue.reason === 'missing' ? net.compatibilityMissing : net.compatibilityMismatch, {
    nick: issue.nick,
    kind: net.compatibilityKinds[issue.kind],
  });
}

/** The gap a refused `hello` names: the protocol only ever goes up, so the lower number is older. */
function refusalGap(refusal: ProtocolRefusal): VersionGap {
  const named = otherRelease(refusal.build);
  return refusal.client < refusal.relay
    ? { kind: 'outdated', required: named }
    : { kind: 'ahead', server: named };
}

/** Both versions and what to do, as a clause; the relay's version only when it names its build. */
function versionGapText(gap: VersionGap, copy: Messages, game = runningGame()): string {
  const text = copy.networkRelay.version;
  const running = game.version;
  if (gap.kind === 'outdated') {
    const hint = outdatedHint(game, copy);
    return gap.required === null
      ? formatMessage(text.outdatedUnnamed, { running, hint })
      : formatMessage(text.outdated, { running, required: gap.required, hint });
  }
  return gap.server === null
    ? formatMessage(text.aheadUnnamed, { running })
    : formatMessage(text.ahead, { running, server: gap.server });
}

/** The release gap behind a closed link, when the relay refused this game's protocol before closing. */
export function relayVersionGap(link: Pick<LinkReport, 'reason' | 'refusal'>): VersionGap | null {
  const refusal = link.refusal;
  return link.reason === 'protocolUnsupported' && refusal?.code === 'protocolUnsupported'
    ? refusalGap(refusal)
    : null;
}

/** The line for a connection the relay will not reopen. A close frame names only a code; the relay's
 *  `error` before it, when the link kept one, supplies the values. */
export function relayCloseText(
  link: Pick<LinkReport, 'reason' | 'refusal'>,
  copy: Messages = messages(),
  game?: RunningGame,
): string {
  const code = link.reason === undefined ? null : closingCode(link.reason);
  if (code === null) return copy.networkRelay.closedPlain;
  const gap = relayVersionGap(link);
  const reason =
    code === 'protocolUnsupported'
      ? gap === null
        ? copy.networkRelay.versionMismatch
        : versionGapText(gap, copy, game)
      : code === 'malformed'
        ? copy.networkRelay.reasons.malformed
        : relayReasonText({ code }, copy);
  return formatMessage(copy.net.closed, { reason });
}

/** A failure a multiplayer screen shows: a relay refusal in the player's language, anything else as
 *  its own message. */
export function relayFailureText(error: unknown, copy: Messages = messages()): string {
  return error instanceof RelayRefusal ? relayReasonText(error.reason, copy) : errorText(error);
}

/** A started room's refusal of this client's seat back, worded for the player left out: the game
 *  goes on without it, or the room is gone. */
export function rejoinRefusalText(reason: RelayReason, copy: Messages = messages()): string {
  if (reason.code === 'gameStarted') return copy.net.removedWhileAway;
  if (reason.code === 'noRoom') return copy.net.roomGoneWhileAway;
  return relayReasonText(reason, copy);
}

/** Why the room took this client's own seat, worded for the player it was taken from. Only another
 *  connection on this token can leave the seat, and that one replaced this connection first. */
export function ownDepartureText(
  kicked: Extract<ServerMessage, { kind: 'kicked' }>,
  copy: Messages = messages(),
): string {
  switch (kicked.cause) {
    case 'loadingTimedOut':
      return copy.net.youTimedOut[kicked.mode];
    case 'vote':
    case 'left':
      return copy.net.youWereKicked;
  }
}

/** The title for a world the worker's client could not open or restore; null for any other failure,
 *  which the screen titles by where it stands. */
export function worldFailureTitle(
  what: FailureSource,
  error: unknown,
  copy: Messages = messages(),
): string | null {
  const relay = copy.networkRelay;
  if (what === 'open') return error instanceof RelayRefusal ? relay.worldRefused : relay.openFailed;
  if (what === 'restore') return relay.restoreFailed;
  return null;
}
