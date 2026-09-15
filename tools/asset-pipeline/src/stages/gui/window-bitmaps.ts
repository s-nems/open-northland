import { type Vfs, vjoin } from '@open-northland/vfs';
import { decodePcx, expandToRgba } from '../../decoders/pcx.js';
import { encodePng } from '../../decoders/png.js';
import { errorMessage } from '../../errors.js';
import { MOD_GUI_BITMAPS_DIR, type SourceRoots } from '../../roots.js';
import { GUI_BITMAPS_DIR } from '../content-tree.js';
import { readSourceFile } from '../source-files.js';

/**
 * Window-fill bitmaps the engine draws through an element palette instead of their embedded one. `bg.pcx`
 * expands to grey marble through its embedded palette while the original's window body is warm brown, which
 * `bg_normal` over the same indices reproduces (observed at 1024×768). Pairing `bg_selected` with
 * `bg_normal` is an observation-anchored approximation: no draw site or palette name pins it, but among the
 * loaded element palettes it is the one reproducing the original's grey-blue card body (avg ≈ #3c4043). The
 * other three `bg_*` bitmaps match through their embedded palettes, so only these two are baked.
 */
const WINDOW_BITMAP_RECOLORS: ReadonlyArray<{ bitmap: string; palette: string; softenShadows?: boolean }> = [
  { bitmap: 'bg', palette: 'bg_normal', softenShadows: true },
  { bitmap: 'bg_selected', palette: 'bg_normal' },
];

/**
 * Shadow floor for the window-body bake (luma points, 0–255). A cosmetic approximation, not decoded engine
 * behaviour: sampled off a native 1024×768 screenshot, the original body's luma percentiles are
 * ≈ [18, 23, 31, 38, 45, 55, 63] (p1…p99), while a straight `bg_normal` swap leaves the marble veins at
 * 0–9 (p1–p5), the "cracked black" look.
 */
const BODY_SHADOW_FLOOR = 31; // the original body's p25
const BODY_SHADOW_KEEP = 0.35;
/** Hue for near-black entries (which have none of their own to scale): the original body's sampled average. */
const BODY_SHADOW_TINT = [60, 36, 19] as const;
/** Below this luma an entry's own hue is noise - recolour it from {@link BODY_SHADOW_TINT} instead. */
const BODY_SHADOW_HUE_MIN = 4;

/** The luma a pure-black entry lands on; ≈20 matches the original body's sampled p1. */
export const BODY_SHADOW_MIN_LUMA = BODY_SHADOW_FLOOR * (1 - BODY_SHADOW_KEEP);

/** Applies the {@link BODY_SHADOW_FLOOR} lift to a copy of `palette` (768 RGB bytes). */
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
 * Bakes each {@link WINDOW_BITMAP_RECOLORS} pairing to `gui-bitmaps/<bitmap>.<palette>.png` under
 * `outDir`. Baking instead of recolouring through a runtime LUT keeps the app side a plain tileable texture.
 */
export async function convertWindowBitmaps(
  fs: Vfs,
  roots: SourceRoots,
  outDir: string,
  paletteByName: ReadonlyMap<string, Uint8Array>,
): Promise<number> {
  let done = 0;
  for (const { bitmap, palette, softenShadows } of WINDOW_BITMAP_RECOLORS) {
    let paletteBytes = paletteByName.get(palette);
    if (paletteBytes === undefined) {
      console.warn(`[pipeline] gui: skipped ${bitmap}.${palette}: palette unavailable`);
      continue;
    }
    if (softenShadows === true) paletteBytes = liftPaletteShadows(paletteBytes);
    try {
      const image = decodePcx(await readSourceFile(fs, roots, vjoin(MOD_GUI_BITMAPS_DIR, `${bitmap}.pcx`)));
      const png = await encodePng(expandToRgba({ ...image, palette: paletteBytes }));
      await fs.writeFile(vjoin(outDir, GUI_BITMAPS_DIR, `${bitmap}.${palette}.png`), png);
      done++;
    } catch (err) {
      console.warn(`[pipeline] gui: skipped ${bitmap}.${palette}: ${errorMessage(err)}`);
    }
  }
  return done;
}
