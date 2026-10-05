import { RelayRefusal } from '@open-northland/net-client';
import type { RelayReason, RelayReasonCode } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { messages } from '../../src/i18n/index.js';
import { relayCloseText, relayFailureText, relayReasonText } from '../../src/net/relay-reason.js';

/** One reason per code, so a new code without a worded template fails to compile here. */
const SAMPLES: { readonly [C in RelayReasonCode]: Extract<RelayReason, { code: C }> } = {
  helloFirst: { code: 'helloFirst' },
  helloOverdue: { code: 'helloOverdue' },
  protocolUnsupported: { code: 'protocolUnsupported', client: 8, relay: 9 },
  replaced: { code: 'replaced' },
  messageTooLarge: { code: 'messageTooLarge' },
  malformed: { code: 'malformed', detail: 'setSettings: the room world is immutable' },
  trafficLimit: { code: 'trafficLimit' },
  relayFault: { code: 'relayFault' },
  serverRestart: { code: 'serverRestart' },
  alreadyIntroduced: { code: 'alreadyIntroduced' },
  alreadyInRoom: { code: 'alreadyInRoom' },
  notInRoom: { code: 'notInRoom' },
  noRoom: { code: 'noRoom' },
  relayFull: { code: 'relayFull', rooms: 64 },
  roomFull: { code: 'roomFull', members: 12 },
  gameStarted: { code: 'gameStarted' },
  gameNotStarted: { code: 'gameNotStarted' },
  creatorOnly: { code: 'creatorOnly' },
  noCreator: { code: 'noCreator' },
  savedRulesFixed: { code: 'savedRulesFixed' },
  savedSeatsFixed: { code: 'savedSeatsFixed' },
  noSeat: { code: 'noSeat', player: 4 },
  seatTaken: { code: 'seatTaken', player: 2, nick: 'Bartek' },
  seatModeUnavailable: { code: 'seatModeUnavailable', player: 1, mode: 'ai' },
  seatTribeUnavailable: { code: 'seatTribeUnavailable', player: 2 },
  seatDifficultyUnavailable: { code: 'seatDifficultyUnavailable', player: 2 },
  seatRequired: { code: 'seatRequired' },
  memberUnseated: { code: 'memberUnseated', nick: 'Bartek' },
  memberNotReady: { code: 'memberNotReady', nick: 'Bartek' },
  incompatible: { code: 'incompatible', nick: 'Bartek', kind: 'map', reason: 'missing' },
  initialSaveMissing: { code: 'initialSaveMissing' },
  mapDeliveryOff: { code: 'mapDeliveryOff' },
  mapUploadHasTick: { code: 'mapUploadHasTick' },
  notFromSave: { code: 'notFromSave' },
  initialSaveForEveryone: { code: 'initialSaveForEveryone' },
  initialSaveTickMismatch: { code: 'initialSaveTickMismatch' },
  initialSaveFingerprintMismatch: { code: 'initialSaveFingerprintMismatch' },
  retryTooSoon: { code: 'retryTooSoon' },
  mapProviderAway: { code: 'mapProviderAway' },
  creatorHasMap: { code: 'creatorHasMap' },
  lobbyFilesFixed: { code: 'lobbyFilesFixed' },
  noRecipient: { code: 'noRecipient', nick: 'Zenon' },
  alreadyLoaded: { code: 'alreadyLoaded' },
  worldOutOfSync: { code: 'worldOutOfSync' },
  notLoaded: { code: 'notLoaded' },
  ackOutOfOrder: { code: 'ackOutOfOrder', expected: 3 },
  tickNotEmitted: { code: 'tickNotEmitted', tick: 9 },
  noWorldYet: { code: 'noWorldYet' },
  matchEnded: { code: 'matchEnded' },
  loadingTimedOut: { code: 'loadingTimedOut', nick: 'Bartek' },
  commandBudget: { code: 'commandBudget' },
  envelopeTooLarge: { code: 'envelopeTooLarge' },
  seatEmpty: { code: 'seatEmpty', player: 5 },
  voteSelf: { code: 'voteSelf' },
  notWaitedFor: { code: 'notWaitedFor', nick: 'Cezary' },
  voteNotOpen: { code: 'voteNotOpen', seconds: 42 },
  snapshotUnsynced: { code: 'snapshotUnsynced' },
  noSnapshot: { code: 'noSnapshot' },
  initialSaveGeneration: { code: 'initialSaveGeneration', generation: 73 },
  worldTickMismatch: { code: 'worldTickMismatch', tick: 73 },
  worldBeforeStart: { code: 'worldBeforeStart', tick: 73 },
  resultTickUnacknowledged: { code: 'resultTickUnacknowledged' },
  resultAlreadyReported: { code: 'resultAlreadyReported' },
  resultDisagreement: { code: 'resultDisagreement' },
  historyBytes: { code: 'historyBytes' },
  historyAge: { code: 'historyAge' },
  saveUnsynced: { code: 'saveUnsynced' },
  saveOtherWorld: { code: 'saveOtherWorld' },
  saveBeforeStart: { code: 'saveBeforeStart' },
  saveUnacknowledged: { code: 'saveUnacknowledged' },
  saveExpired: { code: 'saveExpired' },
  saveTooLarge: { code: 'saveTooLarge' },
};

const en = messages('eng');
const pl = messages('pol');

describe('relay reasons in the player language', () => {
  it('words every code in both languages with every value filled in', () => {
    for (const reason of Object.values(SAMPLES)) {
      for (const copy of [en, pl]) {
        const text = relayReasonText(reason, copy);
        expect(text, reason.code).not.toMatch(/[{}]/);
        expect(text.length, reason.code).toBeGreaterThan(0);
      }
      expect(relayReasonText(reason, pl), reason.code).not.toBe(relayReasonText(reason, en));
    }
  });

  it('counts seats from one and names seat modes and file kinds in the language', () => {
    expect(relayReasonText(SAMPLES.seatTaken, pl)).toBe('miejsce 3 zajmuje Bartek');
    expect(relayReasonText(SAMPLES.seatModeUnavailable, en)).toBe('seat 2 cannot be set to Computer');
    expect(relayReasonText(SAMPLES.incompatible, pl)).toBe('Bartek: brak: mapa');
    expect(relayReasonText(SAMPLES.roomFull, en)).toBe('the room is full (12 players)');
  });

  it('keeps the parser diagnostic out of what the player reads', () => {
    expect(relayReasonText(SAMPLES.malformed, en)).not.toContain('immutable');
  });

  it('words a close by its code, and any other close as a plain one', () => {
    expect(relayCloseText('trafficLimit', pl)).toBe('Połączenie zamknięte: ta gra wysłała zbyt dużo danych');
    expect(relayCloseText('protocolUnsupported', en)).toBe(
      'Connection closed: the server runs a different version of the game',
    );
    expect(relayCloseText('closed with code 1002', pl)).toBe('Połączenie zamknięte');
    expect(relayCloseText(undefined, en)).toBe('Connection closed');
  });

  it('words a refusal carried as an error, and leaves other errors their message', () => {
    expect(relayFailureText(new RelayRefusal({ code: 'noSnapshot' }), pl)).toBe(
      'serwer nie ma jeszcze migawki',
    );
    expect(relayFailureText(new Error('Missing map'), pl)).toBe('Missing map');
  });
});
