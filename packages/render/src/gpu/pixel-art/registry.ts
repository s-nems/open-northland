import type { Texture, TextureSource } from 'pixi.js';
import type { ShadowStyle } from '../world-batch/shadow-style.js';

/**
 * How original pixel art magnifies under enhanced sampling. xBR runs per fragment at any zoom. A
 * prescaled scaler redraws the plain atlas pages a view draws at twice their size, on the GPU, and the
 * world batch samples those through the sharp path; a paletted character keeps xBR there, since an
 * index image cannot be rescaled.
 */
const SHADER_SCALERS = ['xbr'] as const;
export const PRESCALED_SCALERS = ['xbrz', 'superxbr', 'mmpx'] as const;
export const PIXEL_ART_SCALERS = [...SHADER_SCALERS, ...PRESCALED_SCALERS] as const;
export type PixelArtScaler = (typeof PIXEL_ART_SCALERS)[number];
export type PrescaledScaler = (typeof PRESCALED_SCALERS)[number];
export const DEFAULT_PIXEL_ART_SCALER: PixelArtScaler = 'xbr';

/** A stored scaler name; `null` for anything else. */
export function parsePixelArtScaler(raw: unknown): PixelArtScaler | null {
  return PIXEL_ART_SCALERS.find((scaler) => scaler === raw) ?? null;
}

/** The page prescaler `scaler` runs, or `null` for a shader scaler. */
export function prescaledScalerOf(scaler: PixelArtScaler): PrescaledScaler | null {
  return PRESCALED_SCALERS.find((prescaled) => prescaled === scaler) ?? null;
}

/** `off` is enhanced sampling disabled: world sprites sample exactly as Pixi's default batcher. */
export type WorldMagnification = PixelArtScaler | 'off';

/** The world batch program's compile-time modes, which the dismantle overlay's sampling uniform shares
 *  (its 1 is a linear page drawn without a magnifier). Every prescaled scaler shares one mode: the
 *  program reads whichever page it is handed, and only the prescaler differs. */
const WORLD_MAGNIFY_MODE_NAMES = ['off', 'xbr', 'prescaled'] as const;
export type WorldMagnifyModeName = (typeof WORLD_MAGNIFY_MODE_NAMES)[number];
export const WORLD_MAGNIFY_MODES: Readonly<Record<WorldMagnifyModeName, number>> = {
  off: 0,
  xbr: 3,
  prescaled: 4,
};

/** The name a program reports for a compile-time mode. */
export function worldMagnifyModeName(mode: number): WorldMagnifyModeName | undefined {
  return WORLD_MAGNIFY_MODE_NAMES.find((name) => WORLD_MAGNIFY_MODES[name] === mode);
}

/** Every compile-time mode once, for the catalogue that compiles them all. */
export const WORLD_MAGNIFY_MODE_NUMBERS: readonly number[] = WORLD_MAGNIFY_MODE_NAMES.map(
  (name) => WORLD_MAGNIFY_MODES[name],
);
const MAGNIFY_MODES: Readonly<Record<WorldMagnification, number>> = {
  off: WORLD_MAGNIFY_MODES.off,
  xbr: WORLD_MAGNIFY_MODES.xbr,
  xbrz: WORLD_MAGNIFY_MODES.prescaled,
  superxbr: WORLD_MAGNIFY_MODES.prescaled,
  mmpx: WORLD_MAGNIFY_MODES.prescaled,
};

/**
 * Atlas pages loaded as authored pixel art, and the textures the world's caches mint from them. A
 * marked texture magnifies only inside the `world` batcher, which only `worldBatched` sprites reach;
 * HUD elements drawing the same goods pages through their own textures and Pixi's default batcher
 * stay untouched.
 */
const pixelArtSources = new WeakSet<TextureSource>();
const magnifiedTextures = new WeakSet<Texture>();

export function markPixelArtSource(source: TextureSource): void {
  pixelArtSources.add(source);
}

export function isPixelArtSource(source: TextureSource): boolean {
  return pixelArtSources.has(source);
}

/** Register a world texture for edge-aware magnification; a no-op unless its page is pixel art. */
export function markMagnifiedTexture(texture: Texture, page: TextureSource = texture.source): void {
  if (pixelArtSources.has(page)) magnifiedTextures.add(texture);
}

export function isMagnifiedTexture(texture: Texture): boolean {
  return magnifiedTextures.has(texture);
}

/** The mode the batch shader is compiled for; one value for every renderer on the page. */
let magnifyMode = MAGNIFY_MODES.off;

export function setPixelArtMagnification(mode: WorldMagnification): void {
  magnifyMode = MAGNIFY_MODES[mode];
}

export function pixelArtMagnifyMode(): number {
  return magnifyMode;
}

/** The compile-time mode number the world batch shader takes for `mode`. */
export function worldMagnifyModeNumber(mode: WorldMagnification): number {
  return MAGNIFY_MODES[mode];
}

/**
 * A page's prescaled twin, which the world batch binds in its place: the same layout at twice the
 * texels, so every frame's UVs still hold and only the texel size the shader reads changes.
 */
const prescaledPages = new WeakMap<TextureSource, TextureSource>();
/** Twins registered now, so a batch skips the lookup while none exist. */
let prescaledPageCount = 0;

export function setPrescaledPage(page: TextureSource, prescaled: TextureSource | null): void {
  const had = prescaledPages.has(page);
  if (prescaled === null) prescaledPages.delete(page);
  else prescaledPages.set(page, prescaled);
  prescaledPageCount += (prescaled === null ? 0 : 1) - (had ? 1 : 0);
}

export function hasPrescaledPages(): boolean {
  return prescaledPageCount > 0;
}

export function prescaledPageOf(page: TextureSource): TextureSource | undefined {
  return prescaledPages.get(page);
}

/**
 * The pages world batches listed since the prescaler last took them, gathered only while a prescaled
 * scaler is selected: the working set it redraws and keeps. Two sets swap so a frame allocates none.
 */
let drawnPages: Set<TextureSource> | null = null;
let takenPages = new Set<TextureSource>();

export function collectDrawnPages(collect: boolean): void {
  drawnPages = collect ? (drawnPages ?? new Set()) : null;
  takenPages.clear();
}

export function isCollectingDrawnPages(): boolean {
  return drawnPages !== null;
}

export function noteDrawnPage(page: TextureSource): void {
  drawnPages?.add(page);
}

/** The pages drawn since the last call; the set is reused, so read it before the next call. */
export function takeDrawnPages(): ReadonlySet<TextureSource> {
  if (drawnPages === null) return takenPages;
  const drawn = drawnPages;
  takenPages.clear();
  drawnPages = takenPages;
  takenPages = drawn;
  return drawn;
}

/**
 * Textures the world batch shader shades as shadow silhouettes: it keeps only their coverage and paints
 * them in the style's own colour and depth. A silhouette atlas page serves nothing else, so its frame
 * views mark straight through; a body frame drawn as a cast silhouette needs a texture view of its own,
 * since the body itself draws from the same page.
 */
const shadowTextures = new WeakSet<Texture>();

export function markShadowTexture(texture: Texture): void {
  shadowTextures.add(texture);
}

export function isShadowTexture(texture: Texture): boolean {
  return shadowTextures.has(texture);
}

/** How a sheet's pixels read: colour with alpha, the indexed layout (palette index in red, coverage in
 *  green, opaque), or the displacement layout (a value in red, the written mask in alpha, straight). */
export type AtlasSheetLayout = 'rgba' | 'indexed' | 'displacement';

/** Pages in the indexed layout. Every texture cut from one, a cast silhouette included, takes its
 *  coverage from green in the world batch. */
const indexedSources = new WeakSet<TextureSource>();

export function markIndexedSource(source: TextureSource): void {
  indexedSources.add(source);
}

export function isIndexedSource(source: TextureSource): boolean {
  return indexedSources.has(source);
}

/**
 * Frames of palette-indexed sheets (characters, ship yard sites) and the palette LUT each draws through. The world batch
 * shader reads such a texel's red channel as a palette index and its green as coverage, and looks the
 * colour up in the sprite's `lutRow` of that LUT, which rides in the batch's own texture list.
 */
const palettedTextures = new WeakMap<Texture, TextureSource>();
/** The LUT row of a paletted texture that names its own, a recoloured stem's frame; a character's row
 *  rides on its sprite instead. */
const palettedRows = new WeakMap<Texture, number>();

export function markPalettedTexture(texture: Texture, lut: TextureSource, row?: number): void {
  palettedTextures.set(texture, lut);
  if (row !== undefined) palettedRows.set(texture, row);
}

export function palettedRowOf(texture: Texture): number | undefined {
  return palettedRows.get(texture);
}

export function palettedLutOf(texture: Texture): TextureSource | undefined {
  return palettedTextures.get(texture);
}

/** The shadow shading the batch shader is compiled for, or `null` while the enhancement is off. */
let shadowStyle: ShadowStyle | null = null;

export function setWorldShadowStyle(style: ShadowStyle | null): void {
  shadowStyle = style;
}

export function worldShadowStyle(): ShadowStyle | null {
  return shadowStyle;
}
