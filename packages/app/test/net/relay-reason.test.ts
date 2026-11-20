import { RelayRefusal } from '@open-northland/net-client';
import type { RelayReason, RelayReasonCode } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { messages } from '../../src/i18n/index.js';
import {
  relayCloseText,
  relayFailureText,
  relayReasonText,
  relayVersionGap,
} from '../../src/net/relay-reason.js';
import type { RunningGame } from '../../src/update/outdated.js';

/** One reason per code, so a new code without a worded template fails to compile here. */
const SAMPLES: { readonly [C in RelayReasonCode]: Extract<RelayReason, { code: C }> } = {
  helloFirst: { code: 'helloFirst' },
  helloOverdue: { code: 'helloOverdue' },
  protocolUnsupported: { code: 'protocolUnsupported', client: 8, relay: 9, build: '0.8.0' },
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
  gameStarted: { code: 'gameStarted' },
  gameNotStarted: { code: 'gameNotStarted' },
  creatorOnly: { code: 'creatorOnly' },
  noCreator: { code: 'noCreator' },
  savedRulesFixed: { code: 'savedRulesFixed' },
  savedSeatsFixed: { code: 'savedSeatsFixed' },
  seatNotClaimable: { code: 'seatNotClaimable', player: 2 },
  noSeat: { code: 'noSeat', player: 4 },
  seatTaken: { code: 'seatTaken', player: 2, nick: 'Bartek' },
  seatModeUnavailable: { code: 'seatModeUnavailable', player: 1, mode: 'computer' },
  seatTribeUnavailable: { code: 'seatTribeUnavailable', player: 2 },
  colorTaken: { code: 'colorTaken', player: 1, wearer: 2 },
  seatDifficultyUnavailable: { code: 'seatDifficultyUnavailable', player: 2 },
  seatRequired: { code: 'seatRequired' },
  notMember: { code: 'notMember', nick: 'Zenon' },
  wrongPassword: { code: 'wrongPassword' },
  banned: { code: 'banned' },
  banSelf: { code: 'banSelf' },
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
  mapNotKept: { code: 'mapNotKept' },
  lobbyFilesFixed: { code: 'lobbyFilesFixed' },
  noRecipient: { code: 'noRecipient', nick: 'Zenon' },
  alreadyLoaded: { code: 'alreadyLoaded' },
  worldOutOfSync: { code: 'worldOutOfSync' },
  notLoaded: { code: 'notLoaded' },
  ackOutOfOrder: { code: 'ackOutOfOrder', expected: 3 },
  tickNotEmitted: { code: 'tickNotEmitted', tick: 9 },
  noWorldYet: { code: 'noWorldYet' },
  loadingTimedOut: { code: 'loadingTimedOut', nick: 'Bartek' },
  leftBeforeStart: { code: 'leftBeforeStart', nick: 'Bartek' },
  commandBudget: { code: 'commandBudget' },
  envelopeTooLarge: { code: 'envelopeTooLarge' },
  seatEmpty: { code: 'seatEmpty', player: 5 },
  voteSelf: { code: 'voteSelf' },
  notWaitedFor: { code: 'notWaitedFor', nick: 'Cezary' },
  voteNotOpen: { code: 'voteNotOpen', seconds: 42 },
  noVoteToWithdraw: { code: 'noVoteToWithdraw', nick: 'Bartek' },
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
const WEB: RunningGame = { version: '0.7.0', web: true };
const DESKTOP: RunningGame = { version: '0.7.0', web: false };

describe('relay reasons in the player language', () => {
  it('words every code in both languages with every value filled in', () => {
    for (const reason of Object.values(SAMPLES)) {
      for (const copy of [en, pl]) {
        const text = relayReasonText(reason, copy, WEB);
        expect(text, reason.code).not.toMatch(/[{}]/);
        expect(text.length, reason.code).toBeGreaterThan(0);
      }
      expect(relayReasonText(reason, pl, WEB), reason.code).not.toBe(relayReasonText(reason, en, WEB));
    }
  });

  it('counts seats from one and names seat modes and file kinds in the language', () => {
    expect(relayReasonText(SAMPLES.seatTaken, pl)).toBe('miejsce 3 zajmuje Bartek');
    expect(relayReasonText(SAMPLES.seatModeUnavailable, en)).toBe('seat 2 cannot be set to Computer');
    expect(relayReasonText(SAMPLES.incompatible, pl)).toBe('Bartek: brak: mapa');
  });

  it('keeps the parser diagnostic out of what the player reads', () => {
    expect(relayReasonText(SAMPLES.malformed, en)).not.toContain('immutable');
  });

  it('words a close by its code, and any other close as a plain one', () => {
    expect(relayCloseText({ reason: 'trafficLimit' }, pl)).toBe(
      'Połączenie zamknięte: ta gra wysłała zbyt dużo danych',
    );
    expect(relayCloseText({ reason: 'protocolUnsupported' }, en)).toBe(
      'Connection closed: the server runs a different version of the game',
    );
    expect(relayCloseText({ reason: 'closed with code 1002' }, pl)).toBe('Połączenie zamknięte');
    expect(relayCloseText({}, en)).toBe('Connection closed');
  });

  it('leaves out a relay build that is no release name', () => {
    const labelled = { ...SAMPLES.protocolUnsupported, build: 'test relay of a branch' };
    expect(relayVersionGap({ reason: 'protocolUnsupported', refusal: labelled })).toEqual({
      kind: 'outdated',
      required: null,
    });
  });

  it('names both releases when the relay refuses another protocol, and what the older side does', () => {
    const outdated = { reason: 'protocolUnsupported', refusal: SAMPLES.protocolUnsupported } as const;
    expect(relayCloseText(outdated, pl, WEB)).toBe(
      'Połączenie zamknięte: masz wersję gry 0.7.0, a serwer wymaga 0.8.0. Przeładuj stronę, aby wczytać nową wersję',
    );
    expect(relayCloseText(outdated, pl, DESKTOP)).toContain(
      'Pobierz nową wersję ze strony opennorthland.org',
    );
    expect(relayVersionGap(outdated)).toEqual({ kind: 'outdated', required: '0.8.0' });

    const ahead = { code: 'protocolUnsupported', client: 9, relay: 8, build: '0.6.0' } as const;
    expect(relayReasonText(ahead, en, WEB)).toContain('still runs version 0.6.0');
    expect(relayVersionGap({ reason: 'protocolUnsupported', refusal: ahead })).toEqual({
      kind: 'ahead',
      server: '0.6.0',
    });

    // A relay that predates its build in the refusal still tells which side is older.
    const { build: _build, ...unnamed } = SAMPLES.protocolUnsupported;
    expect(relayReasonText(unnamed, en, WEB)).toBe(
      "your game version 0.7.0 is older than the server's. Reload the page to load the new version",
    );
  });

  it('words a refusal carried as an error, and leaves other errors their message', () => {
    expect(relayFailureText(new RelayRefusal({ code: 'noSnapshot' }), pl)).toBe(
      'serwer nie ma jeszcze migawki',
    );
    expect(relayFailureText(new Error('Missing map'), pl)).toBe('Missing map');
  });
});
