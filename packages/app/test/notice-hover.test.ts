import { describe, expect, it } from 'vitest';
import {
  HOVER_CLOSE_DELAY_MS,
  HOVER_OPEN_DWELL_MS,
  HOVER_REARM_PX,
  hoverClosed,
  hoverDue,
  hoverListing,
  hoverOpenKey,
  hoverPinned,
  hoverPointer,
  hoverTick,
  type PointerAt,
  STACK_HOVER_IDLE,
  type StackHover,
} from '../src/hud/dom/notice-hover.js';

const AT: PointerAt = { x: 100, y: 200 };
const STACK_A = 'hunger';
const STACK_B = 'tired';

/** Rest on `key` from time 0 until its dwell has run out. */
function hoverOpened(key: string): StackHover {
  const resting = hoverPointer(STACK_HOVER_IDLE, key, AT, 0).state;
  const step = hoverTick(resting, HOVER_OPEN_DWELL_MS);
  expect(step.action).toEqual({ kind: 'open', key });
  return step.state;
}

describe('stack hover intent', () => {
  it('opens a stack only after the pointer rests on it for the dwell', () => {
    const resting = hoverPointer(STACK_HOVER_IDLE, STACK_A, AT, 0).state;
    expect(hoverDue(resting)).toBe(HOVER_OPEN_DWELL_MS);
    expect(hoverTick(resting, HOVER_OPEN_DWELL_MS - 1).action).toBeNull();
    const moved = hoverPointer(resting, STACK_A, { x: AT.x, y: AT.y + 5 }, HOVER_OPEN_DWELL_MS / 2).state;
    expect(hoverTick(moved, HOVER_OPEN_DWELL_MS).action).toEqual({ kind: 'open', key: STACK_A });
  });

  it('opens nothing for a pointer crossing the column', () => {
    const step = HOVER_OPEN_DWELL_MS / 3;
    let state = hoverPointer(STACK_HOVER_IDLE, STACK_A, AT, 0).state;
    state = hoverPointer(state, null, { x: AT.x, y: AT.y + 30 }, step).state;
    state = hoverPointer(state, STACK_B, { x: AT.x, y: AT.y + 60 }, 2 * step).state;
    state = hoverPointer(state, null, { x: AT.x + 200, y: AT.y + 60 }, 3 * step).state;
    expect(state.phase.kind).toBe('idle');
    expect(hoverTick(state, 10 * HOVER_OPEN_DWELL_MS).action).toBeNull();
  });

  it('starts the dwell over on a different stack', () => {
    let state = hoverPointer(STACK_HOVER_IDLE, STACK_A, AT, 0).state;
    state = hoverPointer(state, STACK_B, AT, HOVER_OPEN_DWELL_MS - 1).state;
    expect(hoverTick(state, HOVER_OPEN_DWELL_MS).action).toBeNull();
    expect(hoverTick(state, 2 * HOVER_OPEN_DWELL_MS - 1).action).toEqual({ kind: 'open', key: STACK_B });
  });

  it('stays open across the gap into its rows and closes after the leave delay', () => {
    const open = hoverOpened(STACK_A);
    const gap = hoverPointer(open, null, AT, 1000).state;
    expect(hoverTick(gap, 1000 + HOVER_CLOSE_DELAY_MS - 1).action).toBeNull();
    const rows = hoverPointer(gap, STACK_A, AT, 1000 + HOVER_CLOSE_DELAY_MS / 2).state;
    expect(hoverOpenKey(rows)).toBe(STACK_A);
    expect(hoverDue(rows)).toBeNull();
    const gone = hoverPointer(rows, null, AT, 2000).state;
    expect(hoverTick(gone, 2000 + HOVER_CLOSE_DELAY_MS).action).toEqual({ kind: 'close' });
  });

  it('closes an open preview before another stack under the pointer may dwell', () => {
    const open = hoverOpened(STACK_A);
    const onB = hoverPointer(open, STACK_B, AT, 1000).state;
    expect(onB.phase).toEqual({ kind: 'leaving', key: STACK_A, since: 1000 });
  });

  it('opens nothing by hover until a still pointer moves on after a close', () => {
    const open = hoverOpened(STACK_A);
    const leaving = hoverPointer(open, null, AT, 1000).state;
    const closed = hoverTick(leaving, 1000 + HOVER_CLOSE_DELAY_MS).state;
    // The cards below slid up: another stack is under the still pointer now.
    const slid = hoverPointer(closed, STACK_B, AT, 1400).state;
    expect(slid.phase.kind).toBe('idle');
    expect(hoverTick(slid, 1400 + 10 * HOVER_OPEN_DWELL_MS).action).toBeNull();
    const nudged = hoverPointer(slid, STACK_B, { x: AT.x + HOVER_REARM_PX - 1, y: AT.y }, 1500).state;
    expect(nudged.phase.kind).toBe('idle');
    const moved = hoverPointer(nudged, STACK_B, { x: AT.x, y: AT.y + HOVER_REARM_PX }, 1600).state;
    expect(moved.phase).toEqual({ kind: 'dwell', key: STACK_B, since: 1600 });
  });

  it('holds a still pointer after a press or key closed the stack too', () => {
    const pinned = hoverPinned(hoverPointer(STACK_HOVER_IDLE, STACK_A, AT, 0).state, STACK_A);
    const closed = hoverClosed(pinned);
    expect(hoverPointer(closed, STACK_A, AT, 100).state.phase.kind).toBe('idle');
  });

  it('never opens or closes by hover while a stack is pinned', () => {
    const pinned = hoverPinned(STACK_HOVER_IDLE, STACK_A);
    const elsewhere = hoverPointer(pinned, STACK_B, AT, 0).state;
    expect(elsewhere.phase).toEqual({ kind: 'pinned', key: STACK_A });
    expect(hoverDue(elsewhere)).toBeNull();
    expect(hoverTick(elsewhere, 10 * HOVER_OPEN_DWELL_MS).action).toBeNull();
    expect(hoverPointer(elsewhere, null, AT, 0).state.phase.kind).toBe('pinned');
  });

  it('pins a hover preview so the pointer no longer closes it', () => {
    const pinned = hoverPinned(hoverOpened(STACK_A), STACK_A);
    expect(hoverPointer(pinned, null, AT, 1000).state.phase).toEqual({ kind: 'pinned', key: STACK_A });
  });

  it('follows the stack the column lists: one it dropped closes, one opened without hover is pinned', () => {
    const open = hoverOpened(STACK_A);
    expect(hoverListing(open, STACK_A)).toBe(open);
    const dropped = hoverListing(open, null);
    expect(dropped.phase.kind).toBe('idle');
    expect(dropped.held).toEqual(AT);
    expect(hoverListing(STACK_HOVER_IDLE, STACK_B).phase).toEqual({ kind: 'pinned', key: STACK_B });
  });
});
