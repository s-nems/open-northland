/**
 * The event stream contract between the performance interpreter and the synthesizer: instrument
 * identity rows plus timed messages with `t` in frames at the render rate.
 */

export interface EventInstance {
  readonly id: number;
  /** DLS collection file the instrument's band references. */
  readonly dls: string;
  readonly bankLo: number;
  readonly bankHi: number;
  readonly patch: number;
  /** Band volume as the squared 0-127 byte fraction, as the players receive it. */
  readonly vol: number;
  /** Band pan in [-1, 1]. */
  readonly pan: number;
  /** Semitones the band transposes the instrument's notes by. The synthesizer applies it, so these
   *  events carry the performance's own note numbers. */
  readonly transpose: number;
}

export type TimedEvent =
  | { readonly e: 'on'; readonly t: number; readonly id: number; readonly note: number; readonly vel: number }
  | { readonly e: 'off'; readonly t: number; readonly id: number; readonly note: number }
  | { readonly e: 'cc'; readonly t: number; readonly id: number; readonly cc: number; readonly val: number }
  | { readonly e: 'pb'; readonly t: number; readonly id: number; readonly val: number };

export interface SegmentEvents {
  readonly instances: readonly EventInstance[];
  /** In emission order, which is chronological. */
  readonly events: readonly TimedEvent[];
  /** Frame at which each segment-end boundary executed, one entry per completed pass. This is the
   *  performance's own clock, so a trim or loop point taken from it cannot drift from the events. */
  readonly segmentEndFrames: readonly number[];
}
