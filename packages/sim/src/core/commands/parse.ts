import type { LoggedCommand } from '../command-queue.js';
import {
  COMMAND_ENVELOPE_VERSION,
  COMMAND_ISSUER,
  type CommandEnvelope,
  type PlayerCommand,
} from './envelope.js';
import type { Command } from './index.js';

/**
 * Validate an envelope decoded from untrusted JSON (an imported replay or a diagnostics bundle). The
 * envelope's own contract is checked here - version, origin, seat id, and whether that origin may issue
 * the command kind at all - and the returned value still references the caller's payload, which
 * `CommandQueue.enqueue` copies. Payload fields are unchecked: the handlers treat a stale id or an
 * unknown type as a recoverable no-op, and the world-aware authority gate re-checks ownership when the
 * command applies, but a field of the wrong primitive type reaches its handler as written.
 */
export function parseCommandEnvelope(value: unknown, at = 'envelope'): CommandEnvelope {
  const raw = asRecord(value, at);
  if (raw.v !== COMMAND_ENVELOPE_VERSION) {
    throw new Error(`${at}: unsupported version ${String(raw.v)}, expected ${COMMAND_ENVELOPE_VERSION}`);
  }
  const command = asRecord(raw.command, `${at}.command`);
  const kind = command.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(COMMAND_ISSUER, kind)) {
    throw new Error(`${at}.command: unknown kind ${JSON.stringify(kind)}`);
  }
  const origin = raw.origin;
  if (origin === 'setup' || origin === 'admin') {
    return { v: COMMAND_ENVELOPE_VERSION, origin, command: command as unknown as Command };
  }
  if (origin !== 'player' && origin !== 'ai') {
    throw new Error(`${at}: unknown origin ${JSON.stringify(origin)}`);
  }
  const player = raw.player;
  if (typeof player !== 'number' || !Number.isInteger(player)) {
    throw new Error(`${at}: a ${origin} envelope needs an integer player, got ${JSON.stringify(player)}`);
  }
  if (COMMAND_ISSUER[kind as Command['kind']] !== 'seat') {
    throw new Error(`${at}: a ${origin} envelope may not issue '${kind}'`);
  }
  return {
    v: COMMAND_ENVELOPE_VERSION,
    origin,
    player,
    command: command as unknown as PlayerCommand,
  };
}

/**
 * Validate a whole imported command log. Each entry is an envelope plus its `(applyTick, sequence)`
 * position, which must stay strictly ascending: a reordered log would apply commands on ticks they
 * never ran on and reconstruct a state the session never had.
 */
export function parseCommandLog(value: unknown): readonly LoggedCommand[] {
  if (!Array.isArray(value)) throw new Error(`command log: expected an array, got ${typeName(value)}`);
  const out: LoggedCommand[] = [];
  let previous: LoggedCommand | undefined;
  value.forEach((entry: unknown, i) => {
    const at = `command log[${i}]`;
    const raw = asRecord(entry, at);
    const applyTick = positiveIndex(raw.applyTick, `${at}.applyTick`);
    const sequence = positiveIndex(raw.sequence, `${at}.sequence`);
    if (previous !== undefined && !ascends(previous, applyTick, sequence)) {
      throw new Error(`${at}: (${applyTick}, ${sequence}) does not follow the previous entry`);
    }
    const logged = { ...parseCommandEnvelope(entry, at), applyTick, sequence };
    out.push(logged);
    previous = logged;
  });
  return out;
}

function ascends(previous: LoggedCommand, applyTick: number, sequence: number): boolean {
  return applyTick > previous.applyTick || (applyTick === previous.applyTick && sequence > previous.sequence);
}

function positiveIndex(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${at}: expected a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

function asRecord(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${at}: expected an object, got ${typeName(value)}`);
  }
  return value as Record<string, unknown>;
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'an array' : typeof value;
}
