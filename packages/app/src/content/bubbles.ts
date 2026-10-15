import type { JobType } from '@open-northland/data';
import type { ImportMarkerGfx, SettlerBubbleGfx, SettlerBubbleKind } from '@open-northland/render';
import { importMarkerExemptJobs } from '@open-northland/render/data';
import { loadLayer, MissingAtlasError } from './ir/load.js';

/** The served stem of the `ls_gui_bubbles` over-head icon sheet: the RGBA preview in the sheet's own
 *  `gui_bubbles` palette, since none of its icons is team-coloured. */
const BUBBLE_ATLAS_STEM = 'ls_gui_bubbles.gui_bubbles';

/** The `ls_gui_bubbles` bob the scripted import marker draws. Original behavior (reading, unconfirmed
 *  against the running original): icon 10 of the sheet, between the stars (6 to 9) and the life bars
 *  (11 to 21). */
const IMPORT_MARKER_FRAME_ID = 10;

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
  const layer = await loadIconSheet();
  if (layer === null) return null;
  const child = layer.atlas.frames.get(BUBBLE_FRAME_ID.child);
  const partner = layer.atlas.frames.get(BUBBLE_FRAME_ID.partner);
  const sleepy = layer.atlas.frames.get(BUBBLE_FRAME_ID.sleepy);
  const hungry = layer.atlas.frames.get(BUBBLE_FRAME_ID.hungry);
  if (child === undefined || partner === undefined || sleepy === undefined || hungry === undefined) {
    return null; // a stale atlas missing the frames
  }
  return { source: layer.source, frameByKind: { child, partner, sleepy, hungry } };
}

/** The import marker's icon and the jobs exempt from it; `null` without the sheet or its frame. */
export async function loadImportMarkerGfx(
  jobs: readonly Pick<JobType, 'typeId' | 'id'>[],
): Promise<ImportMarkerGfx | null> {
  const layer = await loadIconSheet();
  const frame = layer?.atlas.frames.get(IMPORT_MARKER_FRAME_ID);
  if (layer === null || frame === undefined) return null;
  return { source: layer.source, frame, exemptJobs: importMarkerExemptJobs(jobs) };
}

async function loadIconSheet(): Promise<Awaited<ReturnType<typeof loadLayer>> | null> {
  try {
    return await loadLayer(BUBBLE_ATLAS_STEM);
  } catch (err) {
    if (err instanceof MissingAtlasError) return null;
    throw err;
  }
}
