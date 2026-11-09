import {
  type HallChatLine,
  MAX_HALL_CHAT_LINES,
  MAX_PRESENCE_ENTRIES,
  type OnlinePlayer,
  type PlayerFlag,
  type RecentPlayer,
  type ServerMessage,
  withFlag,
} from '@open-northland/net-protocol';
import { HALL_RECORD_VERSION, type HallRecord } from './record.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** How long a line of the relay's chat stays, besides the `MAX_HALL_CHAT_LINES` cap. */
export const HALL_CHAT_KEPT_MS = 14 * MS_PER_DAY;
/** How long a nick that left stays in the recent list. */
export const SEEN_KEPT_MS = 7 * MS_PER_DAY;
/** Lines one peer address may say at once; after that one more each `HALL_CHAT_REFILL_MS`. */
export const HALL_CHAT_BURST = 5;
export const HALL_CHAT_REFILL_MS = 2000;

type PresenceMessage = Extract<ServerMessage, { kind: 'presence' }>;

/**
 * Everything the relay shows outside its rooms that outlives a connection: its chat and who was seen
 * when. Wall-clock times throughout, since they survive a restart through `record`; `changed` tells
 * the host there is something new to keep.
 */
export class Hall {
  private lines: HallChatLine[];
  /** Lines said since the hall began, kept ones included: the count a listener has heard up to. */
  said: number;
  /** Nick to when it was last seen, oldest first. */
  private readonly seen = new Map<string, number>();

  constructor(
    record: HallRecord | null,
    private readonly changed: () => void,
  ) {
    this.lines = [...(record?.chat ?? [])].slice(-MAX_HALL_CHAT_LINES);
    this.said = this.lines.length;
    const seen = [...(record?.seen ?? [])].sort((a, b) => a.at - b.at);
    for (const { nick, at } of seen) this.seen.set(nick, at);
  }

  say(
    from: string,
    text: string,
    at: number,
    flag?: PlayerFlag,
  ): Extract<ServerMessage, { kind: 'hallChat' }> {
    const line = { from, ...withFlag(flag), text, at };
    this.lines.push(line);
    if (this.lines.length > MAX_HALL_CHAT_LINES) this.lines.shift();
    this.said++;
    this.changed();
    return { kind: 'hallChat', ...line };
  }

  /** Every kept line, or with `heard` (a `said` count) only the kept ones said after it. */
  history(now: number, heard: number | null): Extract<ServerMessage, { kind: 'hallChatHistory' }> {
    this.forgetChat(now);
    const first = this.said - this.lines.length;
    // A listener that missed lines no longer kept gets the whole chat, so no gap stays on its screen.
    if (heard === null || heard < first)
      return { kind: 'hallChatHistory', lines: [...this.lines], replaces: true };
    return { kind: 'hallChatHistory', lines: this.lines.slice(heard - first), replaces: false };
  }

  /** `nick` arrived or left at `at`. */
  saw(nick: string, at: number): void {
    this.seen.delete(nick);
    this.seen.set(nick, at);
    this.forgetSeen(at);
    this.changed();
  }

  /** `online` lists every connection; a nick on several shows once, in a room if any of them is. */
  presence(online: readonly OnlinePlayer[], now: number): PresenceMessage {
    const players = new Map<string, OnlinePlayer>();
    for (const player of online) {
      if (!players.has(player.nick) || player.room !== null) players.set(player.nick, player);
    }
    this.forgetSeen(now);
    const recent: RecentPlayer[] = [];
    for (const [nick, at] of this.seen) if (!players.has(nick)) recent.push({ nick, at });
    recent.reverse();
    return {
      kind: 'presence',
      online: [...players.values()].slice(0, MAX_PRESENCE_ENTRIES),
      recent: recent.slice(0, MAX_PRESENCE_ENTRIES),
    };
  }

  /** What to keep across a restart; whoever is still connected was last seen `now`. */
  record(online: readonly string[], now: number): HallRecord {
    for (const nick of online) {
      this.seen.delete(nick);
      this.seen.set(nick, now);
    }
    this.forgetChat(now);
    this.forgetSeen(now);
    return {
      version: HALL_RECORD_VERSION,
      // Flags are left out, so the record keeps its layout; a restart forgets them.
      chat: this.lines.map(({ from, text, at }) => ({ from, text, at })),
      seen: [...this.seen].map(([nick, at]) => ({ nick, at })),
    };
  }

  private forgetChat(now: number): void {
    const first = this.lines.findIndex((line) => now - line.at < HALL_CHAT_KEPT_MS);
    if (first !== 0) this.lines = first < 0 ? [] : this.lines.slice(first);
  }

  private forgetSeen(now: number): void {
    for (const [nick, at] of this.seen) {
      if (now - at < SEEN_KEPT_MS && this.seen.size <= MAX_PRESENCE_ENTRIES) break;
      this.seen.delete(nick);
    }
  }
}
