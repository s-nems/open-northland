import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodePcx, expandToRgba } from '../../decoders/pcx.js';
import { encodePng } from '../../decoders/png.js';
import { errorMessage } from '../../errors.js';
import type { SourceRoots } from '../../roots.js';
import { readSourceFile } from '../source-files.js';

/**
 * Window-fill bitmaps that the engine draws through an element palette instead of their embedded one.
 * `Data/gui/bitmaps/bg.pcx` expands to grey marble through its embedded palette, but every in-game window
 * body in the original renders it warm brown — the `bg_normal` element palette applied to the same indices
 * matches those screenshots (verified visually at 1024×768; the palette's name also states the pairing).
 * `bg_selected` — the original's selected-item card body, which is exactly what the selection info panel is —
 * shows as a grey-blue marble in the original, and its embedded palette (a warm olive) does not reproduce
 * that. `bg_normal` is the pairing chosen here not because a decoded draw-site or the palette name pins it —
 * by name `bg_hilite`/`bg_invert` would fit "selected" better — but because, among the loaded element
 * palettes, `bg_normal` is the one whose indices reproduce the observed grey-blue (avg ≈ #3c4043): an
 * observation-anchored approximation, weaker-evidenced than the `bg` pairing above. Unlike `bg` it needs no
 * shadow lift — its darkest veins hold luma ≈ 48 (p1) through `bg_normal`, so they never read as cracked black.
 * The remaining three `bg_*` bitmaps match the original through their embedded palettes, so only these two
 * are baked. `softenShadows` additionally lifts the swapped palette's near-black entries
 * ({@link liftPaletteShadows}).
 */
const WINDOW_BITMAP_RECOLORS: ReadonlyArray<{ bitmap: string; palette: string; softenShadows?: boolean }> = [
  { bitmap: 'bg', palette: 'bg_normal', softenShadows: true },
  { bitmap: 'bg_selected', palette: 'bg_normal' },
];

/**
 * Shadow floor for the window-body bake (luma points, 0–255). A cosmetic lift applied on top of the
 * `bg`→`bg_normal` swap above — the original engine does not lift; it is inferred from screenshots,
 * not decoded behaviour. Sampled off the same native 1024×768 screenshot the panel
 * geometry is calibrated against: the original body's luma percentiles are ≈ [18, 23, 31, 38, 45, 55, 63]
 * (p1…p99) — its texture never drops near black — while a straight `bg_normal` swap leaves the marble
 * veins at 0–9 (p1–p5), the "cracked black" look. Palette entries below the floor are pulled up toward it,
 * keeping {@link BODY_SHADOW_KEEP} of their depth (`luma' = FLOOR − (FLOOR − luma) · KEEP`), which lands
 * pure black at ≈20 — the original's p1.
 */
const BODY_SHADOW_FLOOR = 31; // the original body's p25 — the vein lift's anchor
const BODY_SHADOW_KEEP = 0.35;
/** Hue for near-black entries (which have none of their own to scale): the original body's sampled average. */
const BODY_SHADOW_TINT = [60, 36, 19] as const;
/** Below this luma an entry's own hue is noise — recolour it from {@link BODY_SHADOW_TINT} instead. */
const BODY_SHADOW_HUE_MIN = 4;

/** The near-black luma every entry is lifted at least to (the {@link BODY_SHADOW_KEEP} residual of a pure-black
 *  entry). Exposed for the arithmetic-invariant test; ≈20 matches the original body's sampled p1. */
export const BODY_SHADOW_MIN_LUMA = BODY_SHADOW_FLOOR * (1 - BODY_SHADOW_KEEP);

/** Applies the {@link BODY_SHADOW_FLOOR} lift to a copy of `palette` (768 RGB bytes), returning the copy. */
export function liftPaletteShadows(palette: Uint8Array): Uint8Array {
  const lifted = Uint8Array.from(palette);
  const tintLuma = (BODY_SHADOW_TINT[0] + BODY_SHADOW_TINT[1] + BODY_SHADOW_TINT[2]) / 3;
  for (let i = 0; i < lifted.length; i += 3) {
    const r = lifted[i] ?? 0;
    const g = lifted[i + 1] ?? 0;
    const b = lifted[i + 2] ?? 0;
    const luma = (r + g + b) / 3;
    if (luma >= BODY_SHADOW_FLOOR) continue;
    const targetLuma = BODY_SHADOW_FLOOR - (BODY_SHADOW_FLOOR - luma) * BODY_SHADOW_KEEP;
    const useTint = luma < BODY_SHADOW_HUE_MIN;
    const source = useTint ? BODY_SHADOW_TINT : ([r, g, b] as const);
    const sourceLuma = useTint ? tintLuma : luma;
    for (let c = 0; c < 3; c++) {
      lifted[i + c] = Math.min(255, Math.round((source[c] ?? 0) * (targetLuma / sourceLuma)));
    }
  }
  return lifted;
}

/**
 * Bakes each {@link WINDOW_BITMAP_RECOLORS} pairing to `Data/gui/bitmaps/<bitmap>.<palette>.png` under
 * `outDir`, beside the embedded-palette conversions from the loose-`.pcx` pass. Baking (instead of a
 * runtime LUT) keeps the app side a plain tileable texture. Warns-and-skips per file like the other steps.
 */
export async function convertWindowBitmaps(
  roots: SourceRoots,
  outDir: string,
  paletteByName: ReadonlyMap<string, Uint8Array>,
): Promise<number> {
  const bitmapsDir = join('Data', 'gui', 'bitmaps');
  let done = 0;
  for (const { bitmap, palette, softenShadows } of WINDOW_BITMAP_RECOLORS) {
    let paletteBytes = paletteByName.get(palette);
    if (paletteBytes === undefined) {
      console.warn(`[pipeline] gui: skipped ${bitmap}.${palette}: palette unavailable`);
      continue;
    }
    if (softenShadows === true) paletteBytes = liftPaletteShadows(paletteBytes);
    try {
      const image = decodePcx(await readSourceFile(roots, join(bitmapsDir, `${bitmap}.pcx`)));
      const png = encodePng(expandToRgba({ ...image, palette: paletteBytes }));
      await mkdir(join(outDir, bitmapsDir), { recursive: true });
      await writeFile(join(outDir, bitmapsDir, `${bitmap}.${palette}.png`), png);
      done++;
    } catch (err) {
      console.warn(`[pipeline] gui: skipped ${bitmap}.${palette}: ${errorMessage(err)}`);
    }
  }
  return done;
}
