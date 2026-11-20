import { z } from 'zod';
import { MAP_TYPE } from '../maps/meta.js';
import { CatalogConversion, CatalogConvertedMap } from './conversion.js';
import { CatalogEntry } from './entry.js';

/** Identity and browse facts without the installation index or lobby roster. */
export const CatalogBrowseMap = CatalogConvertedMap.omit({ index: true }).extend({
  playerCount: z.number().int().nonnegative(),
});
export type CatalogBrowseMap = z.infer<typeof CatalogBrowseMap>;

export const CatalogBrowseConversion = z.discriminatedUnion('verdict', [
  CatalogConversion.options[0].extend({
    mainMapId: CatalogConvertedMap.shape.mapId,
    maps: z.array(CatalogBrowseMap).min(1),
  }),
  CatalogConversion.options[1],
  CatalogConversion.options[2],
]);

/** Search includes both descriptions; full map indexes load from the entry endpoint on demand. */
export const CatalogBrowseEntry = CatalogEntry.extend({ conversion: CatalogBrowseConversion.optional() });
export type CatalogBrowseEntry = z.infer<typeof CatalogBrowseEntry>;
export const CatalogBrowse = z.array(CatalogBrowseEntry);

/** The `/v1/catalog` response header naming the game release the API converts maps for; absent when
 *  its deployment names none. */
export const CATALOG_GAME_VERSION_HEADER = 'x-game-version';

export function catalogBrowseEntry(entry: CatalogEntry): CatalogBrowseEntry {
  const { conversion, ...fields } = entry;
  if (conversion?.verdict !== 'ok') return { ...fields, conversion };
  const main =
    conversion.maps.find((map) => map.index.campaign === undefined) ??
    conversion.maps.find((map) => !(map.index.mapTypes ?? []).includes(MAP_TYPE.SINGLE_PLAYER_CAMPAIGN)) ??
    conversion.maps[0];
  if (main === undefined) throw new Error('Converted catalogue entry has no maps');
  return {
    ...fields,
    conversion: {
      verdict: 'ok',
      irVersion: conversion.irVersion,
      mainMapId: main.mapId,
      maps: conversion.maps.map(({ index, ...map }) => ({
        ...map,
        playerCount: index.players?.filter((slot) => !slot.hidden).length ?? 0,
      })),
    },
  };
}
