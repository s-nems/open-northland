import { diag, dismissCrashBanner, showCrashBanner } from '../../diag/index.js';
import { formatMessage, messages } from '../../i18n/index.js';
import type { StallReports } from '../../session/worker/stall-watch.js';

const MS_PER_SECOND = 1000;
/** Names the banner a stall raised, so its recovery takes down that banner alone. */
const STALL_BANNER = 'sim-stall';

/** A frozen world under a live UI is what the crash banner is for: the player learns the game stopped
 *  and can download the diagnostics that name the tick. */
export const workerStallReports: StallReports = {
  stalled: (silentMs) => {
    diag.error('sim', `the sim worker has not answered for ${Math.round(silentMs)} ms`, { silentMs });
    const seconds = Math.round(silentMs / MS_PER_SECOND);
    showCrashBanner(formatMessage(messages().hud.simStalled, { seconds }), STALL_BANNER);
  },
  // The world runs again, so the stall's banner goes; a banner another crash took over stays.
  recovered: (silentMs) => {
    diag.info('sim', `the sim worker answered again after ${Math.round(silentMs)} ms`);
    dismissCrashBanner(STALL_BANNER);
  },
};
