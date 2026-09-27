import type { HeapProfiler } from 'node:inspector';
import { describe, expect, it } from 'vitest';
import { summarizeAllocations } from '../bench/profile.js';

/** A native frame: no url, so the location resolves without a source map on disk. */
function node(
  functionName: string,
  selfSize: number,
  children: HeapProfiler.SamplingHeapProfileNode[] = [],
): HeapProfiler.SamplingHeapProfileNode {
  return {
    callFrame: { functionName, scriptId: '0', url: '', lineNumber: 0, columnNumber: 0 },
    selfSize,
    children,
  };
}

const KB = 1024;

describe('summarizeAllocations', () => {
  it('ranks allocation sites by self and total kilobytes', () => {
    const summary = summarizeAllocations({
      head: node('(root)', 0, [node('step', 2 * KB, [node('route', 6 * KB)]), node('apply', 4 * KB)]),
    });

    expect(summary.unit).toBe('KB');
    expect(summary.sampled).toBe(12);
    expect(summary.functions.map((f) => [f.name, f.self])).toEqual([
      ['route', 6],
      ['apply', 4],
      ['step', 2],
      ['(root)', 0],
    ]);
    const step = summary.functionsByTotal.find((f) => f.name === 'step');
    expect(step?.total).toBe(8);
    expect(step?.totalPct).toBeCloseTo((8 / 12) * 100);
    expect(summary.functionsByTotal.some((f) => f.name === '(root)')).toBe(false);
  });

  it('counts a recursive allocator once per stack', () => {
    const summary = summarizeAllocations({
      head: node('(root)', 0, [node('walk', 1 * KB, [node('walk', 3 * KB)])]),
    });

    const walk = summary.functions.find((f) => f.name === 'walk');
    expect(walk?.self).toBe(4);
    expect(walk?.total).toBe(4);
  });
});
