import type { SessionDriver } from '@open-northland/lockstep';
import { type ResponsivenessState, TICKS_PER_SECOND } from '@open-northland/net-protocol';
import { VIKING } from '../../catalog/buildings.js';
import { playerSwatchHex } from '../../catalog/roster.js';
import {
  isHeldStatus,
  type NetChatLine,
  type NetClockModel,
  type NetLinkModel,
  type NetPanelModel,
  type NetPanelSource,
  type NetPlayerRow,
  type NetPlayerVote,
  SPEED_HISTORY_SECONDS,
  type SpeedSample,
} from '../../hud/network/model.js';
import { desyncNotice } from '../../hud/network/text.js';
import { tribeName } from '../../i18n/index.js';

/** The scripted states of the network panel's design preview, in the order it cycles through them. */
export const NET_PREVIEW_STATES = [
  'ok',
  'catchingUp',
  'slowing',
  'held',
  'selfCatchingUp',
  'selfSlowing',
] as const;
export type NetPreviewState = (typeof NET_PREVIEW_STATES)[number];

/** `?netstate=<state>` pins the preview on one state instead of cycling. */
export const NET_PREVIEW_STATE_PARAM = 'netstate';

/** Wall ms each state shows before the next. */
export const NET_PREVIEW_STATE_MS = 6000;
const MS_PER_SECOND = 1000;
const REQUESTED_SPEED = 3;
const GOVERNED_SPEED = 2.4;
const SELF_GOVERNED_SPEED = 1.8;
const SELF = 'Ania';
const PEER = 'Bartek';
const SLOW_PEER = 'Celina';
const FRANKS = 2;
const SARACENS = 4;
const SEATS: Readonly<Record<string, { seat: number; tribe: number }>> = {
  [SELF]: { seat: 0, tribe: VIKING },
  [PEER]: { seat: 1, tribe: FRANKS },
  [SLOW_PEER]: { seat: 2, tribe: SARACENS },
};
const BASE_PING_MS: Readonly<Record<string, number>> = { [SELF]: 38, [PEER]: 61, [SLOW_PEER]: 112 };
const DELAY_TICKS = 4;
/** How far a catching-up member trails the clock, in wall seconds at ×1. */
const CATCHING_UP_SECONDS = 2.5;
const CATCHING_UP_TICKS = CATCHING_UP_SECONDS * TICKS_PER_SECOND;
/** The held member's countdown when its wait began, and the other's already-open vote. */
const VOTE_COUNTDOWN_S = 48;
const VOTES_NEEDED = 2;
/** The yeses from other players each open vote starts with. */
const OTHERS_YES = 1;
/** Tick costs in percent of the tick's budget at the running speed. */
const COST_EASY = 34;
const COST_BUSY = 72;
const COST_OVER = 128;
const LOADING_PERCENT = 64;
/** The dip in the history: where it starts, counted back from now, and how far the room fell. */
const DIP_START_S = 40;
const DIP_DEPTH = 0.6;
const HISTORY_WAVE = 0.04;
/** Seconds per radian of the history's wobble. */
const WAVE_PERIOD_S = 3;
const CLICK_TO_APPLY_MS = 96;
const BUFFERED_TICKS = 2;
const SECONDS_PER_MINUTE = 60;
const PREVIEW_RELAY_URL = 'ws://127.0.0.1:8787';
/** Where the held state's world fell out of sync, in game minutes and seconds. */
const DESYNC_AT_MIN = 5;
const DESYNC_AT_S = 40;

export interface NetPanelPreviewOptions {
  /** Pin one state instead of cycling; unknown names cycle. */
  readonly pinned: string | null;
  readonly now?: () => number;
}

/** A scripted network panel feed that cycles through every state the window, the status line and the
 *  speed segments show, for the owner's design preview (`?scene=net-panel`). Nothing in it is
 *  measured. */
export function createNetPanelPreview(options: NetPanelPreviewOptions): NetPanelSource {
  const now = options.now ?? ((): number => performance.now());
  const started = now();
  const pinned = NET_PREVIEW_STATES.find((state) => state === options.pinned) ?? null;
  /** The seats this preview's player voted to kick. */
  const cast = new Set<number>();
  let chat: readonly NetChatLine[] = OPENING_CHAT;
  let chatVersion = OPENING_CHAT.length;
  let responsiveness: ResponsivenessState = { mode: 'auto', bufferTicks: 2, by: null };
  let shownKey = '';
  let shown: NetPanelModel | null = null;

  const stateAt = (elapsedMs: number): NetPreviewState =>
    pinned ??
    NET_PREVIEW_STATES[Math.floor(elapsedMs / NET_PREVIEW_STATE_MS) % NET_PREVIEW_STATES.length] ??
    NET_PREVIEW_STATES[0];

  return {
    model(): NetPanelModel {
      const elapsed = now() - started;
      const state = stateAt(elapsed);
      const second = Math.floor((elapsed % NET_PREVIEW_STATE_MS) / MS_PER_SECOND);
      const key = `${state}|${second}|${chatVersion}|${responsiveness.mode}|${[...cast].join(',')}`;
      if (shown === null || key !== shownKey) {
        shownKey = key;
        const players = previewPlayers(state, second, cast);
        shown = {
          players,
          clock: previewClock(state, players),
          link: PREVIEW_LINK,
          responsiveness,
          chat,
          chatVersion,
          notice: state === 'held' ? desyncNotice(PEER, tick(DESYNC_AT_MIN, DESYNC_AT_S)) : null,
        };
      }
      return shown;
    },
    setResponsiveness(mode): void {
      responsiveness = { mode, bufferTicks: mode === 'responsive' ? 1 : mode === 'smooth' ? 3 : 2, by: SELF };
    },
    kick(seat, yes): void {
      if (yes) cast.add(seat);
      else cast.delete(seat);
    },
    say(text): void {
      chat = [...chat, { from: SELF, text, tick: null }];
      chatVersion += 1;
    },
  };
}

/** The scene's driver, standing still while the preview's room is held or paused, as a relayed world
 *  does while the relay sends no frames: no tick runs, so the world and the bar's clock stop. */
export function stillWhileHeld(driver: SessionDriver, preview: NetPanelSource): SessionDriver {
  const stopped = (): boolean => {
    const clock = preview.model()?.clock;
    return clock !== undefined && (clock.held || clock.paused);
  };
  return {
    get paused() {
      return driver.paused;
    },
    get speed() {
      return driver.speed;
    },
    get droppedTicks() {
      return driver.droppedTicks;
    },
    get maxStepsPerFrame() {
      return driver.maxStepsPerFrame;
    },
    setPaused: (paused) => driver.setPaused(paused),
    setSpeed: (speed) => driver.setSpeed(speed),
    submit: (envelope) => driver.submit(envelope),
    captureSave: (options) => driver.captureSave(options),
    // No elapsed time while stopped: the driver keeps its interpolation alpha and runs nothing.
    advance: (elapsedMs, onTick) => driver.advance(stopped() ? 0 : elapsedMs, onTick),
  };
}

const PREVIEW_LINK: NetLinkModel = {
  connected: true,
  roundTripMs: BASE_PING_MS[SELF] ?? null,
  delayTicks: DELAY_TICKS,
  delayMs: (DELAY_TICKS * MS_PER_SECOND) / TICKS_PER_SECOND / REQUESTED_SPEED,
  clickToApplyMs: CLICK_TO_APPLY_MS,
  bufferedTicks: BUFFERED_TICKS,
  relayUrl: PREVIEW_RELAY_URL,
  relayBuild: 'preview',
  notice: null,
  loss: null,
};

const tick = (minutes: number, seconds: number): number =>
  (minutes * SECONDS_PER_MINUTE + seconds) * TICKS_PER_SECOND;

const OPENING_CHAT: readonly NetChatLine[] = [
  { from: PEER, text: 'gotowi?', tick: null },
  { from: SLOW_PEER, text: 'chwila, wczytuję mapę', tick: null },
  { from: null, text: 'Celina dołącza', tick: tick(0, 0) },
  { from: SELF, text: 'gl hf', tick: tick(0, 4) },
  { from: PEER, text: 'kto bierze wyspę na północy?', tick: tick(3, 12) },
  { from: SLOW_PEER, text: 'ja, ale u mnie trochę klatkuje', tick: tick(3, 20) },
  { from: null, text: 'Bartek ustawia tempo x3', tick: tick(5, 2) },
];

function row(nick: string, overrides: Partial<NetPlayerRow>): NetPlayerRow {
  const seat = SEATS[nick];
  return {
    nick,
    seat: seat?.seat ?? null,
    self: nick === SELF,
    color: seat === undefined ? null : playerSwatchHex(seat.seat),
    tribe: seat === undefined ? null : tribeName(seat.tribe),
    status: 'ok',
    pingMs: BASE_PING_MS[nick] ?? null,
    delayTicks: DELAY_TICKS,
    tickCostPct: COST_EASY,
    behindTicks: 0,
    loadingPercent: null,
    vote: null,
    ...overrides,
  };
}

function previewPlayers(
  state: NetPreviewState,
  second: number,
  cast: ReadonlySet<number>,
): readonly NetPlayerRow[] {
  const vote = (nick: string, voteInSeconds: number): NetPlayerVote => {
    const seat = SEATS[nick]?.seat ?? null;
    const voted = seat !== null && cast.has(seat);
    return {
      voteInSeconds,
      yes: seat === null ? 0 : OTHERS_YES + (voted ? 1 : 0),
      needed: VOTES_NEEDED,
      ballot: nick === SELF || seat === null || voteInSeconds > 0 ? null : voted ? 'cast' : 'open',
    };
  };
  switch (state) {
    case 'ok':
      return [row(SELF, {}), row(PEER, {}), row(SLOW_PEER, { tickCostPct: COST_BUSY })];
    case 'catchingUp':
      return [
        row(SELF, {}),
        row(PEER, { status: 'catchingUp', behindTicks: CATCHING_UP_TICKS }),
        row(SLOW_PEER, { tickCostPct: COST_BUSY }),
      ];
    case 'slowing':
      return [
        row(SELF, {}),
        row(PEER, {}),
        row(SLOW_PEER, { status: 'slowing', tickCostPct: COST_OVER, behindTicks: CATCHING_UP_TICKS }),
      ];
    case 'held':
      return [
        row(SELF, {}),
        row(PEER, { status: 'gone', pingMs: null, delayTicks: null, tickCostPct: null, vote: vote(PEER, 0) }),
        row(SLOW_PEER, {
          status: 'loading',
          loadingPercent: LOADING_PERCENT,
          tickCostPct: null,
          vote: vote(SLOW_PEER, Math.max(0, VOTE_COUNTDOWN_S - second)),
        }),
      ];
    case 'selfCatchingUp':
      return [
        row(SELF, { status: 'catchingUp', behindTicks: CATCHING_UP_TICKS, tickCostPct: COST_BUSY }),
        row(PEER, {}),
        row(SLOW_PEER, { tickCostPct: COST_BUSY }),
      ];
    case 'selfSlowing':
      return [
        row(SELF, { status: 'slowing', tickCostPct: COST_BUSY, behindTicks: CATCHING_UP_TICKS }),
        row(PEER, {}),
        row(SLOW_PEER, {}),
      ];
  }
}

function previewClock(state: NetPreviewState, players: readonly NetPlayerRow[]): NetClockModel {
  const held = players.some((player) => isHeldStatus(player.status));
  const governor =
    state === 'slowing'
      ? { nick: SLOW_PEER, cause: 'load' as const }
      : state === 'selfSlowing'
        ? { nick: SELF, cause: 'lag' as const }
        : null;
  const runningSpeed =
    state === 'slowing' ? GOVERNED_SPEED : state === 'selfSlowing' ? SELF_GOVERNED_SPEED : REQUESTED_SPEED;
  return {
    requestedSpeed: REQUESTED_SPEED,
    runningSpeed,
    paused: false,
    held,
    governor,
    history: previewHistory(state, runningSpeed, held),
  };
}

/** A steady room with a small wobble; a governed or held state shows its fall over the last seconds. */
function previewHistory(state: NetPreviewState, runningSpeed: number, held: boolean): readonly SpeedSample[] {
  const samples: SpeedSample[] = [];
  for (let index = 0; index < SPEED_HISTORY_SECONDS; index++) {
    const fromEnd = SPEED_HISTORY_SECONDS - index;
    const wave = Math.sin(index / WAVE_PERIOD_S) * HISTORY_WAVE * REQUESTED_SPEED;
    const dipped = fromEnd <= DIP_START_S;
    const room = held && dipped ? 0 : dipped ? runningSpeed : REQUESTED_SPEED;
    const own =
      state === 'selfCatchingUp' && dipped
        ? REQUESTED_SPEED * DIP_DEPTH + wave
        : state === 'slowing' && dipped
          ? runningSpeed + wave
          : room + wave;
    samples.push({ roomSpeed: room, ownSpeed: Math.max(0, own) });
  }
  return samples;
}
