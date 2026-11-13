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
  /** Draw `ticks` of frames, four a tick, the walker moving `speed` px a tick to the right. */
  const run = (entity: WorldSnapshot['entities'][number], ticks: number, speed: number, from = 0) => {
    for (let step = 0; step <= ticks * 4; step++) {
      const time = from + step / 4;
      layer.draw({
        snapshot: snapshotOf([entity], Math.floor(time)),
        walkers: [{ ref: WALKER, marksGround: true }],
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
});
