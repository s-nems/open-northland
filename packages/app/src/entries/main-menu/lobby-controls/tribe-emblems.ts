import { CIVILIZATION_TRIBES } from '@open-northland/data';
import type { AtlasManifest } from '@open-northland/render';
import { tribeEmblemRows } from '../../../content/building-gfx/emblems.js';
import { servedAtlasStem } from '../../../content/ir/joins.js';
import { loadIr } from '../../../content/ir/load.js';
import type { BuildingBobRow } from '../../../content/ir/rows.js';
import { fetchJsonOrNull } from '../../../content/net.js';

/** Square edge in device pixels the thumbnail is painted at; the CSS box scales it down. */
const EMBLEM_PX = 128;

/** Each civilization's headquarters sprite as an image URL; a tribe the content cannot draw is absent. */
export type TribeEmblems = ReadonlyMap<number, string>;

let emblems: Promise<TribeEmblems> | null = null;

/** Loaded once per page from the served content. Absent content resolves empty and is retried by the
 *  next caller, like the IR it reads. */
export function loadTribeEmblems(): Promise<TribeEmblems> {
  if (emblems !== null) return emblems;
  const pending = loadIr().then(async (ir) => {
    if (ir === null) {
      emblems = null;
      return new Map<number, string>();
    }
    const rows = tribeEmblemRows(ir, CIVILIZATION_TRIBES);
    const entries = await Promise.all(
      [...rows].map(async ([tribe, row]) => [tribe, await emblemUrl(row).catch(() => null)] as const),
    );
    return new Map(entries.filter((entry): entry is readonly [number, string] => entry[1] !== null));
  });
  emblems = pending;
  return pending;
}

async function emblemUrl(bob: BuildingBobRow): Promise<string | null> {
  const stem = servedAtlasStem(bob);
  if (stem === undefined) return null;
  const manifest = await fetchJsonOrNull<AtlasManifest>(`/bobs/${stem}.atlas.json`);
  const rect = manifest?.frames.find((frame) => frame.bobId === bob.bobId)?.rect;
  if (rect === undefined || rect.width === 0 || rect.height === 0) return null;
  const image = new Image();
  image.src = `/bobs/${stem}.png`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = EMBLEM_PX;
  canvas.height = EMBLEM_PX;
  const scale = EMBLEM_PX / Math.max(rect.width, rect.height);
  const width = rect.width * scale;
  const height = rect.height * scale;
  canvas
    .getContext('2d')
    ?.drawImage(
      image,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      (EMBLEM_PX - width) / 2,
      EMBLEM_PX - height,
      width,
      height,
    );
  return canvas.toDataURL();
}
