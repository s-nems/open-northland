import { describe, expect, it } from 'vitest';
import {
  COVER_LAUNCH_HEIGHT_PX,
  PROJECTILE_ARC_PEAK_FRACTION,
  PROJECTILE_ARC_PEAK_MAX_PX,
} from '../../src/data/scene/index.js';
import { buildScene, ONE, tileToScreen } from '../../src/index.js';
import { entity, FLAT_3x2, snapshotOf } from '../support/fixtures.js';

describe('buildScene - projectile arc & aim', () => {
  it('classifies an in-flight Projectile and aims its rotation at the target', () => {
    // A target one column east makes the screen heading (+x, 0), which is 0 rad.
    const shot = entity(1, 1, 1, {
      Projectile: { target: 2, source: 3, damage: 34, speed: 8, munitionType: 1 },
    });
    const target = entity(2, 2, 1, { Settler: { tribe: 0 } });
    const scene = buildScene(snapshotOf([shot, target]), FLAT_3x2);
    const arrow = scene.find((d) => d.kind === 'projectile');
    expect(arrow?.ref).toBe(1);
    expect(arrow?.rotation).toBeCloseTo(0);
  });

  it('a projectile whose target left the snapshot draws with no rotation (never a throw)', () => {
    const shot = entity(1, 1, 1, {
      Projectile: { target: 99, source: 3, damage: 34, speed: 8, munitionType: 1 },
    });
    const scene = buildScene(snapshotOf([shot]), FLAT_3x2);
    expect(scene.find((d) => d.kind === 'projectile')?.rotation).toBeUndefined();
  });

  function projectileFrom(target: number, ox: number, oy: number): Record<string, unknown> {
    return {
      Projectile: {
        target,
        source: 3,
        damage: 34,
        speed: 8,
        munitionType: 1,
        originX: ox * ONE,
        originY: oy * ONE,
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
    const shot = entity(1, 6, 1, projectileFrom(2, 0, 1));
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
});
