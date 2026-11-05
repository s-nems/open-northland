import type { GlslProgramSource, NightMaskDraws, RendererLink, WarmedProgram } from '@open-northland/render';
import type { Renderer } from 'pixi.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type NightShadersModule = typeof import('../../../src/view/graphics/night-shaders.js');

/** A cold Direct3D link of a world batch program, and one the program cache answered. */
const COMPILED_MS = 6000;
const CACHED_MS = 40;

const gpu = vi.hoisted(() => ({
  sources: [] as GlslProgramSource[],
  draws: 0,
  answer: 'drawn' as 'drawn' | 'timed out' | 'throws',
}));

vi.mock('@open-northland/render', async (original) => ({
  ...(await original<typeof import('@open-northland/render')>()),
  nightMaskSources: () => gpu.sources,
  drawNightMaskPrograms: async (): Promise<NightMaskDraws> => {
    gpu.draws++;
    if (gpu.answer === 'throws') throw new Error('createFramebuffer failed');
    return { programs: gpu.sources.length, ms: 1, timedOut: gpu.answer === 'timed out' };
  },
}));

const renderer = {} as Renderer;
const announced = (): Promise<void> => Promise.resolve();
const nightPrograms = (variant: string): GlslProgramSource[] =>
  ['world-batch', 'paletted-sprite'].map((name) => ({ name, vertex: 'void main() {}', fragment: variant }));

/** This page's links of every night program, all taking `ms`. */
function linksAt(ms: number): { warmed: WarmedProgram[]; linked: RendererLink[] } {
  return {
    warmed: gpu.sources.map((source) => ({ name: source.name, outcome: 'linked', ms })),
    linked: gpu.sources.map((source) => ({ name: source.name, ms: CACHED_MS })),
  };
}

const storage = new Map<string, string>();
/** A fresh page: nothing drawn in it yet, the storage kept from earlier ones. */
async function page(): Promise<NightShadersModule['drawNightShaders']> {
  vi.resetModules();
  return (await import('../../../src/view/graphics/night-shaders.js')).drawNightShaders;
}

beforeEach(() => {
  storage.clear();
  gpu.sources = nightPrograms('xbr');
  gpu.draws = 0;
  gpu.answer = 'drawn';
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('draws where a night program compiled in this page, once per page', async () => {
  const draw = await page();
  await draw(renderer, linksAt(COMPILED_MS), announced);
  await draw(renderer, linksAt(COMPILED_MS), announced);
  expect(gpu.draws).toBe(1);
});

it('skips a later boot that linked from the cache what an earlier one drew, but not other programs', async () => {
  await (await page())(renderer, linksAt(COMPILED_MS), announced);
  // Cached links of the programs drawn before.
  await (await page())(renderer, linksAt(CACHED_MS), announced);
  expect(gpu.draws).toBe(1);
  // A cleared cache: the drawn programs compile again.
  await (await page())(renderer, linksAt(COMPILED_MS), announced);
  expect(gpu.draws).toBe(2);
  // Another setting's programs, cached by an earlier boot that never drew them.
  gpu.sources = nightPrograms('sharp');
  await (await page())(renderer, linksAt(CACHED_MS), announced);
  expect(gpu.draws).toBe(3);
});

it('takes a failed or unfinished draw as not drawn, without throwing into the boot', async () => {
  for (const answer of ['throws', 'timed out'] as const) {
    gpu.answer = answer;
    await expect((await page())(renderer, linksAt(COMPILED_MS), announced)).resolves.toBeUndefined();
  }
  gpu.answer = 'drawn';
  await (await page())(renderer, linksAt(CACHED_MS), announced);
  expect(gpu.draws).toBe(3);
});
