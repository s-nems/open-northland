import type { GroundWave, MapObjectSprite } from '@open-northland/render';
import type { Simulation } from '@open-northland/sim';
import { Texture } from 'pixi.js';
import { expect, it, vi } from 'vitest';
import { bindScriptLandscapes } from '../src/view/runtime/script-landscapes.js';

function sprite(): MapObjectSprite {
  return { x: 0, y: 0, source: Texture.EMPTY.source, frames: [], scale: 1, decor: false, phase: 0 };
}

it('hydrates saved replacements and reconciles later removals without rebuilding unchanged objects', () => {
  let state: ReturnType<Simulation['landscapeEdits']> = {
    revision: 1,
    removed: [0],
    added: [{ id: 10, typeId: 7, hx: 2, hy: 2, level: 1 }],
    tints: [],
  };
  const initial = sprite();
  const replacement = sprite();
  const surface = { addMapObjects: vi.fn(), removeMapObject: vi.fn(), removeGroundWave: vi.fn() };
  const factory = vi.fn(() => replacement);
  const events = bindScriptLandscapes(
    { landscapeEdits: () => state },
    surface,
    new Map([[0, initial]]),
    factory,
    new Map(),
  );
  expect(surface.removeMapObject).toHaveBeenCalledWith(initial);
  expect(surface.addMapObjects).toHaveBeenCalledExactlyOnceWith([replacement]);
  events([{ kind: 'missionLandscapeChanged' }]);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(surface.removeMapObject).toHaveBeenCalledTimes(1);
  state = { ...state, revision: 2, added: [] };
  events([{ kind: 'missionLandscapeChanged' }]);
  expect(surface.removeMapObject).toHaveBeenLastCalledWith(replacement);
});

it('leaves scripted harvestables to the live entity renderer', () => {
  const surface = { addMapObjects: vi.fn(), removeMapObject: vi.fn(), removeGroundWave: vi.fn() };
  const factory = vi.fn(sprite);
  bindScriptLandscapes(
    {
      landscapeEdits: () => ({
        revision: 1,
        removed: [],
        tints: [],
        added: [{ id: 10, typeId: 7, hx: 2, hy: 2, level: 1, resourceBacked: true }],
      }),
    },
    surface,
    new Map(),
    factory,
    new Map(),
  );
  expect(factory).not.toHaveBeenCalled();
  expect(surface.addMapObjects).not.toHaveBeenCalled();
});

it("takes a removed placement's shore wave off the ground", () => {
  const surface = { addMapObjects: vi.fn(), removeMapObject: vi.fn(), removeGroundWave: vi.fn() };
  const wave: GroundWave = { x: 0, y: 0, source: Texture.EMPTY.source, frames: [], phase: 0 };
  bindScriptLandscapes(
    { landscapeEdits: () => ({ revision: 1, removed: [3], added: [], tints: [] }) },
    surface,
    new Map(),
    vi.fn(sprite),
    new Map([[3, wave]]),
  );
  expect(surface.removeGroundWave).toHaveBeenCalledExactlyOnceWith(wave);
  expect(surface.removeMapObject).not.toHaveBeenCalled();
});
