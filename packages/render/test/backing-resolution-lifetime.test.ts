import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resize: vi.fn(), destroys: [] as Array<{ destroy(): void }> }));
vi.mock('pixi.js', () => ({
  Application: class {
    renderer = {
      resolution: 1,
      resize: mocks.resize,
      runners: { destroy: { add: (hook: { destroy(): void }) => mocks.destroys.push(hook) } },
    };
    async init() {}
  },
  Assets: {},
}));

// `pixi.js` is a real ESM package, so its exports cannot be spied in place, and test files share
// one module registry. Clear it, then import the subject, so the subject sees the fake above.
vi.resetModules();
const { createWindowPixiApp } = await import('../src/gpu/pixi-app.js');

afterEach(() => vi.unstubAllGlobals());
it('releases resize and DPR listeners when the renderer is destroyed', async () => {
  const media = new EventTarget();
  const win = Object.assign(new EventTarget(), {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 2,
    matchMedia: vi.fn(() => media),
  });
  vi.stubGlobal('window', win);
  await createWindowPixiApp({} as HTMLCanvasElement);
  win.dispatchEvent(new Event('resize'));
  expect(mocks.resize).toHaveBeenCalledOnce();
  for (const hook of mocks.destroys) hook.destroy();
  win.dispatchEvent(new Event('resize'));
  media.dispatchEvent(new Event('change'));
  expect(mocks.resize).toHaveBeenCalledOnce();
  expect(win.matchMedia).toHaveBeenCalledOnce();
});
