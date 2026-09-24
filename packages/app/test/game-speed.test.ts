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

  it('maps each state to the original speed factor and its tick multiplier', () => {
    expect(GAME_SPEED_STATES.map((spec) => spec.factor)).toEqual([1, 2, 3, 0]);
    for (const spec of GAME_SPEED_STATES) expect(spec.tickMultiplier).toBe(spec.factor);
    expect(gameSpeedSpec('paused').tickMultiplier).toBe(0);
    expect(gameSpeedSpec('faster').tickMultiplier).toBe(3);
  });
});

describe('speed control', () => {
  function mount(seed: number, held: () => boolean = () => false) {
    const clock = testClock(seed);
    const shown: string[] = [];
    const control = createSpeedControl({
      onSpeedChange: (spec, cause) => applyGameSpeed(clock, spec, cause),
      onShow: (c) => shown.push(`${c.running}${c.paused ? '/paused' : ''}`),
      held,
      clockPaused: () => clock.paused,
    });
    return { clock, shown, control };
  }

  it('lights the pause while the clock stands, and shows the choice again once it runs', () => {
    const { clock, shown, control } = mount(1);
    control.refresh();
    clock.setPaused(true); // a hold stops the clock; the player chose nothing
    control.refresh();
    control.refresh(); // nothing moved since: nothing to show again
    clock.setPaused(false); // the hold released, restoring the clock as it was
    control.refresh();
    expect(shown).toEqual(['normal', 'normal/paused', 'normal']);
    expect(control.state()).toEqual({ running: 'normal', paused: false });
  });

  it('keeps a pause the player chose after a hold over it releases', () => {
    const { clock, shown, control } = mount(1);
    control.togglePause();
    clock.setPaused(true); // the hold, over a clock already paused
    control.refresh();
    expect(shown).toEqual(['normal/paused']);
    expect(control.state().paused).toBe(true);
  });

  it('resumes with one press a clock stopped from elsewhere', () => {
    const { clock, control } = mount(1);
    clock.setPaused(true); // a sub-mission paused the session, not the bar
    control.refresh();
    expect(control.togglePause()).toBe(true);
    expect(clock.state).toEqual({ paused: false, speed: 1 });
  });

  it('refuses every press while a window holds the game paused, and takes them again after', () => {
    let held = true;
    const { clock, shown, control } = mount(1, () => held);
    // The hold paused the clock itself; a segment press must not run the game behind the window.
    clock.setPaused(true);
    expect(control.setRunning('faster')).toBe(false);
    expect(control.togglePause()).toBe(false);
    expect(clock.state).toEqual({ paused: true, speed: 1 });
    expect(shown).toEqual([]);
    held = false;
    expect(control.setRunning('faster')).toBe(true);
    expect(clock.state).toEqual({ paused: false, speed: 3 });
  });

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
