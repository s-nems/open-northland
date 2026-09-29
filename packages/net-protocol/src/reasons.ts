import type { CompatibilityIssue } from './compatibility.js';
import type { VacantSeatMode } from './messages.js';

/**
 * Why the relay refused a request, ended a room or closed a connection: a code with the values a
 * client needs to word it in its own language. The relay sends no prose; `malformed.detail` is a
 * parser diagnostic for developers, not text for players.
 */
export type RelayReason =
  | { readonly code: 'helloFirst' }
  | { readonly code: 'helloOverdue' }
  | { readonly code: 'protocolUnsupported'; readonly client: number; readonly relay: number }
  | { readonly code: 'replaced' }
  | { readonly code: 'messageTooLarge' }
  | { readonly code: 'malformed'; readonly detail: string }
  | { readonly code: 'trafficLimit' }
  | { readonly code: 'relayFault' }
  | { readonly code: 'alreadyIntroduced' }
  | { readonly code: 'alreadyInRoom' }
  | { readonly code: 'notInRoom' }
  | { readonly code: 'noRoom' }
  | { readonly code: 'relayFull'; readonly rooms: number }
  | { readonly code: 'roomFull'; readonly members: number }
  | { readonly code: 'gameStarted' }
  | { readonly code: 'gameNotStarted' }
  | { readonly code: 'creatorOnly' }
  | { readonly code: 'noCreator' }
  | { readonly code: 'savedRulesFixed' }
  | { readonly code: 'savedSeatsFixed' }
  | { readonly code: 'noSeat'; readonly player: number }
  | { readonly code: 'seatTaken'; readonly player: number; readonly nick: string }
  | { readonly code: 'seatModeUnavailable'; readonly player: number; readonly mode: VacantSeatMode }
  | { readonly code: 'seatTribeUnavailable'; readonly player: number }
  | { readonly code: 'seatRequired' }
  | { readonly code: 'memberUnseated'; readonly nick: string }
  | { readonly code: 'memberNotReady'; readonly nick: string }
  | ({ readonly code: 'incompatible' } & CompatibilityIssue)
  | { readonly code: 'initialSaveMissing' }
  | { readonly code: 'mapDeliveryOff' }
  | { readonly code: 'mapUploadHasTick' }
  | { readonly code: 'notFromSave' }
  | { readonly code: 'initialSaveForEveryone' }
  | { readonly code: 'initialSaveTickMismatch' }
  | { readonly code: 'initialSaveFingerprintMismatch' }
  | { readonly code: 'retryTooSoon' }
  | { readonly code: 'mapProviderAway' }
  | { readonly code: 'creatorHasMap' }
  | { readonly code: 'lobbyFilesFixed' }
  | { readonly code: 'noRecipient'; readonly nick: string }
  | { readonly code: 'alreadyLoaded' }
  | { readonly code: 'worldOutOfSync' }
  | { readonly code: 'notLoaded' }
  | { readonly code: 'ackOutOfOrder'; readonly expected: number }
  | { readonly code: 'tickNotEmitted'; readonly tick: number }
  | { readonly code: 'noWorldYet' }
  | { readonly code: 'matchEnded' }
  | { readonly code: 'commandBudget' }
  | { readonly code: 'envelopeTooLarge' }
  | { readonly code: 'noPausesLeft'; readonly budget: number }
  | { readonly code: 'seatEmpty'; readonly player: number }
  | { readonly code: 'voteSelf' }
  | { readonly code: 'notWaitedFor'; readonly nick: string }
  | { readonly code: 'voteNotOpen'; readonly seconds: number }
  | { readonly code: 'snapshotUnsynced' }
  | { readonly code: 'noSnapshot' }
  | { readonly code: 'initialSaveGeneration'; readonly generation: number }
  | { readonly code: 'worldTickMismatch'; readonly tick: number }
  | { readonly code: 'worldBeforeStart'; readonly tick: number }
  | { readonly code: 'resultTickUnacknowledged' }
  | { readonly code: 'resultAlreadyReported' }
  | { readonly code: 'resultDisagreement' }
  | { readonly code: 'historyBytes' }
  | { readonly code: 'historyAge' }
  | { readonly code: 'saveUnsynced' }
  | { readonly code: 'saveOtherWorld' }
  | { readonly code: 'saveBeforeStart' }
  | { readonly code: 'saveUnacknowledged' }
  | { readonly code: 'saveExpired' }
  | { readonly code: 'saveTooLarge' };

export type RelayReasonCode = RelayReason['code'];

/** The reasons a connection is closed for. The close frame carries the bare code, after an `error`
 *  message with the whole reason where the relay itself closes. */
export type ClosingReason = Extract<
  RelayReason,
  {
    readonly code:
      | 'helloFirst'
      | 'helloOverdue'
      | 'protocolUnsupported'
      | 'replaced'
      | 'messageTooLarge'
      | 'malformed'
      | 'trafficLimit';
  }
>;

export type ClosingCode = ClosingReason['code'];
