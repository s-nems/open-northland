import { GLOW_PALETTE_INDEX, HUMAN_PALETTE_BYTES, type ResolvedLayer } from '@open-northland/render';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type FigureWell,
  FigureWellSlots,
  PERSON_WELL_FIT,
  showInWell,
} from '../src/hud/dom/parts/figure-well.js';
import { flatGlowPalette, layerColours } from '../src/hud/figures/figure-frames.js';
import { NO_FIGURE_SLOTS } from '../src/hud/figures/live-figures.js';

const RGB = 3;
/** The team ramp step the glow reads, set apart from every other index of the source palette. */
const GLOW_RGB = [12, 34, 200] as const;

function sourcePalette(): Uint8Array {
  const palette = new Uint8Array(HUMAN_PALETTE_BYTES).fill(7);
  palette.set(GLOW_RGB, GLOW_PALETTE_INDEX * RGB);
  return palette;
}

const palettes = { body: new Uint8Array(HUMAN_PALETTE_BYTES), head: new Uint8Array(HUMAN_PALETTE_BYTES) };
const layer = (extra: Partial<ResolvedLayer>): ResolvedLayer => ({ scale: 1, ...extra }) as ResolvedLayer;

describe('figure glow colours', () => {
  it('paints every palette index in the glow step of the source palette', () => {
    const flat = flatGlowPalette(sourcePalette());
    expect(flat).toHaveLength(HUMAN_PALETTE_BYTES);
    for (let at = 0; at < flat.length; at += RGB) expect([...flat.subarray(at, at + RGB)]).toEqual(GLOW_RGB);
  });

  it('recolours a glow copy flat, the head and body through their own palettes, and leaves a shadow out', () => {
    const glow = flatGlowPalette(sourcePalette());
    expect(layerColours(layer({ glow: 0.25 }), palettes, glow)).toBe(glow);
    expect(layerColours(layer({ head: true }), palettes, undefined)).toBe(palettes.head);
    expect(layerColours(layer({}), palettes, undefined)).toBe(palettes.body);
    expect(layerColours(layer({ shadow: true }), palettes, undefined)).toBeNull();
  });

  it('leaves out the glow of a look without palettes, as the map does, and draws its body as baked', () => {
    expect(layerColours(layer({ glow: 0.25 }), undefined, undefined)).toBeNull();
    expect(layerColours(layer({}), undefined, undefined)).toBeUndefined();
  });
});

/** A well whose canvas reports a laid-out box of `width` x `height` design px at `scale` client px each. */
function fakeWell(entity: number | null, width = 28, height = 36, scale = 1): FigureWell {
  const canvas = {
    width: 56,
    offsetWidth: width,
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({ width: width * scale }),
  } as unknown as HTMLCanvasElement;
  const classes = new Set<string>();
  const node = {
    classList: {
      contains: (name: string) => classes.has(name),
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
    },
  } as unknown as HTMLButtonElement;
  return { node, glyph: node, canvas, fit: PERSON_WELL_FIT, entity };
}

describe('figure well slots', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the slot list while the people and the box hold, and rebuilds it when either changes', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const wells = [fakeWell(4), fakeWell(null), fakeWell(9)];
    const slots = new FigureWellSlots();
    const first = slots.of(wells);
    expect(first.map((slot) => slot.entity)).toEqual([4, 9]);
    expect(first[0]?.box).toEqual({ width: 28, height: 36, pixelScale: 2 });
    expect(slots.of(wells)).toBe(first);
    const [, free] = wells;
    if (free !== undefined) free.entity = 5;
    expect(slots.of(wells).map((slot) => slot.entity)).toEqual([4, 5, 9]);
    vi.stubGlobal('devicePixelRatio', 1);
    expect(slots.of(wells)[0]?.box.pixelScale).toBe(1);
  });

  it('answers no slots while no well holds a person or the wells are not laid out', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    expect(new FigureWellSlots().of([fakeWell(null)])).toBe(NO_FIGURE_SLOTS);
    expect(new FigureWellSlots().of([fakeWell(3, 0)])).toBe(NO_FIGURE_SLOTS);
  });

  it('clears a well whose person changed, so a free seat never keeps the last frame', () => {
    const well = fakeWell(4);
    well.node.classList.toggle('on-seat-well--live', true);
    showInWell(well, null);
    expect(well.entity).toBeNull();
    expect(well.canvas.width).toBe(0);
    expect(well.node.classList.contains('on-seat-well--live')).toBe(false);
  });
});
