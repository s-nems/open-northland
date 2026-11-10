import { Rectangle, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { markPalettedTexture } from '../../../src/gpu/pixel-art/registry.js';
import { DrawTable, type TableQuad } from '../../../src/gpu/still-mesh/draw-table.js';

const PAGES = 3;
const SIZE = 8;

const page = (): TextureSource => new TextureSource({ width: SIZE, height: SIZE });
const frameOn = (source: TextureSource): Texture =>
  new Texture({ source, frame: new Rectangle(0, 0, SIZE / 2, SIZE / 2) });
/** A quad no table has placed yet. */
const NO_SLOT = -1;
type PlacedQuad = { -readonly [K in keyof TableQuad]: TableQuad[K] };
const quadOf = (texture: Texture): PlacedQuad => ({
  sprite: { texture },
  lutTexture: null,
  lut: undefined,
  table: null,
  textureId: NO_SLOT,
});
/** A frame drawn through `lut`, as the human palette's frames are. */
function palettedOn(source: TextureSource, lut: TextureSource): Texture {
  const texture = frameOn(source);
  markPalettedTexture(texture, lut);
  return texture;
}

describe('DrawTable', () => {
  it('lists each page once, contiguous from slot 0, and tells of every one it takes on', () => {
    const joined: TextureSource[] = [];
    const table = new DrawTable(PAGES, (source) => joined.push(source));
    const [a, b] = [page(), page()];
    const quads = [quadOf(frameOn(a)), quadOf(frameOn(b)), quadOf(frameOn(a))];
    expect(table.fits(quads)).toBe(true);
    expect(quads.map((quad) => table.join(quad))).toEqual([0, 1, 0]);
    expect(table.count).toBe(2);
    expect(joined).toEqual([a, b]);
  });

  it('lists a page again whose slot a fill dropped, though a quad still names that slot', () => {
    const table = new DrawTable(PAGES, () => {});
    const [first, second] = [quadOf(frameOn(page())), quadOf(frameOn(page()))];
    /** Joins as a quad's owner does, noting where the table put its page. */
    const place = (quad: PlacedQuad): number | null => {
      const slot = table.join(quad);
      quad.table = table;
      quad.textureId = slot ?? NO_SLOT;
      return slot;
    };
    expect([place(first), place(second)]).toEqual([0, 1]);
    table.finish();
    table.begin();
    expect(place(first)).toBe(0);
    table.finish();
    expect(table.count).toBe(1);
    table.begin();
    expect(table.fits([second])).toBe(true);
    expect(place(second)).toBe(1);
    expect(table.count).toBe(2);
  });

  it('counts a page shared by several quads once against the free slots', () => {
    const table = new DrawTable(PAGES, () => {});
    for (const source of [page(), page()]) table.join(quadOf(frameOn(source)));
    const shared = page();
    expect(table.fits([quadOf(frameOn(shared)), quadOf(frameOn(shared))])).toBe(true);
    expect(table.fits([quadOf(frameOn(shared)), quadOf(frameOn(page()))])).toBe(false);
  });

  it('takes one LUT, refusing a quad drawn through another', () => {
    const table = new DrawTable(PAGES, () => {});
    const [human, other] = [page(), page()];
    const body = quadOf(palettedOn(page(), human));
    expect(table.fits([body])).toBe(true);
    table.join(body);
    expect(table.lut).toBe(human);
    expect(table.fits([quadOf(palettedOn(page(), human)), quadOf(frameOn(page()))])).toBe(true);
    const stranger = quadOf(palettedOn(page(), other));
    expect(table.fits([stranger])).toBe(false);
    expect(table.join(stranger)).toBeNull();
    table.clear();
    expect(table.lut).toBeNull();
    expect(table.fits([stranger])).toBe(true);
  });

  it('fits no quad drawing from a destroyed page', () => {
    const table = new DrawTable(PAGES, () => {});
    const gone = page();
    const quad = quadOf(frameOn(gone));
    gone.destroy();
    expect(table.fits([quad])).toBe(false);
  });

  it('keeps each page in its slot from fill to fill, trimming the unclaimed tail', () => {
    const table = new DrawTable(PAGES, () => {});
    const [a, b, c] = [page(), page(), page()];
    for (const source of [a, b, c]) table.join(quadOf(frameOn(source)));
    table.finish();
    table.begin();
    // The next fill meets the pages in another order and without the last one.
    expect([b, a].map((source) => table.join(quadOf(frameOn(source))))).toEqual([1, 0]);
    table.finish();
    expect(table.count).toBe(2);
    expect(table.textures.slice(0, 2)).toEqual([a, b]);
  });

  it('gives a new page the slot of one the fill has not claimed once the table is full', () => {
    const table = new DrawTable(PAGES, () => {});
    const [a, b, c, d] = [page(), page(), page(), page()];
    for (const source of [a, b, c]) table.join(quadOf(frameOn(source)));
    table.finish();
    table.begin();
    expect(table.fits([quadOf(frameOn(c)), quadOf(frameOn(d))])).toBe(true);
    expect([c, d].map((source) => table.join(quadOf(frameOn(source))))).toEqual([2, 0]);
    expect(table.fits([quadOf(frameOn(a)), quadOf(frameOn(b))])).toBe(false);
    expect(table.join(quadOf(frameOn(b)))).toBe(1);
    expect(table.join(quadOf(frameOn(a)))).toBeNull();
  });

  it('points an unclaimed slot whose page was destroyed at a claimed page as a fill ends', () => {
    const table = new DrawTable(PAGES, () => {});
    const [a, b, c] = [page(), page(), page()];
    for (const source of [a, b, c]) table.join(quadOf(frameOn(source)));
    table.finish();
    table.begin();
    for (const source of [a, c]) table.join(quadOf(frameOn(source)));
    b.destroy();
    table.finish();
    expect(table.count).toBe(PAGES);
    expect(table.textures.slice(0, PAGES)).toEqual([a, a, c]);
  });

  it('keeps a page listed at its own slot when a stand-in copy of it is dropped or reused', () => {
    const table = new DrawTable(PAGES, () => {});
    const [a, gone, b, fresh] = [page(), page(), page(), page()];
    for (const source of [a, gone, b]) table.join(quadOf(frameOn(source)));
    table.finish();
    table.begin();
    for (const source of [a, b]) table.join(quadOf(frameOn(source)));
    gone.destroy();
    table.finish();
    // `a` now also stands in the destroyed page's slot.
    expect(table.textures.slice(0, PAGES)).toEqual([a, a, b]);
    table.begin();
    table.join(quadOf(frameOn(a)));
    const member = [fresh, a, b].map((source) => quadOf(frameOn(source)));
    expect(table.fits(member)).toBe(true);
    expect(member.map((quad) => table.join(quad))).toEqual([1, 0, 2]);
  });
});
