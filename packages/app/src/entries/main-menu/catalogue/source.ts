/**
 * Where a catalogue entry comes from. The catalogue serves two community sources, and its contract
 * gains no field for the distinction: the API derives each entry's id from the upstream key, so the
 * prefix tells the source, and an id it does not name belongs to the catalogue's first source.
 */

export type CatalogueSource = 'culturesnation' | 'wikinger-tommy';

/** The entry-id prefix of the wikinger-tommy.de mapdb, as the API's normalizer writes it. */
export const WIKINGER_TOMMY_ID_PREFIX = 'wt-';

/** Every source in the catalogue, the first one first. */
export const CATALOGUE_SOURCES: readonly CatalogueSource[] = ['culturesnation', 'wikinger-tommy'];

/** The source an entry came from, read out of its id. */
export function catalogueSource(entryId: string): CatalogueSource {
  return entryId.startsWith(WIKINGER_TOMMY_ID_PREFIX) ? 'wikinger-tommy' : 'culturesnation';
}
