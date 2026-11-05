/** WebGL context loss on the game canvas, for the log ring: the browser and Pixi restore the context by
 *  themselves, so without this a diagnostics report says nothing of a lost and rebuilt frame. A loss
 *  not restored in {@link CONTEXT_RESTORE_GRACE_MS} is a bug report: the world no longer draws.
 *  Kept out of the `diag` barrel: it reaches `routes.js`, which the sim worker bundle must not import. */
import { REPORT_LIMITS } from '@open-northland/data';
import { webglAvailable } from '../view/platform/browser-support.js';
import type { DesktopFault, DesktopFaults } from '../view/platform/desktop-faults.js';
import { captureContext, contextRoute } from './capture/context.js';
import { clearDesktopFaults, desktopFaultProblem, pendingDesktopFaults } from './capture/desktop-faults.js';
import { reportLogOf } from './capture/session-marker.js';
import { errorText } from './error-text.js';
import { type DiagLog, diag } from './log.js';
import { type ProblemSink, reportProblem } from './report/problem.js';

/** Chromium restores a lost context within a second or two once the GPU process is back. */
export const CONTEXT_RESTORE_GRACE_MS = 5000;

/** A GPU process death the shell saw this long before the page heard of the loss is still its cause:
 *  a dying driver can hold the page in a GL call for seconds before the loss event runs. */
export const GPU_GONE_LEAD_MS = 30_000;

export interface GpuLossDeps {
  readonly log: DiagLog;
  readonly report: ProblemSink;
  /** Whether a new WebGL context can be made now; false when the browser blocked WebGL for the page. */
  readonly freshContext: () => boolean;
  /** The desktop shell's fault records, absent in a browser. */
  readonly faults: DesktopFaults | undefined;
}

function defaultDeps(): GpuLossDeps {
  return {
    log: diag,
    report: reportProblem,
    freshContext: webglAvailable,
    faults: typeof window === 'undefined' ? undefined : window.desktop?.faults,
  };
}

/** The shell's GPU process deaths from {@link GPU_GONE_LEAD_MS} before the loss on. */
async function gpuGoneSince(faults: DesktopFaults, lostAtMs: number): Promise<readonly DesktopFault[]> {
  const pending = await pendingDesktopFaults(faults);
  return pending.filter(
    (fault) => fault.trigger === 'gpu-gone' && Date.parse(fault.at) >= lostAtMs - GPU_GONE_LEAD_MS,
  );
}

/** Listens until `signal` aborts; `tick` dates each entry in sim ticks. */
export function logGpuContextLoss(
  canvas: EventTarget,
  tick: () => number,
  signal: AbortSignal,
  overrides: Partial<GpuLossDeps> = {},
): void {
  const { log, report, freshContext, faults } = { ...defaultDeps(), ...overrides };
  let waiting: ReturnType<typeof setTimeout> | null = null;
  /** Wall-clock time of the loss, which the shell's fault times compare with. */
  let lostAtMs = 0;
  // Reporting the loss must not become an unhandled rejection, which would be a report of its own.
  const settle = (work: Promise<void>): void => {
    work.catch((error: unknown) => log.warn('gpu', `the GPU loss report failed: ${errorText(error)}`));
  };
  const stopWaiting = (): void => {
    if (waiting !== null) clearTimeout(waiting);
    waiting = null;
  };
  const notRestored = async (waitedMs: number): Promise<void> => {
    const fresh = freshContext();
    log.error('gpu', `webgl context not restored after ${waitedMs} ms`, {
      tick: tick(),
      freshContext: fresh,
    });
    const gone = faults === undefined ? [] : await gpuGoneSince(faults, lostAtMs);
    const gpuGone = gone.map(({ reason, exitCode, at, gpuStatus }) => ({ reason, exitCode, at, gpuStatus }));
    report({
      trigger: 'context-lost',
      facts: { tick: tick(), waitedMs, freshContext: fresh, ...(gpuGone.length === 0 ? {} : { gpuGone }) },
    });
    if (faults !== undefined) await clearDesktopFaults(faults, gone);
  };
  // The GPU process came back: its death is reported now, with this page's log, not by the next start.
  const restored = async (): Promise<void> => {
    if (faults === undefined) return;
    const gone = await gpuGoneSince(faults, lostAtMs);
    if (gone.length === 0) return;
    const reportLog = reportLogOf(log, REPORT_LIMITS.logEntries);
    for (const fault of gone) {
      report(
        desktopFaultProblem(fault, {
          previousSession: false,
          facts: { tick: tick() },
          route: contextRoute(captureContext()),
          ...(reportLog === null ? {} : { log: reportLog }),
        }),
      );
    }
    await clearDesktopFaults(faults, gone);
  };
  // A hidden page may get its context back only once it shows, so the wait runs on while hidden.
  const awaitRestore = (startedMs: number): void => {
    waiting = setTimeout(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        awaitRestore(startedMs);
        return;
      }
      waiting = null;
      settle(notRestored(Math.round(performance.now() - startedMs)));
    }, CONTEXT_RESTORE_GRACE_MS);
  };
  canvas.addEventListener(
    'webglcontextlost',
    () => {
      log.warn('gpu', 'webgl context lost', { tick: tick() });
      stopWaiting();
      lostAtMs = Date.now();
      awaitRestore(performance.now());
    },
    { signal },
  );
  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      stopWaiting();
      log.info('gpu', 'webgl context restored', { tick: tick() });
      settle(restored());
    },
    { signal },
  );
  signal.addEventListener('abort', stopWaiting, { once: true });
}
