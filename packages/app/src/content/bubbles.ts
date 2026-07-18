import type { AtlasFrame, SettlerBubbleKind, TextureSource } from '@open-northland/render';
import { loadLayer, MissingAtlasError } from './ir.js';

/**
 * Resolve the decoded settler-bubble art for the render bubble layer: the palette-baked `ls_gui_bubbles`
 * sheet (the GUI speech-bubble bob) and the frame each {@link SettlerBubbleKind} draws. Returns `null`
 * when the atlas is absent (a checkout without `content/`), so the renderer degrades to no bubbles.
 *
 * The RGBA preview stem (`ls_gui_bubbles.gui_bubbles`, baked through the sheet's own `gui_bubbles`
 * palette) is loaded, not the recolourable indexed sheet — a settler bubble is never team-coloured, so
 * it needs no LUT remap and draws as a plain sprite.
 */

/** The served stem of the palette-baked bubble sheet (RGBA preview, not the indexed variant). */
const BUBBLE_ATLAS_STEM = 'ls_gui_bubbles.gui_bubbles';

/**
 * The `ls_gui_bubbles` frame each bubble kind draws (the bob index the `?icons` gallery labels). Both
 * romance states show the heart thought-bubble (frame 2) — the sheet's love bubble; the two are told
 * apart by context (a lone woman at home vs. a walking pair). Source basis: the decoded bubble sheet
 * (`ls_gui_bubbles.bmd`); frame choice is the user's visual pick, one constant to change per kind.
 */
const BUBBLE_FRAME_ID: Readonly<Record<SettlerBubbleKind, number>> = {
  child: 2,
  partner: 2,
};

export async function loadSettlerBubbleGfx(): Promise<{
  source: TextureSource;
  frameByKind: Record<SettlerBubbleKind, AtlasFrame>;
} | null> {
  let layer: Awaited<ReturnType<typeof loadLayer>>;
  try {
    layer = await loadLayer(BUBBLE_ATLAS_STEM);
  } catch (err) {
    if (err instanceof MissingAtlasError) return null;
    throw err;
  }
  const child = layer.atlas.frames.get(BUBBLE_FRAME_ID.child);
  const partner = layer.atlas.frames.get(BUBBLE_FRAME_ID.partner);
  if (child === undefined || partner === undefined) return null; // a stale atlas missing the frames
  return { source: layer.source, frameByKind: { child, partner } };
}
