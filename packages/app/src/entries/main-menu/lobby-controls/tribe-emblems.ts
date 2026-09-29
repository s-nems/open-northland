import { CIVILIZATION_TRIBES } from '@open-northland/data';
import type { AtlasManifest } from '@open-northland/render';
import { servedAtlasStem } from '../../../content/ir/joins.js';
import { loadIr } from '../../../content/ir/load.js';
import type { ContentIr } from '../../../content/ir/rows.js';
import { fetchJsonOrNull } from '../../../content/net.js';

/** The building whose sprite stands for a civilization in the lobby: every civilization founds one. */
const EMBLEM_BUILDING = 'headquarters';
const EMBLEM_LEVEL = 0;
/** Square edge in device pixels the thumbnail is painted at; the CSS box scales it down. */
const EMBLEM_PX = 128;

/** Each civilization's headquarters sprite as an image URL; a tribe the content cannot draw is absent. */
export type TribeEmblems = ReadonlyMap<number, string>;

let emblems: Promise<TribeEmblems> | null = null;

/** Loaded once per page from the served content; resolves empty when the content is missing. */
export function loadTribeEmblems(): Promise<TribeEmblems> {
  emblems ??= loadIr().then(async (ir) => {
    const entries = await Promise.all(
      CIVILIZATION_TRIBES.map(async (tribe) => {
        const url = ir === null ? null : await emblemUrl(ir, tribe).catch(() => null);
        return [tribe, url] as const;
      }),
    );
    return new Map(entries.filter((entry): entry is readonly [number, string] => entry[1] !== null));
  });
  return emblems;
}

async function emblemUrl(ir: ContentIr, tribe: number): Promise<string | null> {
  const typeId = ir.buildings?.find((row) => row.id === EMBLEM_BUILDING)?.typeId;
  const bob = ir.buildingBobs?.find(
    (row) => row.tribeId === tribe && row.typeId === typeId && row.level === EMBLEM_LEVEL,
  );
  const stem = bob === undefined ? undefined : servedAtlasStem(bob);
  if (bob === undefined || stem === undefined) return null;
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
