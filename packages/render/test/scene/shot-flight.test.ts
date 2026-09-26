import { describe, expect, it } from 'vitest';
import { ONE, tileToScreen } from '../../src/data/projection/index.js';
import { readSiegeShot, type SiegeShot, shotPath, shotPoseAt } from '../../src/data/scene/index.js';
import { headingValency, type ParticleRef, particleFrame } from '../../src/data/sprites/index.js';
import { type ElevationField, makeElevationField } from '../../src/data/terrain/index.js';

/** A catapult's stone east over 16 map points at weapon speed 3: `16 * 8 / 3` ticks, the tick before its
 *  land tick spent on the aim. */
const SIXTEEN_POINT_FLIGHT_TICKS = 42;
const LAUNCH_TICK = 7;
const LAND_TICK = LAUNCH_TICK + SIXTEEN_POINT_FLIGHT_TICKS + 1;
const ROCK_MUNITION = 2;

function shot(fields: Partial<SiegeShot> = {}): SiegeShot {
  return {
    ref: 1,
    munitionType: ROCK_MUNITION,
    launchTick: 0,
    flightTicks: SIXTEEN_POINT_FLIGHT_TICKS,
    origin: { x: 2, y: 4 },
    aim: { x: 10, y: 4 },
    ...fields,
  };
}

describe('readSiegeShot', () => {
  it('reads a ground-burst projectile with the sim flight time and skips an arrow', () => {
    const projectile = {
      originX: 2 * ONE,
      originY: 4 * ONE,
      aimX: 10 * ONE,
      aimY: 4 * ONE,
      launchTick: LAUNCH_TICK,
      landTick: LAND_TICK,
      munitionType: ROCK_MUNITION,
      impact: { smokeTicks: 20 },
    };
    expect(readSiegeShot(5, { Projectile: projectile })).toEqual({
      ref: 5,
      munitionType: ROCK_MUNITION,
      launchTick: LAUNCH_TICK,
      flightTicks: SIXTEEN_POINT_FLIGHT_TICKS,
      origin: { x: 2, y: 4 },
      aim: { x: 10, y: 4 },
    });
    expect(readSiegeShot(5, { Projectile: { ...projectile, impact: null } })).toBeNull();
  });
});

describe('the drawn lob', () => {
  it('leaves and lands on the ground and peaks at mid-flight, higher on a longer shot', () => {
    const near = shot({ aim: { x: 6, y: 4 } });
    const far = shot();
    const path = shotPath(far, undefined);
    const from = tileToScreen(2, 4);
    const to = tileToScreen(10, 4);
    expect(shotPoseAt(path, far, 0)).toEqual({ x: from.x, y: from.y, lift: 0 });
    expect(shotPoseAt(path, far, SIXTEEN_POINT_FLIGHT_TICKS)).toEqual({ x: to.x, y: to.y, lift: 0 });
    // Before launch and past landing it holds the chord's ends.
    expect(shotPoseAt(path, far, -1).lift).toBe(0);
    expect(shotPoseAt(path, far, SIXTEEN_POINT_FLIGHT_TICKS + 1).lift).toBe(0);
    const mid = shotPoseAt(path, far, SIXTEEN_POINT_FLIGHT_TICKS / 2);
    expect(mid.lift).toBeCloseTo(path.peak);
    expect(shotPoseAt(path, far, SIXTEEN_POINT_FLIGHT_TICKS / 4).lift).toBeLessThan(mid.lift);
    expect(path.peak).toBeGreaterThan(shotPath(near, undefined).peak);
  });

  it('rides from the ground height at the catapult to that at the landing, and clears a hill between', () => {
    const width = 16;
    const height = 8;
    const heights = new Array<number>(width * height).fill(0);
    const hill: ElevationField = makeElevationField(
      heights.map((_, i) => (i % width === 6 ? 250 : i % width >= 9 ? 40 : 0)),
      width,
      height,
    );
    const flight = shot();
    const path = shotPath(flight, hill);
    expect(path.fromLift).toBe(0);
    expect(path.toLift).toBeGreaterThan(0);
    expect(shotPoseAt(path, flight, SIXTEEN_POINT_FLIGHT_TICKS).lift).toBeCloseTo(path.toLift);
    // Over the ridge the stone stays above the ground under it.
    const overRidge = shotPoseAt(path, flight, SIXTEEN_POINT_FLIGHT_TICKS / 2);
    expect(overRidge.lift).toBeGreaterThan(hill.liftAt(6, 4));
  });
});

describe('particle frames', () => {
  const rock: ParticleRef = {
    layer: 'ls_smoke.rock03',
    valencies: [[212, 213, 214]],
    loop: true,
    directional: false,
  };
  const puff: ParticleRef = {
    layer: 'ls_smoke.smoke',
    valencies: [[4, 3, 2]],
    loop: false,
    directional: false,
  };

  it('loops a looping particle a frame per tick and ends a one-shot after its last frame', () => {
    expect([0, 1, 2, 3, 4.5].map((age) => particleFrame(rock, age))).toEqual([212, 213, 214, 212, 213]);
    expect([0, 2, 3].map((age) => particleFrame(puff, age))).toEqual([4, 2, undefined]);
  });

  it('turns a heading counter-clockwise from screen-down onto its valencies, as the arrow sheet is drawn', () => {
    const down = Math.PI / 2;
    expect(headingValency(down, 32)).toBe(0);
    expect(headingValency(0, 32)).toBe(8); // screen-east, a quarter turn counter-clockwise
    expect(headingValency(-Math.PI / 2, 32)).toBe(16); // screen-up
    expect(headingValency(Math.PI, 32)).toBe(24); // screen-west, from either side of the branch cut
    expect(headingValency(-Math.PI, 32)).toBe(24);
  });
});
