import type { SessionDriver } from '@open-northland/lockstep';
import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import type { NetClockModel, NetPlayerRow } from '../../src/hud/network/model.js';
import { SPARKLINE_H, SPARKLINE_W, sparklineGeometry } from '../../src/hud/network/sparkline.js';
import {
  formatRoomSpeed,
  heldLines,
  ownStateText,
  slowedText,
  speedBarLook,
} from '../../src/hud/network/text.js';
import { formatMessage, messages } from '../../src/i18n/index.js';
import { inputDelayMs, runningSpeed } from '../../src/net/net-worker-client.js';
import {
  createNetPanelPreview,
  NET_PREVIEW_STATE_MS,
  NET_PREVIEW_STATES,
  stillWhileHeld,
} from '../../src/view/net/panel-preview.js';

const REQUESTED_SPEED = 3;
const GOVERNED_SPEED = 2.4;

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
  });

  it('dims the speed bar at the speed a paced room runs at, and stops it while the room is held', () => {
    const players = [panelRow('Ania', { self: true }), panelRow('Bartek', { status: 'gone' })];
    expect(speedBarLook(clockModel(), players)).toBeNull();
    expect(
      speedBarLook(
        clockModel({ runningSpeed: GOVERNED_SPEED, governor: { nick: 'Celina', cause: 'lag' } }),
        players,
      ),
    ).toEqual({
      kind: 'slowed',
      title: formatMessage(copy.barGoverned, { speed: '×2,4', requested: '×3', nick: 'Celina' }),
      pressed: null,
    });
    expect(
      speedBarLook(
        clockModel({ runningSpeed: GOVERNED_SPEED, governor: { nick: 'Ania', cause: 'load' } }),
        players,
      ),
    ).toEqual({
      kind: 'slowed',
      title: formatMessage(copy.barGovernedSelf, { speed: '×2,4', requested: '×3' }),
      pressed: null,
    });
    expect(speedBarLook(clockModel({ held: true }), players)).toEqual({
      kind: 'held',
      title: formatMessage(copy.barHeld, { nicks: 'Bartek' }),
    });
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

  it('stops the scene world while its room is held, so the clock does not run under the banner', () => {
    const fed: number[] = [];
    const driver: SessionDriver = {
      paused: false,
      speed: 1,
      droppedTicks: 0,
      maxStepsPerFrame: 1,
      setPaused: () => undefined,
      setSpeed: () => undefined,
      submit: () => undefined,
      captureSave: () => {
        throw new Error('not saved');
      },
      advance: (elapsedMs) => {
        fed.push(elapsedMs);
        return 1;
      },
    };
    const frameMs = 16;
    stillWhileHeld(driver, createNetPanelPreview({ pinned: 'held', now: () => 0 })).advance(frameMs);
    stillWhileHeld(driver, createNetPanelPreview({ pinned: 'ok', now: () => 0 })).advance(frameMs);
    expect(fed).toEqual([0, frameMs]);
  });
});
