import type { GlTexture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createHumanPaletteIdentity,
  type HumanPaletteIdentity,
} from '../src/data/palettes/human-palettes.js';
import {
  HUMAN_HEAD_ROW_OFFSET,
  HumanPaletteLut,
  humanPaletteRowsUploader,
  TEAM_HUMANS,
} from '../src/gpu/human-palette-lut.js';
import { syntheticHumanLut, TEST_BASE } from './support/human-palettes.js';

/**
 * The human LUT hands each drawn human a body and head row pair, composes it once per identity, gives it
 * back once the human goes a frame undrawn, and uploads only the pairs that changed.
 */

const ROW_BYTES = 256 * 4;
const TEAM_BAND_START = 15 * 16;
const PRIVATE_HUMANS = 2;
/** Two private humans past the shared and team ones. */
const SMALL_ROWS = HumanPaletteLut.rowsFor(PRIVATE_HUMANS);

const look = { body: TEST_BASE, head: TEST_BASE, random: [] };
const man = (fields: Partial<HumanPaletteIdentity> = {}) =>
  Object.assign(createHumanPaletteIdentity(look), fields);

/** The RGB the LUT holds for palette index `index` of `row`. */
function texel(lut: HumanPaletteLut, row: number, index: number): number[] {
  const bytes = lut.source.resource as Uint8Array;
  const at = row * ROW_BYTES + index * 4;
  return [bytes[at] ?? -1, bytes[at + 1] ?? -1, bytes[at + 2] ?? -1];
}

interface FakeGl {
  readonly texImage2D: ReturnType<typeof vi.fn>;
  readonly texSubImage2D: ReturnType<typeof vi.fn>;
}

function upload(lut: HumanPaletteLut, glTexture: GlTexture): FakeGl {
  const gl = { texImage2D: vi.fn(), texSubImage2D: vi.fn() };
  humanPaletteRowsUploader.upload(lut.source, glTexture, gl as unknown as WebGL2RenderingContext, 2);
  return gl;
}

const freshTexture = () =>
  ({ target: 1, width: 0, height: 0, format: 2, type: 3, internalFormat: 4 }) as unknown as GlTexture;

describe('the human palette LUT', () => {
  it('keeps a row per human, composed once, with the head right under the body', () => {
    const lut = syntheticHumanLut();
    lut.beginFrame();
    const row = lut.rowFor(10, man({ seed: 10 }));
    expect(lut.rowFor(10, man({ seed: 10 }))).toBe(row);
    lut.beginFrame();
    expect(lut.rowFor(10, man({ seed: 10 }))).toBe(row);
    expect(lut.stats.composed).toBe(1);
    expect(texel(lut, row, TEAM_BAND_START)).toEqual([255, 0, 0]);
    // The team recipes patch the body alone, so the head keeps the base's own colour.
    expect(texel(lut, row + HUMAN_HEAD_ROW_OFFSET, TEAM_BAND_START)).toEqual([240, 240, 240]);
  });

  it('recomposes a changed identity in the same row', () => {
    const lut = syntheticHumanLut();
    lut.beginFrame();
    const row = lut.rowFor(10, man());
    lut.beginFrame();
    expect(lut.rowFor(10, man({ female: true }))).toBe(row);
    expect(lut.stats.composed).toBe(2);
    expect(texel(lut, row, TEAM_BAND_START)).toEqual([0, 0, 255]);
  });

  it('gives a row back once its human misses a whole frame, and never takes one drawn last frame', () => {
    const lut = syntheticHumanLut(new Map(), SMALL_ROWS);
    lut.beginFrame();
    const a = lut.rowFor(1, man());
    lut.beginFrame();
    const b = lut.rowFor(2, man());
    // Frame 3: `a` was last drawn in frame 1, so the newcomer takes its row.
    lut.beginFrame();
    expect(lut.rowFor(3, man())).toBe(a);
    expect(lut.rowFor(2, man())).toBe(b);
    // Frame 4: both rows were drawn last frame, so the returning human shares a row instead.
    lut.beginFrame();
    expect(lut.rowFor(1, man())).toBeGreaterThanOrEqual(PRIVATE_HUMANS * 2);
    expect(lut.rowFor(3, man())).toBe(a);
    // Frame 6: `b` missed frames 4 and 5, so its row frees up.
    lut.beginFrame();
    lut.beginFrame();
    expect(lut.rowFor(1, man())).toBe(b);
  });

  it('shares a row per look, player and sex once every private row is drawn this frame', () => {
    const lut = syntheticHumanLut(new Map(), SMALL_ROWS);
    lut.beginFrame();
    lut.rowFor(1, man());
    lut.rowFor(2, man());
    const shared = lut.rowFor(3, man({ seed: 3 }));
    expect(shared).toBeGreaterThanOrEqual(PRIVATE_HUMANS * 2);
    expect(lut.rowFor(4, man({ seed: 4 }))).toBe(shared);
    expect(lut.rowFor(5, man({ female: true }))).not.toBe(shared);
    expect(lut.stats.sharedFallbacks).toBe(3);
  });

  it('uploads the whole texture first, then only the changed row pairs', () => {
    const lut = syntheticHumanLut(new Map(), SMALL_ROWS);
    const glTexture = freshTexture();
    lut.beginFrame();
    lut.rowFor(1, man());
    const first = upload(lut, glTexture);
    expect(first.texImage2D).toHaveBeenCalledTimes(1);
    expect(glTexture.height).toBe(SMALL_ROWS);

    expect(upload(lut, glTexture).texSubImage2D).not.toHaveBeenCalled();

    lut.beginFrame();
    const row = lut.rowFor(2, man());
    lut.rowFor(1, man({ female: true }));
    const next = upload(lut, glTexture);
    expect(next.texImage2D).not.toHaveBeenCalled();
    expect(next.texSubImage2D).toHaveBeenCalledTimes(2);
    const rows = next.texSubImage2D.mock.calls.map((call) => [call[3], call[5], call[9]]);
    expect(rows).toContainEqual([row, 2, row * ROW_BYTES]);
    expect(lut.stats).toMatchObject({ wholeUploads: 1, rowUploads: 2 });
  });

  it('shrinks to the device limit and hands rows out afresh', () => {
    const lut = syntheticHumanLut();
    lut.beginFrame();
    lut.rowFor(1, man());
    lut.fitTo(SMALL_ROWS + 1);
    expect(lut.colours).toBe(SMALL_ROWS);
    expect(lut.rowFor(1, man())).toBe(0);
    expect(lut.stats.composed).toBe(2);
  });
  it('holds an unrolled team row per player past every human row', () => {
    const lut = syntheticHumanLut(new Map(), SMALL_ROWS);
    lut.beginFrame();
    const team = lut.teamRow(0);
    expect(team).toBeGreaterThanOrEqual(SMALL_ROWS - TEAM_HUMANS * 2);
    expect(lut.teamRow(0)).toBe(team);
    expect(texel(lut, team, TEAM_BAND_START)).toEqual([255, 0, 0]);
    expect(lut.stats.composed).toBe(1);
    lut.rowFor(1, man({ seed: 1 }));
    lut.rowFor(2, man({ seed: 2 }));
    lut.rowFor(3, man({ seed: 3 }));
    expect(lut.teamRow(0)).toBe(team);
    expect(texel(lut, team, TEAM_BAND_START)).toEqual([255, 0, 0]);
  });
});
