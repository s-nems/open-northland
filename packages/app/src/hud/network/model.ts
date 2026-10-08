import type { GovernorCause, ResponsivenessMode, ResponsivenessState } from '@open-northland/net-protocol';

/** A player's standing in a relayed room as the network panel shows it. `catchingUp` trails the clock
 *  without slowing anyone; `slowing` is the member the room is paced for; `offline` is disconnected
 *  while the relay does not wait for it (a spectator, or after the verdict); the last four are the
 *  relay's wait reasons, which hold the clock. */
export type NetPlayerStatus =
  | 'ok'
  | 'catchingUp'
  | 'slowing'
  | 'offline'
  | 'loading'
  | 'resync'
  | 'silent'
  | 'gone';

/** The statuses a waited member reads as: the relay emits no frames while any member has one. */
const HELD_STATUSES: readonly NetPlayerStatus[] = ['loading', 'resync', 'silent', 'gone'];

export function isHeldStatus(status: NetPlayerStatus): boolean {
  return HELD_STATUSES.includes(status);
}

/** The kick vote against a held member: its countdown, then its tally. */
export interface NetPlayerVote {
  /** Whole seconds until the vote opens; 0 once it is open. */
  readonly voteInSeconds: number;
  readonly yes: number;
  readonly needed: number;
  /** This client's part once the vote is open, on another seated member's row: `open` before it
   *  voted, `cast` after, when it may withdraw; null while it has none. */
  readonly ballot: NetBallot | null;
}

export type NetBallot = 'open' | 'cast';

export interface NetPlayerRow {
  readonly nick: string;
  readonly seat: number | null;
  readonly self: boolean;
  /** CSS colour of the seat, null without a seat. */
  readonly color: string | null;
  /** Localized nation name, null without a seat. */
  readonly tribe: string | null;
  readonly status: NetPlayerStatus;
  readonly pingMs: number | null;
  readonly delayTicks: number | null;
  /** The member's reported tick cost as a percentage of the tick's wall time at the running speed;
   *  above 100 it cannot keep up. */
  readonly tickCostPct: number | null;
  /** Ticks the member's acknowledgements trail the clock. */
  readonly behindTicks: number;
  readonly loadingPercent: number | null;
  readonly vote: NetPlayerVote | null;
}

/** One wall second of the room's pace, oldest first. */
export interface SpeedSample {
  /** The speed the relay ran the clock at; 0 while paused or held. */
  readonly roomSpeed: number;
  /** The ticks this client's world advanced in the second, as a speed multiplier. */
  readonly ownSpeed: number;
}

export interface NetClockModel {
  readonly requestedSpeed: number;
  /** The governed speed while the room is paced for a member, else the requested one. */
  readonly runningSpeed: number;
  readonly paused: boolean;
  /** The relay's wait list is not empty: it emits no frames while it waits for a member. */
  readonly held: boolean;
  /** The member the room is paced for and what bounds it: its machine (`load`) or its link (`lag`). */
  readonly governor: { readonly nick: string; readonly cause: GovernorCause } | null;
  /** Up to {@link SPEED_HISTORY_SECONDS} samples. */
  readonly history: readonly SpeedSample[];
}

/** The sparkline's span: one sample per wall second. */
export const SPEED_HISTORY_SECONDS = 120;

/** The relay's countdown from the moment it begins waiting for a member until the others may vote it
 *  out: its `KICK_COUNTDOWN_MS`, which a test pins. */
export const KICK_COUNTDOWN_MS = 60_000;

/** The link while it is lost. `dropped`: the relay is not heard, whether the socket fell or went quiet,
 *  and the client keeps trying; `waitedSinceMs` is the wall moment (`performance.now`) the room is
 *  reckoned to have begun waiting for this client, which {@link KICK_COUNTDOWN_MS} counts from.
 *  `closed`: the link will not reopen. */
export type NetLinkLoss =
  | { readonly kind: 'dropped'; readonly waitedSinceMs: number }
  | { readonly kind: 'closed'; readonly reason: string };

export interface NetLinkModel {
  /** What this client sends still goes out; false once the socket dropped or closed. */
  readonly connected: boolean;
  readonly roundTripMs: number | null;
  readonly delayTicks: number | null;
  /** The input delay in wall time at the running speed. */
  readonly delayMs: number | null;
  readonly clickToApplyMs: number | null;
  /** Frames received and not yet run. */
  readonly bufferedTicks: number;
  readonly relayUrl: string | null;
  readonly relayBuild: string | null;
  /** Why the link is down: reconnecting, or closed for good with the relay's reason; null while up. */
  readonly notice: string | null;
  /** The lost link, which the lost-connection screen shows; null while the relay is heard. */
  readonly loss: NetLinkLoss | null;
}

/** The sound a chat line rings as it arrives: another player's line, a player joining or returning, a
 *  player leaving or kicked. */
export type NetLineCue = 'chat' | 'arrival' | 'departure';

/** A chat line; `from` null is a line about the session itself. `at` is when it was said, in Unix epoch
 *  ms, and `tick` the game clock then, null before it started: the relay's stamps on a member's line,
 *  this client's on a session line. */
export interface NetChatLine {
  readonly from: string | null;
  readonly text: string;
  readonly at: number;
  readonly tick: number | null;
  /** Absent, the line rings nothing: the player's own line, a line from the history, an announcement
   *  about the clock. */
  readonly cue?: NetLineCue;
}

export interface NetPanelModel {
  readonly responsiveness: ResponsivenessState;
  readonly players: readonly NetPlayerRow[];
  readonly clock: NetClockModel;
  readonly link: NetLinkModel;
  readonly chat: readonly NetChatLine[];
  /** Bumps once per appended chat line, so a reader can tell new lines without comparing arrays. */
  readonly chatVersion: number;
  /** A line about this client's own world (out of sync with the room); null when there is none. */
  readonly notice: NetNotice | null;
}

/** `text` fits the status line; `tip` is the full explanation the window shows on hover. */
export interface NetNotice {
  readonly text: string;
  readonly tip: string;
}

export interface NetPanelActions {
  setResponsiveness(mode: ResponsivenessMode): void;
  /** A yes towards kicking the member in `seat`, or with `yes` false its withdrawal. */
  kick(seat: number, yes: boolean): void;
  say(text: string): void;
}

/** What the network panel, its status line and the chat log read. The model is the same object while
 *  nothing in it changed, so a reader compares identities; null until the relay's HUD is up. */
export interface NetPanelSource extends NetPanelActions {
  model(): NetPanelModel | null;
}
