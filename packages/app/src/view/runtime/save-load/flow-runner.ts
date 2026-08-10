import { diag } from '../../../diag/index.js';

/** A flow's own progress writer, for the line to show while it is still running. */
export type FlowProgress = (text: string) => void;

export interface FlowRunner {
  /** Start a flow unless one is still in flight. */
  (flow: (progress: FlowProgress) => Promise<string | null>): void;
  /** Release a flow that can never settle: a browser file dialog dismissed without a `cancel` event
   *  leaves its promise pending, and without this the panel takes no input again. */
  reset(): void;
}

/** One in-flight flow per panel: a second click while a dialog or store call is pending would
 *  stack another one. A flow resolves to the status line to show, or null to leave it cleared;
 *  `failed` is the line for a flow that threw, since every expected refusal returns its own text. */
export function flowRunner(setStatus: (text: string | null) => void, failed: string): FlowRunner {
  let busy = false;
  const run = (flow: (progress: FlowProgress) => Promise<string | null>): void => {
    if (busy) return;
    busy = true;
    setStatus(null);
    void flow(setStatus)
      .then(setStatus, (err: unknown) => {
        diag.warn('save', `save flow failed: ${String(err)}`);
        setStatus(failed);
      })
      .finally(() => {
        busy = false;
      });
  };
  return Object.assign(run, {
    reset: (): void => {
      busy = false;
    },
  });
}
