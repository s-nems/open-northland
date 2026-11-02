// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTEXT_RESTORE_GRACE_MS,
  GPU_GONE_LEAD_MS,
  type GpuLossDeps,
  logGpuContextLoss,
} from '../../src/diag/gpu-context.js';
import { DiagLog } from '../../src/diag/index.js';
import type { Problem } from '../../src/diag/report/problem.js';
import type { DesktopFault, DesktopFaults } from '../../src/view/platform/desktop-faults.js';

const LOST_AT_TICK = 50_017;
/** Chromium's exit code for a GPU process that quit because its driver lost the device. */
const GPU_EXIT_ON_CONTEXT_LOST = 34;
const LOSS_AT = Date.parse('2026-10-30T09:22:48.000Z');

function gpuGone(id: string, atMs: number): DesktopFault {
  return {
    id: id.repeat(32),
    trigger: 'gpu-gone',
    at: new Date(atMs).toISOString(),
    reason: 'crashed',
    exitCode: GPU_EXIT_ON_CONTEXT_LOST,
    durationMs: null,
    stack: null,
    url: null,
    gpuStatus: null,
  };
}

function shellFaults(pending: readonly DesktopFault[]): DesktopFaults & { readonly cleared: string[] } {
  const cleared: string[] = [];
  return {
    cleared,
    pending: () => Promise.resolve(pending.filter((fault) => !cleared.includes(fault.id))),
    clear: (ids) => {
      cleared.push(...ids);
      return Promise.resolve();
    },
    versions: () => Promise.resolve({}),
    previousRun: () => Promise.resolve(null),
  };
}

function watch(deps: Partial<GpuLossDeps>): { readonly canvas: EventTarget; readonly problems: Problem[] } {
  const problems: Problem[] = [];
  const canvas = new EventTarget();
  logGpuContextLoss(canvas, () => LOST_AT_TICK, new AbortController().signal, {
    log: new DiagLog({ consoleLevel: 'silent' }),
    report: (problem) => problems.push(problem),
    freshContext: () => true,
    faults: undefined,
    ...deps,
  });
  return { canvas, problems };
}

describe('GPU context loss logging', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(LOSS_AT);
  });
  afterEach(() => vi.useRealTimers());

  it('records a lost and a restored context with the sim tick', () => {
    const log = new DiagLog({ consoleLevel: 'silent' });
    const { canvas } = watch({ log });
    canvas.dispatchEvent(new Event('webglcontextlost'));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(
      log.entries().map(({ channel, level, message, data }) => ({ channel, level, message, data })),
    ).toEqual([
      { channel: 'gpu', level: 'warn', message: 'webgl context lost', data: { tick: LOST_AT_TICK } },
      { channel: 'gpu', level: 'info', message: 'webgl context restored', data: { tick: LOST_AT_TICK } },
    ]);
  });

  it('stops listening once the game view is torn down', () => {
    const log = new DiagLog({ consoleLevel: 'silent' });
    const canvas = new EventTarget();
    const lifetime = new AbortController();
    logGpuContextLoss(canvas, () => 0, lifetime.signal, { log, faults: undefined });
    lifetime.abort();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(log.entries()).toHaveLength(0);
  });

  it('reports a loss the browser does not restore within the grace, and not one it does', async () => {
    const { canvas, problems } = watch({});
    canvas.dispatchEvent(new Event('webglcontextlost'));
    vi.advanceTimersByTime(CONTEXT_RESTORE_GRACE_MS - 1);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    await vi.advanceTimersByTimeAsync(CONTEXT_RESTORE_GRACE_MS);
    expect(problems).toEqual([]);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    await vi.advanceTimersByTimeAsync(CONTEXT_RESTORE_GRACE_MS);
    expect(problems.map(({ trigger, facts }) => ({ trigger, tick: facts?.tick }))).toEqual([
      { trigger: 'context-lost', tick: LOST_AT_TICK },
    ]);
  });

  it('says whether a new context could be made when the old one never came back', async () => {
    const { canvas, problems } = watch({ freshContext: () => false });
    canvas.dispatchEvent(new Event('webglcontextlost'));
    await vi.advanceTimersByTimeAsync(CONTEXT_RESTORE_GRACE_MS);
    expect(problems[0]?.facts?.freshContext).toBe(false);
  });

  it("folds the shell's GPU process death into the report of a context that never came back", async () => {
    const hang: DesktopFault = { ...gpuGone('d', LOSS_AT + 50), trigger: 'renderer-unresponsive' };
    const faults = shellFaults([
      gpuGone('a', LOSS_AT - GPU_GONE_LEAD_MS - 1),
      hang,
      gpuGone('b', LOSS_AT + 100),
    ]);
    const { canvas, problems } = watch({ faults });
    canvas.dispatchEvent(new Event('webglcontextlost'));
    await vi.advanceTimersByTimeAsync(CONTEXT_RESTORE_GRACE_MS);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.trigger).toBe('context-lost');
    expect(problems[0]?.facts?.gpuGone).toEqual([
      {
        reason: 'crashed',
        exitCode: GPU_EXIT_ON_CONTEXT_LOST,
        at: new Date(LOSS_AT + 100).toISOString(),
        gpuStatus: null,
      },
    ]);
    expect(faults.cleared).toEqual(['b'.repeat(32)]);
  });

  it("reports the shell's GPU process death with this page's log once the context is back", async () => {
    const log = new DiagLog({ consoleLevel: 'silent' });
    const faults = shellFaults([gpuGone('c', LOSS_AT + 100)]);
    const { canvas, problems } = watch({ log, faults });
    canvas.dispatchEvent(new Event('webglcontextlost'));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    await vi.advanceTimersByTimeAsync(0);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.trigger).toBe('gpu-gone');
    expect(problems[0]?.earlier?.previousSession).toBe(false);
    expect(problems[0]?.earlier?.log?.entries.map(({ message }) => message)).toEqual([
      'webgl context lost',
      'webgl context restored',
    ]);
    expect(faults.cleared).toEqual(['c'.repeat(32)]);
  });
});
