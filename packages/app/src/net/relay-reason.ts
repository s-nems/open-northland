import { RelayRefusal } from '@open-northland/net-client';
import { closingCode, type RelayReason, type RelayReasonCode } from '@open-northland/net-protocol';
import { errorText } from '../diag/error-text.js';
import { formatMessage, type Messages, messages } from '../i18n/index.js';

/** A relay reason worded for the player, as a clause for a surrounding template. */
export function relayReasonText(reason: RelayReason, copy: Messages = messages()): string {
  const net = copy.net;
  const templates: Readonly<Record<Exclude<RelayReasonCode, 'incompatible'>, string>> =
    copy.networkRelay.reasons;
  switch (reason.code) {
    case 'incompatible':
      return formatMessage(
        reason.reason === 'missing' ? net.compatibilityMissing : net.compatibilityMismatch,
        {
          nick: reason.nick,
          kind: net.compatibilityKinds[reason.kind],
        },
      );
    case 'seatModeUnavailable':
      return formatMessage(templates[reason.code], {
        seat: seatNumber(reason.player),
        mode: copy.networkRoom[reason.mode],
      });
    case 'noSeat':
    case 'seatEmpty':
    case 'seatTribeUnavailable':
    case 'seatDifficultyUnavailable':
      return formatMessage(templates[reason.code], { seat: seatNumber(reason.player) });
    case 'seatTaken':
      return formatMessage(templates[reason.code], { seat: seatNumber(reason.player), nick: reason.nick });
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

/** The line for a connection the relay will not reopen. A close frame names only a code, so a reason
 *  that carries values is worded without them. */
export function relayCloseText(closeReason: string | undefined, copy: Messages = messages()): string {
  const code = closeReason === undefined ? null : closingCode(closeReason);
  if (code === null) return copy.networkRelay.closedPlain;
  const reason =
    code === 'protocolUnsupported'
      ? copy.networkRelay.versionMismatch
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
