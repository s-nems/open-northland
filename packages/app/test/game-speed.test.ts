import { describe, expect, it } from 'vitest';
import {
  cycleGameSpeed,
  DEFAULT_GAME_SPEED_CONTROL,
  effectiveGameSpeedSpec,
  GAME_SPEED_STATES,
  gameSpeedClickCause,
  gameSpeedSpec,
  toggleGameSpeedPause,
} from '../src/hud/tool-panel/game-speed.js';
import { applyGameSpeed, type LoopSpeedControl } from '../src/view/game-tool-panel.js';

describe('game-speed', () => {
  it('clicks cycle the running speeds only', () => {
    expect(DEFAULT_GAME_SPEED_CONTROL).toEqual({ running: 'normal', paused: false });
    let control = DEFAULT_GAME_SPEED_CONTROL;
    control = cycleGameSpeed(control);
    expect(control.running).toBe('fast');
    control = cycleGameSpeed(control);
    expect(control.running).toBe('faster');
    control = cycleGameSpeed(control);
    expect(control).toEqual({ running: 'normal', paused: false });
  });

  it('P toggles pause, remembering and restoring the running speed', () => {
    const fast = cycleGameSpeed(DEFAULT_GAME_SPEED_CONTROL);
    const paused = toggleGameSpeedPause(fast);
    expect(paused).toEqual({ running: 'fast', paused: true });
    expect(effectiveGameSpeedSpec(paused).tickMultiplier).toBe(0);
    expect(effectiveGameSpeedSpec(paused).gfx).toBe(0x36);
    const resumed = toggleGameSpeedPause(paused);
    expect(resumed).toEqual({ running: 'fast', paused: false });
    expect(effectiveGameSpeedSpec(resumed).tickMultiplier).toBe(2);
  });

  it('a click while paused resumes at the remembered speed', () => {
    const paused = toggleGameSpeedPause({ running: 'faster', paused: false });
    expect(cycleGameSpeed(paused)).toEqual({ running: 'faster', paused: false });
  });

  it('a click-resume reports pause-toggle, so a fractional seed survives', () => {
    const loop: LoopSpeedControl = { paused: false, speed: 0.5 };
    let control = toggleGameSpeedPause(DEFAULT_GAME_SPEED_CONTROL);
    applyGameSpeed(loop, effectiveGameSpeedSpec(control), 'pause-toggle');
    expect(loop).toEqual({ paused: true, speed: 0.5 });
    const cause = gameSpeedClickCause(control);
    expect(cause).toBe('pause-toggle');
    control = cycleGameSpeed(control);
    applyGameSpeed(loop, effectiveGameSpeedSpec(control), cause);
    expect(loop).toEqual({ paused: false, speed: 0.5 });
    expect(gameSpeedClickCause(control)).toBe('cycle');
  });

  it('a pause toggle never overwrites the loop multiplier', () => {
    const control: LoopSpeedControl = { paused: false, speed: 0.5 };
    applyGameSpeed(control, gameSpeedSpec('paused'), 'pause-toggle');
    expect(control).toEqual({ paused: true, speed: 0.5 });
    applyGameSpeed(control, gameSpeedSpec('normal'), 'pause-toggle');
    expect(control).toEqual({ paused: false, speed: 0.5 });
    applyGameSpeed(control, gameSpeedSpec('fast'), 'cycle');
    expect(control).toEqual({ paused: false, speed: 2 });
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
