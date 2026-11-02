import type { FogGhost, RememberedMarkers } from '@open-northland/render';
import { FOG_MODE, FOG_STATE, type FogView, fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  knownBuildings,
  type LabelBox,
  type LabelSpot,
  type OwnedSpot,
  peopleOf,
  settlementsOf,
  spreadLabels,
} from '../../../src/hud/diplomacy-map/places.js';
import type { Rect } from '../../../src/hud/geometry.js';
import { type Ent, snapshotOf } from '../../support/snapshot.js';

const MAP_CELLS = 8;
const VIEWER = 0;
const FOE = 2;
/** Fog splits the test map here: `VISIBLE` west of the column, the given state east of it. */
const SIGHT_EDGE = 4;

const at = (x: number, y: number) => ({ Position: { x: fx.fromInt(x), y: fx.fromInt(y) } });

function building(id: number, player: number, x: number, y: number): Ent {
  return { id, components: { Building: {}, Owner: { player }, ...at(x, y) } };
}

function fogWest(east: number): FogView {
  return {
    player: VIEWER,
    mode: FOG_MODE.RECON_FOG_OF_WAR,
    cellsWide: MAP_CELLS,
    cellsHigh: MAP_CELLS,
    generation: 1,
    stateAt: (cellX) => (cellX < SIGHT_EDGE ? FOG_STATE.VISIBLE : east),
  };
}

function memoryOf(...ghosts: FogGhost[]): RememberedMarkers {
  return {
    markers: (out) => {
      out.push(...ghosts);
      return out;
    },
  };
}

describe('knownBuildings', () => {
  it('leaks no live building off visible ground, on unseen or merely explored cells', () => {
    const world = snapshotOf([building(1, FOE, 2, 3), building(2, FOE, 6, 5)]);
    const seen = [{ owner: FOE, col: 2, row: 3 }];
    expect(knownBuildings(world, fogWest(FOG_STATE.UNEXPLORED), undefined)).toEqual(seen);
    expect(knownBuildings(world, fogWest(FOG_STATE.EXPLORED), undefined)).toEqual(seen);
  });

  it('adds what memory holds, skipping other kinds and ownerless ghosts', () => {
    const memory = memoryOf(
      { ref: 5, kind: 'building', tileX: 6, tileY: 4, owner: FOE },
      { ref: 6, kind: 'vehicle', tileX: 5, tileY: 6, owner: FOE },
      { ref: 7, kind: 'building', tileX: 7, tileY: 2 },
    );
    expect(knownBuildings(snapshotOf([]), fogWest(FOG_STATE.EXPLORED), memory)).toEqual([
      { owner: FOE, col: 6, row: 4 },
    ]);
  });

  it('answers the whole live world and no memory when there is no fog', () => {
    const world = snapshotOf([
      building(1, FOE, 6, 5),
      { id: 2, components: { Building: {}, ...at(1, 1) } },
      { id: 3, components: { Building: {}, Owner: { player: FOE } } },
      { id: 4, components: { Settler: {}, Owner: { player: FOE }, ...at(2, 2) } },
    ]);
    const memory = memoryOf({ ref: 9, kind: 'building', tileX: 3, tileY: 3, owner: FOE });
    expect(knownBuildings(world, null, memory)).toEqual([{ owner: FOE, col: 6, row: 5 }]);
  });

  it('keeps the fraction of a position between tiles', () => {
    const position = { Position: { x: fx.fromFloat(1.5), y: fx.fromInt(2) } };
    const hut = { id: 1, components: { Building: {}, Owner: { player: 1 }, ...position } };
    expect(knownBuildings(snapshotOf([hut]), null, undefined)).toEqual([{ owner: 1, col: 1.5, row: 2 }]);
  });
});

describe('peopleOf', () => {
  it("lists only the owner's people, leaving out its wildlife", () => {
    const world = snapshotOf([
      { id: 1, components: { Settler: {}, Person: {}, Owner: { player: VIEWER }, ...at(1, 2) } },
      { id: 2, components: { Settler: {}, Owner: { player: VIEWER }, ...at(3, 3) } },
      { id: 3, components: { Settler: {}, Person: {}, Owner: { player: FOE }, ...at(4, 4) } },
      building(4, VIEWER, 5, 5),
    ]);
    expect(peopleOf(world, VIEWER)).toEqual([{ owner: VIEWER, col: 1, row: 2 }]);
  });
});

const FAR = 200;
const NEAR_BUCKET_EDGE = 31;
const JUST_PAST_BUCKET_EDGE = 33;

/** `count` buildings of `owner` in a tight row starting at `(col, row)`. */
function village(owner: number, col: number, row: number, count: number): OwnedSpot[] {
  return Array.from({ length: count }, (_, n) => ({ owner, col: col + n, row }));
}

describe('settlementsOf', () => {
  it('answers each far village of one owner at its centroid, largest first', () => {
    const buildings = [...village(1, 0, 0, 3), ...village(1, FAR, FAR, 4)];
    expect(settlementsOf(buildings)).toEqual([
      { owner: 1, col: FAR + 1.5, row: FAR, buildings: 4 },
      { owner: 1, col: 1, row: 0, buildings: 3 },
    ]);
  });

  it('merges buildings in neighbouring grid buckets, diagonals too', () => {
    const buildings = [
      { owner: 1, col: NEAR_BUCKET_EDGE, row: NEAR_BUCKET_EDGE },
      { owner: 1, col: JUST_PAST_BUCKET_EDGE, row: JUST_PAST_BUCKET_EDGE },
    ];
    expect(settlementsOf(buildings)).toEqual([{ owner: 1, col: 32, row: 32, buildings: 2 }]);
  });

  it('keeps owners apart however close their buildings stand', () => {
    const owners = settlementsOf([...village(2, 0, 0, 3), ...village(1, 0, 1, 3)]);
    expect(owners.map((settlement) => settlement.owner)).toEqual([1, 2]);
  });

  it('drops a lone outpost beside a village but keeps it when it is all the owner has', () => {
    const outpost = { owner: 1, col: FAR, row: FAR };
    expect(settlementsOf([...village(1, 0, 0, 3), outpost])).toEqual([
      { owner: 1, col: 1, row: 0, buildings: 3 },
    ]);
    expect(settlementsOf([outpost])).toEqual([{ owner: 1, col: FAR, row: FAR, buildings: 1 }]);
  });

  it('answers the same whatever the input order, equal villages falling west first', () => {
    const buildings = [
      ...village(2, 0, 0, 3),
      ...village(1, FAR, 0, 3),
      ...village(1, 0.1, 0.7, 3),
      { owner: 1, col: 0.3, row: 0.2 },
    ];
    const forward = settlementsOf(buildings);
    expect(settlementsOf([...buildings].reverse())).toEqual(forward);
    expect(settlementsOf([...buildings.slice(4), ...buildings.slice(0, 4)])).toEqual(forward);
    const equal = settlementsOf([...village(1, FAR, 0, 3), ...village(1, 0, 0, 3)]);
    expect(equal.map((settlement) => settlement.col)).toEqual([1, FAR + 1]);
  });
});

const BOUNDS: Rect = { x: 0, y: 0, w: 400, h: 300 };
const LABEL_W = 60;
const LABEL_H = 20;

function label(key: string, x: number, y: number): LabelBox {
  return { key, x, y, w: LABEL_W, h: LABEL_H };
}

function overlapCount(boxes: readonly LabelBox[], spots: readonly LabelSpot[]): number {
  const placed = boxes.map((box, n) => ({ ...box, ...spots[n] }));
  let overlaps = 0;
  for (const [n, a] of placed.entries()) {
    for (const b of placed.slice(n + 1)) {
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++;
    }
  }
  return overlaps;
}

function allInside(boxes: readonly LabelBox[], spots: readonly LabelSpot[], bounds: Rect): boolean {
  return boxes.every((box, n) => {
    const spot = spots[n];
    return (
      spot !== undefined &&
      spot.x >= bounds.x &&
      spot.y >= bounds.y &&
      spot.x + box.w <= bounds.x + bounds.w &&
      spot.y + box.h <= bounds.y + bounds.h
    );
  });
}

describe('spreadLabels', () => {
  it('keeps labels off the regions it is told to', () => {
    const keepOut = { x: 90, y: 0, w: 100, h: 100 };
    const [spot] = spreadLabels([{ key: 'a', x: 100, y: 10, w: 40, h: 20 }], BOUNDS, [keepOut]);
    expect(spot).toBeDefined();
    const clear =
      (spot?.x ?? 0) + 40 <= keepOut.x ||
      (spot?.x ?? 0) >= keepOut.x + keepOut.w ||
      (spot?.y ?? 0) >= keepOut.y + keepOut.h;
    expect(clear).toBe(true);
  });

  it('leaves boxes alone that neither overlap nor cross the bounds, touching ones included', () => {
    const boxes = [label('a', 10, 10), label('b', 10 + LABEL_W, 10), label('c', 100, 100)];
    expect(spreadLabels(boxes, BOUNDS)).toEqual(boxes.map(({ key, x, y }) => ({ key, x, y })));
  });

  it('moves the later key to its nearest free spot, the shorter way out of the overlap', () => {
    expect(spreadLabels([label('a', 100, 100), label('b', 100, 110)], BOUNDS)).toEqual([
      { key: 'a', x: 100, y: 100 },
      { key: 'b', x: 100, y: 120 },
    ]);
  });

  it('pulls a box outside the bounds back in', () => {
    expect(spreadLabels([label('a', -5, BOUNDS.h)], BOUNDS)).toEqual([
      { key: 'a', x: 0, y: BOUNDS.h - LABEL_H },
    ]);
  });

  it('goes the longer way when the shorter one leaves the bounds', () => {
    expect(spreadLabels([label('a', 0, 5), label('b', 0, 0)], BOUNDS)).toEqual([
      { key: 'a', x: 0, y: 5 },
      { key: 'b', x: 0, y: 5 + LABEL_H },
    ]);
  });

  it('untangles a pile on one spot, inside the bounds, whatever the input order', () => {
    const boxes = Array.from({ length: 32 }, (_, n) => label(`nation-${n}`, 170, 140));
    const spots = spreadLabels(boxes, BOUNDS);
    expect(overlapCount(boxes, spots)).toBe(0);
    expect(allInside(boxes, spots, BOUNDS)).toBe(true);

    const reversed = spreadLabels([...boxes].reverse(), BOUNDS);
    expect(reversed.reverse()).toEqual(spots);
  });

  it('moves a box to the next row when its own row is full', () => {
    const row: Rect = { x: 0, y: 0, w: LABEL_W * 3, h: LABEL_H * 4 };
    const boxes = ['a', 'b', 'c', 'd'].map((key, n) => label(key, n * (LABEL_W - 10), 0));
    const spots = spreadLabels(boxes, row);
    expect(overlapCount(boxes, spots)).toBe(0);
    expect(allInside(boxes, spots, row)).toBe(true);
  });

  it('stops on a layout that cannot fit, keeping every box in as far as it fits', () => {
    const tiny: Rect = { x: 0, y: 0, w: LABEL_W, h: LABEL_H };
    const boxes = [label('a', 0, 0), label('b', 0, 0), label('c', 0, 0)];
    const spots = spreadLabels(boxes, tiny);
    expect(spots).toEqual(boxes.map(({ key, x, y }) => ({ key, x, y })));

    const oversized = { key: 'wide', x: 5, y: 5, w: BOUNDS.w * 2, h: LABEL_H };
    expect(spreadLabels([oversized], BOUNDS)).toEqual([{ key: 'wide', x: BOUNDS.x, y: 5 }]);
  });
});
