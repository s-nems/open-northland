import type { ShaderWarmup, WarmedProgram } from '@open-northland/render';
import type { Renderer } from 'pixi.js';
import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, type MenuSettings } from '../../../src/view/settings/store.js';

type WarmupModule = typeof import('../../../src/view/graphics/shader-warmup.js');

interface FakeWarmup {
  /** Settles `done` as the real warm-up would once its links finish or stall. */
  readonly settle: (outcome: WarmedProgram['outcome']) => void;
}

const warmups = vi.hoisted(() => ({
  started: [] as FakeWarmup[],
  /** Calls to the render warm-up, including those it answered with null. */
  asked: 0,
  parallel: true,
  failing: false,
  forgotten: 0,
  /** Renderers the game linked its programs in. */
  rendererLinks: 0,
}));
const stored = vi.hoisted(() => ({ settings: null as MenuSettings | null }));

vi.mock('../../../src/view/settings/store.js', async (original) => {
  const store = await original<typeof import('../../../src/view/settings/store.js')>();
  return { ...store, readStoredSettings: () => stored.settings ?? store.defaultSettings() };
});

vi.mock('@open-northland/render', async (original) => {
  const fresh = (): ShaderWarmup => {
    if (warmups.failing) throw new Error('createProgram failed for world-batch');
    let resolve: (programs: readonly WarmedProgram[]) => void = () => undefined;
    const done = new Promise<readonly WarmedProgram[]>((settle) => {
      resolve = settle;
    });
    const settle = (outcome: WarmedProgram['outcome']): void =>
      resolve([{ name: 'world-batch', outcome, ms: 0 }]);
    warmups.started.push({ settle });
    return { done };
  };
  return {
    ...(await original<typeof import('@open-northland/render')>()),
    startShaderWarmup: () => {
      warmups.asked++;
      return warmups.parallel ? fresh() : null;
    },
    forgetShaderLinks: () => {
      warmups.forgotten++;
    },
    linkRendererPrograms: async () => {
      warmups.rendererLinks++;
      return [];
    },
  };
});

// Each case starts from a module that has warmed nothing yet.
let applyWhenWarmed: WarmupModule['applyWhenWarmed'];
let graphicsShaderWarmup: WarmupModule['graphicsShaderWarmup'];
let warmGraphicsInBackground: WarmupModule['warmGraphicsInBackground'];
let rewarmAfterContextRestore: WarmupModule['rewarmAfterContextRestore'];
let relinkAfterContextRestore: WarmupModule['relinkAfterContextRestore'];

beforeEach(async () => {
  warmups.started.length = 0;
  warmups.asked = 0;
  warmups.parallel = true;
  warmups.failing = false;
  warmups.forgotten = 0;
  warmups.rendererLinks = 0;
  stored.settings = null;
  vi.resetModules();
  ({
    applyWhenWarmed,
    graphicsShaderWarmup,
    relinkAfterContextRestore,
    rewarmAfterContextRestore,
    warmGraphicsInBackground,
  } = await import('../../../src/view/graphics/shader-warmup.js'));
});

/** Changes a stored setting that picks programs, so the next warm-up asks for another program set. */
function change(patch: Partial<MenuSettings>): void {
  stored.settings = { ...(stored.settings ?? defaultSettings()), ...patch };
}
function toggleWeather(): void {
  change({ weather: !(stored.settings ?? defaultSettings()).weather });
}
const turns = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

it('shares one warm-up per settings', () => {
  toggleWeather();
  const first = graphicsShaderWarmup();
  expect(graphicsShaderWarmup()).toBe(first);
  expect(warmups.started).toHaveLength(1);
});

it('starts another warm-up for a setting that picks programs', () => {
  graphicsShaderWarmup();
  toggleWeather();
  graphicsShaderWarmup();
  expect(warmups.started).toHaveLength(2);
});

it('lets a map boot take over the menu warm-up of the same settings', () => {
  toggleWeather();
  warmGraphicsInBackground();
  graphicsShaderWarmup();
  expect(warmups.started).toHaveLength(1);
});

it('asks once and settles at once where links would block, leaving them to the game renderer', async () => {
  warmups.parallel = false;
  toggleWeather();
  warmGraphicsInBackground();
  expect(await graphicsShaderWarmup().done).toEqual([]);
  expect(warmups.asked).toBe(1);
  const apply = vi.fn();
  applyWhenWarmed(apply)('on');
  await turns();
  expect(apply.mock.calls).toEqual([['on']]);
});

it('keeps the menu up when the background warm-up cannot start', () => {
  warmups.failing = true;
  toggleWeather();
  expect(() => warmGraphicsInBackground()).not.toThrow();
});

it('retries a warm-up that gave up on a stalled driver instead of taking it as done', async () => {
  toggleWeather();
  const stalled = graphicsShaderWarmup();
  warmups.started[0]?.settle('pending');
  await stalled.done;
  await turns();
  expect(graphicsShaderWarmup()).not.toBe(stalled);
  expect(warmups.started).toHaveLength(2);
});

it('applies a live change once its programs are warmed, the latest change only', async () => {
  toggleWeather();
  const apply = vi.fn();
  const applyWarmed = applyWhenWarmed(apply);
  applyWarmed('first');
  applyWarmed('second');
  await turns();
  expect(apply).not.toHaveBeenCalled();
  warmups.started.at(-1)?.settle('linked');
  await turns();
  expect(apply.mock.calls).toEqual([['second']]);
});

it('applies a stalled warm-up change once, without waiting on the driver again', async () => {
  toggleWeather();
  const apply = vi.fn();
  applyWhenWarmed(apply)('on');
  warmups.started.at(-1)?.settle('pending');
  await turns();
  expect(apply.mock.calls).toEqual([['on']]);
  expect(warmups.started).toHaveLength(1);
});

it('holds a change until the warm-up a later change of another setting started has settled', async () => {
  const shadows = vi.fn();
  const blood = vi.fn();
  const applyShadows = applyWhenWarmed(shadows);
  const applyBlood = applyWhenWarmed(blood);
  change({ softShadows: false, blood: false });
  applyShadows(false);
  // The blood change starts a warm-up for settings that now differ from what the shadows one covers.
  change({ blood: true });
  applyBlood(true);
  // The superseded warm-up ends first; its programs are not the ones now in use.
  warmups.started[0]?.settle('linked');
  await turns();
  expect(shadows).not.toHaveBeenCalled();
  warmups.started.at(-1)?.settle('linked');
  await turns();
  expect(shadows).toHaveBeenCalledWith(false);
  expect(blood).toHaveBeenCalledWith(true);
});

it('applies a change that draws nothing new at once, dropping an earlier one still waiting', async () => {
  toggleWeather();
  const apply = vi.fn();
  const applyWarmed = applyWhenWarmed(apply, (enabled: boolean) => enabled);
  applyWarmed(true);
  applyWarmed(false);
  expect(apply.mock.calls).toEqual([[false]]);
  warmups.started.at(-1)?.settle('linked');
  await turns();
  expect(apply.mock.calls).toEqual([[false]]);
});

it('applies a live change even when its warm-up fails to start', async () => {
  warmups.failing = true;
  toggleWeather();
  const apply = vi.fn();
  applyWhenWarmed(apply)('on');
  await turns();
  expect(apply.mock.calls).toEqual([['on']]);
});

it('warms again after a context restore, though a warm-up of the same settings already settled', async () => {
  toggleWeather();
  const boot = graphicsShaderWarmup();
  warmups.started[0]?.settle('linked');
  await boot.done;
  const restored = rewarmAfterContextRestore();
  expect(restored).not.toBe(boot);
  expect(warmups.forgotten).toBe(1);
  expect(warmups.started).toHaveLength(2);
  expect(graphicsShaderWarmup()).toBe(restored);
});

it('holds a restored world until the renderer has linked its programs after the warm-up', async () => {
  toggleWeather();
  let settled = false;
  void relinkAfterContextRestore({} as Renderer, new AbortController().signal).done.then(() => {
    settled = true;
  });
  await turns();
  expect(warmups.rendererLinks).toBe(0);
  warmups.started.at(-1)?.settle('linked');
  await turns();
  expect(warmups.rendererLinks).toBe(1);
  expect(settled).toBe(true);
});

it('links nothing after a context restore once its view is torn down', async () => {
  toggleWeather();
  const lifetime = new AbortController();
  const restored = relinkAfterContextRestore({} as Renderer, lifetime.signal);
  lifetime.abort();
  warmups.started.at(-1)?.settle('linked');
  await restored.done;
  expect(warmups.rendererLinks).toBe(0);
});
