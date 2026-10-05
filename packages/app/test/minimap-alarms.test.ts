import { terrainWorldBounds } from '@open-northland/render';
import { positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { ALARM_MS, alarmFrame, alarmPoint } from '../src/hud/minimap/alarms.js';
import { forEachMinimapDot } from '../src/hud/minimap/dots.js';
import { DEFAULT_MINIMAP_FILTERS } from '../src/hud/minimap/filters.js';
import { snapshotOf } from './support/snapshot.js';

const MAP_CELLS = 8;
const BOUNDS = terrainWorldBounds(MAP_CELLS, MAP_CELLS);
const SCALE = 0.5;
const VIEWER = 0;
const CIVILIAN_JOB = 7;

describe('alarmFrame', () => {
  it('drops the medallion in with an overshoot, sends out ripples, fades at the end, then is gone', () => {
    const start = alarmFrame(0);
    const dropping = alarmFrame(ALARM_MS / 20);
    const middle = alarmFrame(ALARM_MS / 2);
    const closing = alarmFrame(ALARM_MS - 1);
    expect(start?.pinScale).toBe(0);
    expect(start?.ripples).toEqual([]);
    expect(dropping?.pinScale).toBeGreaterThan(0);
    expect(middle?.pinScale).toBe(1);
    expect(middle?.alpha).toBe(1);
    expect(middle?.ripples.length).toBeGreaterThan(0);
    expect(closing?.alpha).toBeLessThan(0.01);
    expect(alarmFrame(ALARM_MS)).toBeNull();
    expect(alarmFrame(-1)).toBeNull();
  });

  it('overshoots the full medallion while it lands', () => {
    const scales = Array.from({ length: 40 }, (_, i) => alarmFrame(i * 10)?.pinScale ?? 0);
    expect(Math.max(...scales)).toBeGreaterThan(1);
  });

  it('widens each ripple as it fades', () => {
    const early = alarmFrame(ALARM_MS / 10)?.ripples[0];
    const later = alarmFrame(ALARM_MS / 4)?.ripples[0];
    expect(later?.radius).toBeGreaterThan(early?.radius ?? Number.POSITIVE_INFINITY);
    expect(later?.alpha).toBeLessThan(early?.alpha ?? 0);
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
