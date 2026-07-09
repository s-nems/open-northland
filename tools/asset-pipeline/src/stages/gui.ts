import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type BobAtlas, packBobAtlas, packIndexedBobAtlas } from '../decoders/atlas.js';
import { decodeBmd } from '../decoders/bmd.js';
import { decodeCursor } from '../decoders/cursor.js';
import { decodeCifStringTable } from '../decoders/ini.js';
import { decodePcx, expandToRgba } from '../decoders/pcx.js';
import { buildPlayerLutImage } from '../decoders/player-palette.js';
import { encodePng } from '../decoders/png.js';
import { BOBS_DIR, identityPalette, readGameFile, writeBobAtlas } from './game-file.js';

/**
 * GUI extraction stage — the original in-game HUD art, colorization palettes, UI strings, and mouse
 * cursors, converted from an OWNED game copy into `content/` for the app to consume. It is the GUI twin
 * of the character/building bob stages, reusing their pieces:
 *
 *  - **Atlas art.** `ls_gui_window.bmd` (193 bobs: tool-panel chrome, order buttons, window frames,
 *    progress/hit bars, minimap chrome) and `ls_gui_bubbles.bmd` (23 speech/thought bubbles) are the same
 *    CBobManager `.bmd` the settlers use, so each becomes (a) an **indexed** atlas (`packIndexedBobAtlas` —
 *    palette index in red, mask in alpha) the renderer colours per element at draw time through a palette
 *    LUT, plus (b) an **RGBA preview** atlas (`packBobAtlas`) coloured with one sensible default palette so
 *    a human can eyeball "chrome, not noise". Both ride the existing `/bobs/` route (`<stem>.png` +
 *    `<stem>.atlas.json`), so the app's `loadLayer` reads them unchanged.
 *  - **Palettes.** The engine colours each HUD element with a `Data/gui/palettes/*.pcx` (2×2 carriers
 *    whose real payload is the 256-colour trailer). We stack them into one `256 × N` LUT PNG — the exact
 *    mechanism as the player-colour LUT ({@link buildPlayerLutImage}) — with the row order fixed by
 *    {@link GUI_PALETTES} (mirrored app-side, so no sidecar descriptor is needed). The renderer reads an
 *    indexed atlas pixel through the LUT row for its element's palette. Which palette pairs with which
 *    element is documented in `docs/SOURCES.md` (from the OpenVikings `CGuiBaseDataManager`/`CGuiManager`
 *    oracle: `iconsleft` = the whole tool panel, `context` = the order icons, `frame`/`bg_*`/`bar_*`/
 *    `papyrus` = windows & bars).
 *  - **Strings.** The nine `ingamegui*.cif` UI tables per language are `CStringArray`s (already decoded by
 *    `cif.ts`); we emit id→text JSON per language, re-decoded to CP1250 for the display glyphs.
 *  - **Cursors.** The three `DataX/Mouse/*.cur` are standard Win32 cursors — decoded to PNG (with hotspot)
 *    and copied through verbatim so the app can use either the `.cur` (CSS `cursor: url()`) or the PNG.
 *
 * Boundary failures are warned-and-skipped, never fatal (matching the other tree-walk stages): a missing
 * `.bmd`/palette/string table/cursor drops that one output rather than aborting the run. All sources are
 * loose files read straight from `gameDir` (the HUD ships unpacked; the culturesnation mod does not
 * override it), so this stage does not depend on the `.lib` unpack. No copyrighted bytes enter the repo —
 * everything lands under the gitignored `content/`.
 */

/** The `content/gui/` subtree the strings + cursors + top-level manifest are written to (served at `/gui/`). */
const GUI_CONTENT_DIR = 'gui';
/** The dir holding the 2×2 palette carriers the engine colours HUD elements with. */
const GUI_PALETTES_DIR = join('Data', 'gui', 'palettes');
/** The speech/thought-bubble palette (a different tree from the element palettes). */
const BUBBLES_PALETTE_FILE = join('Data', 'engine2d', 'bin', 'palettes', 'gui', 'gui_bubbles.pcx');
/** Filename stem of the emitted GUI palette LUT (a `/bobs/` PNG, loaded like the player-colour LUT). */
export const GUI_PALETTE_LUT_STEM = 'gui-palettes-lut';

/** One GUI colorization palette: its LUT-row name and the `.pcx` carrier it is read from (under `gameDir`). */
interface GuiPaletteSource {
  readonly name: string;
  readonly file: string;
}

/**
 * The GUI colorization palettes, in LUT-row order (row index = array index). The 13 in-game HUD element
 * palettes from `Data/gui/palettes/` (the `font_*` ones belong to the later font step; `campaignmap`/
 * `campaignbuttons`/`menu_remap` are menu/campaign, not in-game HUD), then `gui_bubbles` for the bubble
 * sheet. The renderer reads an indexed GUI atlas pixel through the row named here for its element. This
 * order is the contract with the app (mirrored in `packages/app/src/content/gui-gfx.ts`) — append, never
 * reorder, or the app's row indices drift.
 */
const GUI_PALETTES: readonly GuiPaletteSource[] = [
  { name: 'iconsleft', file: join(GUI_PALETTES_DIR, 'iconsleft.pcx') },
  { name: 'context', file: join(GUI_PALETTES_DIR, 'context.pcx') },
  { name: 'frame', file: join(GUI_PALETTES_DIR, 'frame.pcx') },
  { name: 'bar_standart', file: join(GUI_PALETTES_DIR, 'bar_standart.pcx') },
  { name: 'bar_hitpoints', file: join(GUI_PALETTES_DIR, 'bar_hitpoints.pcx') },
  { name: 'bar_disabled', file: join(GUI_PALETTES_DIR, 'bar_disabled.pcx') },
  { name: 'bg_normal', file: join(GUI_PALETTES_DIR, 'bg_normal.pcx') },
  { name: 'bg_hilite', file: join(GUI_PALETTES_DIR, 'bg_hilite.pcx') },
  { name: 'bg_invert', file: join(GUI_PALETTES_DIR, 'bg_invert.pcx') },
  { name: 'ingame_remap_01', file: join(GUI_PALETTES_DIR, 'ingame_remap_01.pcx') },
  { name: 'ingame_remap_02', file: join(GUI_PALETTES_DIR, 'ingame_remap_02.pcx') },
  { name: 'ingame_remap_03', file: join(GUI_PALETTES_DIR, 'ingame_remap_03.pcx') },
  { name: 'papyrus', file: join(GUI_PALETTES_DIR, 'papyrus.pcx') },
  { name: 'gui_bubbles', file: BUBBLES_PALETTE_FILE },
];

/** The GUI bob sheets to atlas, each with the palette its RGBA preview is coloured through. */
interface GuiAtlasSource {
  readonly stem: string;
  readonly bmd: string;
  /** A {@link GUI_PALETTES} name — the palette that colours the most of this sheet (best default preview). */
  readonly previewPalette: string;
}

/**
 * The GUI bob sheets. `ls_gui_window` is drawn mostly through `iconsleft` (the whole tool panel; the order
 * icons use `context`) per the OpenVikings oracle, so `iconsleft` is the best single preview palette; the
 * bubble sheet uses its own `gui_bubbles` palette.
 */
const GUI_ATLASES: readonly GuiAtlasSource[] = [
  { stem: 'ls_gui_window', bmd: join(BOBS_DIR, 'ls_gui_window.bmd'), previewPalette: 'iconsleft' },
  { stem: 'ls_gui_bubbles', bmd: join(BOBS_DIR, 'ls_gui_bubbles.bmd'), previewPalette: 'gui_bubbles' },
];

/** The nine in-game GUI string tables (files are `ingamegui<table>.cif` under `Data/text/<lang>/strings/ingamegui/`). */
const STRING_TABLES = [
  'main',
  'misc',
  'miscwindow',
  'misclogic',
  'messages',
  'humanwindow',
  'humanlistwindow',
  'housewindow',
  'vehiclewindow',
] as const;

/** The three mouse cursors under `DataX/Mouse/`, in a stable order. */
const CURSORS = ['MouseNormal', 'MousePressed', 'MouseRight'] as const;
const MOUSE_DIR = join('DataX', 'Mouse');

/** Languages whose GUI strings are extracted (the deliverable's "at least eng and pol"). */
const STRING_LANGS = ['eng', 'pol'] as const;

/** One emitted GUI bob atlas: the app-side `loadLayer` stems for its indexed + preview forms, plus frame count. */
export interface GuiAtlasResult {
  readonly stem: string;
  /** `loadLayer` stem for the recolourable indexed atlas (`<stem>.indexed`). */
  readonly indexedStem: string;
  /** `loadLayer` stem for the default-coloured RGBA preview (`<stem>.<previewPalette>`). */
  readonly previewStem: string;
  readonly previewPalette: string;
  readonly frames: number;
}

/**
 * Decodes each GUI bob sheet into an indexed atlas + an RGBA preview atlas, written under `BOBS_DIR`.
 * `paletteByName` supplies the preview colours (from {@link convertGuiPaletteLut}). A missing/malformed
 * `.bmd`, or an absent preview palette, warns-and-skips that sheet. Returns one {@link GuiAtlasResult} per
 * sheet that converted.
 */
export async function convertGuiAtlases(
  gameDir: string,
  outDir: string,
  paletteByName: ReadonlyMap<string, Uint8Array>,
): Promise<GuiAtlasResult[]> {
  const done: GuiAtlasResult[] = [];
  for (const src of GUI_ATLASES) {
    let bytes: Uint8Array;
    try {
      bytes = await readGameFile(gameDir, src.bmd);
    } catch (err) {
      console.warn(`[pipeline] gui: skipped ${src.stem}: ${(err as Error).message}`);
      continue;
    }
    const preview = paletteByName.get(src.previewPalette);
    if (preview === undefined) {
      console.warn(
        `[pipeline] gui: skipped ${src.stem}: preview palette "${src.previewPalette}" unavailable`,
      );
      continue;
    }
    let indexed: BobAtlas;
    let colored: BobAtlas;
    try {
      const bmd = decodeBmd(bytes);
      indexed = packIndexedBobAtlas(bmd);
      colored = packBobAtlas(bmd, preview);
    } catch (err) {
      console.warn(`[pipeline] gui: skipped ${src.stem}: ${(err as Error).message}`);
      continue;
    }
    const indexedStem = `${src.stem}.indexed`;
    const previewStem = `${src.stem}.${src.previewPalette}`;
    await writeBobAtlas(outDir, indexedStem, indexed);
    await writeBobAtlas(outDir, previewStem, colored);
    done.push({
      stem: src.stem,
      indexedStem,
      previewStem,
      previewPalette: src.previewPalette,
      frames: indexed.manifest.frames.length,
    });
  }
  return done;
}

/** The emitted GUI palette LUT plus the resolved palettes (for the preview colouring + the manifest). */
export interface GuiPaletteLutResult {
  /** `loadLayer`/`loadAtlasSource` stem of the `256 × N` LUT PNG under `/bobs/`. */
  readonly stem: string;
  /** LUT row order (row index = array index) — the app mirrors this to pick a palette row. */
  readonly names: string[];
  /** name → 768-byte palette, for colouring the preview atlases. Absent palettes are identity-filled. */
  readonly byName: Map<string, Uint8Array>;
}

/**
 * Reads every {@link GUI_PALETTES} carrier, stacks their 256-colour trailers into one `256 × N` LUT PNG
 * (via {@link buildPlayerLutImage}, the same mechanism as the player-colour LUT), and writes it under
 * `BOBS_DIR`. A missing/palette-less carrier is warned and replaced with a neutral grayscale row so
 * the row order (the app's contract) stays fixed regardless of a partial install.
 */
export async function convertGuiPaletteLut(gameDir: string, outDir: string): Promise<GuiPaletteLutResult> {
  const ordered: Uint8Array[] = [];
  const byName = new Map<string, Uint8Array>();
  for (const src of GUI_PALETTES) {
    let palette: Uint8Array | undefined;
    try {
      palette = decodePcx(await readGameFile(gameDir, src.file)).palette;
    } catch (err) {
      console.warn(
        `[pipeline] gui: palette ${src.name} unreadable (${(err as Error).message}); using neutral row`,
      );
    }
    if (palette === undefined) palette = identityPalette();
    ordered.push(palette);
    byName.set(src.name, palette);
  }
  await mkdir(join(outDir, BOBS_DIR), { recursive: true });
  await writeFile(
    join(outDir, BOBS_DIR, `${GUI_PALETTE_LUT_STEM}.png`),
    encodePng(buildPlayerLutImage(ordered)),
  );
  return { stem: GUI_PALETTE_LUT_STEM, names: GUI_PALETTES.map((p) => p.name), byName };
}

/**
 * Window-fill bitmaps that the engine draws through an ELEMENT palette instead of their embedded one.
 * `Data/gui/bitmaps/bg.pcx` expands to grey marble through its embedded palette, but every in-game window
 * body in the original renders it warm brown — the `bg_normal` element palette applied to the same indices
 * matches those screenshots (verified visually at 1024×768; the palette's name states the pairing, but
 * OpenVikings only shows the palette being loaded, not the draw-site pairing itself).
 * The other four `bg_*` bitmaps match the original through their embedded palettes, so only `bg` is baked.
 * `softenShadows` additionally lifts the swapped palette's near-black entries ({@link liftPaletteShadows}).
 */
const WINDOW_BITMAP_RECOLORS: ReadonlyArray<{ bitmap: string; palette: string; softenShadows?: boolean }> = [
  { bitmap: 'bg', palette: 'bg_normal', softenShadows: true },
];

/**
 * Shadow floor for the window-body bake (luma points, 0–255). This lift is a cosmetic compensation WE
 * apply on top of the `bg`→`bg_normal` swap above — the original engine does not lift; it is inferred
 * from screenshots, not decoded behavior. Sampled off the same native 1024×768 screenshot the panel
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
  gameDir: string,
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
      const image = decodePcx(await readGameFile(gameDir, join(bitmapsDir, `${bitmap}.pcx`)));
      const png = encodePng(expandToRgba({ ...image, palette: paletteBytes }));
      await mkdir(join(outDir, bitmapsDir), { recursive: true });
      await writeFile(join(outDir, bitmapsDir, `${bitmap}.${palette}.png`), png);
      done++;
    } catch (err) {
      console.warn(`[pipeline] gui: skipped ${bitmap}.${palette}: ${(err as Error).message}`);
    }
  }
  return done;
}

/** One converted language's GUI strings: the served path + how many tables it carried. */
export interface GuiStringsResult {
  readonly lang: string;
  /** Path under `content/` (served at `/gui/strings/<lang>.json`). */
  readonly path: string;
  readonly tables: number;
  readonly strings: number;
}

/**
 * Decodes the nine `ingamegui*.cif` UI string tables for each language into one `content/gui/strings/<lang>.json`
 * of `{ <table>: { <stringId>: <displayText> } }` — the display id is NOT the container slot id but the
 * running string id, and the text is CP1250 display text ({@link decodeCifStringTable}, shared with the
 * map folders' `strings.cif`). A missing table warns-and-skips (that table is simply absent from the
 * language's JSON); a language with no tables at all is skipped entirely.
 */
export async function convertGuiStrings(
  gameDir: string,
  outDir: string,
  langs: readonly string[] = STRING_LANGS,
): Promise<GuiStringsResult[]> {
  const done: GuiStringsResult[] = [];
  for (const lang of langs) {
    const tables: Record<string, Record<number, string>> = {};
    let tableCount = 0;
    let stringCount = 0;
    for (const table of STRING_TABLES) {
      const rel = join('Data', 'text', lang, 'strings', 'ingamegui', `ingamegui${table}.cif`);
      let byId: Record<number, string>;
      try {
        byId = decodeCifStringTable(await readGameFile(gameDir, rel));
      } catch (err) {
        console.warn(`[pipeline] gui: skipped strings ${lang}/${table}: ${(err as Error).message}`);
        continue;
      }
      tables[table] = byId;
      tableCount++;
      stringCount += Object.keys(byId).length;
    }
    if (tableCount === 0) continue; // no tables for this language — emit nothing
    await mkdir(join(outDir, GUI_CONTENT_DIR, 'strings'), { recursive: true });
    const path = join(GUI_CONTENT_DIR, 'strings', `${lang}.json`);
    await writeFile(join(outDir, path), `${JSON.stringify(tables, null, 2)}\n`);
    done.push({ lang, path, tables: tableCount, strings: stringCount });
  }
  return done;
}

/** One converted cursor: the copied `.cur`, the decoded `.png`, the hotspot, and the pixel size. */
export interface GuiCursorResult {
  readonly name: string;
  /** URL path relative to `/gui/` (forward slashes) of the verbatim `.cur` — for CSS `cursor: url(/gui/<cur>)`. */
  readonly cur: string;
  /** URL path relative to `/gui/` (forward slashes) of the decoded RGBA PNG fallback/preview. */
  readonly png: string;
  readonly hotspotX: number;
  readonly hotspotY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Decodes each `DataX/Mouse/*.cur` to a PNG (with its hotspot) and copies the raw `.cur` through, both
 * under `content/gui/cursors/`. A missing/malformed cursor warns-and-skips. Returns one result per cursor.
 */
export async function convertCursors(gameDir: string, outDir: string): Promise<GuiCursorResult[]> {
  const done: GuiCursorResult[] = [];
  await mkdir(join(outDir, GUI_CONTENT_DIR, 'cursors'), { recursive: true });
  for (const name of CURSORS) {
    const rel = join(MOUSE_DIR, `${name}.cur`);
    let bytes: Uint8Array;
    try {
      bytes = await readGameFile(gameDir, rel);
    } catch (err) {
      console.warn(`[pipeline] gui: skipped cursor ${name}: ${(err as Error).message}`);
      continue;
    }
    let cursor: ReturnType<typeof decodeCursor>;
    try {
      cursor = decodeCursor(bytes);
    } catch (err) {
      console.warn(`[pipeline] gui: skipped cursor ${name}: ${(err as Error).message}`);
      continue;
    }
    // Disk write uses a native path; the manifest records a forward-slash URL path relative to `/gui/`
    // (a browser consumer fetches `/gui/<cur>`), so it must not carry OS separators or a `gui/` prefix.
    await writeFile(join(outDir, GUI_CONTENT_DIR, 'cursors', `${name}.cur`), bytes); // verbatim, for CSS cursor: url()
    await writeFile(join(outDir, GUI_CONTENT_DIR, 'cursors', `${name}.png`), encodePng(cursor.image));
    done.push({
      name,
      cur: `cursors/${name}.cur`,
      png: `cursors/${name}.png`,
      hotspotX: cursor.hotspotX,
      hotspotY: cursor.hotspotY,
      width: cursor.width,
      height: cursor.height,
    });
  }
  return done;
}

/** The top-level `content/gui/manifest.json` — the app's single entry point to discover every GUI output. */
export interface GuiManifest {
  readonly atlases: GuiAtlasResult[];
  readonly paletteLut: { readonly stem: string; readonly names: string[] };
  readonly strings: { readonly languages: string[]; readonly tables: readonly string[] };
  readonly cursors: GuiCursorResult[];
}

/** What {@link convertGuiStage} did, for the CLI log line. */
export interface GuiStageSummary {
  readonly atlases: number;
  readonly frames: number;
  readonly palettes: number;
  readonly strings: GuiStringsResult[];
  readonly cursors: number;
}

/**
 * Runs the whole GUI extraction: palette LUT (which also yields the preview palettes) → indexed + preview
 * atlases → per-language strings → cursors → the top-level `content/gui/manifest.json`. Returns a summary
 * for the CLI log. Each sub-step is independently resilient (warn-and-skip), so a partial game install
 * still produces whatever it can.
 */
export async function convertGuiStage(gameDir: string, outDir: string): Promise<GuiStageSummary> {
  const palettes = await convertGuiPaletteLut(gameDir, outDir);
  const atlases = await convertGuiAtlases(gameDir, outDir, palettes.byName);
  await convertWindowBitmaps(gameDir, outDir, palettes.byName);
  const strings = await convertGuiStrings(gameDir, outDir);
  const cursors = await convertCursors(gameDir, outDir);

  const manifest: GuiManifest = {
    atlases,
    paletteLut: { stem: palettes.stem, names: palettes.names },
    strings: { languages: strings.map((s) => s.lang), tables: STRING_TABLES },
    cursors,
  };
  await mkdir(join(outDir, GUI_CONTENT_DIR), { recursive: true });
  await writeFile(join(outDir, GUI_CONTENT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    atlases: atlases.length,
    frames: atlases.reduce((sum, a) => sum + a.frames, 0),
    palettes: palettes.names.length,
    strings,
    cursors: cursors.length,
  };
}
