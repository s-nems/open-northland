import { CIVILIZATION_TRIBES } from '@open-northland/data';
import { pictureSheetUrl } from '../../content/atlas-sheet/index.js';
import { loadAtlasManifest } from '../../content/bob-atlases.js';
import { tribeEmblemRows } from '../../content/building-gfx/emblems.js';
import { servedAtlasStem } from '../../content/ir/joins.js';
import { loadIr } from '../../content/ir/load.js';
import type { BuildingBobRow } from '../../content/ir/rows.js';
import { tribeName } from '../../i18n/index.js';
import { element } from './parts/dom.js';

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

/** The civilization's headquarters thumbnail; its initial stands in until the content draws it. The
 *  name is carried by the surrounding control, so the picture stays out of the accessible name. */
export function tribeEmblem(tribe: number, className: string): HTMLElement {
  const box = element('span', className);
  box.textContent = tribeName(tribe).slice(0, 1);
  box.setAttribute('aria-hidden', 'true');
  void loadTribeEmblems().then((urls) => {
    const url = urls.get(tribe);
    if (url === undefined) return;
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    box.replaceChildren(image);
  });
  return box;
}

async function emblemUrl(bob: BuildingBobRow): Promise<string | null> {
  const stem = servedAtlasStem(bob);
  if (stem === undefined) return null;
  const manifest = await loadAtlasManifest(stem);
  const rect = manifest?.frames.find((frame) => frame.bobId === bob.bobId)?.rect;
  if (manifest === null || rect === undefined || rect.width === 0 || rect.height === 0) return null;
  const src = pictureSheetUrl(manifest);
  if (src === null) return null;
  const image = new Image();
  image.src = src;
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
