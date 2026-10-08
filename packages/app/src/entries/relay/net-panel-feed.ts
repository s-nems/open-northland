import type { ClockState, RelayClientView } from '@open-northland/net-client';
import {
  kickVotesNeeded,
  MAX_CHAT_HISTORY_LINES,
  type RoomView,
  type ServerMessage,
  TICK_MS,
  type WaitedMember,
} from '@open-northland/net-protocol';
import { playerSwatchHex } from '../../catalog/roster.js';
import type {
  NetChatLine,
  NetClockModel,
  NetLineCue,
  NetLinkLoss,
  NetLinkModel,
  NetNotice,
  NetPanelModel,
  NetPlayerRow,
  NetPlayerStatus,
  SpeedSample,
} from '../../hud/network/model.js';
import { messages, tribeName } from '../../i18n/index.js';
import type { KickTally, RelayClientMirror } from '../../net/net-worker-client.js';
import { relayCloseText } from '../../net/relay-reason.js';
import type { LinkReport } from '../../session/worker/net-protocol.js';
import { createSpeedHistory } from '../../view/net/speed-history.js';
import type { NetReadout } from '../../view/runtime/net-readout.js';

const MS_PER_SECOND = 1000;
const PERCENT = 100;
/** The requested speed before the relay's first clock word: a room starts at ×1. */
const DEFAULT_SPEED = 1;
/** Wall time a member may trail the clock before its row reads as catching up: the relay's
 *  `LAG_BEHIND_MS`, which a test pins, counted in frames at the requested speed as the relay counts it. */
export const CATCHING_UP_BEHIND_MS = 1000;
/** Pings unanswered this long make a member silent, and waited for, at the relay: its
 *  `SILENT_AFTER_MS`, which a test pins. */
export const RELAY_SILENT_AFTER_MS = 4000;

/** When the room is reckoned to have begun waiting for this client, from a link report that arrived at
 *  `atMs`: a socket the relay closed is gone at once, and a link quiet for longer than the relay's
 *  silence limit went silent there that long ago, taking the outage as the same both ways. */
function waitedSince(report: LinkReport, atMs: number): number {
  return atMs - Math.max(0, (report.quietMs ?? 0) - RELAY_SILENT_AFTER_MS);
}

/** The link's loss after the worker's report. The first loss keeps its moment and its identity: a drop
 *  after a quiet, or a retry after a retry, moves nothing. */
function linkLoss(current: NetLinkLoss | null, report: LinkReport, atMs: number): NetLinkLoss | null {
  switch (report.state) {
    case 'ok':
      return null;
    case 'quiet':
    case 'reconnecting':
      return current?.kind === 'dropped'
        ? current
        : { kind: 'dropped', waitedSinceMs: waitedSince(report, atMs) };
    case 'closed':
      return { kind: 'closed', reason: relayCloseText(report.reason) };
  }
}

/** What the relay has told this client about its room, as the panel's rows read it. */
interface RelayRoomFacts {
  readonly room: RoomView | null;
  readonly waiting: readonly WaitedMember[];
  /** Milliseconds since the wait list arrived, which its countdowns run from. */
  readonly waitingAgeMs: number;
  readonly tallies: ReadonlyMap<number, KickTally>;
  readonly clock: ClockState | null;
  readonly selfNick: string;
}

const runningSpeedOf = (clock: ClockState | null): number =>
  clock?.governed?.speed ?? clock?.speed ?? DEFAULT_SPEED;

/** Whole seconds until a waited member's vote opens. */
const voteInSeconds = (wait: WaitedMember, ageMs: number): number =>
  Math.ceil(Math.max(0, wait.voteAfterMs - ageMs) / MS_PER_SECOND);

/** One row per room member, in the room's order. A waited member reads as why it is waited for, the
 *  governor as slowing the room, a disconnected member the relay does not wait for as offline, a
 *  member trailing by more than {@link CATCHING_UP_BEHIND_MS} of frames as catching up. */
function relayPlayerRows(facts: RelayRoomFacts): readonly NetPlayerRow[] {
  const { room, clock } = facts;
  if (room === null) return [];
  const waited = new Map(facts.waiting.map((member) => [member.nick, member]));
  const governor = clock?.governed?.nick ?? null;
  const tickBudgetMs = TICK_MS / runningSpeedOf(clock);
  const lagTicks = Math.ceil((CATCHING_UP_BEHIND_MS / TICK_MS) * (clock?.speed ?? DEFAULT_SPEED));
  // The relay's electorate before its first tally: every other connected member.
  const connected = room.members.filter((member) => member.connected).length;
  return room.members.map((member): NetPlayerRow => {
    const self = member.nick === facts.selfNick;
    const wait = waited.get(member.nick);
    const status: NetPlayerStatus =
      wait !== undefined
        ? wait.reason
        : member.nick === governor
          ? 'slowing'
          : !member.connected
            ? 'offline'
            : member.behindTicks > lagTicks
              ? 'catchingUp'
              : 'ok';
    const seat = member.seat === null ? undefined : room.seats.find((row) => row.player === member.seat);
    const tally = member.seat === null ? undefined : facts.tallies.get(member.seat);
    const electorate = connected - (member.connected ? 1 : 0);
    const seconds = wait === undefined ? 0 : voteInSeconds(wait, facts.waitingAgeMs);
    return {
      nick: member.nick,
      seat: member.seat,
      self,
      color: seat === undefined ? null : playerSwatchHex(seat.color),
      tribe: seat?.tribe === undefined ? null : tribeName(seat.tribe),
      status,
      pingMs: member.roundTripMs,
      delayTicks: member.delayTicks,
      tickCostPct: member.load === null ? null : (member.load.tickMs / tickBudgetMs) * PERCENT,
      behindTicks: member.behindTicks,
      loadingPercent: member.loading,
      vote:
        wait === undefined
          ? null
          : {
              voteInSeconds: seconds,
              yes: tally?.yes.length ?? 0,
              needed: tally?.needed ?? kickVotesNeeded(electorate),
              ballot:
                self || member.seat === null || seconds > 0
                  ? null
                  : tally?.yes.includes(facts.selfNick) === true
                    ? 'cast'
                    : 'open',
            },
    };
  });
}

/** The clock as the panel shows it; `held` is whether the relay waits for anyone, which stops its
 *  frames whatever the pause says. */
function relayClock(clock: ClockState | null, held: boolean, history: readonly SpeedSample[]): NetClockModel {
  return {
    requestedSpeed: clock?.speed ?? DEFAULT_SPEED,
    runningSpeed: runningSpeedOf(clock),
    paused: clock?.paused ?? false,
    held,
    governor: clock?.governed == null ? null : { nick: clock.governed.nick, cause: clock.governed.cause },
    history,
  };
}

const sameLine = (a: NetChatLine, b: NetChatLine): boolean =>
  a.from === b.from && a.text === b.text && a.at === b.at;

/** The lines of a replayed history this client has not shown: those after the last member line it
 *  holds, or all of them when that line is not among them (the room said more than its log keeps). */
export function unseenHistory(
  shown: readonly NetChatLine[],
  history: readonly NetChatLine[],
): readonly NetChatLine[] {
  const lastSaid = [...shown].reverse().find((line) => line.from !== null);
  if (lastSaid === undefined) return history;
  const fromEnd = [...history].reverse().findIndex((line) => sameLine(line, lastSaid));
  return fromEnd < 0 ? history : history.slice(history.length - fromEnd);
}

export interface RelayPanelFeedDeps {
  readonly client: RelayClientView & Pick<RelayClientMirror, 'kickTallies'>;
  readonly readout: () => NetReadout;
  readonly relayUrl: string | null;
  /** Wall milliseconds, monotonic; default `performance.now`. */
  readonly now?: () => number;
  /** Unix epoch milliseconds, which stamps the session's own lines; default `Date.now`. */
  readonly wallClock?: () => number;
}

/** The network panel's model for a relayed game, built from what the client view and the messages
 *  it applied say. Each part is rebuilt only when its inputs moved, so the model keeps its identity
 *  between changes. */
export interface RelayPanelFeed {
  model(): NetPanelModel;
  /** Every relay message after the client acted on it. */
  observe(message: ServerMessage): void;
  /** Add a line about the session; it takes its place among the members' lines as it arrives, ringing
   *  `cue` if given. */
  announce(text: string, cue?: NetLineCue): void;
  /** The line about this client's own world; null clears it. */
  notice(notice: NetNotice | null): void;
  /** The link as the worker last reported it; `atMs` is when that report arrived, default now. */
  link(report: LinkReport, atMs?: number): void;
}

export function createRelayPanelFeed(deps: RelayPanelFeedDeps): RelayPanelFeed {
  const { client } = deps;
  const now = deps.now ?? ((): number => performance.now());
  const wallClock = deps.wallClock ?? ((): number => Date.now());
  const speeds = createSpeedHistory();
  // The client's wait list, which an `ended` clears as well as a `waiting`; its countdowns run from when
  // this feed saw it change.
  let waiting: readonly WaitedMember[] = client.waitingFor;
  let waitingAt = now();
  // The room's lines said before this HUD mounted, the lobby's included; the announcements join them.
  let chat: readonly NetChatLine[] = client.chat;
  let chatVersion = 0;
  let worldNotice: NetNotice | null = null;
  let linkNoticeText: string | null = null;
  let loss: NetLinkLoss | null = null;

  let playersKey = '';
  let players: readonly NetPlayerRow[] = [];
  let clockFor: ClockState | null | undefined;
  let clock: NetClockModel | null = null;
  let linkKey = '';
  let link: NetLinkModel | null = null;
  let roomDirty = true;
  let shown: NetPanelModel | null = null;

  const append = (lines: readonly NetChatLine[]): void => {
    if (lines.length === 0) return;
    chat = [...chat, ...lines].slice(-MAX_CHAT_HISTORY_LINES);
    chatVersion += lines.length;
  };

  return {
    model(): NetPanelModel {
      const nowMs = now();
      if (client.waitingFor !== waiting) {
        waiting = client.waitingFor;
        waitingAt = nowMs;
        roomDirty = true;
      }
      const waitingAgeMs = nowMs - waitingAt;
      const held = waiting.length > 0;
      const clockState = client.clockState;
      const history = speeds.observe({
        nowMs,
        tick: client.tick,
        roomSpeed: held || (clockState?.paused ?? false) ? 0 : runningSpeedOf(clockState),
      });
      // The countdowns move by the second; nothing else in a row moves without a message.
      const nextPlayersKey = waiting.map((member) => voteInSeconds(member, waitingAgeMs)).join(',');
      if (roomDirty || nextPlayersKey !== playersKey) {
        roomDirty = false;
        playersKey = nextPlayersKey;
        players = relayPlayerRows({
          room: client.room,
          waiting,
          waitingAgeMs,
          tallies: client.kickTallies,
          clock: clockState,
          selfNick: client.nick,
        });
      }
      // A new clock that only carries a new sample leaves the speed bar alone, so a clock that moved
      // takes its history a frame later rather than both arriving in one object.
      if (clock === null || clockState !== clockFor || held !== clock.held) {
        clockFor = clockState;
        clock = relayClock(clockState, held, clock?.history ?? history);
      } else if (history !== clock.history) {
        clock = { ...clock, history };
      }
      const readout = deps.readout();
      const nextLinkKey = [
        readout.connected,
        readout.roundTripMs,
        readout.delayTicks,
        readout.delayMs,
        readout.clickToApplyMs,
        readout.bufferedTicks,
        client.relayBuild,
        linkNoticeText,
      ].join('|');
      if (link === null || nextLinkKey !== linkKey || link.loss !== loss) {
        linkKey = nextLinkKey;
        link = {
          ...readout,
          relayUrl: deps.relayUrl,
          relayBuild: client.relayBuild,
          notice: linkNoticeText,
          loss,
        };
      }
      if (
        shown === null ||
        shown.players !== players ||
        shown.clock !== clock ||
        shown.link !== link ||
        shown.responsiveness !== client.responsiveness ||
        shown.chatVersion !== chatVersion ||
        shown.notice !== worldNotice
      ) {
        shown = {
          players,
          clock,
          link,
          responsiveness: client.responsiveness,
          chat,
          chatVersion,
          notice: worldNotice,
        };
      }
      return shown;
    },
    observe(message): void {
      switch (message.kind) {
        case 'waiting':
          // Stamped on arrival rather than at the next frame's read.
          waiting = message.for;
          waitingAt = now();
          roomDirty = true;
          return;
        case 'kickVote':
          roomDirty = true;
          return;
        case 'rejected':
          // The speed segments moved on the click; a new clock object makes them follow the relay back.
          if (message.of === 'clock') clockFor = undefined;
          return;
        case 'room':
        case 'clock':
        case 'kicked':
          roomDirty = true;
          return;
        case 'chat': {
          const line = { from: message.from, text: message.text, at: message.at, tick: message.tick };
          append([message.from === client.nick ? line : { ...line, cue: 'chat' }]);
          return;
        }
        case 'chatHistory':
          // A return after a drop: the lines said meanwhile follow what was shown.
          append(unseenHistory(chat, message.lines));
          return;
        default:
          return;
      }
    },
    announce(text, cue): void {
      const line = { from: null, text, at: wallClock(), tick: client.tick };
      append([cue === undefined ? line : { ...line, cue }]);
    },
    notice(notice): void {
      worldNotice = notice;
    },
    link(report, atMs = now()): void {
      loss = linkLoss(loss, report, atMs);
      linkNoticeText =
        loss === null ? null : loss.kind === 'closed' ? loss.reason : messages().net.reconnecting;
    },
  };
}
