import { type EntitySnapshot, fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { GOOD_WOOD } from '../src/game/sandbox/ids/index.js';
import { fixedViewerSeat, overseerViewerSeat, switchableViewerSeat } from '../src/game/viewer-seat.js';
import { signpostPanelModel } from '../src/hud/details-panel/model/signpost.js';
import { sandboxCtx, snapshotOf } from './support/sandbox.js';

const post: EntitySnapshot = {
  id: 1,
  components: {
    Owner: { player: 0 },
    Position: { x: fx.fromInt(10), y: fx.fromInt(10) },
    Signpost: { links: [] },
  },
};
const store: EntitySnapshot = {
  id: 2,
  components: {
    Owner: { player: 0 },
    Position: post.components.Position,
    Stockpile: { amounts: [[GOOD_WOOD, 8]] },
  },
};
const snapshot = snapshotOf([post, store]);

describe('signpost panel model', () => {
  it('shows localized goods and counts the selected network', () => {
    const base = sandboxCtx();
    const ctx = {
      ...base,
      goods: base.goods.map((g) => (g.typeId === GOOD_WOOD ? { ...g, name: 'Drewno' } : g)),
      viewer: fixedViewerSeat(0),
    };
    const model = signpostPanelModel(ctx, snapshot, post);
    expect(model.kind).toBe('signpost');
    if (model.kind !== 'signpost') throw new Error('expected signpost');
    expect(model.postCount).toBe(1);
    expect(model.stock).toEqual([
      expect.objectContaining({
        goodType: GOOD_WOOD,
        amount: 8,
        label: ctx.goods.find((g) => g.typeId === GOOD_WOOD)?.name,
      }),
    ]);
    expect(model.canDemolish).toBe(true);
  });

  it('closes the panel when its post becomes foreign, without leaking the new network inventory', () => {
    const taken = { ...post, components: { ...post.components, Owner: { player: 1 } } };
    expect(
      signpostPanelModel({ ...sandboxCtx(), viewer: fixedViewerSeat(0) }, snapshotOf([taken, store]), taken),
    ).toEqual({ kind: 'empty' });
  });

  it('keeps whole-map viewing and demolition consistent with other panels', () => {
    for (const viewer of [overseerViewerSeat(1), switchableViewerSeat(null)]) {
      expect(signpostPanelModel({ ...sandboxCtx(), viewer }, snapshot, post)).toMatchObject({
        kind: 'signpost',
        canDemolish: true,
        stock: [{ amount: 8 }],
      });
    }
  });
});
