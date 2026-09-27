import { type RoomView, TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { formatMessage, messages } from '../../src/i18n/index.js';
import { inputDelayMs, runningSpeed } from '../../src/net/net-worker-client.js';
import { memberRows } from '../../src/view/net/net-status.js';
import { type WaitedRow, waitedRows, waitingText } from '../../src/view/net/waiting-overlay.js';

const ROOM: RoomView = {
  id: 'r1',
  state: 'running',
  creator: 'Ania',
  settings: {
    name: 'las',
    world: { kind: 'map', mapId: 'las' },
    seed: 7,
    rules: { fog: null, progression: null, needs: null },
    speed: 1,
  },
  seats: [],
  members: [
    { nick: 'Ania', seat: 1, connected: true, compatibility: null, load: null },
    { nick: 'Bartek', seat: 2, connected: true, compatibility: null, load: null },
    { nick: 'Celina', seat: 3, connected: false, compatibility: null, load: null },
  ],
};

describe('input delay readout', () => {
  const DELAY_TICKS = 4;
  const REQUESTED_SPEED = 2;
  const GOVERNED_SPEED = 0.5;

  it('reads the delay at the governed speed the clock runs at, not the requested one', () => {
    const client = {
      delayTicks: DELAY_TICKS,
      speed: REQUESTED_SPEED,
      governed: { nick: 'Bartek', speed: GOVERNED_SPEED },
    };
    expect(runningSpeed(client)).toBe(GOVERNED_SPEED);
    expect(inputDelayMs(client)).toBe((DELAY_TICKS * TICK_MS) / GOVERNED_SPEED);
  });

  it('reads the requested speed while nobody governs the clock, and no delay before one is assigned', () => {
    const client = { delayTicks: DELAY_TICKS, speed: REQUESTED_SPEED, governed: null };
    expect(inputDelayMs(client)).toBe((DELAY_TICKS * TICK_MS) / REQUESTED_SPEED);
    expect(inputDelayMs({ ...client, delayTicks: null })).toBeNull();
  });
});

describe('memberRows', () => {
  it('reads each member from the wait list first, then from the connection flag', () => {
    const rows = memberRows(ROOM, [{ nick: 'Bartek', reason: 'slow', voteAfterMs: 1000 }], 'Ania');
    expect(rows).toEqual([
      { nick: 'Ania', seat: 1, status: 'ok', self: true, load: null },
      { nick: 'Bartek', seat: 2, status: 'slow', self: false, load: null },
      { nick: 'Celina', seat: 3, status: 'gone', self: false, load: null },
    ]);
  });

  it('lists nobody before a room', () => {
    expect(memberRows(null, [], 'Ania')).toEqual([]);
  });
});

describe('waitedRows', () => {
  it('counts each member down from the moment the notice arrived, in whole seconds, to zero', () => {
    const waited = [
      { nick: 'Bartek', reason: 'gone', voteAfterMs: 4500 },
      { nick: 'Celina', reason: 'silent', voteAfterMs: 0 },
    ] as const;
    expect(waitedRows(waited, 1000, 1000)).toEqual([
      { nick: 'Bartek', reason: 'gone', voteInSeconds: 5 },
      { nick: 'Celina', reason: 'silent', voteInSeconds: 0 },
    ]);
    expect(waitedRows(waited, 1000, 4600)[0]?.voteInSeconds).toBe(1);
    expect(waitedRows(waited, 1000, 9000)[0]?.voteInSeconds).toBe(0);
  });
});

describe('waitingText', () => {
  const copy = messages().net;
  const GOVERNED_SPEED = 0.5;
  const governed = { nick: 'Bartek', speed: GOVERNED_SPEED };
  const slow = (nick: string): WaitedRow => ({ nick, reason: 'slow', voteInSeconds: 0 });

  it('names the speed the slowest member holds the game to, under a slowed-down title', () => {
    const text = waitingText([slow('Bartek'), slow('Celina')], governed, 'Ania');
    expect(text).toEqual({
      title: copy.slowedTitle,
      lines: [
        `Bartek · ${formatMessage(copy.slowingTo, { speed: '×0.5' })}`,
        `Celina · ${copy.reasons.slow}`,
      ],
      footer: null,
    });
  });

  it('tells the member slowing the game that the others wait for it', () => {
    expect(waitingText([slow('Bartek')], governed, 'Bartek').footer).toBe(copy.othersWaitForYou);
  });

  it('keeps the waiting title while any member holds the clock', () => {
    const rows: readonly WaitedRow[] = [slow('Bartek'), { nick: 'Celina', reason: 'gone', voteInSeconds: 0 }];
    const text = waitingText(rows, governed, 'Ania');
    expect(text.title).toBe(copy.waitingTitle);
    expect(text.lines[1]).toBe(`Celina · ${copy.reasons.gone}`);
  });
});
