import { describe, expect, it } from 'vitest';
import {
  fixedViewerSeat,
  overseerViewerSeat,
  pickableSeat,
  switchableViewerSeat,
} from '../src/game/viewer-seat.js';

describe('viewer seats', () => {
  it('a played seat is its own; the overseer keeps its figures but spans the whole map', () => {
    const played = fixedViewerSeat(2);
    expect([played.seat(), played.wholeMap()]).toEqual([2, false]);
    const overseer = overseerViewerSeat(0);
    expect([overseer.seat(), overseer.wholeMap()]).toEqual([0, true]);
  });

  it('limits picking and group recall to the seat off the whole map, to nobody on it', () => {
    expect(pickableSeat(fixedViewerSeat(2))).toBe(2);
    expect(pickableSeat(overseerViewerSeat(0))).toBeNull(); // every owner, its own figures aside
    const spectator = switchableViewerSeat(null);
    expect(pickableSeat(spectator)).toBeNull();
    spectator.watch(4);
    expect(pickableSeat(spectator)).toBe(4);
  });

  it('a switchable seat spans the whole map with nobody’s figures while watching none', () => {
    const viewer = switchableViewerSeat(null);
    const seen: (number | null)[] = [];
    viewer.onSwitch((seat) => seen.push(seat));
    expect([viewer.seat(), viewer.wholeMap(), viewer.version()]).toEqual([null, true, 0]);
    viewer.watch(3);
    viewer.watch(3); // the same seat again is no switch
    expect([viewer.seat(), viewer.wholeMap(), viewer.version()]).toEqual([3, false, 1]);
    viewer.watch(null);
    expect([viewer.seat(), viewer.wholeMap(), viewer.version()]).toEqual([null, true, 2]);
    expect(seen).toEqual([3, null]);
  });
});
