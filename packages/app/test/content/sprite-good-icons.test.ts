import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANIMAL_TRIBE_HARES } from '../../src/catalog/animal-tribes.js';
import { sandboxContent } from '../../src/game/sandbox/content/index.js';
import { bobAtlasDocument } from '../support/bob-atlases.js';

/**
 * A good with no `ls_goods` pile draws its own sprite in the DOM HUD: a vehicle good the vehicle
 * standing, a species good the animal standing, cut from the served atlas the map draws it from. The
 * modules memoize their fetches, so each test re-imports them under a fresh registry.
 */

// Transform the graph once, outside any test body: it pulls in `@open-northland/render`.
await import('../../src/hud/dom/good-art.js');

const LOADER_TIMEOUT_MS = 30_000;
const VIKING = 1;
const HANDCART = 1;
const OXCART = 2;
const CART_NO_OX = 6;
const HANDCART_YARD = 42;
const SECOND_TRIBE = 2;
const CATTLE_TRIBE = 10;
const ADULT_ANIMAL_JOB = 49;
const WAIT_ACTION = 2;
const LOOP_MODE = 1;
const FACINGS = 8;
/** The standing frame every facing's wait list holds. */
const CART_STANDING_BOB = 15;
const CART_OTHER_BOB = 14;
const COW_WAIT_START = 100;
const COW_STANDING_BOB = COW_WAIT_START + 3;

const CART_STEM = 'cr_veh_body_00.goods01';
const FISH_STEM = 'ls_fishes.fishes';
/** The swarm fish side on; the rest of the strip turns it about. */
const FISH_SIDE_BOB = 4;
const GOLD_BAR_BOB = 20;
const OXCART_STEM = 'cr_veh_body_00.oxcart';
const COW_STEM = 'cr_ani_body_00.cattle01';
const HARE_STEM = 'cr_ani_body_00.house01';
const HARE_WAIT_START = 200;
const HARE_STANDING_BOB = HARE_WAIT_START + 2;

const ir = {
  vehicleGraphics: [
    {
      tribe: VIKING,
      vehicleType: HANDCART,
      job: 1,
      body: 'data/engine2d/bin/bobs/cr_veh_body_00.bmd',
      bodyPalette: 'goods01',
      clips: [{ action: WAIT_ACTION, dirFrames: Array.from({ length: FACINGS }, () => [CART_STANDING_BOB]) }],
      gaits: [],
    },
    // The harnessed ox cart: the first tribe's body is not served, so the second tribe's stands in.
    {
      tribe: VIKING,
      vehicleType: OXCART,
      job: 1,
      body: 'data/engine2d/bin/bobs/cr_veh_body_00.bmd',
      bodyPalette: 'unserved',
      clips: [{ action: WAIT_ACTION, dirFrames: Array.from({ length: FACINGS }, () => [CART_STANDING_BOB]) }],
      gaits: [],
    },
    {
      tribe: SECOND_TRIBE,
      vehicleType: OXCART,
      job: 1,
      body: 'data/engine2d/bin/bobs/cr_veh_body_00.bmd',
      bodyPalette: 'oxcart',
      clips: [{ action: WAIT_ACTION, dirFrames: Array.from({ length: FACINGS }, () => [CART_STANDING_BOB]) }],
      gaits: [],
    },
  ],
  gfxAtomics: [
    {
      tribe: CATTLE_TRIBE,
      job: ADULT_ANIMAL_JOB,
      action: WAIT_ACTION,
      bodySeq: 'cow_wait',
      dirFrames: Array.from({ length: FACINGS }, () => [COW_STANDING_BOB - COW_WAIT_START]),
      mode: LOOP_MODE,
    },
    {
      tribe: ANIMAL_TRIBE_HARES,
      job: ADULT_ANIMAL_JOB,
      action: WAIT_ACTION,
      bodySeq: 'hare_wait',
      dirFrames: Array.from({ length: FACINGS }, () => [HARE_STANDING_BOB - HARE_WAIT_START]),
      mode: LOOP_MODE,
    },
  ],
  bobSequences: [
    {
      imagelib: 'cr_ani_body_00.bmd',
      sequences: [
        { name: 'cow_wait', start: COW_WAIT_START, length: 16 },
        { name: 'hare_wait', start: HARE_WAIT_START, length: 16 },
      ],
    },
  ],
};

/** The sheet a stub stem's manifest names. */
const sheetOf = (stem: string): string => `${stem}-sheet.webp`;

/** The atlas of `stem` holding `bobs` side by side, 10 px wide each. */
function atlas(stem: string, bobs: readonly number[]) {
  return {
    width: 10 * bobs.length,
    height: 20,
    frames: bobs.map((bobId, i) => ({ bobId, rect: { x: 10 * i, y: 0, width: 10, height: 20 } })),
    image: sheetOf(stem),
  };
}

const served: Record<string, unknown> = {
  '/ir.json': ir,
  '/bobs/atlases.json': bobAtlasDocument({
    [CART_STEM]: atlas(CART_STEM, [CART_OTHER_BOB, CART_STANDING_BOB]),
    [OXCART_STEM]: atlas(OXCART_STEM, [CART_STANDING_BOB]),
    [COW_STEM]: atlas(COW_STEM, [COW_WAIT_START + 1, COW_STANDING_BOB]),
    [HARE_STEM]: atlas(HARE_STEM, [HARE_WAIT_START + 1, HARE_STANDING_BOB]),
    [FISH_STEM]: atlas(FISH_STEM, [FISH_SIDE_BOB - 1, FISH_SIDE_BOB]),
    'ls_goods.goods_gold': atlas('ls_goods.goods_gold', [GOLD_BAR_BOB]),
  }),
  // The data's fish pile is gold's bar in gold's palette.
  '/goods/manifest.json': {
    indexedStem: 'ls_goods.indexed',
    previewStem: 'ls_goods.goods_wood',
    paletteLutStem: 'goods-palettes-lut',
    palettes: ['goods_gold'],
    icons: { fish: { frame: GOLD_BAR_BOB, palette: 'goods_gold', fillFrames: [GOLD_BAR_BOB] } },
  },
};

function stubServer(): void {
  vi.stubGlobal('fetch', (input: unknown) => {
    const body = served[String(input)];
    return Promise.resolve(
      body === undefined ? new Response(null, { status: 404 }) : new Response(JSON.stringify(body)),
    );
  });
}

async function freshIconSource() {
  vi.resetModules();
  return (await import('../../src/hud/dom/good-art.js')).goodIconSource;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a good with no pile icon', { timeout: LOADER_TIMEOUT_MS }, () => {
  it('draws a vehicle good as the standing vehicle from its baked body atlas', async () => {
    stubServer();
    const goodIconSource = await freshIconSource();
    const source = await goodIconSource('handcart', null, sandboxContent());
    expect(source).toEqual({
      url: `/bobs/${sheetOf(CART_STEM)}`,
      sheet: { width: 20, height: 20 },
      rect: { x: 10, y: 0, width: 10, height: 20 },
    });
  });

  it('draws a cart that recruits its ox as the harnessed cart, from the next tribe when the first is unserved', async () => {
    stubServer();
    const goodIconSource = await freshIconSource();
    const base = sandboxContent();
    // The handcart's yard is made to spawn the ox-less cart, which turns into the ox cart once harnessed.
    const content = {
      ...base,
      buildings: base.buildings.map((b) =>
        b.typeId === HANDCART_YARD ? { ...b, vehicleType: CART_NO_OX } : b,
      ),
    };
    const source = await goodIconSource('handcart', null, content);
    expect(source?.url).toBe(`/bobs/${sheetOf(OXCART_STEM)}`);
  });

  it('draws nothing when the IR is not served', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 404 })));
    const goodIconSource = await freshIconSource();
    expect(await goodIconSource('handcart', null, sandboxContent())).toBeNull();
  });

  it('draws a species good as the standing animal from its body atlas', async () => {
    stubServer();
    const goodIconSource = await freshIconSource();
    const source = await goodIconSource('cattle', null, sandboxContent());
    expect(source).toEqual({
      url: `/bobs/${sheetOf(COW_STEM)}`,
      sheet: { width: 20, height: 20 },
      rect: { x: 10, y: 0, width: 10, height: 20 },
    });
  });

  it('draws the prey token as the hare, the one animal standing in for it', async () => {
    stubServer();
    const goodIconSource = await freshIconSource();
    const source = await goodIconSource('prey', null, sandboxContent());
    expect(source).toEqual({
      url: `/bobs/${sheetOf(HARE_STEM)}`,
      sheet: { width: 20, height: 20 },
      rect: { x: 10, y: 0, width: 10, height: 20 },
    });
  });

  it('draws the fish as the swarm fish, never the gold bar its pile copies', async () => {
    stubServer();
    const goodIconSource = await freshIconSource();
    expect(await goodIconSource('fish', null, sandboxContent())).toEqual({
      url: `/bobs/${sheetOf(FISH_STEM)}`,
      sheet: { width: 20, height: 20 },
      rect: { x: 10, y: 0, width: 10, height: 20 },
    });
  });

  it('draws nothing without the game content, and nothing for an ordinary ware', async () => {
    stubServer();
    const goodIconSource = await freshIconSource();
    expect(await goodIconSource('handcart', null, null)).toBeNull();
    expect(await goodIconSource('wood', null, sandboxContent())).toBeNull();
  });
});
