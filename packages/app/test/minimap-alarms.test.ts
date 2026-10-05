import { terrainWorldBounds } from '@open-northland/render';
import { positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { ALARM_MS, alarmPoint, alarmRing } from '../src/hud/minimap/alarms.js';
import { forEachMinimapDot } from '../src/hud/minimap/dots.js';
import { DEFAULT_MINIMAP_FILTERS } from '../src/hud/minimap/filters.js';
import { snapshotOf } from './support/snapshot.js';

const MAP_CELLS = 8;
const BOUNDS = terrainWorldBounds(MAP_CELLS, MAP_CELLS);
const SCALE = 0.5;
const VIEWER = 0;
const CIVILIAN_JOB = 7;

describe('alarmRing', () => {
  it('closes in on the hit at full strength, fades at the end, then is gone', () => {
    const opening = alarmRing(0);
    const middle = alarmRing(ALARM_MS / 2);
    const closing = alarmRing(ALARM_MS - 1);
    expect(opening?.alpha).toBe(1);
    expect(middle?.alpha).toBe(1);
    expect(closing?.alpha).toBeLessThan(0.01);
    expect(opening?.radius).toBeGreaterThan(middle?.radius ?? Number.POSITIVE_INFINITY);
    expect(middle?.radius).toBeGreaterThan(closing?.radius ?? Number.POSITIVE_INFINITY);
    expect(alarmRing(ALARM_MS)).toBeNull();
    expect(alarmRing(-1)).toBeNull();
  });
});

describe('alarmPoint', () => {
  it('centres on the raster px where a marker standing on the same node is stamped', () => {
    for (const at of [
      { hx: 3, hy: 4 },
      { hx: 6, hy: 7 },
    ]) {
      const dots: { bx: number; by: number }[] = [];
      const person = {
        id: 1,
        components: {
          Settler: { jobType: CIVILIAN_JOB },
          Person: { person: true },
          Owner: { player: VIEWER },
          Position: positionOfNode(at.hx, at.hy),
        },
      };
      forEachMinimapDot(
        snapshotOf([person]),
        {
          fog: null,
          bounds: BOUNDS,
          scale: SCALE,
          filters: DEFAULT_MINIMAP_FILTERS,
          isFighterJob: () => false,
          viewer: VIEWER,
          stanceToward: () => 'neutral',
        },
        (bx, by, _mark, _colour, part) => {
          if (part === 'fills') dots.push({ bx, by });
        },
      );
      const point = alarmPoint(at, BOUNDS, SCALE);
      expect(dots).toEqual([{ bx: point.x, by: point.y }]);
    }
  });
});
