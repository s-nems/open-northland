import { fx, nodeOfPosition, positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { BuildingDoorInfo } from '../src/view/projections/index.js';
import { computeConstructionSigns } from '../src/view/projections/index.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/**
 * computeConstructionSigns - one player-coloured construction stand per building carrying
 * `UnderConstruction` (a fresh build or a running upgrade), planted at the type's `GfxFlagPoint` sign
 * post when the content has one, else at the DOOR node itself (the stand marks the site entrance).
 */

/** A building site at tile `(x, y)`: a Building + Position + UnderConstruction, optionally owned. */
function site(id: number, typeId: number, x: number, y: number, player?: number): Ent {
  return {
    id,
    components: {
      Building: { buildingType: typeId },
      Position: { x: fx.fromInt(x), y: fx.fromInt(y) },
      UnderConstruction: { labor: 0 },
      ...(player !== undefined ? { Owner: { player } } : {}),
    },
  };
}

describe('computeConstructionSigns', () => {
  it('plants one sign per under-construction building at its door node, carrying the owner slot', () => {
    const types = new Map<number, BuildingDoorInfo>([[7, { footprint: { door: { dx: 0, dy: 2 } } }]]);
    const snap = snapshotOf([site(1, 7, 4, 4, 3)]);

    const signs = computeConstructionSigns(snap, types);

    expect(signs).toHaveLength(1);
    const anchor = nodeOfPosition(fx.fromInt(4), fx.fromInt(4));
    const door = positionOfNode(anchor.hx + 0, anchor.hy + 2);
    expect(signs[0]).toEqual({ id: 1, x: door.x, y: door.y, player: 3 });
  });

  it('plants at the building position + GfxFlagPoint px offset when the type carries one', () => {
    const types = new Map<number, BuildingDoorInfo>([
      [7, { footprint: { door: { dx: 0, dy: 2 } }, flagPoint: { x: -6, y: 29 } }],
    ]);
    const signs = computeConstructionSigns(snapshotOf([site(1, 7, 4, 4, 3)]), types);
    expect(signs).toEqual([{ id: 1, x: fx.fromInt(4), y: fx.fromInt(4), dx: -6, dy: 29, player: 3 }]);
  });

  it('emits nothing for a completed building, and anchors a doorless type at its anchor node', () => {
    const done: Ent = {
      id: 1,
      components: { Building: { buildingType: 7 }, Position: { x: fx.fromInt(4), y: fx.fromInt(4) } },
    };
    expect(computeConstructionSigns(snapshotOf([done]), new Map())).toEqual([]);

    const signs = computeConstructionSigns(snapshotOf([site(2, 9, 6, 2)]), new Map());
    const anchor = nodeOfPosition(fx.fromInt(6), fx.fromInt(2));
    const pos = positionOfNode(anchor.hx, anchor.hy);
    expect(signs).toEqual([{ id: 2, x: pos.x, y: pos.y }]);
  });
});
