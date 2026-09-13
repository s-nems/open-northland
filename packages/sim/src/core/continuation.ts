import { type CommandEnvelope, ownedEnvelope } from './commands/envelope.js';
import { parseCommandEnvelope } from './commands/parse.js';
import { asRecord } from './untrusted.js';

/** Accepted input inherited from a saved session, independent of the new transport's sequences. */
export interface SavedCommand {
  readonly applyTick: number;
  readonly envelope: CommandEnvelope;
}

/** Validate and own future commands; same-tick array order is authoritative. */
export function parseContinuation(
  value: unknown,
  tick: number,
  at = 'commands.continuation',
): SavedCommand[] {
  if (!Array.isArray(value)) throw new Error(`${at}: expected an array`);
  let previous = tick;
  return value.map((entry: unknown, i) => {
    const path = `${at}[${i}]`;
    const raw = asRecord(entry, path);
    const applyTick = raw.applyTick;
    if (typeof applyTick !== 'number' || !Number.isSafeInteger(applyTick) || applyTick <= tick) {
      throw new Error(`${path}.applyTick: expected a safe integer after saved tick ${tick}`);
    }
    if (applyTick < previous) throw new Error(`${path}.applyTick: continuation must be ordered by tick`);
    if (Object.keys(raw).some((key) => key !== 'applyTick' && key !== 'envelope')) {
      throw new Error(`${path}: unknown continuation field`);
    }
    previous = applyTick;
    return { applyTick, envelope: ownedEnvelope(parseCommandEnvelope(raw.envelope, `${path}.envelope`)) };
  });
}

/** Stable merge: inherited commands precede new captured commands at a shared tick. */
export function mergeContinuation(
  existing: readonly SavedCommand[],
  supplied: readonly SavedCommand[],
  tick: number,
): SavedCommand[] {
  // Captures may arrive in transport batches; sort each supplied batch before validating its order.
  const sorted = [...supplied].sort((a, b) => a.applyTick - b.applyTick);
  return [...parseContinuation(existing, tick), ...parseContinuation(sorted, tick)].sort(
    (a, b) => a.applyTick - b.applyTick,
  );
}
