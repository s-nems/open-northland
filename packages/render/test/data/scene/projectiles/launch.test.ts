import { describe, expect, it } from 'vitest';
import { collectSpriteScene, IncrementalScene } from '../../../../src/data/scene/build/sprite-scene.js';
import { COVER_LAUNCH_HEIGHT_PX } from '../../../../src/data/scene/index.js';
import { BOW_LAUNCH } from '../../../../src/data/scene/projectiles/arc.js';
import {
  deckLaunch,
  type FiringPost,
  postLaunch,
  ShotLaunches,
} from '../../../../src/data/scene/projectiles/launch.js';
import { ONE } from '../../../../src/index.js';
import { entity, snapshotOf } from '../../../support/fixtures.js';

/** Render facings in the `CR_Hum_Body` order: 4 is east, 7 north. */
const EAST = 4;
const NORTH = 7;
/** `Vehicle.facing` in the source's `<dir>` ring: 0 is east, 6 north. */
const GFX_EAST = 0;
const GFX_NORTH = 6;

describe('shot launch', () => {
  it('leaves a garrison shot from the half of its firing level that faces the mark', () => {
    const post = { x: -4, y: -150, halfWidth: 40 };
    const east = postLaunch(post, { x: 100, y: 0 }, 0);
    expect(east.dx).toBeCloseTo(post.x + post.halfWidth);
    expect(east.dy).toBeCloseTo(0);
    expect(east.height).toBe(-post.y);
    expect(postLaunch(post, { x: -100, y: 0 }, 0).dx).toBeCloseTo(post.x - post.halfWidth);
    for (const spread of [-1, -0.5, 0.5, 1]) {
      expect(postLaunch(post, { x: 100, y: 0 }, spread).dx).toBeGreaterThanOrEqual(post.x - 1e-9);
    }
  });

  it("leaves a garrison shot from its building's measured post, else from the default height", () => {
    const tower = entity(20, 1, 1, { Building: { buildingType: 40, tribe: 2 } });
    const shot = entity(21, 1, 1, {
      Projectile: {
        source: 20,
        target: null,
        munitionType: 1,
        originX: ONE,
        originY: ONE,
        aimX: 5 * ONE,
        aimY: ONE,
        cover: 20,
        launchTick: 5,
        impact: null,
      },
    });
    const post: FiringPost = { x: 0, y: -210, halfWidth: 40 };
    const liftWith = (found: FiringPost | undefined) =>
      collectSpriteScene(snapshotOf([tower, shot]), {
        firingPosts: (tribe, type) => (tribe === 2 && type === 40 ? found : undefined),
      }).items.find((d) => d.ref === 21)?.lift;
    expect(liftWith(post)).toBeCloseTo(-post.y);
    expect(liftWith(undefined)).toBeCloseTo(COVER_LAUNCH_HEIGHT_PX);
  });

  it('spreads deck shots along the hull the ship faces, from the rail on the mark side', () => {
    const towardViewer = { x: 0, y: 100 };
    const bow = deckLaunch(EAST, towardViewer, 1);
    const stern = deckLaunch(EAST, towardViewer, -1);
    expect(bow.dx).toBeGreaterThan(0);
    expect(stern.dx).toBeCloseTo(-bow.dx);
    expect(bow.dy).toBeGreaterThan(0);
    expect(Math.abs(bow.dy)).toBeLessThan(Math.abs(bow.dx));

    const northBow = deckLaunch(NORTH, { x: 100, y: 0 }, 1);
    expect(northBow.dy).toBeLessThan(0);
    expect(northBow.dx).toBeGreaterThan(0);
    expect(Math.abs(northBow.dy)).toBeGreaterThan(Math.abs(northBow.dx));
  });

  it('keeps a deck shot leaving from its first spot when the ship turns and the bowman dies', () => {
    const ship = (gfxFacing: number) => entity(10, 1, 1, { Vehicle: { facing: gfxFacing } });
    const bowman = { id: 11, components: { Rider: { vehicle: 10, boarding: false, leaving: null } } };
    const shot = entity(12, 1, 1, {
      Projectile: {
        source: 11,
        target: null,
        munitionType: 1,
        originX: ONE,
        originY: ONE,
        aimX: 9 * ONE,
        aimY: ONE,
        cover: null,
        launchTick: 5,
        impact: null,
      },
    });
    const arrowAt = (snapshot: ReturnType<typeof snapshotOf>, incremental?: IncrementalScene) => {
      const arrow = collectSpriteScene(snapshot, {}, undefined, undefined, incremental).items.find(
        (d) => d.ref === 12,
      );
      return { x: arrow?.x, y: arrow?.y, lift: arrow?.lift };
    };
    const incremental = new IncrementalScene();
    const first = arrowAt(snapshotOf([ship(GFX_EAST), bowman, shot]), incremental);
    const later = snapshotOf([ship(GFX_NORTH), shot]);
    expect(arrowAt(later, incremental)).toEqual(first);
    // Read afresh, the same shot has lost its bowman and leaves from the bow height on the ship's anchor.
    expect(arrowAt(later).lift).toBeLessThan(first.lift ?? 0);
  });

  it("draws the arrow of its shooter's trade, kept after the shooter dies", () => {
    const long = { length: 1.3, thickness: 1.2 };
    const short = { length: 0.8, thickness: 1 };
    const LONG_BOWMAN = 41;
    const TRIBE = 2;
    const archer = entity(30, 1, 1, { Settler: { tribe: TRIBE, jobType: LONG_BOWMAN } });
    const shot = entity(31, 1, 1, {
      Projectile: {
        source: 30,
        target: null,
        munitionType: 1,
        originX: ONE,
        originY: ONE,
        aimX: 9 * ONE,
        aimY: ONE,
        cover: null,
        launchTick: 5,
        impact: null,
      },
    });
    const shapeIn = (snapshot: ReturnType<typeof snapshotOf>, incremental?: IncrementalScene) =>
      collectSpriteScene(
        snapshot,
        { shotShapes: (tribe, job) => (tribe === TRIBE && job === LONG_BOWMAN ? long : short) },
        undefined,
        undefined,
        incremental,
      ).items.find((d) => d.ref === 31)?.shotShape;
    const incremental = new IncrementalScene();
    expect(shapeIn(snapshotOf([archer, shot]), incremental)).toBe(long);
    expect(shapeIn(snapshotOf([shot]), incremental)).toBe(long);
    expect(shapeIn(snapshotOf([shot]))).toBe(short);
  });

  it('forgets a held look once its shot has landed', () => {
    const launches = new ShotLaunches();
    const look = { launch: BOW_LAUNCH };
    launches.hold(12, 5, look);
    launches.forgetLanded(snapshotOf([entity(12, 1, 1, {})]));
    expect(launches.of(12, 5)).toBe(look);
    launches.forgetLanded(snapshotOf([]));
    expect(launches.of(12, 5)).toBeUndefined();
  });
});
