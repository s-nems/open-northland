import { isPlainRecord, PROTO_KEY } from '../core/plain-value.js';

/** Caller-owned JSON only: no session package dependency and no effect on simulated state. */
export function copySessionMetadata(value: unknown): unknown {
  let nodes = 0;
  let text = 0;
  const active = new Set<object>();
  const copy = (input: unknown, depth: number): unknown => {
    if (++nodes > 4096 || depth > 32) throw new Error('save.header.session exceeds its structural budget');
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input === 'string') {
      text += input.length;
      if (text > 65536) throw new Error('save.header.session exceeds its text budget');
      return input;
    }
    if (typeof input !== 'object' || input === null || (!Array.isArray(input) && !isPlainRecord(input))) {
      throw new Error('save.header.session must contain plain JSON values');
    }
    if (active.has(input)) throw new Error('save.header.session cannot contain cycles');
    active.add(input);
    let result: unknown;
    if (Array.isArray(input)) {
      const out: unknown[] = [];
      for (let i = 0; i < input.length; i++) out.push(copy(input[i], depth + 1));
      result = out;
    } else {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input)) {
        if (key === PROTO_KEY) throw new Error('save.header.session contains a reserved key');
        copy(key, depth + 1);
        out[key] = copy(input[key], depth + 1);
      }
      result = out;
    }
    active.delete(input);
    return result;
  };
  return copy(value, 0);
}
