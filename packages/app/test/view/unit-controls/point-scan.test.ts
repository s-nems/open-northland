import type { DrawItem, EntityBounds } from '@open-northland/render';
import { expect, it, vi } from 'vitest';
import { createPointScan } from '../../../src/view/unit-controls/point-scan.js';

const item = (ref: number, kind: DrawItem['kind'], x: number, y: number, more: Partial<DrawItem> = {}) =>
  ({ ref, kind, x, y, ...more }) as DrawItem;

const box = (x: number, y: number): EntityBounds => ({ minX: x - 5, maxX: x + 5, minY: y - 5, maxY: y + 5 });

it('keeps the hit targets whose box holds the point, in draw order, and every drawn resource', () => {
  const drawn = [
    item(1, 'settler', 100, 100),
    item(2, 'settler', 300, 100),
    item(3, 'settler', 100, 100, { ghost: true }),
    item(4, 'resource', 300, 300),
    item(5, 'roadsite', 107, 100),
    item(6, 'fish', 100, 100),
    item(7, 'stump', 100, 100, { isFlag: true }),
    item(8, 'building', 100, 100, { inHouse: true }),
  ];
  const scanAt = createPointScan({
    drawnItems: () => drawn,
    boundsOf: (ref) => box(drawn[ref - 1]?.x ?? 0, 100),
  });
  const scan = scanAt(100, 100);
  // The road plot's box ends 2 px short of the point and reaches it by its margin.
  expect(scan.items.map((i) => i.ref)).toEqual([1, 5, 7]);
  expect([...scan.resources]).toEqual([4]);
});

it('walks the frame once for one point in a task, and again for another point, frame or task', async () => {
  let drawn = [item(1, 'settler', 100, 100), item(2, 'building', 300, 100)];
  const boundsOf = vi.fn((_ref: number): EntityBounds | undefined => undefined);
  const scanAt = createPointScan({ drawnItems: () => drawn, boundsOf });

  expect(scanAt(100, 100).items.map((i) => i.ref)).toEqual([1]);
  scanAt(100, 100);
  expect(boundsOf).toHaveBeenCalledTimes(2);

  expect(scanAt(300, 100).items.map((i) => i.ref)).toEqual([2]);
  expect(boundsOf).toHaveBeenCalledTimes(4);

  drawn = [item(3, 'settler', 300, 100)];
  expect(scanAt(300, 100).items.map((i) => i.ref)).toEqual([3]);
  expect(boundsOf).toHaveBeenCalledTimes(5);

  await Promise.resolve();
  scanAt(300, 100);
  expect(boundsOf).toHaveBeenCalledTimes(6);
});
