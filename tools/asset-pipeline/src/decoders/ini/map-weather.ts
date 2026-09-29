/**
 * `[misc_weather]` reducer: the `set<kind>rectangle <x1> <y1> <x2> <y2> <density>` rows a map lays down
 * at load, coordinates in half-cell nodes and density on the original's `0..10000` scale.
 */
import type { MapWeatherRectangle } from '@open-northland/data';
import type { RuleSection } from './grammar.js';

const RECTANGLE_KINDS: Readonly<Record<string, MapWeatherRectangle['weather']>> = {
  setrainrectangle: 'rain',
  setsnowrectangle: 'snow',
  setsandrectangle: 'sand',
};

function int(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  const n = Number.parseInt(token, 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * The section's rectangles in file order. Corners are ordered per axis as the original swaps them (the
 * corpus authors some right-to-left or bottom-to-top); a row short of five numbers is dropped, and an
 * unknown key is skipped as the original skips it.
 */
export function weatherRectangles(section: RuleSection): MapWeatherRectangle[] {
  const rows: MapWeatherRectangle[] = [];
  for (const p of section.props) {
    const weather = RECTANGLE_KINDS[p.key];
    if (weather === undefined) continue;
    const [x1, y1, x2, y2, density] = p.values.map(int);
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined || density === undefined)
      continue;
    rows.push({
      weather,
      min: { hx: Math.min(x1, x2), hy: Math.min(y1, y2) },
      max: { hx: Math.max(x1, x2), hy: Math.max(y1, y2) },
      density,
    });
  }
  return rows;
}
