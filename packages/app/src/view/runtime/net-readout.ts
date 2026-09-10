/** The connection figures a relayed session shows: on the perf overlay, in `perf()`, and beside the
 *  player list. Null fields are not measured yet. */
export interface NetReadout {
  readonly connected: boolean;
  readonly roundTripMs: number | null;
  readonly delayTicks: number | null;
  /** The assigned input delay in wall time at the session's tempo. */
  readonly delayMs: number | null;
  readonly clickToApplyMs: number | null;
  /** Frames received and not yet run: the jitter buffer's depth. */
  readonly bufferedTicks: number;
}
