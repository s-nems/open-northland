import type { SettlerBubbleGfx, SettlerBubbleKind } from '@open-northland/render';
import { loadLayer, MissingAtlasError } from './ir.js';

/** The served stem of the palette-baked bubble sheet (RGBA preview, not the indexed variant). */
const BUBBLE_ATLAS_STEM = 'ls_gui_bubbles.gui_bubbles';

/**
 * The `ls_gui_bubbles` frame each bubble kind draws (the bob index the `?icons` gallery labels). Both
 * romance states show the heart thought-bubble (frame 2) — the sheet's love bubble; the two are told
 * apart by context (a lone woman at home vs. a walking pair). The need bubbles are frame 0 (sleep) and
 * frame 4 (hunger). Source basis: the decoded bubble sheet (`ls_gui_bubbles.bmd`); the frame→state map is
 * observed original behavior (no readable ini names the frames), one constant to change per kind.
 */
const BUBBLE_FRAME_ID: Readonly<Record<SettlerBubbleKind, number>> = {
  child: 2,
  partner: 2,
  sleepy: 0,
  hungry: 4,
};

/**
 * Resolve the decoded settler-bubble art for the render bubble layer: the palette-baked `ls_gui_bubbles`
 * sheet and the frame each {@link SettlerBubbleKind} draws. The RGBA preview stem is loaded, not the
 * recolourable indexed sheet — a settler bubble is never team-coloured, so it draws as a plain sprite.
 * Returns `null` when the atlas is absent (a checkout without `content/`), so the renderer degrades to no
 * bubbles.
 */
export async function loadSettlerBubbleGfx(): Promise<SettlerBubbleGfx | null> {
  let layer: Awaited<ReturnType<typeof loadLayer>>;
  try {
    layer = await loadLayer(BUBBLE_ATLAS_STEM);
  } catch (err) {
    if (err instanceof MissingAtlasError) return null;
    throw err;
  }
  const child = layer.atlas.frames.get(BUBBLE_FRAME_ID.child);
  const partner = layer.atlas.frames.get(BUBBLE_FRAME_ID.partner);
  const sleepy = layer.atlas.frames.get(BUBBLE_FRAME_ID.sleepy);
  const hungry = layer.atlas.frames.get(BUBBLE_FRAME_ID.hungry);
  if (child === undefined || partner === undefined || sleepy === undefined || hungry === undefined) {
    return null; // a stale atlas missing the frames
  }
  return { source: layer.source, frameByKind: { child, partner, sleepy, hungry } };
}
