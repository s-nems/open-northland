import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_COLOR_COUNT } from '../../../src/catalog/roster.js';
import { bobAtlasDocument } from '../../support/bob-atlases.js';

/** The palette index the marker bobs draw most of their pixels in (colour range 1, the team ramp). */
const MARKER_INDEX = 26;
const PALETTE_ENTRIES = 256;
const RGB = 3;
const RGBA = 4;
const OPAQUE = 255;
const RED_SLOT = 1;

/** A sign stem's palette, black but for `colour` at {@link MARKER_INDEX}. */
function signPalette(colour: readonly [number, number, number]): string {
  const bytes = new Uint8Array(PALETTE_ENTRIES * RGB);
  bytes.set(colour, MARKER_INDEX * RGB);
  return Buffer.from(bytes).toString('base64');
}

/** Serves `bobs/atlases.json` with the sign stems `ls_temp.human_player01..` of `slots` colour slots,
 *  slot `n` coloured `[n, 100, 200]`. */
function serveSigns(slots: number): void {
  const stems = Object.fromEntries(
    Array.from({ length: slots }, (_, slot) => [
      `ls_temp.human_player${String(slot + 1).padStart(2, '0')}`,
      {
        image: 'signs.png',
        palette: signPalette([slot, 100, 200]),
        imageEncoding: 'index-coverage-png' as const,
        width: 1,
        height: 1,
        frames: [],
      },
    ]),
  );
  const catalogue = JSON.stringify(bobAtlasDocument(stems));
  vi.stubGlobal('fetch', (input: unknown) =>
    Promise.resolve(
      String(input) === '/bobs/atlases.json' ? new Response(catalogue) : new Response(null, { status: 404 }),
    ),
  );
}

async function freshLoader() {
  vi.resetModules();
  return (await import('../../../src/content/gui/player-palettes.js')).loadPlayerPaletteLut;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the player palette LUT', () => {
  it("holds each colour slot's own human_playerNN palette, opaque, in the slot's row", async () => {
    serveSigns(PLAYER_COLOR_COUNT);
    const lut = await (await freshLoader())();
    expect(lut?.colours).toBe(PLAYER_COLOR_COUNT);
    const rows: unknown = lut?.source.resource;
    if (!(rows instanceof Uint8Array)) throw new Error('the LUT holds no rows');
    const at = (RED_SLOT * PALETTE_ENTRIES + MARKER_INDEX) * RGBA;
    expect([...rows.subarray(at, at + RGBA)]).toEqual([RED_SLOT, 100, 200, OPAQUE]);
  });

  it('is absent while a colour slot has no sign stem to read its palette off', async () => {
    serveSigns(PLAYER_COLOR_COUNT - 1);
    expect(await (await freshLoader())()).toBeNull();
  });
});
