import { describe, expect, it } from 'vitest';
import type { Viewport } from '../../src/data/projection/viewport.js';
import {
  LIGHTNING_BUCKET_SECONDS,
  LIGHTNING_RETAIN_SECONDS,
  strikeFlash,
  strikeInBucket,
  THUNDER_MAX_DELAY_SECONDS,
  thunderDelaySeconds,
  viewWeatherAmounts,
  WEATHER_FADE_SECONDS,
  WEATHER_SNAP_SECONDS,
  WeatherClimate,
  windSway,
} from '../../src/data/weather/climate.js';
import { buildWeatherField, type WeatherField } from '../../src/data/weather/field.js';
import { WEATHER_DENSITY_FULL, type WeatherKind } from '../../src/data/weather/types.js';

const MAP_NODES = 400;
/** World px spanning the whole test map (34 px per node across, 19 px per node down). */
const WHOLE_MAP: Viewport = { minX: 0, minY: 0, maxX: MAP_NODES * 34, maxY: MAP_NODES * 19 };
const FRAME = 1 / 60;

function field(kind: WeatherKind, amount: number): WeatherField {
  return buildWeatherField(
    [
      {
        weather: kind,
        min: { hx: 0, hy: 0 },
        max: { hx: MAP_NODES, hy: MAP_NODES },
        density: amount * WEATHER_DENSITY_FULL,
      },
    ],
    MAP_NODES,
    MAP_NODES,
  );
}

function run(climate: WeatherClimate, f: WeatherField | null, from: number, to: number, dt = FRAME) {
  let conditions = climate.step({ field: f, viewport: WHOLE_MAP, gameSeconds: from, enabled: true });
  for (let t = from + dt; t <= to + 1e-9; t += dt) {
    conditions = climate.step({ field: f, viewport: WHOLE_MAP, gameSeconds: t, enabled: true });
  }
  return conditions;
}

describe('weather climate amounts', () => {
  it('snaps on the first step and fades on later ones', () => {
    const climate = new WeatherClimate();
    const rain = field('rain', 0.2);
    expect(
      climate.step({ field: rain, viewport: WHOLE_MAP, gameSeconds: 10, enabled: true }).amounts.rain,
    ).toBeCloseTo(0.2);
    const dry = field('rain', 0);
    const after = run(climate, dry, 10 + FRAME, 10 + WEATHER_FADE_SECONDS);
    expect(after.amounts.rain).toBeGreaterThan(0.2 * 0.3);
    expect(after.amounts.rain).toBeLessThan(0.2 * 0.45);
  });

  it('follows the view at once while paused, so a paused pan keeps every layer in step', () => {
    const climate = new WeatherClimate();
    climate.step({ field: field('snow', 0), viewport: WHOLE_MAP, gameSeconds: 5, enabled: true });
    const snow = field('snow', 0.3);
    const a = climate.step({ field: snow, viewport: WHOLE_MAP, gameSeconds: 6, enabled: true }).amounts.snow;
    expect(a).toBeLessThan(0.3);
    const b = climate.step({ field: snow, viewport: WHOLE_MAP, gameSeconds: 6, enabled: true }).amounts.snow;
    expect(b).toBeCloseTo(0.3);
  });

  it('snaps on a fast-forward jump or a backwards seek', () => {
    const climate = new WeatherClimate();
    climate.step({ field: field('sand', 0), viewport: WHOLE_MAP, gameSeconds: 5, enabled: true });
    const sand = field('sand', 0.05);
    const jumped = climate.step({
      field: sand,
      viewport: WHOLE_MAP,
      gameSeconds: 5 + WEATHER_SNAP_SECONDS + 1,
      enabled: true,
    });
    expect(jumped.amounts.sand).toBeCloseTo(0.05);
    const back = climate.step({
      field: field('sand', 0),
      viewport: WHOLE_MAP,
      gameSeconds: 1,
      enabled: true,
    });
    expect(back.amounts.sand).toBe(0);
  });

  it('is calm and forgets its fades when disabled', () => {
    const climate = new WeatherClimate();
    const rain = field('rain', 0.4);
    run(climate, rain, 0, 2);
    const off = climate.step({ field: rain, viewport: WHOLE_MAP, gameSeconds: 2.1, enabled: false });
    expect(off.amounts.rain).toBe(0);
    expect(off.windX).toBe(0);
    expect(off.strikes).toHaveLength(0);
    const on = climate.step({ field: rain, viewport: WHOLE_MAP, gameSeconds: 2.2, enabled: true });
    expect(on.amounts.rain).toBeCloseTo(0.4);
  });

  it('averages several points across the view, not only its centre', () => {
    const corner = buildWeatherField(
      [{ weather: 'rain', min: { hx: 0, hy: 0 }, max: { hx: 60, hy: 60 }, density: WEATHER_DENSITY_FULL }],
      MAP_NODES,
      MAP_NODES,
    );
    // A view 180 nodes square with rain only in its top-left third.
    const view: Viewport = { minX: 0, minY: 0, maxX: 180 * 34, maxY: 180 * 19 };
    const amounts = viewWeatherAmounts(corner, view);
    expect(amounts.rain).toBeGreaterThan(0);
    expect(amounts.rain).toBeLessThan(0.5);
  });
});

describe('weather climate storms', () => {
  const stormAt = (kind: WeatherKind, amount: number) =>
    new WeatherClimate().step({
      field: field(kind, amount),
      viewport: WHOLE_MAP,
      gameSeconds: 0,
      enabled: true,
    }).storm;

  it('keeps typical script weather below a full storm and the heaviest at one', () => {
    expect(stormAt('rain', 0.05)).toBe(0);
    expect(stormAt('rain', 0.3)).toBeGreaterThan(0.5);
    expect(stormAt('rain', 0.65)).toBe(1);
    expect(stormAt('snow', 0.1)).toBe(0);
    expect(stormAt('snow', 0.5)).toBe(1);
  });

  it('turns ini-scale sand into a sandstorm', () => {
    expect(stormAt('sand', 0.02)).toBe(0);
    expect(stormAt('sand', 0.07)).toBeGreaterThan(0.5);
  });

  it('blows harder in a storm and hardest sideways in a sandstorm', () => {
    const windAt = (kind: WeatherKind, amount: number) =>
      run(new WeatherClimate(), field(kind, amount), 0, 1);
    const calm = windAt('rain', 0);
    const storm = windAt('rain', 0.5);
    const sand = windAt('sand', 0.08);
    expect(Math.hypot(storm.windX, storm.windY)).toBeGreaterThan(3 * Math.hypot(calm.windX, calm.windY));
    expect(Math.abs(sand.windX)).toBeGreaterThan(Math.abs(storm.windX));
    expect(Math.abs(sand.windY)).toBeLessThan(0.2 * Math.abs(sand.windX));
  });

  it('never blows a blizzard up the screen, while still drifting it sideways', () => {
    const blizzard = field('snow', 0.5);
    const seeds = [0, 3, 17];
    // Two slow heading periods cover the whole drift range.
    const seconds = 350;
    let lowest = Number.POSITIVE_INFINITY;
    let flattened = 0;
    for (const seed of seeds) {
      const climate = new WeatherClimate(seed);
      for (let t = 0; t < seconds; t += 0.5) {
        const c = climate.step({ field: blizzard, viewport: WHOLE_MAP, gameSeconds: t, enabled: true });
        lowest = Math.min(lowest, c.windY);
        if (c.windY === 0) flattened++;
        expect(c.windX).toBeGreaterThan(0);
      }
    }
    expect(lowest).toBe(0);
    expect(flattened).toBeGreaterThan(0);
  });

  it('reports wind sway strength and direction', () => {
    const sway = windSway(run(new WeatherClimate(), field('sand', 0.08), 0, 1));
    expect(sway.strength).toBeGreaterThan(0.9);
    expect(sway.direction).toBeGreaterThan(0.9);
    expect(
      windSway({
        amounts: { rain: 0, snow: 0, sand: 0 },
        storm: 0,
        windX: 0,
        windY: 0,
        gust: 0,
        flash: 0,
        strikes: [],
      }),
    ).toEqual({ strength: 0, direction: 0, gust: 0 });
  });

  it('leaves the calm breeze of a clear sky out of the sway', () => {
    const clear = run(new WeatherClimate(), null, 0, 1);
    expect(Math.hypot(clear.windX, clear.windY)).toBeGreaterThan(0);
    expect(windSway(clear).strength).toBe(0);
    const storm = windSway(run(new WeatherClimate(), field('rain', 0.5), 0, 1));
    expect(storm.strength).toBeGreaterThan(0.5);
    expect(storm.direction).toBeGreaterThan(0);
  });
});

describe('weather climate lightning', () => {
  const thunderstorm = field('rain', 0.6);

  it('never strikes outside a rain storm', () => {
    for (const [kind, amount] of [
      ['rain', 0.15],
      ['snow', 0.8],
      ['sand', 0.1],
    ] as const) {
      const climate = new WeatherClimate();
      let strikes = 0;
      for (let t = 0; t < 120; t += FRAME) {
        strikes += climate.step({
          field: field(kind, amount),
          viewport: WHOLE_MAP,
          gameSeconds: t,
          enabled: true,
        }).strikes.length;
      }
      expect(strikes).toBe(0);
    }
  });

  it('strikes in a thunderstorm, flashes, and keeps each strike until its thunder could arrive', () => {
    const climate = new WeatherClimate(7);
    const seen = new Map<number, number>();
    let brightest = 0;
    for (let t = 0; t < 60; t += FRAME) {
      const conditions = climate.step({
        field: thunderstorm,
        viewport: WHOLE_MAP,
        gameSeconds: t,
        enabled: true,
      });
      brightest = Math.max(brightest, conditions.flash);
      for (const strike of conditions.strikes) {
        expect(t - strike.atSeconds).toBeLessThanOrEqual(LIGHTNING_RETAIN_SECONDS + 1e-9);
        seen.set(strike.id, Math.max(seen.get(strike.id) ?? 0, t - strike.atSeconds));
      }
    }
    expect(seen.size).toBeGreaterThan(3);
    expect(brightest).toBeGreaterThan(0.5);
    // Every strike that is old enough stayed listed past its thunder.
    for (const [id, age] of seen) {
      if (id * LIGHTNING_BUCKET_SECONDS < 60 - LIGHTNING_RETAIN_SECONDS - LIGHTNING_BUCKET_SECONDS) {
        expect(age).toBeGreaterThan(THUNDER_MAX_DELAY_SECONDS);
      }
    }
  });

  it('schedules the same strikes whatever the frame rate, and none while paused', () => {
    const ids = (dt: number) => {
      const climate = new WeatherClimate(3);
      const out = new Set<number>();
      for (let t = 0; t < 90; t += dt) {
        for (const s of climate.step({
          field: thunderstorm,
          viewport: WHOLE_MAP,
          gameSeconds: t,
          enabled: true,
        }).strikes)
          out.add(s.id);
      }
      return [...out];
    };
    expect(ids(1 / 20)).toEqual(ids(1 / 144));

    const climate = new WeatherClimate(3);
    run(climate, thunderstorm, 0, 30);
    const frozen = climate.step({ field: thunderstorm, viewport: WHOLE_MAP, gameSeconds: 30, enabled: true });
    const before = frozen.strikes.map((s) => s.id);
    const flash = frozen.flash;
    for (let i = 0; i < 200; i++)
      climate.step({ field: thunderstorm, viewport: WHOLE_MAP, gameSeconds: 30, enabled: true });
    const after = climate.step({ field: thunderstorm, viewport: WHOLE_MAP, gameSeconds: 30, enabled: true });
    expect(after.strikes.map((s) => s.id)).toEqual(before);
    expect(after.flash).toBe(flash);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const trace = (seed: number) => {
      const climate = new WeatherClimate(seed);
      const out: number[] = [];
      for (let t = 0; t < 40; t += FRAME) {
        const c = climate.step({ field: thunderstorm, viewport: WHOLE_MAP, gameSeconds: t, enabled: true });
        out.push(c.windX, c.flash);
      }
      return out;
    };
    expect(trace(11)).toEqual(trace(11));
    expect(trace(11)).not.toEqual(trace(12));
  });

  it('drops strikes on a jump instead of replaying the skipped time', () => {
    const climate = new WeatherClimate(5);
    run(climate, thunderstorm, 0, 20);
    const jumped = climate.step({
      field: thunderstorm,
      viewport: WHOLE_MAP,
      gameSeconds: 500,
      enabled: true,
    });
    expect(jumped.strikes).toHaveLength(0);
  });

  it('flickers at most twice per strike and dims with distance', () => {
    let near = null;
    for (let bucket = 0; near === null; bucket++) {
      const strike = strikeInBucket(0, bucket, 1);
      if (strike !== null && strike.distance < 0.3) near = strike;
    }
    const samples: number[] = [];
    for (let t = 0; t < 0.5; t += 0.005) samples.push(strikeFlash(0, near, near.atSeconds + t));
    const peaks = samples.filter(
      (v, i) => i > 0 && v > (samples[i - 1] ?? 0) && v >= (samples[i + 1] ?? 0) && v > 0.1,
    );
    expect(peaks.length).toBeGreaterThanOrEqual(1);
    expect(peaks.length).toBeLessThanOrEqual(2);
    const far = { ...near, distance: 1 };
    expect(strikeFlash(0, far, near.atSeconds + 0.03)).toBeLessThan(
      strikeFlash(0, near, near.atSeconds + 0.03),
    );
    expect(thunderDelaySeconds(far)).toBe(THUNDER_MAX_DELAY_SECONDS);
  });

  it('never flashes more than three times in any second', () => {
    const FLASHES_PER_SECOND_LIMIT = 3;
    const dt = 1 / 240;
    const climate = new WeatherClimate(9);
    const onsets: number[] = [];
    let previous = 0;
    let rising = false;
    for (let t = 0; t < 300; t += dt) {
      const { flash } = climate.step({
        field: thunderstorm,
        viewport: WHOLE_MAP,
        gameSeconds: t,
        enabled: true,
      });
      if (flash > previous && !rising) onsets.push(t);
      rising = flash > previous;
      previous = flash;
    }
    expect(onsets.length).toBeGreaterThan(10);
    for (let i = FLASHES_PER_SECOND_LIMIT; i < onsets.length; i++) {
      expect((onsets[i] ?? 0) - (onsets[i - FLASHES_PER_SECOND_LIMIT] ?? 0)).toBeGreaterThan(1);
    }
  });
});
