import { z } from 'zod';

/** The languages a map folder ships under `text/<lang>/`, most preferred first: the menu shows one
 *  table and the culturesnation mod is Polish-authored. */
export const MAP_TEXT_LANGUAGES = ['pol', 'eng', 'ger', 'rus'] as const;
export type MapTextLanguage = (typeof MAP_TEXT_LANGUAGES)[number];

/**
 * `maps/<id>.strings.json`: one map's own string table per shipped language, keyed by string id.
 * A language the folder does not ship is absent.
 */
export const MapStrings = z.partialRecord(z.enum(MAP_TEXT_LANGUAGES), z.record(z.string(), z.string()));
export type MapStrings = z.infer<typeof MapStrings>;
