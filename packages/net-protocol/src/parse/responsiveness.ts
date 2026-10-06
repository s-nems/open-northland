import { MAX_RESPONSIVENESS_BUFFER_TICKS } from '../limits.js';
import type { ResponsivenessMode } from '../messages.js';
import { asCount, asOneOf, keysOf } from '../untrusted.js';

const MODES = keysOf<ResponsivenessMode>({ auto: true, responsive: true, balanced: true, smooth: true });

export function parseResponsivenessMode(value: unknown): ResponsivenessMode {
  return asOneOf(value, MODES, 'responsiveness.mode');
}

export function parseBufferTicks(value: unknown): number {
  const ticks = asCount(value, 'responsiveness.bufferTicks');
  if (ticks < 1 || ticks > MAX_RESPONSIVENESS_BUFFER_TICKS)
    throw new Error('responsiveness.bufferTicks: expected 1 through 6');
  return ticks;
}
