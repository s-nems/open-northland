import { afterAll, afterEach, expect, it, vi } from 'vitest';

const mocks = { resize: vi.fn(), destroys: [] as Array<{ destroy(): void }> };
class FakeApplication {
  renderer = {
    resolution: 1,
    resize: mocks.resize,
    runners: { destroy: { add: (hook: { destroy(): void }) => mocks.destroys.push(hook) } },
    events: { cursorStyles: { default: 'inherit' } },
  };
  async init() {}
}

// Test files share one module registry, so a module evaluated against a fake `pixi.js` would reach
// later files. Only `Application` is faked, over the real module, and the registry is cleared on both
// sides of this file so the subject and the modules it loads see the fake here and nowhere else.
vi.doMock('pixi.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('pixi.js')>()),
  Application: FakeApplication,
}));
vi.resetModules();
const { createWindowPixiApp } = await import('../src/gpu/pixi-app.js');
afterAll(() => {
  vi.doUnmock('pixi.js');
  vi.resetModules();
});

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
