/** How often the runtime asks the worker for a sign of life. */
export const HEARTBEAT_INTERVAL_MS = 1000;

/**
 * Silence past which the worker counts as stalled. Five heartbeats, and well past the longest single
 * piece of work the worker does between messages: a tick on the late six-AI magiczny_las world takes
 * about 20 ms, its diag state hash about 550 ms.
 */
export const WORKER_STALL_TIMEOUT_MS = 5000;

export interface StallReports {
  /** The worker has been silent for `silentMs`; reported once per silence. */
  stalled(silentMs: number): void;
  /** A reported silence ended after `silentMs`. */
  recovered(silentMs: number): void;
}

/** A check this many heartbeats late means this thread, not the worker, was blocked. */
const LATE_CHECK_HEARTBEATS = 2;

/**
 * Tells a silent worker from a busy runtime: any message from the worker counts as heard, and a check
 * that itself comes late means this thread was blocked, whose queued messages have not been read yet,
 * so the silence restarts instead of being charged to the worker. Checked once per heartbeat.
 */
export class StallWatch {
  private lastHeardMs: number;
  private lastCheckMs: number;
  private reported = false;

  constructor(
    private readonly reports: StallReports,
    private readonly timeoutMs: number,
    private readonly heartbeatMs: number,
    nowMs: number,
  ) {
    this.lastHeardMs = nowMs;
    this.lastCheckMs = nowMs;
  }

  heard(nowMs: number): void {
    if (this.reported) {
      this.reported = false;
      this.reports.recovered(nowMs - this.lastHeardMs);
    }
    this.lastHeardMs = nowMs;
  }

  check(nowMs: number): void {
    if (nowMs - this.lastCheckMs > LATE_CHECK_HEARTBEATS * this.heartbeatMs) this.lastHeardMs = nowMs;
    this.lastCheckMs = nowMs;
    if (this.reported || nowMs - this.lastHeardMs <= this.timeoutMs) return;
    this.reported = true;
    this.reports.stalled(nowMs - this.lastHeardMs);
  }
}
