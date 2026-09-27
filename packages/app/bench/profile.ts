import type { HeapProfiler, Profiler, Runtime } from 'node:inspector';
import { Session } from 'node:inspector/promises';
import { formatLocation, resolveLocation } from './profile-location.js';

/**
 * A function-level CPU or allocation profile of whatever the caller steps, sampled by V8 itself. The
 * per-system table says which system got slower; this says which FUNCTION spends the time or makes
 * the garbage, which is the question a hotspot hunt actually asks.
 *
 * Self cost finds the function that burns cycles or allocates; total cost finds the caller that fans
 * out into many cheap callees, which no self row shows. Both are reported, aggregated per
 * (function, file, line), so one function appearing under many call paths is one row.
 */

/** V8's own default is 1000 µs, which resolves nothing inside a 6 ms tick. */
const SAMPLING_INTERVAL_US = 100;
const US_PER_MS = 1000;
/** Bytes between allocation samples, a Poisson mean. V8's 32 KB default leaves a small tick's
 *  allocations unsampled. */
const ALLOCATION_SAMPLING_INTERVAL_BYTES = 4096;
const BYTES_PER_KB = 1024;
const ANONYMOUS = '(anonymous)';
/** V8's synthetic top frame: its total is the whole profile, so it ranks nothing. */
const ROOT_FRAME = '(root)';

/** One call site's share of a profile, in the profile's own unit: milliseconds of CPU or kilobytes
 *  allocated. */
export interface FunctionCost {
  readonly name: string;
  /** `file:line`, repo-relative and source-mapped where a map was available. */
  readonly location: string;
  readonly self: number;
  readonly selfPct: number;
  /** Self cost of the function and everything it called, counted once per call path. */
  readonly total: number;
  readonly totalPct: number;
}

export interface FileCost {
  readonly file: string;
  readonly self: number;
  readonly selfPct: number;
}

export interface ProfileSummary {
  readonly unit: 'ms' | 'KB';
  /** Sampled cost, not wall time or heap size: un-sampled work is not in here. */
  readonly sampled: number;
  /** Descending by self cost. */
  readonly functions: readonly FunctionCost[];
  /** Descending by total cost, without V8's `(root)` frame. */
  readonly functionsByTotal: readonly FunctionCost[];
  readonly files: readonly FileCost[];
}

/** The call-tree shape both V8 profilers reduce to: a CPU profile's node list as it comes, a sampling
 *  heap profile's nested tree once flattened. */
interface CallTreeNode {
  readonly id: number;
  readonly callFrame: Runtime.CallFrame;
  readonly children?: readonly number[] | undefined;
}

/** Profile one run, handing back what it resolved to. The sampler is process-wide, so the caller must
 *  do nothing else while it runs. */
export async function captureCpuProfile<T>(
  run: () => Promise<T>,
): Promise<{ readonly profile: Profiler.Profile; readonly result: T }> {
  const session = new Session();
  session.connect();
  try {
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval', { interval: SAMPLING_INTERVAL_US });
    await session.post('Profiler.start');
    const result = await run();
    const { profile } = await session.post('Profiler.stop');
    return { profile, result };
  } finally {
    session.disconnect();
  }
}

/** Allocation-sampling flags this V8 honours but `@types/node` does not declare yet. Without them the
 *  profile keeps only objects still alive when sampling stops, and a tick's garbage - what GC pays
 *  for - is invisible. */
interface AllocationSamplingParameters extends HeapProfiler.StartSamplingParameterType {
  readonly includeObjectsCollectedByMajorGC: boolean;
  readonly includeObjectsCollectedByMinorGC: boolean;
}

/** Sample every allocation one run makes, collected or not. Process-wide like the CPU sampler. */
export async function captureAllocationProfile<T>(
  run: () => Promise<T>,
): Promise<{ readonly profile: HeapProfiler.SamplingHeapProfile; readonly result: T }> {
  const session = new Session();
  session.connect();
  try {
    await session.post('HeapProfiler.enable');
    const parameters: AllocationSamplingParameters = {
      samplingInterval: ALLOCATION_SAMPLING_INTERVAL_BYTES,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    };
    await session.post('HeapProfiler.startSampling', parameters);
    const result = await run();
    const { profile } = await session.post('HeapProfiler.stopSampling');
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
  readonly node: CallTreeNode;
  readonly key: string;
  readonly parent: number | null;
}

function keyOf(node: CallTreeNode): string {
  const { functionName, url, lineNumber } = node.callFrame;
  return `${functionName}\u0000${url}\u0000${lineNumber}`;
}

function framesOf(nodes: readonly CallTreeNode[]): ReadonlyMap<number, Frame> {
  const frames = new Map<number, Frame>();
  for (const node of nodes) frames.set(node.id, { node, key: keyOf(node), parent: null });
  for (const node of nodes) {
    for (const child of node.children ?? []) {
      const frame = frames.get(child);
      if (frame !== undefined) frames.set(child, { ...frame, parent: node.id });
    }
  }
  return frames;
}

/** Subtree self cost per node, accumulated children-first so one pass suffices. */
function subtreeCost(
  frames: ReadonlyMap<number, Frame>,
  self: ReadonlyMap<number, number>,
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
    let sum = self.get(id) ?? 0;
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
  return summarizeCallTree(profile.nodes, selfUsByNode(profile), 'ms', US_PER_MS);
}

/** A sampling heap profile's nested tree as a node list, numbered in visit order: the declared type
 *  carries no node ids, and nothing here needs V8's own. */
function flattenHeapTree(head: HeapProfiler.SamplingHeapProfileNode): {
  readonly nodes: readonly CallTreeNode[];
  readonly selfBytes: ReadonlyMap<number, number>;
} {
  const nodes: { id: number; callFrame: Runtime.CallFrame; children: number[] }[] = [];
  const selfBytes = new Map<number, number>();
  const stack: { readonly node: HeapProfiler.SamplingHeapProfileNode; readonly parent: number | null }[] = [
    { node: head, parent: null },
  ];
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    const id = nodes.length;
    nodes.push({ id, callFrame: entry.node.callFrame, children: [] });
    selfBytes.set(id, entry.node.selfSize);
    if (entry.parent !== null) nodes[entry.parent]?.children.push(id);
    for (const child of entry.node.children) stack.push({ node: child, parent: id });
  }
  return { nodes, selfBytes };
}

export function summarizeAllocations(profile: HeapProfiler.SamplingHeapProfile): ProfileSummary {
  const { nodes, selfBytes } = flattenHeapTree(profile.head);
  return summarizeCallTree(nodes, selfBytes, 'KB', BYTES_PER_KB);
}

/** `raw` per node in the profiler's unit (µs or bytes), reported divided by `perUnit`. */
function summarizeCallTree(
  nodes: readonly CallTreeNode[],
  raw: ReadonlyMap<number, number>,
  unit: ProfileSummary['unit'],
  perUnit: number,
): ProfileSummary {
  const frames = framesOf(nodes);
  const totals = subtreeCost(frames, raw);

  const byFunction = new Map<string, { name: string; location: string; self: number; total: number }>();
  const byFile = new Map<string, number>();
  let sampled = 0;
  for (const frame of frames.values()) {
    const { functionName, url, lineNumber, columnNumber } = frame.node.callFrame;
    const location = resolveLocation(url, lineNumber, columnNumber);
    const self = raw.get(frame.node.id) ?? 0;
    sampled += self;
    const row = byFunction.get(frame.key) ?? {
      name: functionName === '' ? ANONYMOUS : functionName,
      location: formatLocation(location),
      self: 0,
      total: 0,
    };
    row.self += self;
    if (!nestedInSelf(frames, frame)) row.total += totals.get(frame.node.id) ?? 0;
    byFunction.set(frame.key, row);
    byFile.set(location.file, (byFile.get(location.file) ?? 0) + self);
  }

  const pct = (value: number): number => (sampled === 0 ? 0 : (value / sampled) * 100);
  const functions = [...byFunction.values()].map((row) => ({
    name: row.name,
    location: row.location,
    self: row.self / perUnit,
    selfPct: pct(row.self),
    total: row.total / perUnit,
    totalPct: pct(row.total),
  }));
  return {
    unit,
    sampled: sampled / perUnit,
    functions: [...functions].sort((a, b) => b.self - a.self || byCodepoint(a.name, b.name)),
    functionsByTotal: functions
      .filter((f) => f.name !== ROOT_FRAME)
      .sort((a, b) => b.total - a.total || byCodepoint(a.name, b.name)),
    files: [...byFile.entries()]
      .map(([file, value]) => ({ file, self: value / perUnit, selfPct: pct(value) }))
      .sort((a, b) => b.self - a.self || byCodepoint(a.file, b.file)),
  };
}
