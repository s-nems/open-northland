import { StallWatch } from '../../../session/worker/stall-watch.js';
import type { CaptureContext } from '../context.js';

/** How often the page's main thread beats, and the watchdog checks the silence. */
export const WATCHDOG_BEAT_MS = 1000;

/** A visible page silent this long is frozen: far past a long frame or a garbage collection, short
 *  enough that a player waiting on a frozen game has not given up and closed the tab yet. */
export const FREEZE_REPORT_MS = 8000;

/** A boot's long steps (decoding a map, building atlases, compiling shaders) block a slow machine's
 *  page for 8 to 20 s while its card says it is loading. A boot silent three times that long is stuck,
 *  not slow. */
export const BOOT_FREEZE_REPORT_MS = 60_000;

/** The first frames after a boot's card comes down still upload its textures and compile its
 *  shaders, which blocks a slow machine as the boot itself does: a freeze that began this soon after
 *  counts as the boot's. */
export const BOOT_GRACE_MS = 3000;

/** A watchdog check this late means the page did not run at all that long: the machine slept or the
 *  browser suspended the tab, far past any delay of a busy scheduler. */
export const MACHINE_AWAY_MS = 30_000;

/** A freeze that began this soon after such a wake is the system bringing the app back, paging its
 *  memory in and restarting the GPU: one woken desktop page stalled 11 to 38 s. An approximation. */
export const WAKE_GRACE_MS = 60_000;

/** A freeze of `lastedMs` is worth a report; a `slow` one, of a boot, of a page drawn in software or
 *  of a page just woken, only when it lasted as long as a stuck boot. */
export function freezeWorthReport(lastedMs: number, slow: boolean): boolean {
  return lastedMs >= (slow ? BOOT_FREEZE_REPORT_MS : FREEZE_REPORT_MS);
}

export interface FreezeReports {
  /** The page went silent while visible, `silentMs` ago, last beating with `context`. */
  frozen(silentMs: number, context: CaptureContext | null): void;
  /** A frozen page beat again after `freezeMs` of silence; `afterWake`: the freeze began within
   *  {@link WAKE_GRACE_MS} of the machine waking. */
  thawed(freezeMs: number, context: CaptureContext | null, afterWake: boolean): void;
}

/**
 * The watchdog's view of the page's heartbeat. Silence counts only while the last beat said the page
 * was visible: a hidden page's timers are throttled to a beat a minute or less. A check that comes
 * late itself means the watchdog was not running either (the machine slept), so that silence is not
 * the page's; {@link StallWatch} holds that rule.
 */
export class FreezeWatch {
  private readonly silence: StallWatch;
  private visible = false;
  private context: CaptureContext | null = null;
  private lastCheckMs: number;
  private wokeAtMs = Number.NEGATIVE_INFINITY;
  private beatAtMs = 0;

  constructor(reports: FreezeReports, thresholdMs: number, beatMs: number, nowMs: number) {
    this.silence = new StallWatch(
      {
        stalled: (silentMs) => reports.frozen(silentMs, this.context),
        recovered: (silentMs) =>
          reports.thawed(silentMs, this.context, this.beatAtMs - silentMs - this.wokeAtMs <= WAKE_GRACE_MS),
      },
      thresholdMs,
      beatMs,
      nowMs,
    );
    this.lastCheckMs = nowMs;
  }

  /** A beat; a freeze it ends is told with the context from before it. */
  beat(nowMs: number, visible: boolean, context: CaptureContext): void {
    this.beatAtMs = nowMs;
    this.silence.heard(nowMs);
    this.visible = visible;
    this.context = context;
  }

  check(nowMs: number): void {
    if (nowMs - this.lastCheckMs > MACHINE_AWAY_MS) this.wokeAtMs = nowMs;
    this.lastCheckMs = nowMs;
    if (this.visible) this.silence.check(nowMs);
    else this.silence.heard(nowMs);
  }
}
