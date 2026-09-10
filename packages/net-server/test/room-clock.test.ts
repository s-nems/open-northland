import { MAX_COMMANDS_PER_TICK, TICK_MS, type WireEnvelope } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { RoomClock } from '../src/relay/room-clock.js';

/** Frames one advance may carry after a stall. */
const STALL_BURST_FRAMES = 12;

function envelope(kind: string): WireEnvelope {
  return { v: 1, origin: 'player', player: 0, command: { kind } };
}

function startedAt(tick: number): RoomClock {
  const clock = new RoomClock(1);
  clock.start();
  clock.advance(TICK_MS * tick);
  expect(clock.tick).toBe(tick);
  return clock;
}

describe('room clock', () => {
  it('emits nothing before it starts, then one frame per tick of speed-scaled time', () => {
    const clock = new RoomClock(1);
    expect(clock.advance(TICK_MS * 5)).toEqual([]);
    clock.start();
    expect(clock.advance(TICK_MS * 2).map((frame) => frame.tick)).toEqual([1, 2]);
    clock.setSpeed(3);
    expect(clock.advance(TICK_MS).map((frame) => frame.tick)).toEqual([3, 4, 5]);
  });

  it('emits nothing while paused and owes nothing for the pause', () => {
    const clock = startedAt(1);
    clock.setPaused(true);
    expect(clock.advance(TICK_MS * 4)).toEqual([]);
    clock.setPaused(false);
    expect(clock.advance(0)).toEqual([]);
    expect(clock.advance(TICK_MS).map((frame) => frame.tick)).toEqual([2]);
  });

  it('lands a command its delay after the tick it was issued on, in arrival order', () => {
    const clock = startedAt(10);
    expect(clock.schedule('a', envelope('first'), 10, 3)).toEqual({ applyTick: 13 });
    expect(clock.schedule('b', envelope('second'), 10, 3)).toEqual({ applyTick: 13 });
    const frames = clock.advance(TICK_MS * 3);
    expect(frames.map((frame) => [frame.tick, frame.commands.length])).toEqual([
      [11, 0],
      [12, 0],
      [13, 2],
    ]);
    expect(frames[2]?.commands).toEqual([
      { envelope: envelope('first'), sequence: 0 },
      { envelope: envelope('second'), sequence: 1 },
    ]);
  });

  it('never lands a command on an emitted tick, and clamps a client claiming to be ahead', () => {
    const clock = startedAt(10);
    expect(clock.schedule('a', envelope('late'), 2, 3)).toEqual({ applyTick: 11 });
    expect(clock.schedule('a', envelope('ahead'), 50, 1)).toEqual({ applyTick: 11 });
  });

  it('refuses the command past a member’s budget for one tick, and that member alone', () => {
    const clock = startedAt(1);
    for (let i = 0; i < MAX_COMMANDS_PER_TICK; i++) {
      expect(clock.schedule('a', envelope(`a${i}`), 1, 1)).toEqual({ applyTick: 2 });
    }
    expect(clock.schedule('a', envelope('over'), 1, 1)).toEqual({ refused: 'budget' });
    expect(clock.schedule('b', envelope('b0'), 1, 1)).toEqual({ applyTick: 2 });
    const [frame] = clock.advance(TICK_MS);
    expect(frame?.commands).toHaveLength(MAX_COMMANDS_PER_TICK + 1);
  });

  it('caps a stall to one burst and lets the game run late instead', () => {
    const clock = startedAt(0);
    expect(clock.advance(TICK_MS * 100)).toHaveLength(STALL_BURST_FRAMES);
    expect(clock.advance(0)).toEqual([]);
    expect(clock.advance(TICK_MS).map((frame) => frame.tick)).toEqual([STALL_BURST_FRAMES + 1]);
  });
});
