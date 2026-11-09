import { FOG_MODE, FOG_STATE, type FogMode, type FogView, SHARED_SIGHT_VIEWER } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { PLAYERS_SIGHT, switchableViewerSeat } from '../../../src/game/viewer-seat.js';
import { rememberedFog, viewerFog } from '../../../src/view/runtime/viewer-fog.js';

const MAP = { width: 4, height: 3 };
const SEATS = [0, 2];

function hostAnswering(shared: FogView | null, mode: FogMode = FOG_MODE.CLASSIC) {
  return { fogView: () => null, sharedFogView: () => shared, fogMode: () => mode };
}

describe('viewer fog', () => {
  it('under the players’ sight shows nothing seen until the first union lands, then the union', () => {
    const viewer = switchableViewerSeat(PLAYERS_SIGHT);
    const waiting = viewerFog(hostAnswering(null), viewer, SEATS, MAP)();
    expect(waiting?.player).toBe(SHARED_SIGHT_VIEWER);
    expect(waiting?.stateAt(1, 1)).toBe(FOG_STATE.UNEXPLORED);
    const union = { ...(waiting as FogView), generation: 7 };
    expect(viewerFog(hostAnswering(union), viewer, SEATS, MAP)()).toBe(union);
  });

  it('draws no fog with fog off, over the revealed map, or with no seat to share', () => {
    const sight = switchableViewerSeat(PLAYERS_SIGHT);
    expect(viewerFog(hostAnswering(null, FOG_MODE.OFF), sight, SEATS, MAP)()).toBeNull();
    expect(viewerFog(hostAnswering(null), sight, [], MAP)()).toBeNull();
    expect(viewerFog(hostAnswering(null), switchableViewerSeat(null), SEATS, MAP)()).toBeNull();
  });

  it("draws the last answered seat's current view while a switched-to seat's answer is on the way", () => {
    const viewer = switchableViewerSeat(0);
    const answers = new Map<number, FogView>();
    const host = {
      fogView: (seat: number) => answers.get(seat) ?? null,
      sharedFogView: () => null,
      fogMode: () => FOG_MODE.CLASSIC,
    };
    const drawn = viewerFog(host, viewer, SEATS, MAP);
    const unseen = drawn();
    expect(unseen?.player).toBe(0); // nothing landed yet: the seat has seen nothing
    const own = { ...(unseen as FogView), generation: 2 };
    answers.set(0, own);
    expect(drawn()).toBe(own);
    viewer.watch(2);
    const ownLater = { ...own, generation: 3 };
    answers.set(0, ownLater);
    expect(drawn()).toBe(ownLater);
    const landed = { ...own, player: 2, generation: 3 };
    answers.set(2, landed);
    expect(drawn()).toBe(landed);
  });

  it('remembers every seat and their sight together only while the session watches', () => {
    const own = { player: 0 } as FogView;
    const ally = { player: 2 } as FogView;
    const shared = { player: SHARED_SIGHT_VIEWER } as FogView;
    let watching = false;
    const host = {
      fogView: (seat: number) => (seat === 0 ? own : seat === 2 ? ally : null),
      sharedFogView: () => shared,
      fogMode: () => FOG_MODE.CLASSIC,
    };
    const remembered = rememberedFog(host, SEATS, () => watching);
    expect(remembered()).toEqual([]);
    watching = true;
    expect(remembered()).toEqual([own, ally, shared]);
  });
});
