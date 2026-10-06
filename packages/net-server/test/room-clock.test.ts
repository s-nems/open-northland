import { MAX_COMMANDS_PER_TICK, type PlayerWireEnvelope, TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { MAX_PENDING_COMMANDS_PER_MEMBER, RoomClock } from '../src/relay/room-clock.js';

/** Frames one advance may carry after a stall. */
const STALL_BURST_FRAMES = 12;

function envelope(kind: string): PlayerWireEnvelope {
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

  it('keeps one member’s commands in order when its input delay falls during a pause', () => {
    const clock = startedAt(10);
    clock.setPaused(true);
    expect(clock.schedule('a', envelope('first'), 10, 4)).toEqual({ applyTick: 14 });
    expect(clock.schedule('a', envelope('second'), 10, 3)).toEqual({ applyTick: 14 });
    expect(clock.schedule('b', envelope('independent'), 10, 1)).toEqual({ applyTick: 11 });
    clock.setPaused(false);
    const frames = clock.advance(TICK_MS * 4);
    expect(frames.flatMap((frame) => frame.commands.map(({ envelope }) => envelope.command.kind))).toEqual([
      'independent',
      'first',
      'second',
    ]);
    expect(clock.schedule('a', envelope('next'), 14, 1)).toEqual({ applyTick: 15 });
  });

  it('never lands a command on an emitted tick, and clamps a client claiming to be ahead', () => {
    const clock = startedAt(10);
    expect(clock.schedule('a', envelope('late'), 2, 3)).toEqual({ applyTick: 11 });
    expect(clock.schedule('a', envelope('ahead'), 50, 1)).toEqual({ applyTick: 11 });
  });

  it('spreads a selection over successive ticks without delaying another member or reordering input', () => {
    const clock = startedAt(1);
    for (let i = 0; i < 60; i++) {
      expect(clock.schedule('a', envelope(`a${i}`), 1, 1)).toEqual({
        applyTick: 2 + Math.floor(i / MAX_COMMANDS_PER_TICK),
      });
    }
    expect(clock.schedule('b', envelope('b0'), 1, 1)).toEqual({ applyTick: 2 });
    expect(clock.schedule('a', envelope('later'), 0, 0)).toEqual({ applyTick: 5 });
    const frames = clock.advance(TICK_MS * 4);
    expect(frames.map((frame) => frame.commands.length)).toEqual([21, 20, 20, 1]);
    expect(
      frames
        .flatMap((frame) => frame.commands.map(({ envelope }) => envelope.command.kind))
        .filter((kind) => kind !== 'b0'),
    ).toEqual([...Array.from({ length: 60 }, (_, i) => `a${i}`), 'later']);
  });

  it('bounds pending input while paused and releases exactly the capacity it emitted', () => {
    const clock = startedAt(1);
    clock.setPaused(true);
    for (let i = 0; i < MAX_PENDING_COMMANDS_PER_MEMBER; i++) {
      expect(clock.schedule('a', envelope(`a${i}`), 1, 1)).toHaveProperty('applyTick');
    }
    expect(clock.schedule('a', envelope('overflow'), 1, 1)).toEqual({ refused: 'budget' });
    expect(clock.schedule('b', envelope('independent'), 1, 1)).toEqual({ applyTick: 2 });
    expect(clock.advance(TICK_MS * 100)).toEqual([]);
    clock.setPaused(false);
    expect(clock.advance(TICK_MS)[0]?.commands).toHaveLength(MAX_COMMANDS_PER_TICK + 1);
    for (let i = 0; i < MAX_COMMANDS_PER_TICK; i++) {
      expect(clock.schedule('a', envelope(`refill${i}`), 2, 1)).toHaveProperty('applyTick');
    }
    expect(clock.schedule('a', envelope('overflow'), 2, 1)).toEqual({ refused: 'budget' });
    const frames = clock.advance(TICK_MS * 8);
    expect(frames.flatMap((frame) => frame.commands)).toHaveLength(MAX_PENDING_COMMANDS_PER_MEMBER);
    expect(clock.schedule('a', envelope('drained'), clock.tick, 1)).toEqual({ applyTick: clock.tick + 1 });
  });

  it('runs at the governed speed while one is set, reporting the requested speed throughout', () => {
    const clock = startedAt(0);
    clock.setSpeed(2);
    clock.govern({ nick: 'Bartek', speed: 0.5, cause: 'load' });
    expect(clock.advance(TICK_MS * 4).map((frame) => frame.tick)).toEqual([1, 2]);
    expect(clock.speed).toBe(2);
    clock.govern(null);
    expect(clock.advance(TICK_MS).map((frame) => frame.tick)).toEqual([3, 4]);
  });

  it('discards every pending frame and its capacity accounting at the terminal tick', () => {
    const clock = startedAt(1);
    for (let i = 0; i < MAX_PENDING_COMMANDS_PER_MEMBER; i++) clock.schedule('a', envelope('queued'), 1, 1);
    clock.finishAt(1);
    expect(clock.pendingFrames()).toEqual([]);
    expect(clock.advance(TICK_MS * 10)).toEqual([]);
    // Game guards further submissions; the clock itself no longer retains the retired budget.
    expect(clock.schedule('a', envelope('fresh'), 1, 1)).toEqual({ applyTick: 2 });
  });

  it('caps a stall to one burst and lets the game run late instead', () => {
    const clock = startedAt(0);
    expect(clock.advance(TICK_MS * 100)).toHaveLength(STALL_BURST_FRAMES);
    expect(clock.advance(0)).toEqual([]);
    expect(clock.advance(TICK_MS).map((frame) => frame.tick)).toEqual([STALL_BURST_FRAMES + 1]);
  });

  it('emits nothing while held, and lands the relay’s own command on the next tick outside every budget', () => {
    const clock = startedAt(3);
    clock.hold(true);
    expect(clock.advance(TICK_MS * 4)).toEqual([]);
    for (let i = 0; i < MAX_COMMANDS_PER_TICK; i++) clock.schedule('a', envelope(`a${i}`), 3, 1);
    const trusted = {
      v: 1,
      origin: 'admin',
      command: { kind: 'setPlayerAi', player: 2, enabled: true },
    } as const;
    expect(clock.scheduleTrusted(trusted)).toBe(4);
    clock.hold(false);
    const [frame] = clock.advance(TICK_MS);
    expect(frame?.tick).toBe(4);
    expect(frame?.commands).toHaveLength(MAX_COMMANDS_PER_TICK + 1);
    expect(frame?.commands.at(-1)).toEqual({ envelope: trusted, sequence: MAX_COMMANDS_PER_TICK });
  });
});
