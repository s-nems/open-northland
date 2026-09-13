import type { ClientMessage, ServerMessage } from '@open-northland/net-protocol';
import { broadcast, type Deliver, isSynced, type Member, type Refusal } from './member.js';

import type { RoomClock } from './room-clock.js';

type FinishReport = Extract<ClientMessage, { kind: 'finish' }>;

export class MatchEnd {
  private readonly reports = new Map<string, FinishReport>();
  private result: FinishReport | null = null;
  failure: Refusal = null;

  constructor(
    private readonly clock: RoomClock,
    private readonly members: ReadonlyMap<string, Member>,
    private readonly deliver: Deliver,
    private readonly onEnded: (tick: number) => void,
  ) {}

  get tick(): number | null {
    return this.result?.tick ?? null;
  }

  get message(): Extract<ServerMessage, { kind: 'ended' }> | null {
    return this.result === null ? null : { kind: 'ended', tick: this.result.tick, hash: this.result.hash };
  }

  report(member: Member, report: FinishReport): Refusal {
    if (report.world !== member.world || member.outOfSync !== null) return null;
    if (!isSynced(member)) return 'not loaded';
    if (report.tick !== member.ackedTick) return 'the result must name the acknowledged tick';
    if (this.result !== null) return sameResult(this.result, report) ? null : 'the match has ended';
    const previous = this.reports.get(member.token);
    if (previous !== undefined && !sameResult(previous, report)) return 'a result was already reported';
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
    for (const member of this.members.values()) {
      if (!member.connected) continue;
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
      this.failure = 'match result disagreement: connected players reported different final states';
      return;
    }
    this.result = candidate;
    this.reports.clear();
    this.clock.finishAt(candidate.tick);
    const send = (message: Parameters<Deliver>[1]) => broadcast(this.members.values(), this.deliver, message);
    send({ kind: 'waiting', for: [] });
    send({ kind: 'clock', tick: this.clock.nextTick, speed: this.clock.speed, paused: true, by: null });
    this.onEnded(candidate.tick);
    send({ kind: 'ended', tick: candidate.tick, hash: candidate.hash });
  }
}

function sameResult(a: FinishReport, b: FinishReport): boolean {
  return a.tick === b.tick && a.hash === b.hash;
}
