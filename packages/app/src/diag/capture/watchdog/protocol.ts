import type { CaptureContext } from '../context.js';

/** The page's messages to its watchdog worker. */
export type ToWatchdog =
  | { readonly kind: 'start'; readonly tabId: string }
  | { readonly kind: 'beat'; readonly visible: boolean; readonly context: CaptureContext };

/** A freeze past the report threshold ended; `frozenAt` is the epoch time of the beat before it. */
export interface Thaw {
  readonly kind: 'thawed';
  readonly freezeMs: number;
  readonly frozenAt: number;
  readonly context: CaptureContext | null;
  /** The freeze began just after the machine woke from sleep. */
  readonly afterWake: boolean;
}
