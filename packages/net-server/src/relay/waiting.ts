import type { ServerMessage, WaitReason } from '@open-northland/net-protocol';

/** How long a member is waited for before a vote to kick it may open. */
export const KICK_COUNTDOWN_MS = 60_000;

export interface Waited {
  readonly token: string;
  readonly nick: string;
  readonly reason: WaitReason;
}

/**
 * Who the room holds its clock for, and one countdown per waited member to when a vote to kick it may
 * open.
 */
export class Waiting {
  /** The waited set as the clients were last told it. */
  private announced: readonly Waited[] = [];
  private readonly since = new Map<string, number>();
  private readonly voteAnnounced = new Set<string>();

  get active(): boolean {
    return this.since.size > 0;
  }

  message(now: number): Extract<ServerMessage, { kind: 'waiting' }> {
    return {
      kind: 'waiting',
      for: this.announced.map(({ token, nick, reason }) => ({
        nick,
        reason,
        voteAfterMs: this.voteAfterMs(token, now),
      })),
    };
  }

  isWaitedFor(token: string): boolean {
    return this.since.has(token);
  }

  voteOpen(token: string, now: number): boolean {
    return this.voteAfterMs(token, now) === 0;
  }

  /** Whole milliseconds, since the wire carries a count and the clock may hand out fractions. */
  voteAfterMs(token: string, now: number): number {
    const since = this.since.get(token);
    return since === undefined
      ? KICK_COUNTDOWN_MS
      : Math.max(0, Math.ceil(KICK_COUNTDOWN_MS - (now - since)));
  }

  /** Replace the waited set; true when what clients were told has changed. */
  update(waited: readonly Waited[], now: number): boolean {
    const before = this.announced;
    this.announced = waited;
    for (const token of this.since.keys()) {
      if (!waited.some((entry) => entry.token === token)) {
        this.since.delete(token);
        this.voteAnnounced.delete(token);
      }
    }
    let opened = false;
    for (const { token } of waited) {
      if (!this.since.has(token)) this.since.set(token, now);
      if (this.voteOpen(token, now) && !this.voteAnnounced.has(token)) {
        this.voteAnnounced.add(token);
        opened = true;
      }
    }
    return opened || !sameWait(before, waited);
  }

  /** A departed token keeps no countdown. */
  forget(token: string): void {
    this.since.delete(token);
    this.voteAnnounced.delete(token);
  }
}

function sameWait(a: readonly Waited[], b: readonly Waited[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, i) => entry.token === b[i]?.token && entry.reason === b[i]?.reason);
}
