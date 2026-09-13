import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ frame: (_now: number): void => undefined }));
vi.mock('../../src/view/runtime/raf-loop.js', () => ({
  startRafLoop: (frame: (now: number) => void) => {
    state.frame = frame;
    return { stop: () => undefined };
  },
}));

import { type FrameLoopDeps, startFrameLoop } from '../../src/view/runtime/frame-loop.js';

it('polls confirmed finish when an adopted terminal save advances zero ticks and emits no events', () => {
  const afterPoll = new Error('stop before rendering');
  const finished = vi.fn();
  const onEvents = vi.fn();
  let confirmed: number | null = null;
  const driver = { paused: true, advance: vi.fn(() => 0) };
  startFrameLoop({
    deps: {
      app: {},
      renderer: { setPaused: vi.fn() },
      sim: {
        snapshot: () => {
          throw afterPoll;
        },
      },
      cameraCtl: { update: vi.fn() },
      params: new URLSearchParams(),
      sharedClock: true,
      confirmedMatchEnd: () => confirmed,
      onEvents,
    },
    driver,
    fpsLimit: null,
    onMatchEnd: finished,
    pointer: () => null,
    syncViewport: vi.fn(),
  } as unknown as FrameLoopDeps);
  expect(() => state.frame(100)).toThrow(afterPoll);
  expect(finished).not.toHaveBeenCalled();
  confirmed = 35;
  expect(() => state.frame(116)).toThrow(afterPoll);
  expect(finished).toHaveBeenCalledOnce();
  expect(onEvents).not.toHaveBeenCalled();
});

it('does not touch camera, snapshot or renderer after a driver error disposes the current view', () => {
  let disposed = false;
  const cameraUpdate = vi.fn();
  const snapshot = vi.fn();
  const setPaused = vi.fn();
  const render = vi.fn();
  const loop = startFrameLoop({
    deps: {
      app: {},
      renderer: { setPaused, update: render },
      sim: { snapshot },
      cameraCtl: { update: cameraUpdate },
      params: new URLSearchParams(),
    },
    driver: {
      advance: () => {
        disposed = true;
        loop.stop();
        return 0;
      },
    },
    fpsLimit: null,
    isDisposed: () => disposed,
    pointer: () => null,
    syncViewport: vi.fn(),
  } as unknown as FrameLoopDeps);
  state.frame(100);
  expect(cameraUpdate).not.toHaveBeenCalled();
  expect(snapshot).not.toHaveBeenCalled();
  expect(setPaused).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
});
