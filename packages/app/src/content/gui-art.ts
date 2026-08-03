import {
  type AtlasFrame,
  PalettedSprite,
  type SpriteLayer,
  type TextureSource,
} from '@open-northland/render';
import { GUI_FRAMES } from './gui-atlas-map.js';
import { type GuiPaletteName, guiPaletteRow, loadGuiPaletteLut, loadGuiWindowIndexed } from './gui-gfx.js';

/**
 * The one loader and sprite factory for the decoded GUI art (the indexed `ls_gui_window` sheet read
 * through the GUI palette LUT), so the load/degrade policy and the frame→palette resolution cannot drift
 * between HUD modules. A checkout without `content/` yields `null` and consumers fall back to flat
 * `Graphics`.
 */

/** The loaded GUI art bundle: the indexed atlas + the palette LUT it is coloured through. */
export interface GuiArt {
  readonly layer: SpriteLayer;
  readonly lut: TextureSource;
  /** LUT row count (its pixel height) - passed to each `PalettedSprite`. */
  readonly colours: number;
}

/** One built GUI sprite plus its atlas frame (callers centre/size by the frame's geometry). */
export interface GuiSprite {
  readonly sprite: PalettedSprite;
  readonly frame: AtlasFrame;
}

let guiArtOnce: Promise<GuiArt | null> | null = null;

/**
 * The indexed GUI window sheet and palette LUT, or `null` when either half is missing, in which case the
 * consumer renders its flat fallback at the same geometry. Memoized per page so every HUD surface shares
 * one sheet texture.
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
 * Build a {@link PalettedSprite} for one GUI atlas frame, coloured through the frame's mapped palette and
 * falling back to `defaultPalette` for an unmapped frame, or `null` when the frame isn't in the atlas.
 * `colorKey` picks the transparency treatment: `'full'` for the panel strip and buttons, `'round'` for
 * the round wooden order buttons.
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
