import type { GroundWave, MapObjectSprite } from '@open-northland/render';
import type { Simulation } from '@open-northland/sim';
import { Texture } from 'pixi.js';
import { expect, it, vi } from 'vitest';
import { bindScriptLandscapes } from '../src/view/runtime/script-landscapes.js';

/** Let the host's answers land: each resolves a microtask after it was asked. */
const landed = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function sprite(): MapObjectSprite {
  return { x: 0, y: 0, source: Texture.EMPTY.source, frames: [], scale: 1, decor: false, phase: 0 };
}

it('hydrates saved replacements and reconciles later removals without rebuilding unchanged objects', async () => {
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
  const landscapes = bindScriptLandscapes(
    { landscapeEdits: () => Promise.resolve(state) },
    surface,
    new Map([[0, initial]]),
    factory,
    new Map(),
  );
  await landed();
  expect(surface.removeMapObject).toHaveBeenCalledWith(initial);
  expect(surface.addMapObjects).toHaveBeenCalledExactlyOnceWith([replacement]);
  landscapes.onEvents([{ kind: 'missionLandscapeChanged' }]);
  await landed();
  expect(factory).toHaveBeenCalledTimes(1);
  expect(surface.removeMapObject).toHaveBeenCalledTimes(1);
  state = { ...state, revision: 2, added: [] };
  landscapes.onEvents([{ kind: 'missionLandscapeChanged' }]);
  await landed();
  expect(surface.removeMapObject).toHaveBeenLastCalledWith(replacement);
});

it('applies only the latest of two asks when they land out of order', async () => {
  const surface = { addMapObjects: vi.fn(), removeMapObject: vi.fn(), removeGroundWave: vi.fn() };
  const first = sprite();
  const answers: ((edits: ReturnType<Simulation['landscapeEdits']>) => void)[] = [];
  const landscapes = bindScriptLandscapes(
    { landscapeEdits: () => new Promise((resolve) => answers.push(resolve)) },
    surface,
    new Map([[1, first]]),
    vi.fn(sprite),
    new Map(),
  );
  landscapes.onEvents([{ kind: 'missionLandscapeChanged' }]);
  answers[1]?.({ revision: 2, removed: [], added: [], tints: [] });
  answers[0]?.({ revision: 1, removed: [1], added: [], tints: [] });
  await landed();
  expect(surface.removeMapObject).not.toHaveBeenCalled();
});

it('leaves scripted harvestables to the live entity renderer', async () => {
  const surface = { addMapObjects: vi.fn(), removeMapObject: vi.fn(), removeGroundWave: vi.fn() };
  const factory = vi.fn(sprite);
  bindScriptLandscapes(
    {
      landscapeEdits: () =>
        Promise.resolve({
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
  await landed();
  expect(factory).not.toHaveBeenCalled();
  expect(surface.addMapObjects).not.toHaveBeenCalled();
});

it("takes a removed placement's shore wave off the ground", async () => {
  const surface = { addMapObjects: vi.fn(), removeMapObject: vi.fn(), removeGroundWave: vi.fn() };
  const wave: GroundWave = { x: 0, y: 0, source: Texture.EMPTY.source, frames: [], phase: 0 };
  bindScriptLandscapes(
    { landscapeEdits: () => Promise.resolve({ revision: 1, removed: [3], added: [], tints: [] }) },
    surface,
    new Map(),
    vi.fn(sprite),
    new Map([[3, wave]]),
  );
  await landed();
  expect(surface.removeGroundWave).toHaveBeenCalledExactlyOnceWith(wave);
  expect(surface.removeMapObject).not.toHaveBeenCalled();
});

it('applies nothing that lands after disposal', async () => {
  const surface = { addMapObjects: vi.fn(), removeMapObject: vi.fn(), removeGroundWave: vi.fn() };
  const landscapes = bindScriptLandscapes(
    { landscapeEdits: () => Promise.resolve({ revision: 1, removed: [1], added: [], tints: [] }) },
    surface,
    new Map([[1, sprite()]]),
    vi.fn(sprite),
    new Map(),
  );
  landscapes.dispose();
  await landed();
  expect(surface.removeMapObject).not.toHaveBeenCalled();
});
