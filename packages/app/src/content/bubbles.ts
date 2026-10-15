import type { JobType } from '@open-northland/data';
import {
  type AtlasFrame,
  type ExperienceStarGfx,
  type ImportMarkerGfx,
  LIFE_HEART_STEPS,
  type LifeHeartGfx,
  type LifeHeartSheet,
  type SettlerBubbleGfx,
  type SettlerBubbleKind,
  STAR_TIERS,
} from '@open-northland/render';
import { importMarkerExemptJobs } from '@open-northland/render/data';
import { PLAYER_COLOR_COUNT } from '../catalog/roster.js';
import { loadLayer, MissingAtlasError } from './ir/load.js';

/** The served stem of the `ls_gui_bubbles` over-head icon sheet: the RGBA preview in the sheet's own
 *  `gui_bubbles` palette, since none of its icons is team-coloured. */
const BUBBLE_ATLAS_STEM = 'ls_gui_bubbles.gui_bubbles';

/** The `ls_gui_bubbles` bob the scripted import marker draws. Original behavior (reading, unconfirmed
 *  against the running original): icon 10 of the sheet, between the stars (6 to 9) and the life bars
 *  (11 to 21). */
const IMPORT_MARKER_FRAME_ID = 10;

/** The `ls_gui_bubbles` bob of the smallest experience star; each larger tier is the bob before it, so
 *  the largest is bob 6. Original behavior (reading, unconfirmed against the running original). */
const SMALLEST_STAR_FRAME_ID = 9;

/** The `ls_gui_bubbles` bob of the full life heart; each tenth of life lost is the next bob, to the
 *  empty heart at bob 21. */
const FULL_HEART_FRAME_ID = 11;

/** The served stem of one colour slot's hearts: `ls_gui_bubbles` baked through that player's palette. */
const heartAtlasStem = (slot: number): string => `ls_gui_bubbles.player_${String(slot).padStart(2, '0')}`;

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

/** The experience star in each size, smallest first; `null` without the sheet or any of its frames. */
export async function loadExperienceStarGfx(): Promise<ExperienceStarGfx | null> {
  const layer = await loadIconSheet();
  if (layer === null) return null;
  const frameByTier: AtlasFrame[] = [];
  for (let tier = 1; tier <= STAR_TIERS; tier++) {
    const frame = layer.atlas.frames.get(SMALLEST_STAR_FRAME_ID + 1 - tier);
    if (frame === undefined) return null;
    frameByTier.push(frame);
  }
  return { source: layer.source, frameByTier };
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

/** The life hearts per colour slot; `null` when no slot's page loads. Original behavior: the hearts
 *  draw in the owner's player palette, every pixel inside its player ramp. */
export async function loadLifeHeartGfx(): Promise<LifeHeartGfx | null> {
  const byPlayer = await Promise.all(
    Array.from({ length: PLAYER_COLOR_COUNT }, (_, slot) => loadHeartSheet(slot)),
  );
  return byPlayer.some((sheet) => sheet !== undefined) ? { byPlayer } : null;
}

/** One slot's heart page, or `undefined` when it is missing or lacks a frame. */
async function loadHeartSheet(slot: number): Promise<LifeHeartSheet | undefined> {
  let layer: Awaited<ReturnType<typeof loadLayer>>;
  try {
    layer = await loadLayer(heartAtlasStem(slot));
  } catch (err) {
    if (err instanceof MissingAtlasError) return undefined;
    throw err;
  }
  const frames: AtlasFrame[] = [];
  for (let step = 0; step < LIFE_HEART_STEPS; step++) {
    const frame = layer.atlas.frames.get(FULL_HEART_FRAME_ID + step);
    if (frame === undefined) return undefined;
    frames.push(frame);
  }
  return { source: layer.source, frames };
}

async function loadIconSheet(): Promise<Awaited<ReturnType<typeof loadLayer>> | null> {
  try {
    return await loadLayer(BUBBLE_ATLAS_STEM);
  } catch (err) {
    if (err instanceof MissingAtlasError) return null;
    throw err;
  }
}
