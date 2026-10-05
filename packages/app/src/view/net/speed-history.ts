import { TICKS_PER_SECOND } from '@open-northland/net-protocol';
import { SPEED_HISTORY_SECONDS, type SpeedSample } from '../../hud/network/model.js';

const MS_PER_SECOND = 1000;

/** What one moment of a relayed game says about its pace. */
export interface PaceReading {
  /** Wall milliseconds, monotonic. */
  readonly nowMs: number;
  /** The tick this client's world stands at; null while it holds none. */
  readonly tick: number | null;
  /** The speed the room's clock runs at; 0 while it is paused or held. */
  readonly roomSpeed: number;
}

/** The network panel's speed history: one sample per wall second, the newest
 *  {@link SPEED_HISTORY_SECONDS} of them, oldest first. */
export interface SpeedHistory {
  /** Read as often as convenient; the same array until a second closes. */
  observe(reading: PaceReading): readonly SpeedSample[];
}

/**
 * Closes a second once a reading lands past it. A gap of several seconds (a stalled or hidden page)
 * closes all of them with the gap's average pace, so the chart keeps wall time. `ownSpeed` is the
 * ticks the world advanced over the closed seconds as a multiplier of real time; `roomSpeed` is the
 * clock's speed at the reading that closed them.
 */
export function createSpeedHistory(): SpeedHistory {
  let samples: readonly SpeedSample[] = [];
  let windowStartMs: number | null = null;
  let windowStartTick: number | null = null;
  return {
    observe(reading): readonly SpeedSample[] {
      if (windowStartMs === null) {
        windowStartMs = reading.nowMs;
        windowStartTick = reading.tick;
        return samples;
      }
      const elapsedMs = reading.nowMs - windowStartMs;
      const seconds = Math.floor(elapsedMs / MS_PER_SECOND);
      if (seconds < 1) return samples;
      // A world rebuilt from a snapshot, or one not yet adopted, advanced nothing this client can count.
      const advanced =
        reading.tick === null || windowStartTick === null ? 0 : Math.max(0, reading.tick - windowStartTick);
      const sample: SpeedSample = {
        roomSpeed: reading.roomSpeed,
        ownSpeed: advanced / TICKS_PER_SECOND / (elapsedMs / MS_PER_SECOND),
      };
      const closed = Array.from({ length: Math.min(seconds, SPEED_HISTORY_SECONDS) }, () => sample);
      samples = [...samples, ...closed].slice(-SPEED_HISTORY_SECONDS);
      // The next second opens at the boundary; the ticks of the moments past it are carried into it.
      const carriedMs = elapsedMs - seconds * MS_PER_SECOND;
      windowStartMs = reading.nowMs - carriedMs;
      windowStartTick = reading.tick === null ? null : reading.tick - (advanced * carriedMs) / elapsedMs;
      return samples;
    },
  };
}
