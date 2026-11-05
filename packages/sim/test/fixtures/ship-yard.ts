import type { FootprintCell } from '@open-northland/data';

const cells = (pairs: readonly (readonly [number, number])[]): FootprintCell[] =>
  pairs.map(([dx, dy]) => ({ dx, dy }));

/** The real small-ship yard body (house 44): rows -2..2, five wide at the middle. */
export const SHIP_HULL: readonly FootprintCell[] = cells([
  [-1, -2],
  [0, -2],
  [1, -2],
  [-2, -1],
  [-1, -1],
  [0, -1],
  [1, -1],
  [-2, 0],
  [-1, 0],
  [0, 0],
  [1, 0],
  [2, 0],
  [-2, 1],
  [-1, 1],
  [0, 1],
  [1, 1],
  [-1, 2],
  [0, 2],
  [1, 2],
]);

/** The real small-ship yard's door, three rows south of the anchor. */
export const SHIP_DOOR: FootprintCell = { dx: -2, dy: 3 };

/** The real small-ship yard's construction work area: the ring two cells out from the hull. */
export const SHIP_WORK_AREA: readonly FootprintCell[] = cells([
  [-2, -4],
  [-1, -4],
  [0, -4],
  [1, -4],
  [2, -4],
  [-3, -3],
  [2, -3],
  [-3, -2],
  [3, -2],
  [-4, -1],
  [3, -1],
  [-4, 0],
  [4, 0],
  [-4, 1],
  [3, 1],
  [-3, 2],
  [3, 2],
  [-3, 3],
  [2, 3],
  [-2, 4],
  [-1, 4],
  [0, 4],
  [1, 4],
  [2, 4],
]);
