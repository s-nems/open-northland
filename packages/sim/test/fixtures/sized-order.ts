import { type CommandEnvelope, type Entity, playerCommand } from '@open-northland/sim';

const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** A two-digit job priority: one serialized byte more than a one-digit entry. */
const WIDE_PRIORITY = 10;

/**
 * A group order for seat 0 that serializes to exactly `bytes`, for transport budget tests; it orders
 * nothing a test world holds. No player command carries free text, so the fill is one member's job
 * list: its first entry is one byte, every later one two, and a two-digit last entry adds an odd byte.
 */
export function orderOfSize(bytes: number, entity: Entity): CommandEnvelope {
  const order = (jobPriority: number[]): CommandEnvelope =>
    playerCommand(0, { kind: 'assignWorkerGroup', building: entity, members: [{ entity, jobPriority }] });
  const rest = bytes - jsonBytes(order([0]));
  if (rest < 0) throw new Error(`a group order is at least ${bytes - rest} bytes`);
  const entries = Math.floor(rest / 2) + 1;
  const jobPriority = new Array<number>(entries).fill(0);
  if (rest % 2 === 1) jobPriority[entries - 1] = WIDE_PRIORITY;
  return order(jobPriority);
}
