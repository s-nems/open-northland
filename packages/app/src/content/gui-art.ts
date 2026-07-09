import { type AtlasFrame, PalettedSprite, type SpriteLayer, type TextureSource } from '@vinland/render';
import { GUI_FRAMES } from './gui-atlas-map.js';
import { type GuiPaletteName, guiPaletteRow, loadGuiPaletteLut, loadGuiWindowIndexed } from './gui-gfx.js';

/**
 * The ONE loader + sprite factory for the decoded GUI art (the indexed `ls_gui_window` sheet read
 * through the GUI palette LUT) — shared by the tool panel and the settler action menu so the
 * load/degrade policy and the frame→palette resolution can't drift between HUD modules. A checkout
 * without `content/` yields `null` and every consumer falls back to its flat-`Graphics` look.
 */

/** The loaded GUI art bundle: the indexed atlas + the palette LUT it is coloured through. */
export interface GuiArt {
  readonly layer: SpriteLayer;
  readonly lut: TextureSource;
  /** LUT row count (its pixel height) — passed to each `PalettedSprite`. */
  readonly colours: number;
}

/** One built GUI sprite plus its atlas frame (callers centre/size by the frame's geometry). */
export interface GuiSprite {
  readonly sprite: PalettedSprite;
  readonly frame: AtlasFrame;
}

let guiArtOnce: Promise<GuiArt | null> | null = null;

/**
 * Load the indexed GUI window sheet + palette LUT, or `null` when either half is missing (the GUI
 * pipeline stage hasn't run) — the consumer then renders its flat fallback at the same geometry.
 * Memoized per page (like `loadIr`): the tool panel, the action ring, and the details panel all
 * mount it and must share one sheet texture instead of fetching three.
 */
export function loadGuiArt(): Promise<GuiArt | null> {
  guiArtOnce ??= (async () => {
    const [layer, lut] = await Promise.all([
      loadGuiWindowIndexed().catch<SpriteLayer | null>(() => null),
      loadGuiPaletteLut().then((t) => t ?? null),
    ]);
    if (layer === null || lut === null) return null;
    return { layer, lut, colours: lut.pixelHeight };
  })();
  return guiArtOnce;
}

/**
 * Build a {@link PalettedSprite} for one GUI atlas frame, coloured through the frame's mapped palette
 * (`content/gui-atlas-map.ts`, falling back to `defaultPalette` for an unmapped frame), or `null` when
 * the frame isn't in the atlas. `colorKey` picks the transparency treatment (see `PalettedSprite`):
 * `'full'` for the panel strip/buttons, `'round'` for the round wooden order buttons.
 */
export function makeGuiSprite(
  art: GuiArt,
  gfx: number,
  opts: {
    readonly defaultPalette: GuiPaletteName;
    readonly colorKey: PalettedSprite['colorKey'];
    readonly palette?: GuiPaletteName;
  },
): GuiSprite | null {
  const frame = art.layer.atlas.frames.get(gfx);
  if (frame === undefined) return null;
  const sprite = new PalettedSprite(art.lut, art.colours);
  sprite.setFrame(art.layer.source, frame, art.layer.atlas.width, art.layer.atlas.height);
  sprite.player = guiPaletteRow(opts.palette ?? GUI_FRAMES[gfx]?.palette ?? opts.defaultPalette);
  sprite.colorKey = opts.colorKey;
  return { sprite, frame };
}
