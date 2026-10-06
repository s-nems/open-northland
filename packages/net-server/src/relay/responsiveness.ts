import {
  MAX_RESPONSIVENESS_BUFFER_TICKS,
  type ResponsivenessMode,
  type ResponsivenessState,
  type ServerMessage,
  TICK_MS,
} from '@open-northland/net-protocol';
import { isSynced, type Member } from './member.js';

/** These are room pacing choices, independent of each member's existing command delivery budget. */
const MANUAL_TICKS = { responsive: 1, balanced: 2, smooth: 3 } as const;
const LOWER_AFTER_MS = 10_000;

type MeasuredMember = Pick<
  Member,
  'seat' | 'connected' | 'loaded' | 'outOfSync' | 'linkMeasured' | 'roundTripMs' | 'jitterMs'
>;

/** A small capped RTT margin covers unobserved variation; measured jitter determines the reserve.
 *  Stable latency is already covered by the member's input delay and is not buffered twice. */
export function automaticBufferTicks(members: Iterable<MeasuredMember>, speed: number): number {
  let target = 1;
  for (const member of members) {
    if (member.seat === null || !isSynced(member)) continue;
    if (!member.linkMeasured) {
      target = Math.max(target, 2);
      continue;
    }
    const reserveMs = Math.min(25, member.roundTripMs * 0.1) + member.jitterMs * 2;
    target = Math.max(target, Math.ceil((reserveMs * speed) / TICK_MS));
  }
  return Math.min(MAX_RESPONSIVENESS_BUFFER_TICKS, target);
}

export class Responsiveness {
  private state: ResponsivenessState = { mode: 'auto', bufferTicks: 2, by: null };
  private lowerSince: number | null = null;

  message(): Extract<ServerMessage, { kind: 'responsiveness' }> {
    return { kind: 'responsiveness', ...this.state };
  }

  select(mode: ResponsivenessMode, by: string): boolean {
    if (mode === this.state.mode) return false;
    this.state = { mode, bufferTicks: mode === 'auto' ? 2 : MANUAL_TICKS[mode], by };
    this.lowerSince = null;
    return true;
  }

  observe(members: Iterable<MeasuredMember>, speed: number | null, now: number): boolean {
    if (this.state.mode !== 'auto' || speed === null) {
      this.lowerSince = null;
      return false;
    }
    const target = automaticBufferTicks(members, speed);
    if (target === this.state.bufferTicks) {
      this.lowerSince = null;
      return false;
    }
    if (target < this.state.bufferTicks) {
      this.lowerSince ??= now;
      if (now - this.lowerSince < LOWER_AFTER_MS) return false;
    }
    this.state = {
      ...this.state,
      bufferTicks: target > this.state.bufferTicks ? target : this.state.bufferTicks - 1,
    };
    this.lowerSince = null;
    return true;
  }
}
