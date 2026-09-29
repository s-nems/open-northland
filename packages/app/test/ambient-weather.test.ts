import type { SceneTerrain, WeatherField } from '@open-northland/render';
import { AMBIENT_LEVEL_AMOUNTS, WEATHER_KINDS, weatherAmountAt } from '@open-northland/render/data';
import { describe, expect, it } from 'vitest';
import { type AmbientWeatherMode, ambientWeatherFor } from '../src/view/ambient-weather.js';
import { createWeatherFeed } from '../src/view/weather-feed.js';

const PATTERNS = [
  { editName: 'grass', editGroups: ['meadow green', 'meadow all'] },
  { editName: 'snow', editGroups: ['snow 2x2', 'snow all'] },
  { editName: 'dune', editGroups: ['desertBrown a', 'desertBrown all'] },
  { editName: 'beach', editGroups: ['sand 2x2', 'sand all'] },
  { editName: 'sea', editGroups: ['water 2x2', 'water all'] },
];
const NAMES = PATTERNS.map((p) => p.editName);
const SIZE = 20;

/** A square map whose west half is `west` ground and east half `east`. */
function terrain(west: string, east: string): SceneTerrain {
  const cells = Array.from({ length: SIZE * SIZE }, (_, i) =>
    NAMES.indexOf(i % SIZE < SIZE / 2 ? west : east),
  );
  return {
    width: SIZE,
    height: SIZE,
    typeIds: new Array<number>(SIZE * SIZE).fill(0),
    ground: { patterns: NAMES, a: cells, b: cells },
  };
}

const kindAt = (map: SceneTerrain, sx: number): string | undefined => {
  const ambient = ambientWeatherFor(map, PATTERNS, 1);
  return WEATHER_KINDS[ambient?.sectors.kinds[sx] ?? -1];
};
const WEST = 0;
const EAST = 3;

describe('ambientWeatherFor', () => {
  it('reads each sector its kind off the ground', () => {
    expect(kindAt(terrain('grass', 'snow'), WEST)).toBe('rain');
    expect(kindAt(terrain('grass', 'snow'), EAST)).toBe('snow');
    expect(kindAt(terrain('grass', 'dune'), EAST)).toBe('sand');
  });

  it('takes sand for a beach on a green map and for desert on a desert one', () => {
    const green = { ...terrain('grass', 'grass') };
    const beachCells = green.ground?.a.map((cell, i) =>
      i % SIZE >= SIZE - 3 ? NAMES.indexOf('beach') : cell,
    );
    const coast: SceneTerrain = {
      ...green,
      ground: { patterns: NAMES, a: beachCells ?? [], b: beachCells ?? [] },
    };
    expect(kindAt(coast, EAST)).toBe('rain');
    expect(kindAt(terrain('dune', 'beach'), EAST)).toBe('sand');
  });

  it('gives open water the kind of the map', () => {
    expect(kindAt(terrain('snow', 'sea'), EAST)).toBe('snow');
  });
});

describe('ambient weather feed', () => {
  const map = terrain('grass', 'grass');
  const size = { width: SIZE, height: SIZE };
  const DAY_SECONDS = 24 * 3600;
  const [lightRain] = AMBIENT_LEVEL_AMOUNTS.rain;
  const played = (
    mode: AmbientWeatherMode,
  ): { fields: WeatherField[]; feed: ReturnType<typeof createWeatherFeed> } => {
    const fields: WeatherField[] = [];
    const feed = createWeatherFeed(
      size,
      (next) => fields.push(next),
      null,
      ambientWeatherFor(map, PATTERNS, 1, mode),
    );
    for (let t = 0; t < DAY_SECONDS; t += 10) feed.frame(t);
    return { fields, feed };
  };

  it('holds a preview episode under the ambient override', () => {
    const fields: WeatherField[] = [];
    createWeatherFeed(
      size,
      (next) => fields.push(next),
      { kind: 'ambient', percent: 50 },
      ambientWeatherFor(map, PATTERNS, 1),
    );
    const built = fields.at(-1);
    if (built === undefined) throw new Error('no field');
    expect(weatherAmountAt(built, 'rain', 20, 20)).toBeCloseTo(lightRain / 2);
  });

  it('plays nothing of its own in the map mode', () => {
    expect(played('map').fields).toHaveLength(0);
  });

  it('follows the schedule in the variable mode and yields where the map writes', () => {
    const { fields, feed } = played('variable');
    expect(fields.some((field) => field.any)).toBe(true);
    feed.write({ weather: 'snow', min: { hx: 0, hy: 0 }, max: { hx: 39, hy: 39 }, density: 2000 });
    const built = fields.at(-1);
    if (built === undefined) throw new Error('no field');
    expect(weatherAmountAt(built, 'snow', 20, 20)).toBeCloseTo(0.2);
    expect(weatherAmountAt(built, 'rain', 20, 20)).toBe(0);
  });

  it('lays the winter snow on the first frame', () => {
    const fields: WeatherField[] = [];
    const feed = createWeatherFeed(
      size,
      (next) => fields.push(next),
      null,
      ambientWeatherFor(map, PATTERNS, 1, 'winter'),
    );
    feed.frame(0);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.lyingSnow ?? 0).toBeGreaterThan(0);
  });

  it('snows on grass and keeps lying snow in the winter mode', () => {
    const { fields } = played('winter');
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((field) => (field.lyingSnow ?? 0) > 0)).toBe(true);
    expect(fields.some((field) => weatherAmountAt(field, 'snow', 20, 20) > 0)).toBe(true);
    expect(fields.every((field) => weatherAmountAt(field, 'rain', 20, 20) === 0)).toBe(true);
  });
});
