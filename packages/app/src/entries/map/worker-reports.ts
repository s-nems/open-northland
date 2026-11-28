import type { ReportThread } from '@open-northland/data';
import { reportError } from '../../diag/capture/report-error.js';
import { diag, dismissCrashBanner, showCrashBanner } from '../../diag/index.js';
import { reportProblem } from '../../diag/report/problem.js';
import { formatMessage, messages } from '../../i18n/index.js';
import type { WorkerReports } from '../../session/worker/worker-session.js';

const MS_PER_SECOND = 1000;
/** Names the banner a stall raised, so its recovery takes down that banner alone. */
const STALL_BANNER = 'sim-stall';

/** A silence this long becomes a bug report: three times the banner's, so a long save or a collection
 *  pause that ends soon after the banner shows reports nothing. */
export const SIM_STALL_REPORT_MS = 15_000;

export type WorkerThread = Extract<ReportThread, 'sim-worker' | 'net-worker'>;

/** A frozen world under a live UI is what the crash banner is for: the player learns the game stopped
 *  and can download the diagnostics that name the tick. A silence that outlasts
 *  {@link SIM_STALL_REPORT_MS} and an error the worker raised go to the bug report, each silence once. */
export function workerReports(thread: WorkerThread): WorkerReports {
  let reported = false;
  return {
    stalled: (silentMs) => {
      reported = false;
      diag.error('sim', `the ${thread} has not answered for ${Math.round(silentMs)} ms`, { silentMs });
      const seconds = Math.round(silentMs / MS_PER_SECOND);
      showCrashBanner(formatMessage(messages().hud.simStalled, { seconds }), STALL_BANNER);
    },
    lasting: (silentMs) => {
      if (reported || silentMs < SIM_STALL_REPORT_MS) return;
      reported = true;
      // The report's dialog says the world stopped from here on; the banner would say it twice.
      dismissCrashBanner(STALL_BANNER);
      reportProblem({ trigger: 'sim-stall', facts: { silentMs: Math.round(silentMs), thread } });
    },
    // The world runs again, so the stall's banner goes; a banner another crash took over stays.
    replayMismatch: (mismatch) => {
      diag.error('sim', `the played-back recording diverged at tick ${mismatch.tick}`, {
        tick: mismatch.tick,
        expected: mismatch.expected,
        actual: mismatch.actual,
      });
      showCrashBanner(
        formatMessage(messages().hud.replayMismatch, { tick: mismatch.tick }),
        'replay-mismatch',
      );
    },
    recovered: (silentMs) => {
      diag.info('sim', `the ${thread} answered again after ${Math.round(silentMs)} ms`);
      dismissCrashBanner(STALL_BANNER);
    },
    faulted: (error, source, fatal) =>
      reportError(thread, error, { ...(source === undefined ? {} : { source }), fatal }),
  };
}
