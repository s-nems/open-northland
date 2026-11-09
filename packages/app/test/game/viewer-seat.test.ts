import { describe, expect, it } from 'vitest';
import {
  fixedViewerSeat,
  PLAYERS_SIGHT,
  pickableSeat,
  switchableViewerSeat,
  type WatchTarget,
} from '../../src/game/viewer-seat.js';

describe('viewer seats', () => {
  it('limits picking and group recall to the seat off the whole map, to nobody on it', () => {
    expect(pickableSeat(fixedViewerSeat(2))).toBe(2);
    const spectator = switchableViewerSeat(null);
    expect(pickableSeat(spectator)).toBeNull();
    spectator.watch(4);
    expect(pickableSeat(spectator)).toBe(4);
  });

  it('a switchable seat spans the whole map with nobody’s figures while watching none', () => {
    const viewer = switchableViewerSeat(null);
    const seen: WatchTarget[] = [];
    viewer.onSwitch((seat) => seen.push(seat));
    expect([viewer.seat(), viewer.wholeMap(), viewer.version()]).toEqual([null, true, 0]);
    viewer.watch(3);
    viewer.watch(3); // the same seat again is no switch
    expect([viewer.seat(), viewer.wholeMap(), viewer.version()]).toEqual([3, false, 1]);
    viewer.watch(null);
    expect([viewer.seat(), viewer.wholeMap(), viewer.version()]).toEqual([null, true, 2]);
    expect(seen).toEqual([3, null]);
  });

  it("the players' sight spans the whole map with nobody's figures, under fog", () => {
    const viewer = switchableViewerSeat(PLAYERS_SIGHT);
    expect([viewer.seat(), viewer.wholeMap(), viewer.sharedSight()]).toEqual([null, true, true]);
    viewer.watch(null);
    expect([viewer.wholeMap(), viewer.sharedSight(), viewer.target()]).toEqual([true, false, null]);
  });
});
