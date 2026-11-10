import { Allowance, type ClientMessage, SIGNAL_BURST, SIGNAL_REFILL_MS } from '@open-northland/net-protocol';
import type { Deliver, Member, Refusal } from '../member.js';

type SignalMessage = Extract<ClientMessage, { kind: 'signal' }>;

/**
 * A running room's map signals: each goes from a seated member to the connected members in the seats
 * it names, never back to the sender and never to anyone unnamed, since a signal is only for the
 * sender's allies. Past a member's allowance a signal is dropped unanswered, as the client counts the
 * same allowance and never sends it.
 */
export class RoomSignals {
  private readonly allowances = new Map<string, Allowance>();

  constructor(
    private readonly members: ReadonlyMap<string, Member>,
    private readonly deliver: Deliver,
  ) {}

  relay(member: Member, message: SignalMessage, now: number): Refusal {
    const seat = member.seat;
    if (seat === null) return { code: 'seatRequired' };
    let allowance = this.allowances.get(member.token);
    if (allowance === undefined) {
      allowance = new Allowance(SIGNAL_BURST, SIGNAL_REFILL_MS, now);
      this.allowances.set(member.token, allowance);
    }
    if (!allowance.take(now)) return null;
    const to = new Set(message.to);
    for (const other of this.members.values()) {
      if (other === member || !other.connected || other.seat === null || !to.has(other.seat)) continue;
      this.deliver(other, { kind: 'signal', from: member.nick, seat, at: message.at });
    }
    return null;
  }

  /** A token that left the room keeps no allowance. */
  forget(token: string): void {
    this.allowances.delete(token);
  }
}
