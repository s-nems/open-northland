/** A player's standing in a relayed room as the network panel shows it. `catchingUp` trails the clock
 *  without slowing anyone; `slowing` is the member the room is paced for; the last four hold the clock. */
export type NetPlayerStatus = 'ok' | 'catchingUp' | 'slowing' | 'loading' | 'resync' | 'silent' | 'gone';

/** The statuses the relay holds the clock for: it emits no frames while any member has one. */
export const HELD_STATUSES: readonly NetPlayerStatus[] = ['loading', 'resync', 'silent', 'gone'];

export function isHeldStatus(status: NetPlayerStatus): boolean {
  return HELD_STATUSES.includes(status);
}

/** The kick vote against a held member: its countdown, then its tally. */
export interface NetPlayerVote {
  /** Whole seconds until the vote opens; 0 once it is open. */
  readonly voteInSeconds: number;
  readonly yes: number;
  readonly needed: number;
  /** True once the vote is open, for a member with a seat, on another client's row, while this
   *  client has not voted yet. */
  readonly canVote: boolean;
}

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

export type NetGovernorCause = 'load' | 'lag';

export interface NetClockModel {
  readonly requestedSpeed: number;
  /** The governed speed while the room is paced for a member, else the requested one. */
  readonly runningSpeed: number;
  readonly paused: boolean;
  /** The relay emits no frames: some member is gone, silent, loading or resyncing. */
  readonly held: boolean;
  /** The member the room is paced for and what bounds it: its machine (`load`) or its link (`lag`). */
  readonly governor: { readonly nick: string; readonly cause: NetGovernorCause } | null;
  /** Up to {@link SPEED_HISTORY_SECONDS} samples. */
  readonly history: readonly SpeedSample[];
}

/** The sparkline's span: one sample per wall second. */
export const SPEED_HISTORY_SECONDS = 120;

export interface NetLinkModel {
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
}

/** A chat line; `from` null is a line about the session itself, `tick` the game clock it was said at. */
export interface ChatLine {
  readonly from: string | null;
  readonly text: string;
  readonly tick: number | null;
}

export interface NetPanelModel {
  readonly players: readonly NetPlayerRow[];
  readonly clock: NetClockModel;
  readonly link: NetLinkModel;
  readonly chat: readonly ChatLine[];
  /** Bumps once per appended chat line, so a reader can tell new lines without comparing arrays. */
  readonly chatVersion: number;
  /** A line about this client's own world (out of sync with the room); null when there is none. */
  readonly notice: string | null;
}

export interface NetPanelActions {
  kick(seat: number): void;
  say(text: string): void;
}

/** What the network panel, its banners and the chat log read. The model is the same object while
 *  nothing in it changed, so a reader compares identities; null until the relay's HUD is up. */
export interface NetPanelSource extends NetPanelActions {
  model(): NetPanelModel | null;
}
