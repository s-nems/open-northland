import { describe, expect, it } from 'vitest';
import {
  COVER_LAUNCH_HEIGHT_PX,
  PROJECTILE_ARC_PEAK_FRACTION,
  PROJECTILE_ARC_PEAK_MAX_PX,
} from '../../src/data/scene/index.js';
import { headingValency } from '../../src/data/sprites/index.js';
import { buildScene, ONE, tileToScreen } from '../../src/index.js';
import { entity, FLAT_3x2, snapshotOf } from '../support/fixtures.js';

describe('buildScene - projectile arc & aim', () => {
  it('classifies an in-flight Projectile and aims its rotation at the target', () => {
    // A target one column east makes the screen heading (+x, 0), which is 0 rad.
    const shot = entity(1, 1, 1, {
      Projectile: {
        target: 2,
        source: 3,
        damage: 34,
        speed: 8,
        munitionType: 1,
        aimX: 2 * ONE,
        aimY: ONE,
      },
    });
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([shot, target]), FLAT_3x2);
    const arrow = scene.find((d) => d.kind === 'projectile');
    expect(arrow?.ref).toBe(1);
    expect(arrow?.rotation).toBeCloseTo(0);
  });

  it('a projectile with no readable frozen aim draws with no rotation (never a throw)', () => {
    const shot = entity(1, 1, 1, {
      Projectile: { target: 99, source: 3, damage: 34, speed: 8, munitionType: 1 },
    });
    const scene = buildScene(snapshotOf([shot]), FLAT_3x2);
    expect(scene.find((d) => d.kind === 'projectile')?.rotation).toBeUndefined();
  });

  function projectileFrom(target: number, ox: number, oy: number, ax = 2, ay = 1): Record<string, unknown> {
    return {
      Projectile: {
        target,
        source: 3,
        damage: 34,
        speed: 8,
        munitionType: 1,
        originX: ox * ONE,
        originY: oy * ONE,
        aimX: ax * ONE,
        aimY: ay * ONE,
      },
    };
  }

  it('lobs a projectile with a readable origin: peak lift at mid-chord, level tangent, depth untouched', () => {
    // Origin (0,1) to target (2,1) is a 2-cell chord of 136 px, and the shot sits exactly halfway, so
    // p = 0.5: the lift is the parabola's peak and the tangent slope is 0.
    const shot = entity(1, 1, 1, projectileFrom(2, 0, 1));
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    // A control shot with no readable origin, and so no arc, on the same cell: the arc must ride the
    // lift channel only, or mid-lob occlusion order reshuffles.
    const flatShot = entity(4, 1, 1, {
      Projectile: { target: 2, source: 3, damage: 34, speed: 8, munitionType: 1 },
    });
    const scene = buildScene(snapshotOf([shot, target, flatShot]), FLAT_3x2);
    const arrow = scene.find((d) => d.kind === 'projectile' && d.ref === 1);
    const chord = tileToScreen(2, 1).x - tileToScreen(0, 1).x;
    expect(arrow?.lift).toBeCloseTo(chord * PROJECTILE_ARC_PEAK_FRACTION); // 4·peak·½·½ = peak at mid-flight
    expect(arrow?.rotation).toBeCloseTo(0); // level at the apex
    const flat = scene.find((d) => d.kind === 'projectile' && d.ref === 4);
    expect(arrow?.depth).toBe(flat?.depth);
  });

  it('caps the lob peak on a long chord (a max-range shot must not leave the screen)', () => {
    // A 12-cell chord of 816 px has a fractional peak of ~98 px, over the cap, and the shot sits at
    // mid-flight.
    const shot = entity(1, 6, 1, projectileFrom(2, 0, 1, 12, 1));
    const target = entity(2, 12, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([shot, target]), FLAT_3x2);
    const chord = tileToScreen(12, 1).x - tileToScreen(0, 1).x;
    expect(chord * PROJECTILE_ARC_PEAK_FRACTION).toBeGreaterThan(PROJECTILE_ARC_PEAK_MAX_PX); // the cap really binds
    expect(scene.find((d) => d.kind === 'projectile')?.lift).toBeCloseTo(PROJECTILE_ARC_PEAK_MAX_PX);
  });

  /** The same payload, loosed from building `cover`'s gallery instead of open ground. */
  function coveredProjectileFrom(
    target: number,
    ox: number,
    oy: number,
    cover: number,
  ): Record<string, unknown> {
    const payload = projectileFrom(target, ox, oy);
    return { Projectile: { ...(payload.Projectile as Record<string, unknown>), cover } };
  }

  it('drops a garrison shot down the gallery height: full at the bow, nearly spent near the mark', () => {
    // Over the same 2-cell chord as the lob above: a shot still at the tower (p = 0) hangs at the
    // gallery's full height, where the ground lob reads 0, and one at (1.8, 1) (p = 0.9) has fallen to
    // h·(1−p²) of it.
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const bowScene = buildScene(
      snapshotOf([entity(1, 0, 1, coveredProjectileFrom(2, 0, 1, 9)), target]),
      FLAT_3x2,
    );
    expect(bowScene.find((d) => d.kind === 'projectile')?.lift).toBeCloseTo(COVER_LAUNCH_HEIGHT_PX);

    const nearScene = buildScene(
      snapshotOf([entity(1, 1.8, 1, coveredProjectileFrom(2, 0, 1, 9)), target]),
      FLAT_3x2,
    );
    const spent = COVER_LAUNCH_HEIGHT_PX * (1 - 0.9 ** 2);
    expect(nearScene.find((d) => d.kind === 'projectile')?.lift).toBeCloseTo(spent);
  });

  it('never tilts a garrison shot nose-UP: it leaves the gallery level and only steepens downward', () => {
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const near = buildScene(
      snapshotOf([entity(1, 0.5, 1, coveredProjectileFrom(2, 0, 1, 9)), target]),
      FLAT_3x2,
    );
    const far = buildScene(
      snapshotOf([entity(1, 1.5, 1, coveredProjectileFrom(2, 0, 1, 9)), target]),
      FLAT_3x2,
    );
    // Eastbound, so screen-down is a positive rotation: nose already dipping, and dipping harder later.
    const nearRotation = near.find((d) => d.kind === 'projectile')?.rotation ?? 0;
    const farRotation = far.find((d) => d.kind === 'projectile')?.rotation ?? 0;
    expect(nearRotation).toBeGreaterThan(0);
    expect(farRotation).toBeGreaterThan(nearRotation);
  });

  it('tilts a descending projectile nose-DOWN along the arc tangent past mid-flight', () => {
    // Three quarters of the way along the chord the parabola is falling, so an eastbound shot's heading
    // tilts screen-down into a positive rotation instead of the flat 0.
    const shot = entity(1, 1.5, 1, projectileFrom(2, 0, 1));
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([shot, target]), FLAT_3x2);
    const arrow = scene.find((d) => d.kind === 'projectile');
    expect(arrow?.rotation ?? 0).toBeGreaterThan(0);
    expect(arrow?.lift ?? 0).toBeGreaterThan(0); // still airborne
  });

  /** The sim's whole `Projectile` payload for a bow shot loosed from `(ox, oy)` at `(ax, ay)`, so the
   *  readers see the exact shape a snapshot carries. */
  function bowShot(ox: number, oy: number, ax: number, ay: number): Record<string, unknown> {
    return {
      Projectile: {
        source: 3,
        target: 2,
        player: 0,
        hitSelf: false,
        area: false,
        damage: { '1': 34 },
        hitSounds: {},
        weaponMainType: 6,
        missSounds: {},
        munitionType: 1,
        originX: ox * ONE,
        originY: oy * ONE,
        aimX: ax * ONE,
        aimY: ay * ONE,
        cover: null,
        launchTick: 10,
        landTick: 20,
        impact: null,
      },
    };
  }

  it('flies a ground lob with its nose tangent: up off the bow, level at the peak, down into the mark', () => {
    // A 6-cell eastbound chord, sampled at a tenth, a half and nine tenths flown; the sheet's east frame
    // is valency 8, its neighbours above and below 10 and 6.
    const target = entity(2, 6, 1, { Settler: { tribe: 0 } });
    const drawAt = (x: number) =>
      buildScene(snapshotOf([entity(1, x, 1, bowShot(0, 1, 6, 1)), target]), FLAT_3x2).find(
        (d) => d.kind === 'projectile',
      );
    const rising = drawAt(0.6);
    const apex = drawAt(3);
    const falling = drawAt(5.4);
    expect(rising?.rotation ?? 0).toBeLessThan(0);
    expect(apex?.rotation).toBeCloseTo(0);
    expect(falling?.rotation ?? 0).toBeGreaterThan(0);
    expect(falling?.rotation).toBeCloseTo(-(rising?.rotation ?? 0));
    expect(headingValency(rising?.rotation ?? 0, 32)).toBe(10);
    expect(headingValency(apex?.rotation ?? 0, 32)).toBe(8);
    expect(headingValency(falling?.rotation ?? 0, 32)).toBe(6);
    expect(rising?.lift ?? 0).toBeGreaterThan(0);
    expect(apex?.lift ?? 0).toBeGreaterThan(rising?.lift ?? 0);
    expect(falling?.lift).toBeCloseTo(rising?.lift ?? 0);
  });

  it('keeps a multi-row diagonal on one projected chord instead of following the stagger wave', () => {
    const aim = entity(2, 4, 4, { Settler: { tribe: 0 } });
    const drawAt = (x: number, y: number) => {
      const shot = entity(1, x, y, projectileFrom(2, 0, 0, 4, 4));
      return buildScene(snapshotOf([shot, aim]), FLAT_3x2).find((d) => d.kind === 'projectile');
    };
    const quarter = drawAt(1, 1);
    const half = drawAt(2, 2);
    const threeQuarters = drawAt(3, 3);
    const start = tileToScreen(0, 0);
    const end = tileToScreen(4, 4);

    // Raw projection at the odd rows would shift x by +34 px. The flight path instead samples the
    // stable projected release chord at equal map-space progress.
    expect(quarter?.x).toBeCloseTo(start.x + (end.x - start.x) * 0.25);
    expect(half?.x).toBeCloseTo(start.x + (end.x - start.x) * 0.5);
    expect(threeQuarters?.x).toBeCloseTo(start.x + (end.x - start.x) * 0.75);
    expect((half?.x ?? 0) - (quarter?.x ?? 0)).toBeCloseTo((threeQuarters?.x ?? 0) - (half?.x ?? 0));
  });
});
