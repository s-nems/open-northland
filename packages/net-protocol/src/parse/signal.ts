import { MAX_SEATS, MAX_SIGNAL_NODE } from '../limits.js';
import type { SignalNode } from '../messages.js';
import { asArray, asCount, asRecord } from '../untrusted.js';
import { parseSeatIndex } from './room.js';

export function parseSignalNode(value: unknown, at: string): SignalNode {
  const raw = asRecord(value, at);
  const coordinate = (v: unknown, name: string): number => {
    const n = asCount(v, `${at}.${name}`);
    if (n > MAX_SIGNAL_NODE) throw new Error(`${at}.${name}: ${n} is past ${MAX_SIGNAL_NODE}`);
    return n;
  };
  return { hx: coordinate(raw.hx, 'hx'), hy: coordinate(raw.hy, 'hy') };
}

/** A signal's recipients: distinct seat indices. */
export function parseSignalSeats(value: unknown, at: string): readonly number[] {
  const list = asArray(value, at);
  if (list.length > MAX_SEATS) throw new Error(`${at}: more than ${MAX_SEATS} seats`);
  const seats = list.map((seat, i) => parseSeatIndex(seat, `${at}[${i}]`));
  if (new Set(seats).size !== seats.length) throw new Error(`${at}: a seat named twice`);
  return seats;
}
