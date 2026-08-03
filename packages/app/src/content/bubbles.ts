import type { SettlerBubbleGfx, SettlerBubbleKind } from '@open-northland/render';
import { loadLayer, MissingAtlasError } from './ir/load.js';

/** The served stem of the bubble sheet: the RGBA preview, since a bubble is never team-coloured. */
const BUBBLE_ATLAS_STEM = 'ls_gui_bubbles.gui_bubbles';

/** The `ls_gui_bubbles` bob index each bubble kind draws. Source basis: observation, since no readable
 *  ini names the frames. */
const BUBBLE_FRAME_ID: Readonly<Record<SettlerBubbleKind, number>> = {
  child: 2,
  partner: 2,
  sleepy: 0,
  hungry: 4,
};

/** Returns `null` when the bubble atlas is absent (a checkout without `content/`), so the renderer draws
 *  no bubbles. */
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
