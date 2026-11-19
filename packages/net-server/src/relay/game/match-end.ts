import type { ClientMessage, ServerMessage } from '@open-northland/net-protocol';
import { broadcast, type Deliver, isSynced, type Member, type Refusal } from '../member.js';

type FinishReport = Extract<ClientMessage, { kind: 'finish' }>;

/** The match's result: the tick and full hash every connected player's world agreed on. The game plays
 *  on past it; the result only says who won. */
export class MatchEnd {
  private readonly reports = new Map<string, FinishReport>();
  private result: FinishReport | null = null;
  failure: Refusal = null;

  constructor(
    private readonly members: ReadonlyMap<string, Member>,
    private readonly deliver: Deliver,
  ) {}

  get tick(): number | null {
    return this.result?.tick ?? null;
  }

  get message(): Extract<ServerMessage, { kind: 'ended' }> | null {
    return this.result === null ? null : { kind: 'ended', tick: this.result.tick, hash: this.result.hash };
  }

  report(member: Member, report: FinishReport): Refusal {
    // A world that comes back or catches up passes the decided result again.
    if (this.result !== null) return null;
    if (report.world !== member.world || member.outOfSync !== null) return null;
    if (!isSynced(member)) return { code: 'notLoaded' };
    if (report.tick !== member.ackedTick) return { code: 'resultTickUnacknowledged' };
    const previous = this.reports.get(member.token);
    if (previous !== undefined && !sameResult(previous, report)) return { code: 'resultAlreadyReported' };
    this.reports.set(member.token, report);
    this.settle();
    return null;
  }

  forget(token: string): void {
    this.reports.delete(token);
  }

  settle(): void {
    if (this.result !== null) return;
    let candidate: FinishReport | null = null;
    let mismatch = false;
    const hasPlayers = [...this.members.values()].some((member) => member.seat !== null);
    for (const member of this.members.values()) {
      if (!member.connected || (hasPlayers && member.seat === null)) continue;
      const report = this.reports.get(member.token);
      if (
        !isSynced(member) ||
        report === undefined ||
        report.world !== member.world ||
        report.tick !== member.ackedTick
      )
        return;
      if (candidate !== null && !sameResult(candidate, report)) mismatch = true;
      candidate = report;
    }
    if (candidate === null) return;
    if (mismatch) {
      this.failure = { code: 'resultDisagreement' };
      return;
    }
    this.result = candidate;
    this.reports.clear();
    broadcast(this.members.values(), this.deliver, {
      kind: 'ended',
      tick: candidate.tick,
      hash: candidate.hash,
    });
  }
}

function sameResult(a: FinishReport, b: FinishReport): boolean {
  return a.tick === b.tick && a.hash === b.hash;
}
