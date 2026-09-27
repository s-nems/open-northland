import { z } from 'zod';

/** The languages a map folder ships under `text/<lang>/`, most preferred first: a text missing in the
 *  reader's language falls back in this order, and the culturesnation mod is Polish-authored. */
export const MAP_TEXT_LANGUAGES = ['pol', 'eng', 'ger', 'rus'] as const;
export type MapTextLanguage = (typeof MAP_TEXT_LANGUAGES)[number];

/**
 * `maps/<id>.strings.json`: one map's own string table per shipped language, keyed by string id.
 * A language the folder does not ship is absent.
 */
export const MapStrings = z.partialRecord(z.enum(MAP_TEXT_LANGUAGES), z.record(z.string(), z.string()));
export type MapStrings = z.infer<typeof MapStrings>;

/** One map text (name, description, seat name) in every shipped language that carries it. */
export const MapText = z.partialRecord(z.enum(MAP_TEXT_LANGUAGES), z.string());
export type MapText = z.infer<typeof MapText>;
