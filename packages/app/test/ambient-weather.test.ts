import type { SceneTerrain, WeatherField } from '@open-northland/render';
import { AMBIENT_FULL_AMOUNT, WEATHER_KINDS, weatherAmountAt } from '@open-northland/render/data';
import { describe, expect, it } from 'vitest';
import { ambientWeatherFor, authorsWeather } from '../src/view/ambient-weather.js';
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
  const ambient = ambientWeatherFor(null, map, PATTERNS, 1);
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

  it('is unscheduled on a map that authors weather', () => {
    const script = { missions: [{ results: [{ values: ['SetWeather', '1', '1', '9', '0', '10'] }] }] };
    expect(authorsWeather(script)).toBe(true);
    expect(authorsWeather({ weather: [{}] })).toBe(true);
    expect(authorsWeather({ missions: [{ results: [{ values: ['ActivateMission', '3'] }] }] })).toBe(false);
    expect(ambientWeatherFor(script, terrain('grass', 'grass'), PATTERNS, 1)?.scheduled).toBe(false);
  });
});

describe('ambient weather feed', () => {
  const map = terrain('grass', 'grass');
  const size = { width: SIZE, height: SIZE };

  it('holds a preview episode under the ambient override', () => {
    let field: WeatherField | null = null;
    createWeatherFeed(
      size,
      (next) => {
        field = next;
      },
      { kind: 'ambient', percent: 50 },
      ambientWeatherFor(null, map, PATTERNS, 1),
    );
    const built = field as WeatherField | null;
    if (built === null) throw new Error('no field');
    expect(weatherAmountAt(built, 'rain', 20, 20)).toBeCloseTo(AMBIENT_FULL_AMOUNT.rain / 2);
  });

  it('follows the schedule and stops at the first authored write', () => {
    let applied = 0;
    const feed = createWeatherFeed(size, () => applied++, null, ambientWeatherFor(null, map, PATTERNS, 1));
    const DAY_SECONDS = 24 * 3600;
    for (let t = 0; t < DAY_SECONDS; t += 10) feed.frame(t);
    expect(applied).toBeGreaterThan(0);
    feed.write({ weather: 'rain', min: { hx: 0, hy: 0 }, max: { hx: 9, hy: 9 }, density: 1000 });
    const after = applied;
    for (let t = DAY_SECONDS; t < 2 * DAY_SECONDS; t += 10) feed.frame(t);
    expect(applied).toBe(after);
  });
});
