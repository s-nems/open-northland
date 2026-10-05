import type { ClockState } from '@open-northland/net-client';
import { type RoomView, TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import {
  holdsClock,
  type KickVote,
  relayClock,
  relayPlayerRows,
} from '../../src/entries/relay/net-panel-feed.js';
import type { NetClockModel, NetPlayerRow } from '../../src/hud/network/model.js';
import { SPARKLINE_H, SPARKLINE_W, sparklineGeometry } from '../../src/hud/network/sparkline.js';
import {
  formatRoomSpeed,
  governedBarTitle,
  heldLines,
  ownStateText,
  slowedText,
} from '../../src/hud/network/text.js';
import { formatMessage, messages } from '../../src/i18n/index.js';
import { inputDelayMs, runningSpeed } from '../../src/net/net-worker-client.js';
import {
  createNetPanelPreview,
  NET_PREVIEW_STATE_MS,
  NET_PREVIEW_STATES,
} from '../../src/view/net/panel-preview.js';
import type { NetReadout } from '../../src/view/runtime/net-readout.js';

const member = (nick: string, seat: number | null, connected = true) => ({
  nick,
  seat,
  connected,
  compatibility: null,
  load: null,
  loading: null,
  roundTripMs: null,
  delayTicks: null,
  behindTicks: 0,
});

const ROOM: RoomView = {
  id: 'r1',
  state: 'running',
  creator: 'Ania',
  settings: {
    name: 'las',
    world: { kind: 'map', mapId: 'las' },
    seed: 7,
    rules: { fog: null, progression: null, needs: null, weather: null },
    speed: 1,
  },
  seats: [],
  members: [member('Ania', 1), member('Bartek', 2), member('Celina', 3, false), member('Dorota', 4)],
};

const READOUT: NetReadout = {
  connected: true,
  roundTripMs: 40,
  delayTicks: 3,
  delayMs: 150,
  clickToApplyMs: null,
  bufferedTicks: 1,
};

const REQUESTED_SPEED = 3;
const GOVERNED_SPEED = 2.4;
const clockState = (governed: ClockState['governed']): ClockState => ({
  kind: 'clock',
  tick: 100,
  speed: REQUESTED_SPEED,
  paused: false,
  by: null,
  governed,
});

const facts = (overrides: Partial<Parameters<typeof relayPlayerRows>[0]> = {}) => ({
  room: ROOM,
  waiting: [],
  waitingAgeMs: 0,
  tallies: new Map<number, KickVote>(),
  clock: null,
  selfNick: 'Ania',
  readout: READOUT,
  ...overrides,
});

describe('input delay readout', () => {
  const DELAY_TICKS = 4;
  const REQUESTED = 2;
  const GOVERNED = 0.5;

  it('reads the delay at the governed speed the clock runs at, not the requested one', () => {
    const client = {
      delayTicks: DELAY_TICKS,
      speed: REQUESTED,
      governed: { nick: 'Bartek', speed: GOVERNED, cause: 'load' as const },
    };
    expect(runningSpeed(client)).toBe(GOVERNED);
    expect(inputDelayMs(client)).toBe((DELAY_TICKS * TICK_MS) / GOVERNED);
  });

  it('reads the requested speed while nobody governs the clock, and no delay before one is assigned', () => {
    const client = { delayTicks: DELAY_TICKS, speed: REQUESTED, governed: null };
    expect(inputDelayMs(client)).toBe((DELAY_TICKS * TICK_MS) / REQUESTED);
    expect(inputDelayMs({ ...client, delayTicks: null })).toBeNull();
  });
});

describe('relayed panel rows', () => {
  it('reads the hold reasons first, then the governor, then the connection flag', () => {
    const rows = relayPlayerRows(
      facts({
        waiting: [{ nick: 'Bartek', reason: 'silent', voteAfterMs: 0 }],
        clock: clockState({ nick: 'Dorota', speed: GOVERNED_SPEED, cause: 'load' }),
      }),
    );
    expect(rows.map((row) => [row.nick, row.status])).toEqual([
      ['Ania', 'ok'],
      ['Bartek', 'silent'],
      ['Celina', 'gone'],
      ['Dorota', 'slowing'],
    ]);
    expect(rows.map((row) => row.self)).toEqual([true, false, false, false]);
    // Only this client's own link is known today.
    expect(rows[0]?.pingMs).toBe(READOUT.roundTripMs);
    expect(rows[1]?.pingMs).toBeNull();
  });

  it('counts a held member down to its vote, then offers it with the relay tally or the electorate', () => {
    const VOTE_AFTER_MS = 5000;
    const waiting = [{ nick: 'Bartek', reason: 'gone' as const, voteAfterMs: VOTE_AFTER_MS }];
    const counting = relayPlayerRows(facts({ waiting, waitingAgeMs: 1200 }));
    expect(counting[1]?.vote).toEqual({ voteInSeconds: 4, yes: 0, needed: 1, canVote: true });
    const open = relayPlayerRows(facts({ waiting, waitingAgeMs: VOTE_AFTER_MS }));
    // Ania and Dorota are the connected others: half of two, rounded up.
    expect(open[1]?.vote).toEqual({ voteInSeconds: 0, yes: 0, needed: 1, canVote: true });
    const tallied = relayPlayerRows(
      facts({
        waiting,
        waitingAgeMs: VOTE_AFTER_MS,
        tallies: new Map([[2, { kind: 'kickVote', player: 2, nick: 'Bartek', yes: ['Ania'], needed: 2 }]]),
      }),
    );
    expect(tallied[1]?.vote).toMatchObject({ yes: 1, needed: 2 });
  });

  it('offers no vote against this client itself', () => {
    const rows = relayPlayerRows(facts({ waiting: [{ nick: 'Ania', reason: 'loading', voteAfterMs: 0 }] }));
    expect(rows[0]?.vote?.canVote).toBe(false);
  });

  it('holds the clock only for the held statuses, and names the governor by its machine for now', () => {
    const governed = clockState({ nick: 'Dorota', speed: GOVERNED_SPEED, cause: 'load' });
    const clock = relayClock(governed, holdsClock([]));
    expect(clock).toMatchObject({
      requestedSpeed: REQUESTED_SPEED,
      runningSpeed: GOVERNED_SPEED,
      held: false,
      governor: { nick: 'Dorota', cause: 'load' },
    });
    // Celina is disconnected, but nobody waits for her: the clock runs.
    expect(holdsClock([])).toBe(false);
    expect(holdsClock([{ nick: 'Bartek', reason: 'resync', voteAfterMs: 0 }])).toBe(true);
  });
});

const clockModel = (overrides: Partial<NetClockModel> = {}): NetClockModel => ({
  requestedSpeed: REQUESTED_SPEED,
  runningSpeed: REQUESTED_SPEED,
  paused: false,
  held: false,
  governor: null,
  history: [],
  ...overrides,
});

const panelRow = (nick: string, overrides: Partial<NetPlayerRow> = {}): NetPlayerRow => ({
  nick,
  seat: 1,
  self: false,
  color: null,
  tribe: null,
  status: 'ok',
  pingMs: null,
  delayTicks: null,
  tickCostPct: null,
  behindTicks: 0,
  loadingPercent: null,
  vote: null,
  ...overrides,
});

describe('network panel wording', () => {
  const copy = messages().hud.network;

  it('writes speeds in the language’s own decimals', () => {
    expect(formatRoomSpeed(GOVERNED_SPEED)).toBe('×2,4');
    expect(formatRoomSpeed(REQUESTED_SPEED)).toBe('×3');
  });

  it('says who slows the room and why, or that this client does', () => {
    const players = [panelRow('Ania', { self: true }), panelRow('Celina')];
    const governed = (nick: string, cause: 'load' | 'lag') =>
      clockModel({ runningSpeed: GOVERNED_SPEED, governor: { nick, cause } });
    expect(slowedText(clockModel(), players)).toBeNull();
    expect(slowedText(governed('Celina', 'lag'), players)).toBe(
      formatMessage(copy.slowedBy, { speed: '×2,4', nick: 'Celina', cause: copy.causes.lag }),
    );
    expect(slowedText(governed('Ania', 'load'), players)).toBe(
      formatMessage(copy.slowedBySelf, { speed: '×2,4' }),
    );
    expect(governedBarTitle(governed('Celina', 'load'))).toContain('Celina');
  });

  it('lists only the held members on the banner, each with where its vote stands', () => {
    const lines = heldLines([
      panelRow('Ania', { self: true }),
      panelRow('Bartek', { status: 'gone', vote: { voteInSeconds: 48, yes: 0, needed: 1, canVote: true } }),
      panelRow('Celina', { status: 'catchingUp' }),
    ]);
    expect(lines).toEqual([`Bartek · ${copy.status.gone} · ${formatMessage(copy.voteIn, { seconds: 48 })}`]);
  });

  it('tells this client when it trails or paces the room', () => {
    expect(ownStateText([panelRow('Ania', { self: true })])).toBeNull();
    expect(ownStateText([panelRow('Ania', { self: true, status: 'catchingUp' })])).toBe(copy.selfCatchingUp);
    expect(ownStateText([panelRow('Ania', { self: true, status: 'slowing' })])).toBe(copy.selfSlowing);
  });
});

describe('speed sparkline', () => {
  it('fills from the right on one scale up to the requested speed, with a guide per whole multiplier', () => {
    const geometry = sparklineGeometry(
      [
        { roomSpeed: REQUESTED_SPEED, ownSpeed: REQUESTED_SPEED },
        { roomSpeed: 0, ownSpeed: 1.5 },
      ],
      REQUESTED_SPEED,
    );
    const points = geometry.room.split(' ');
    expect(points).toHaveLength(2);
    expect(points[1]).toBe(`${SPARKLINE_W - 1},${SPARKLINE_H}`);
    expect(geometry.guides.map((guide) => guide.speed)).toEqual([1, 2, 3]);
    expect(sparklineGeometry([], 1).room).toBe('');
  });
});

describe('network panel preview', () => {
  it('reaches every state and keeps its model while nothing moved', () => {
    let clock = 0;
    const preview = createNetPanelPreview({ pinned: null, now: () => clock });
    const first = preview.model();
    expect(preview.model()).toBe(first);
    const seen = new Set<string>();
    for (const _ of NET_PREVIEW_STATES) {
      const model = preview.model();
      const governed = model?.clock.governor?.nick ?? '';
      seen.add(`${model?.clock.held}|${governed}|${model?.players.map((row) => row.status).join(',')}`);
      clock += NET_PREVIEW_STATE_MS;
    }
    expect(seen.size).toBe(NET_PREVIEW_STATES.length);
  });

  it('pins one state, and counts a kick vote', () => {
    const preview = createNetPanelPreview({ pinned: 'held', now: () => 0 });
    expect(preview.model()?.clock.held).toBe(true);
    const target = preview
      .model()
      ?.players.find((row) => row.vote?.canVote === true && row.vote.voteInSeconds === 0);
    expect(target?.seat).not.toBeNull();
    if (target?.seat == null) return;
    preview.kick(target.seat);
    expect(preview.model()?.players.find((row) => row.nick === target.nick)?.vote?.yes).toBe(2);
  });
});
