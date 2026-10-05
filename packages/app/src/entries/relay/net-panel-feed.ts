import type { ClockState, RelayClientView } from '@open-northland/net-client';
import {
  type RoomView,
  type ServerMessage,
  TICK_MS,
  type WaitedMember,
  type WaitReason,
} from '@open-northland/net-protocol';
import { playerSwatchHex } from '../../catalog/roster.js';
import {
  type ChatLine,
  isHeldStatus,
  type NetClockModel,
  type NetLinkModel,
  type NetPanelModel,
  type NetPlayerRow,
  type NetPlayerStatus,
} from '../../hud/network/model.js';
import { tribeName } from '../../i18n/index.js';
import type { NetReadout } from '../../view/runtime/net-readout.js';

/** Lines the panel's chat keeps; older ones drop off the top. */
export const MAX_PANEL_CHAT_LINES = 500;
const MS_PER_SECOND = 1000;
const PERCENT = 100;
/** The requested speed before the relay's first clock word: a room starts at ×1. */
const DEFAULT_SPEED = 1;

export type KickVote = Extract<ServerMessage, { kind: 'kickVote' }>;

/** What the relay has told this client about its room, as the panel's rows read it. */
export interface RelayRoomFacts {
  readonly room: RoomView | null;
  readonly waiting: readonly WaitedMember[];
  /** Milliseconds since the wait list arrived, which its countdowns run from. */
  readonly waitingAgeMs: number;
  readonly tallies: ReadonlyMap<number, KickVote>;
  readonly clock: ClockState | null;
  readonly selfNick: string;
  readonly readout: NetReadout;
}

/** A waited member's status. A reason other than the four the relay holds the clock for (the slow
 *  member the relay paces the room for, while the protocol still lists it) reads as catching up. */
function waitStatus(reason: WaitReason): NetPlayerStatus {
  switch (reason) {
    case 'gone':
    case 'silent':
    case 'loading':
    case 'resync':
      return reason;
    default:
      return 'catchingUp';
  }
}

const runningSpeedOf = (clock: ClockState | null): number =>
  clock?.governed?.speed ?? clock?.speed ?? DEFAULT_SPEED;

/** One row per room member, in the room's order. */
export function relayPlayerRows(facts: RelayRoomFacts): readonly NetPlayerRow[] {
  const { room, clock } = facts;
  if (room === null) return [];
  const waited = new Map(facts.waiting.map((member) => [member.nick, member]));
  const governor = clock?.governed?.nick ?? null;
  const tickBudgetMs = TICK_MS / runningSpeedOf(clock);
  // The relay's electorate before its first tally: every other connected member, half of them rounded up.
  const connected = room.members.filter((member) => member.connected).length;
  return room.members.map((member): NetPlayerRow => {
    const self = member.nick === facts.selfNick;
    const wait = waited.get(member.nick);
    const status: NetPlayerStatus =
      wait !== undefined && isHeldStatus(waitStatus(wait.reason))
        ? waitStatus(wait.reason)
        : member.nick === governor
          ? 'slowing'
          : wait !== undefined
            ? 'catchingUp'
            : member.connected
              ? 'ok'
              : 'gone';
    const seat = member.seat === null ? undefined : room.seats.find((row) => row.player === member.seat);
    const tally = member.seat === null ? undefined : facts.tallies.get(member.seat);
    const electorate = connected - (member.connected ? 1 : 0);
    return {
      nick: member.nick,
      seat: member.seat,
      self,
      color: seat === undefined ? null : playerSwatchHex(seat.color),
      tribe: seat?.tribe === undefined ? null : tribeName(seat.tribe),
      status,
      pingMs: self ? facts.readout.roundTripMs : null,
      delayTicks: self ? facts.readout.delayTicks : null,
      tickCostPct: member.load === null ? null : (member.load.tickMs / tickBudgetMs) * PERCENT,
      behindTicks: 0,
      loadingPercent: member.loading,
      vote:
        wait === undefined || !isHeldStatus(status)
          ? null
          : {
              voteInSeconds: Math.ceil(Math.max(0, wait.voteAfterMs - facts.waitingAgeMs) / MS_PER_SECOND),
              yes: tally?.yes.length ?? 0,
              needed: tally?.needed ?? Math.ceil(electorate / 2),
              canVote: !self && member.seat !== null,
            },
    };
  });
}

/** Whether the relay holds the clock for anyone on the wait list. A member merely disconnected and
 *  not waited for holds nothing. */
export function holdsClock(waiting: readonly WaitedMember[]): boolean {
  return waiting.some((member) => isHeldStatus(waitStatus(member.reason)));
}

export function relayClock(clock: ClockState | null, held: boolean): NetClockModel {
  return {
    requestedSpeed: clock?.speed ?? DEFAULT_SPEED,
    runningSpeed: runningSpeedOf(clock),
    paused: clock?.paused ?? false,
    held,
    governor: clock?.governed == null ? null : { nick: clock.governed.nick, cause: 'load' },
    history: [],
  };
}

export interface RelayPanelFeedDeps {
  readonly client: RelayClientView;
  readonly readout: () => NetReadout;
  readonly relayUrl: string | null;
  readonly now?: () => number;
}

/** The network panel's model for a relayed game, built from what the client view and the messages
 *  it applied say. Each part is rebuilt only when its inputs moved, so the model keeps its identity
 *  between changes. */
export interface RelayPanelFeed {
  model(): NetPanelModel;
  /** Every relay message after the client acted on it. */
  observe(message: ServerMessage): void;
  /** Add a chat line, a member's or one about the session. */
  append(line: Omit<ChatLine, 'tick'>): void;
  /** The line about this client's own link or world; null clears it. */
  notice(text: string | null): void;
}

export function createRelayPanelFeed(deps: RelayPanelFeedDeps): RelayPanelFeed {
  const { client } = deps;
  const now = deps.now ?? ((): number => performance.now());
  let waiting: readonly WaitedMember[] = client.waitingFor;
  let waitingAt = now();
  const tallies = new Map<number, KickVote>();
  let chat: readonly ChatLine[] = [];
  let chatVersion = 0;
  let noticeText: string | null = null;

  let playersKey = '';
  let players: readonly NetPlayerRow[] = [];
  let clockFor: ClockState | null | undefined;
  let clock: NetClockModel = relayClock(null, false);
  let linkKey = '';
  let link: NetLinkModel | null = null;
  let roomDirty = true;
  let shown: NetPanelModel | null = null;

  const facts = (): RelayRoomFacts => ({
    room: client.room,
    waiting,
    waitingAgeMs: now() - waitingAt,
    tallies,
    clock: client.clockState,
    selfNick: client.nick,
    readout: deps.readout(),
  });

  return {
    model(): NetPanelModel {
      const current = facts();
      // The countdowns move by the second; nothing else in a row moves without a message.
      const countdown = waiting
        .map((member) => Math.ceil(Math.max(0, member.voteAfterMs - current.waitingAgeMs) / MS_PER_SECOND))
        .join(',');
      const { readout } = current;
      const nextPlayersKey = `${countdown}|${readout.roundTripMs}|${readout.delayTicks}`;
      if (roomDirty || nextPlayersKey !== playersKey) {
        roomDirty = false;
        playersKey = nextPlayersKey;
        players = relayPlayerRows(current);
      }
      const held = holdsClock(waiting);
      if (current.clock !== clockFor || held !== clock.held) {
        clockFor = current.clock;
        clock = relayClock(current.clock, held);
      }
      const nextLinkKey = [
        readout.connected,
        readout.roundTripMs,
        readout.delayTicks,
        readout.delayMs,
        readout.clickToApplyMs,
        readout.bufferedTicks,
      ].join('|');
      if (link === null || nextLinkKey !== linkKey) {
        linkKey = nextLinkKey;
        link = { ...readout, relayUrl: deps.relayUrl, relayBuild: null };
      }
      if (
        shown === null ||
        shown.players !== players ||
        shown.clock !== clock ||
        shown.link !== link ||
        shown.chatVersion !== chatVersion ||
        shown.notice !== noticeText
      ) {
        shown = { players, clock, link, chat, chatVersion, notice: noticeText };
      }
      return shown;
    },
    observe(message): void {
      switch (message.kind) {
        case 'waiting': {
          waiting = message.for;
          waitingAt = now();
          const seats = new Set(
            message.for.flatMap(
              (member) => client.room?.members.find((row) => row.nick === member.nick)?.seat ?? [],
            ),
          );
          for (const seat of tallies.keys()) if (!seats.has(seat)) tallies.delete(seat);
          roomDirty = true;
          return;
        }
        case 'kickVote':
          tallies.set(message.player, message);
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
        default:
          return;
      }
    },
    append(line): void {
      const next = [...chat, { ...line, tick: client.tick }];
      chat = next.length > MAX_PANEL_CHAT_LINES ? next.slice(-MAX_PANEL_CHAT_LINES) : next;
      chatVersion += 1;
    },
    notice(text): void {
      noticeText = text;
    },
  };
}
