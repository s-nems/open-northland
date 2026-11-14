import { ONE, type WorldSnapshot } from '@open-northland/sim';
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { WIND_GUST_EVERY_TICKS, WIND_GUST_LIFE_TICKS } from '../../../src/data/effects/index.js';
import type { Viewport } from '../../../src/data/projection/index.js';
import { WindTrailLayer } from '../../../src/gpu/overlays/wind-trail-layer.js';
import { drawnGeometry, snapshotOf } from '../../support/fixtures.js';

const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const WALKER = 4;
const AMULET = 55;
const BOOTS = 30;
const DEPTH = 500;
/** World px a tick: a walk with the amulet. */
const WALK_SPEED = 6;
const FEET_Y = 80;
const FRAMES_PER_TICK = 4;
/** A frame every two ticks: a slow machine on a fast game speed. */
const COARSE_FRAMES_PER_TICK = 0.5;

const carrying = (goodType: number, degreeOfUse = 0) => ({
  id: WALKER,
  components: {
    Equipment: {
      boots: null,
      tool: null,
      weapon: null,
      armor: null,
      misc: [{ goodType, degreeOfUse }, null],
    },
  },
});

function setup(goods: ReadonlySet<number> | null = new Set([AMULET])) {
  const world = new Container();
  const layer = new WindTrailLayer(world);
  layer.setGoods(goods);
  let snapshot: WorldSnapshot | undefined;
  /** Draw `ticks` of frames, `perTick` a tick sharing one snapshot, the walker moving `speed` px a tick
   *  to the right. */
  const run = (
    entity: WorldSnapshot['entities'][number],
    ticks: number,
    speed: number,
    from = 0,
    { perTick = FRAMES_PER_TICK, drawn: walkerDrawn = true } = {},
  ) => {
    for (let step = 0; step <= ticks * perTick; step++) {
      const time = from + step / perTick;
      const tick = Math.floor(time);
      if (snapshot?.tick !== tick) snapshot = snapshotOf([entity], tick);
      layer.draw({
        snapshot,
        walkers: walkerDrawn ? [{ ref: WALKER, marksGround: true }] : [],
        drawn: drawnGeometry({ anchorOf: () => ({ x: time * speed, y: FEET_Y }), depthOf: () => DEPTH }),
        viewport: VIEW_ALL,
        renderTime: time,
      });
    }
  };
  return { world, layer, run };
}

describe('wind trail layer', () => {
  it('trails gusts under a walking carrier, behind it, and lets them die out once it stands', () => {
    const { world, run } = setup();
    const ticks = WIND_GUST_EVERY_TICKS * 4;
    run(carrying(AMULET), ticks, WALK_SPEED);

    expect(world.children.length).toBeGreaterThanOrEqual(3);
    for (const gust of world.children) {
      expect(gust.zIndex).toBeLessThan(DEPTH);
      expect(gust.x).toBeLessThan(ticks * WALK_SPEED);
    }

    run(carrying(AMULET), WIND_GUST_LIFE_TICKS + 1, 0, ticks);
    expect(world.children).toHaveLength(0);
  });

  it('trails nothing for a standing carrier, a spent unit, another good or no goods at all', () => {
    const standing = setup();
    standing.run(carrying(AMULET), 10, 0);
    expect(standing.world.children).toHaveLength(0);

    const spent = setup();
    spent.run(carrying(AMULET, ONE), 10, WALK_SPEED);
    expect(spent.world.children).toHaveLength(0);

    const other = setup();
    other.run(carrying(BOOTS), 10, WALK_SPEED);
    expect(other.world.children).toHaveLength(0);

    const none = setup(null);
    none.run(carrying(AMULET), 10, WALK_SPEED);
    expect(none.world.children).toHaveLength(0);
  });

  it('still trails gusts when a frame spans several ticks', () => {
    const { world, run } = setup();
    run(carrying(AMULET), WIND_GUST_EVERY_TICKS * 4, WALK_SPEED, 0, { perTick: COARSE_FRAMES_PER_TICK });
    expect(world.children.length).toBeGreaterThanOrEqual(2);
  });

  it('raises no more gusts once the carrier is no longer drawn', () => {
    const { world, run } = setup();
    const ticks = WIND_GUST_EVERY_TICKS * 4;
    run(carrying(AMULET), ticks, WALK_SPEED);
    run(carrying(AMULET), WIND_GUST_LIFE_TICKS + 1, WALK_SPEED, ticks, { drawn: false });
    expect(world.children).toHaveLength(0);
  });

  it('drops the gusts of a later time when the clock is rewound, and all of them when cleared', () => {
    const { world, layer, run } = setup();
    const ticks = WIND_GUST_EVERY_TICKS * 4;
    run(carrying(AMULET), ticks, WALK_SPEED, 100);
    expect(world.children.length).toBeGreaterThan(0);
    run(carrying(AMULET), 0, WALK_SPEED, 0);
    expect(world.children).toHaveLength(0);

    run(carrying(AMULET), ticks, WALK_SPEED);
    expect(world.children.length).toBeGreaterThan(0);
    layer.clear();
    expect(world.children).toHaveLength(0);
  });
});
