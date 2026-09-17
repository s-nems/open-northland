import type { SessionClock } from '@open-northland/lockstep';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_SPEED_CONTROL,
  effectiveGameSpeedSpec,
  GAME_SPEED_STATES,
  gameSpeedSpec,
  toggleGameSpeedPause,
} from '../src/hud/tool-panel/game-speed.js';
import { createSpeedControl } from '../src/hud/tool-panel/speed-control.js';
import { applyGameSpeed } from '../src/view/game-tool-panel.js';

/** A session clock that only records what the speed control asks of it. */
function testClock(speed: number): SessionClock & { readonly state: { paused: boolean; speed: number } } {
  const state = { paused: false, speed };
  return {
    state,
    get paused() {
      return state.paused;
    },
    get speed() {
      return state.speed;
    },
    setPaused: (paused) => {
      state.paused = paused;
    },
    setSpeed: (next) => {
      state.speed = next;
    },
  };
}

describe('game-speed', () => {
  it('P toggles pause, remembering and restoring the running speed', () => {
    expect(DEFAULT_GAME_SPEED_CONTROL).toEqual({ running: 'normal', paused: false });
    const paused = toggleGameSpeedPause({ running: 'fast', paused: false });
    expect(paused).toEqual({ running: 'fast', paused: true });
    expect(effectiveGameSpeedSpec(paused).tickMultiplier).toBe(0);
    expect(effectiveGameSpeedSpec(paused).gfx).toBe(0x36);
    const resumed = toggleGameSpeedPause(paused);
    expect(resumed).toEqual({ running: 'fast', paused: false });
    expect(effectiveGameSpeedSpec(resumed).tickMultiplier).toBe(2);
  });

  it('a pause toggle never overwrites the loop multiplier', () => {
    const clock = testClock(0.5);
    applyGameSpeed(clock, gameSpeedSpec('paused'), 'pause-toggle');
    expect(clock.state).toEqual({ paused: true, speed: 0.5 });
    applyGameSpeed(clock, gameSpeedSpec('normal'), 'pause-toggle');
    expect(clock.state).toEqual({ paused: false, speed: 0.5 });
    applyGameSpeed(clock, gameSpeedSpec('fast'), 'cycle');
    expect(clock.state).toEqual({ paused: false, speed: 2 });
  });

  it('maps each state to the pinned gfx family and tick multiplier', () => {
    expect(gameSpeedSpec('normal').gfx).toBe(0x31);
    expect(gameSpeedSpec('fast').gfx).toBe(0x34);
    expect(gameSpeedSpec('faster').gfx).toBe(0x35);
    expect(gameSpeedSpec('paused').gfx).toBe(0x36);
    for (const spec of GAME_SPEED_STATES) expect(spec.tickMultiplier).toBe(spec.factor);
    expect(gameSpeedSpec('paused').tickMultiplier).toBe(0);
    expect(gameSpeedSpec('faster').tickMultiplier).toBe(3);
  });
});

describe('speed control', () => {
  function mount(seed: number) {
    const clock = testClock(seed);
    const shown: string[] = [];
    const control = createSpeedControl({
      onSpeedChange: (spec, cause) => applyGameSpeed(clock, spec, cause),
      onShow: (c) => shown.push(`${c.running}${c.paused ? '/paused' : ''}`),
    });
    return { clock, shown, control };
  }

  it('resuming at the remembered segment only flips the pause, so a fractional seed survives', () => {
    const { clock, control } = mount(0.5);
    control.togglePause();
    expect(clock.state).toEqual({ paused: true, speed: 0.5 });
    control.setRunning('normal');
    expect(clock.state).toEqual({ paused: false, speed: 0.5 });
  });

  it('picking another segment hands the clock its multiplier, paused or not', () => {
    const { clock, control } = mount(0.5);
    control.togglePause();
    control.setRunning('faster');
    expect(clock.state).toEqual({ paused: false, speed: 3 });
    control.setRunning('fast');
    expect(clock.state).toEqual({ paused: false, speed: 2 });
  });

  it('shows a restored control without pushing it to the clock', () => {
    const { clock, shown, control } = mount(0.5);
    control.restore({ running: 'faster', paused: true });
    expect(shown).toEqual(['faster/paused']);
    expect(clock.state).toEqual({ paused: false, speed: 0.5 });
    expect(control.state()).toEqual({ running: 'faster', paused: true });
  });
});
