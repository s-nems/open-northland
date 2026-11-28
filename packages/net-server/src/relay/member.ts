import {
  type ClientLoad,
  DESCRIPTOR_WORLD,
  type LobbyCompatibility,
  type PlayerFlag,
  type RelayReason,
  type ServerMessage,
  type WaitReason,
  withFlag,
} from '@open-northland/net-protocol';
import { msFields } from './relay-log.js';

export interface Member {
  readonly token: string;
  /** Unique within the room; a duplicate gets a numeric suffix. */
  readonly nick: string;
  /** The flag the member said `hello` with when it joined; none when absent. */
  readonly flag?: PlayerFlag;
  connected: boolean;
  /** When the current connection was made, then the order of joining; the earliest wins a digest tie. */
  connectedSince: number;
  joinOrder: number;
  /** When the client's last message, or progress on one still arriving, reached the relay. */
  lastHeardAt: number;
  /** Bytes of a message from the client still arriving, such as a snapshot upload; 0 when none. */
  receivingBytes: number;
  /** The connection's input delay and round trip, as the relay last measured them. */
  delayTicks: number;
  roundTripMs: number;
  jitterMs: number;
  linkMeasured: boolean;
  /** The load the client's last acknowledgement reported, kept as sent: the client already smooths
   *  the tick cost. Null before its first. */
  load: ClientLoad | null;
  seat: number | null;
  ready: boolean;
  compatibility: LobbyCompatibility | null;
  loaded: boolean;
  /** The boot progress, in percent, the client last reported before its world loaded. */
  loading: number | null;
  /** When the client's boot last moved or its world loaded, or the game started or the client dropped
   *  or returned; how long a load has stood still counts from it. */
  progressAt: number;
  /** The last tick the client reported applied, and the generation of the world it reports from. */
  ackedTick: number;
  world: number;
  /** The notice that put the client out of sync, until a snapshot brings it back. */
  outOfSync: DesyncNotice | null;
  /** What the relay saw of the member since the room's last status line. */
  figures: MemberFigures;
}

/** One member's figures over a room status interval, each updated where the relay already has the
 *  value: on a pong, an acknowledgement, a drop, or the poll that judges its lag. */
export interface MemberFigures {
  roundTrips: number;
  roundTripSumMs: number;
  roundTripMaxMs: number;
  delayMaxTicks: number;
  behindMaxTicks: number;
  tickMaxMs: number | null;
  bufferedMaxTicks: number | null;
  /** Connections lost, closed or replaced by a newer one. */
  drops: number;
  /** Messages the relay refused, by `kind:code`: a client stuck on a refused `loaded`, or orders over
   *  its budget. */
  readonly refused: Partial<Record<string, number>>;
  /** Milliseconds the clock held for the member, by reason. */
  readonly waitedMs: Partial<Record<WaitReason, number>>;
  /** Milliseconds the clock ran governed for the member, neither held nor paused. */
  governedMs: number;
}

/** Figures for an interval starting now: the levels in force at its start count towards its maxima. */
export function freshFigures(member: Pick<Member, 'delayTicks' | 'load'>): MemberFigures {
  return {
    roundTrips: 0,
    roundTripSumMs: 0,
    roundTripMaxMs: 0,
    delayMaxTicks: member.delayTicks,
    behindMaxTicks: 0,
    tickMaxMs: member.load?.tickMs ?? null,
    bufferedMaxTicks: member.load?.buffered ?? null,
    drops: 0,
    refused: {},
    waitedMs: {},
    governedMs: 0,
  };
}

/** One member's entry in a room status line; a figure with nothing to report is left out. */
export function figureFields(member: Member): Record<string, unknown> {
  const { figures } = member;
  return {
    nick: member.nick,
    seat: member.seat,
    ...(member.connected ? {} : { connected: false }),
    // A boot still in progress, in percent.
    ...(member.loaded || member.loading === null ? {} : { loading: member.loading }),
    // The mean of the interval's samples; a `disconnect` line carries the smoothed estimate instead.
    ...(figures.roundTrips === 0
      ? {}
      : {
          roundTripMeanMs: Math.round(figures.roundTripSumMs / figures.roundTrips),
          roundTripMaxMs: Math.round(figures.roundTripMaxMs),
        }),
    delayMaxTicks: figures.delayMaxTicks,
    behindMaxTicks: figures.behindMaxTicks,
    ...(figures.tickMaxMs === null ? {} : { tickMaxMs: Math.round(figures.tickMaxMs) }),
    ...(figures.bufferedMaxTicks === null ? {} : { bufferedMaxTicks: figures.bufferedMaxTicks }),
    ...(figures.drops === 0 ? {} : { drops: figures.drops }),
    ...(Object.keys(figures.refused).length === 0 ? {} : { refused: figures.refused }),
    ...msFields(figures.waitedMs),
    ...(figures.governedMs === 0 ? {} : { governedMs: Math.round(figures.governedMs) }),
  };
}

/** Nothing heard from a client this long makes it silent, whatever its socket says. */
export const SILENT_AFTER_MS = 4000;

export function isSilent(member: Pick<Member, 'lastHeardAt'>, now: number): boolean {
  return now - member.lastHeardAt > SILENT_AFTER_MS;
}

export type DesyncNotice = Extract<ServerMessage, { kind: 'desync' }>;

export interface MeasuredLink {
  readonly delayTicks: number;
  readonly roundTripMs: number;
  readonly jitterMs?: number;
  readonly measured?: boolean;
}

export function createMember(
  token: string,
  nick: string,
  now: number,
  link: MeasuredLink,
  flag?: PlayerFlag,
): Member {
  return {
    token,
    nick,
    ...withFlag(flag),
    connected: true,
    connectedSince: now,
    joinOrder: 0,
    lastHeardAt: now,
    receivingBytes: 0,
    delayTicks: link.delayTicks,
    roundTripMs: link.roundTripMs,
    jitterMs: link.jitterMs ?? 0,
    linkMeasured: link.measured ?? false,
    load: null,
    seat: null,
    ready: false,
    compatibility: null,
    loaded: false,
    loading: null,
    progressAt: now,
    ackedTick: 0,
    world: DESCRIPTOR_WORLD,
    outOfSync: null,
    figures: freshFigures({ delayTicks: link.delayTicks, load: null }),
  };
}

/** A member whose world is believed to match the room's: the ones a digest is expected from and a
 *  snapshot may come from. */
export function isSynced(member: Pick<Member, 'connected' | 'loaded' | 'outOfSync'>): boolean {
  return member.connected && member.loaded && member.outOfSync === null;
}

export function broadcast(members: Iterable<Member>, deliver: Deliver, message: ServerMessage): void {
  for (const member of members) {
    if (member.connected) deliver(member, message);
  }
}

/** Null when the action went through, otherwise why it was refused. */
export type Refusal = RelayReason | null;

export type Deliver = (member: Member, message: ServerMessage) => void;
