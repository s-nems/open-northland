import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createScriptEffects } from '../src/view/script-effects.js';

/** The quake's camera jitter runs for the asked seconds, and the weather wash follows the density
 *  of the last square written over the view's centre. */
describe('createScriptEffects', () => {
  const screen = { width: 800, height: 600 };

  it("shakes for the quake's duration and no longer", () => {
    const effects = createScriptEffects(new Container());
    expect(effects.jitter(0)).toBeNull();
    effects.startEarthquake(2, 1000);
    const early = effects.jitter(1500);
    expect(early).not.toBeNull();
    expect(Math.abs(early?.dx ?? 0)).toBeLessThanOrEqual(6);
    expect(effects.jitter(2999)).not.toBeNull();
    expect(effects.jitter(3000)).toBeNull();
  });

  it('washes the view by the last square over its centre and clears on a zero', () => {
    const parent = new Container();
    const effects = createScriptEffects(parent);
    const wash = parent.children[0];
    expect(wash).toBeDefined();
    // The camera centres on world (0,0), which is half-cell node (0,0).
    const camera = { offsetX: screen.width / 2, offsetY: screen.height / 2, scale: 1 };
    const square = { min: { hx: -2, hy: -2 }, max: { hx: 2, hy: 2 } };
    effects.setWeather({ kind: 'missionWeather', weather: 'rain', ...square, density: 5000 });
    effects.update(camera, screen);
    const washed = wash?.getBounds().width ?? 0;
    expect(washed).toBe(screen.width);
    effects.setWeather({ kind: 'missionWeather', weather: 'rain', ...square, density: 0 });
    effects.update(camera, screen);
    expect(wash?.getBounds().width ?? 0).toBe(0);
    // A square elsewhere leaves the centre dry.
    effects.setWeather({
      kind: 'missionWeather',
      weather: 'snow',
      min: { hx: 40, hy: 40 },
      max: { hx: 50, hy: 50 },
      density: 9000,
    });
    effects.update(camera, screen);
    expect(wash?.getBounds().width ?? 0).toBe(0);
  });

  it('clears overlapping weather only inside the zero-density region', () => {
    const parent = new Container();
    const effects = createScriptEffects(parent);
    const wash = parent.children[0];
    const camera = { offsetX: screen.width / 2, offsetY: screen.height / 2, scale: 1 };
    effects.setWeather({
      kind: 'missionWeather',
      weather: 'rain',
      min: { hx: -20, hy: -20 },
      max: { hx: 20, hy: 20 },
      density: 5000,
    });
    effects.setWeather({
      kind: 'missionWeather',
      weather: 'rain',
      min: { hx: -2, hy: -2 },
      max: { hx: 2, hy: 2 },
      density: 0,
    });
    effects.update(camera, screen);
    expect(wash?.getBounds().width ?? 0).toBe(0);
    effects.update({ ...camera, offsetX: camera.offsetX - 340 }, screen);
    expect(wash?.getBounds().width ?? 0).toBe(screen.width);
    effects.dispose();
  });

  it('keeps one entry per square, so a mission re-firing its weather never grows the list', () => {
    const parent = new Container();
    const effects = createScriptEffects(parent);
    const wash = parent.children[0];
    const camera = { offsetX: screen.width / 2, offsetY: screen.height / 2, scale: 1 };
    const square = { min: { hx: -2, hy: -2 }, max: { hx: 2, hy: 2 } };
    for (let i = 0; i < 50; i++) {
      effects.setWeather({ kind: 'missionWeather', weather: 'rain', ...square, density: 100 * (i + 1) });
    }
    effects.update(camera, screen);
    // The last write decides, whichever order the fifty came in.
    expect(wash?.alpha).toBe(1);
    expect(wash?.getBounds().width ?? 0).toBe(screen.width);
    effects.setWeather({ kind: 'missionWeather', weather: 'rain', ...square, density: 0 });
    effects.update(camera, screen);
    expect(wash?.getBounds().width ?? 0).toBe(0);
  });
});
