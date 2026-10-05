import { SPEED_HISTORY_SECONDS, type SpeedSample } from './model.js';

/** The sparkline's drawing box in SVG units: one unit per sampled second across. */
export const SPARKLINE_W = SPEED_HISTORY_SECONDS;
export const SPARKLINE_H = 48;
/** SVG units kept clear above the highest guide, so a line at the top is not clipped. */
const TOP_MARGIN = 3;

export interface SparklineGeometry {
  /** `points` of the room's speed and of this client's own speed; empty without samples. */
  readonly room: string;
  readonly own: string;
  /** The y of each whole multiplier from ×1 up to the scale's top, labelled by its speed. */
  readonly guides: readonly { readonly speed: number; readonly y: number }[];
}

/** The two lines of the last {@link SPEED_HISTORY_SECONDS} seconds against one scale from 0 up to the
 *  requested speed or the highest sample, whichever is higher. The newest sample sits at the right
 *  edge, so a short history fills from the right. */
export function sparklineGeometry(history: readonly SpeedSample[], requested: number): SparklineGeometry {
  const samples = history.slice(-SPEED_HISTORY_SECONDS);
  let top = Math.max(1, requested);
  for (const sample of samples) top = Math.max(top, sample.roomSpeed, sample.ownSpeed);
  const y = (speed: number): number => SPARKLINE_H - (Math.max(0, speed) / top) * (SPARKLINE_H - TOP_MARGIN);
  const offset = SPARKLINE_W - samples.length;
  const line = (pick: (sample: SpeedSample) => number): string =>
    samples.map((sample, index) => `${offset + index},${round(y(pick(sample)))}`).join(' ');
  const guides: { speed: number; y: number }[] = [];
  for (let speed = 1; speed <= top; speed++) guides.push({ speed, y: round(y(speed)) });
  return { room: line((s) => s.roomSpeed), own: line((s) => s.ownSpeed), guides };
}

/** Hundredths keep the markup short; the box is a few dozen units tall. */
const HUNDREDTHS = 100;
const round = (value: number): number => Math.round(value * HUNDREDTHS) / HUNDREDTHS;
