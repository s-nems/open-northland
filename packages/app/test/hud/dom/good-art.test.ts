import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoodIconSource, PresentationPack } from '../../../src/presentation/pack.js';

const SHEET: GoodIconSource = {
  url: '/bobs/goods.png',
  sheet: { width: 1008, height: 250 },
  rect: { x: 40, y: 12, width: 18, height: 14 },
};

/** A pack that serves every good from `SHEET`. */
const pack = { goodIconSource: () => SHEET } as unknown as PresentationPack;

let draws: unknown[][] = [];
let readable = true;

describe('good icon pictures', () => {
  beforeEach(() => {
    draws = [];
    readable = true;
    vi.resetModules();
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        decode = () => Promise.resolve();
      },
    );
    const canvas = {
      width: 0,
      height: 0,
      toDataURL: () => {
        if (!readable) throw new Error('tainted');
        return 'data:crop';
      },
      getContext: () => ({ canvas, drawImage: (...args: unknown[]) => draws.push(args.slice(1)) }),
    };
    vi.stubGlobal('document', { createElement: () => canvas });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the good's frame cut out of its sheet once, so a panel never makes the GPU upload the sheet", async () => {
    const { goodIconPicture } = await import('../../../src/hud/dom/good-art.js');
    const cropped = {
      url: 'data:crop',
      sheet: { width: 18, height: 14 },
      rect: { x: 0, y: 0, width: 18, height: 14 },
    };
    expect(await goodIconPicture('wood', pack, null)).toEqual(cropped);
    expect(await goodIconPicture('wood', pack, null)).toEqual(cropped);
    expect(draws).toEqual([[40, 12, 18, 14, 0, 0, 18, 14]]);
  });

  it('keeps the sheet when the page may not read the crop back', async () => {
    readable = false;
    const { goodIconPicture } = await import('../../../src/hud/dom/good-art.js');
    expect(await goodIconPicture('wood', pack, null)).toEqual(SHEET);
  });
});
