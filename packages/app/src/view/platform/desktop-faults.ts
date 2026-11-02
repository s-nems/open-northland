/** A fault the desktop shell saw from outside the page: the page crashed, was killed or hung. */
export interface DesktopFault {
  /** 32 lowercase hex characters; becomes the report's id. */
  readonly id: string;
  readonly trigger: 'renderer-gone' | 'renderer-unresponsive' | 'gpu-gone' | 'error';
  /** ISO time the shell saw it. */
  readonly at: string;
  /** Electron's `render-process-gone` reason, `unresponsive`, or the main-process error's name. */
  readonly reason: string;
  readonly exitCode: number | null;
  /** How long a hung page stayed unresponsive; null while unknown. */
  readonly durationMs: number | null;
  /** The hung page's JavaScript call stack, or the main-process error's stack. */
  readonly stack: string | null;
  /** The page's URL when it happened. */
  readonly url: string | null;
  /** Chromium's GPU feature status when the GPU process died, else null. */
  readonly gpuStatus: Readonly<Record<string, string>> | null;
}

/** How the shell's previous run ended without quitting: the system ended the session, it never woke
 *  from sleep, a native crash left a dump, or none of these (killed, or the power went). */
export interface PreviousShellRun {
  /** ISO times bounding the pages that run served. */
  readonly from: string;
  readonly until: string;
  readonly end: 'shutdown' | 'asleep' | 'crash' | 'unknown';
  /** When the session ended, the system went to sleep or the dump was written; null for `unknown`. */
  readonly endedAt: string | null;
}

/** The shell keeps faults across a restart until the page reports or dismisses them. */
export interface DesktopFaults {
  /** Faults recorded and not yet cleared, oldest first. */
  pending(): Promise<readonly DesktopFault[]>;
  clear(ids: readonly string[]): Promise<void>;
  /** App, Electron, Chrome and OS versions, for a report's build facts. */
  versions(): Promise<Readonly<Record<string, string>>>;
  /** The previous run, when it ended without quitting. */
  previousRun(): Promise<PreviousShellRun | null>;
}
