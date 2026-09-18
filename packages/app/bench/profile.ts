import type { Profiler } from 'node:inspector';
import { Session } from 'node:inspector/promises';
import { formatLocation, resolveLocation } from './profile-location.js';

/**
 * A function-level CPU profile of whatever the caller steps, sampled by V8 itself. The per-system
 * table says which system got slower; this says which FUNCTION it spends the time in, which is the
 * question a hotspot hunt actually asks.
 *
 * Self time is what a hotspot is read from: a caller's total time only says that its callees are
 * expensive. Both are reported, aggregated per (function, file, line), so one function appearing
 * under many call paths is one row.
 */

/** V8's own default is 1000 µs, which resolves nothing inside a 6 ms tick. */
const SAMPLING_INTERVAL_US = 100;
const US_PER_MS = 1000;
const ANONYMOUS = '(anonymous)';

export interface FunctionCost {
  readonly name: string;
  /** `file:line`, repo-relative and source-mapped where a map was available. */
  readonly location: string;
  readonly selfMs: number;
  readonly selfPct: number;
  /** Self time of the function and everything it called, counted once per call path. */
  readonly totalMs: number;
}

export interface FileCost {
  readonly file: string;
  readonly selfMs: number;
  readonly selfPct: number;
}

export interface ProfileSummary {
  /** Sampled time, not wall time: idle and un-sampled time is not in here. */
  readonly sampledMs: number;
  /** Descending by self time. */
  readonly functions: readonly FunctionCost[];
  readonly files: readonly FileCost[];
}

/** Profile one synchronous run, handing back what it returned. The sampler is process-wide, so the
 *  caller must do nothing else while it runs. */
export async function captureCpuProfile<T>(
  run: () => T,
): Promise<{ readonly profile: Profiler.Profile; readonly result: T }> {
  const session = new Session();
  session.connect();
  try {
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval', { interval: SAMPLING_INTERVAL_US });
    await session.post('Profiler.start');
    const result = run();
    const { profile } = await session.post('Profiler.stop');
    return { profile, result };
  } finally {
    session.disconnect();
  }
}

/** Self microseconds per node: the sample stream when V8 recorded one, else its hit counts. */
function selfUsByNode(profile: Profiler.Profile): ReadonlyMap<number, number> {
  const self = new Map<number, number>();
  const add = (id: number, us: number): void => {
    self.set(id, (self.get(id) ?? 0) + us);
  };
  const { samples, timeDeltas } = profile;
  if (samples !== undefined && timeDeltas !== undefined) {
    for (const [i, id] of samples.entries()) add(id, timeDeltas[i] ?? 0);
    return self;
  }
  for (const node of profile.nodes) add(node.id, (node.hitCount ?? 0) * SAMPLING_INTERVAL_US);
  return self;
}

interface Frame {
  readonly node: Profiler.ProfileNode;
  readonly key: string;
  readonly parent: number | null;
}

function keyOf(node: Profiler.ProfileNode): string {
  const { functionName, url, lineNumber } = node.callFrame;
  return `${functionName}\u0000${url}\u0000${lineNumber}`;
}

function framesOf(profile: Profiler.Profile): ReadonlyMap<number, Frame> {
  const frames = new Map<number, Frame>();
  for (const node of profile.nodes) frames.set(node.id, { node, key: keyOf(node), parent: null });
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) {
      const frame = frames.get(child);
      if (frame !== undefined) frames.set(child, { ...frame, parent: node.id });
    }
  }
  return frames;
}

/** Subtree self time per node, accumulated children-first so one pass suffices. */
function subtreeUs(
  frames: ReadonlyMap<number, Frame>,
  selfUs: ReadonlyMap<number, number>,
): ReadonlyMap<number, number> {
  const order: number[] = [];
  const stack = [...frames.values()].filter((f) => f.parent === null).map((f) => f.node.id);
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;
    order.push(id);
    stack.push(...(frames.get(id)?.node.children ?? []));
  }
  const totals = new Map<number, number>();
  for (const id of order.reverse()) {
    let sum = selfUs.get(id) ?? 0;
    for (const child of frames.get(id)?.node.children ?? []) sum += totals.get(child) ?? 0;
    totals.set(id, sum);
  }
  return totals;
}

/** True when the same function already appears higher up this stack: its subtree is counted there,
 *  so counting it again would report a recursive function's time several times over. */
function nestedInSelf(frames: ReadonlyMap<number, Frame>, frame: Frame): boolean {
  let parent = frame.parent;
  while (parent !== null) {
    const up = frames.get(parent);
    if (up === undefined) return false;
    if (up.key === frame.key) return true;
    parent = up.parent;
  }
  return false;
}

/** Codepoint order, the stable tie-break of equal self time (see ./report/summarize.ts). */
function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function summarizeProfile(profile: Profiler.Profile): ProfileSummary {
  const selfUs = selfUsByNode(profile);
  const frames = framesOf(profile);
  const totals = subtreeUs(frames, selfUs);

  const byFunction = new Map<string, { name: string; location: string; selfUs: number; totalUs: number }>();
  const byFile = new Map<string, number>();
  let sampledUs = 0;
  for (const frame of frames.values()) {
    const { functionName, url, lineNumber, columnNumber } = frame.node.callFrame;
    const location = resolveLocation(url, lineNumber, columnNumber);
    const self = selfUs.get(frame.node.id) ?? 0;
    sampledUs += self;
    const row = byFunction.get(frame.key) ?? {
      name: functionName === '' ? ANONYMOUS : functionName,
      location: formatLocation(location),
      selfUs: 0,
      totalUs: 0,
    };
    row.selfUs += self;
    if (!nestedInSelf(frames, frame)) row.totalUs += totals.get(frame.node.id) ?? 0;
    byFunction.set(frame.key, row);
    byFile.set(location.file, (byFile.get(location.file) ?? 0) + self);
  }

  const pct = (us: number): number => (sampledUs === 0 ? 0 : (us / sampledUs) * 100);
  return {
    sampledMs: sampledUs / US_PER_MS,
    functions: [...byFunction.values()]
      .map((row) => ({
        name: row.name,
        location: row.location,
        selfMs: row.selfUs / US_PER_MS,
        selfPct: pct(row.selfUs),
        totalMs: row.totalUs / US_PER_MS,
      }))
      .sort((a, b) => b.selfMs - a.selfMs || byCodepoint(a.name, b.name)),
    files: [...byFile.entries()]
      .map(([file, us]) => ({ file, selfMs: us / US_PER_MS, selfPct: pct(us) }))
      .sort((a, b) => b.selfMs - a.selfMs || byCodepoint(a.file, b.file)),
  };
}
