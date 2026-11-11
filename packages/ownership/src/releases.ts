export type OriginalGameId = 'cultures2' | 'northland' | 'wonders';

export interface KnownRelease {
  readonly game: OriginalGameId;
  /** Language and the stores or editions that ship this exact library. */
  readonly edition: string;
}

/**
 * `DataX/Libs/data0001.lib` sizes in bytes of the releases inspected so far. Steam and GOG ship
 * the retail library unchanged, so one size covers every store of a language. A size missing
 * here still passes the check; it only loses its label.
 */
export const KNOWN_LIBRARY_SIZES: ReadonlyMap<number, KnownRelease> = new Map<number, KnownRelease>([
  [242_861_354, { game: 'cultures2', edition: 'EN' }],
  [244_064_304, { game: 'cultures2', edition: 'DE' }],
  [248_047_582, { game: 'cultures2', edition: 'PL' }],
  [253_137_102, { game: 'cultures2', edition: 'PT' }],
  [106_818_707, { game: 'cultures2', edition: 'demo' }],
  [234_653_915, { game: 'northland', edition: 'EN' }],
  [234_680_670, { game: 'northland', edition: 'DE' }],
  [236_622_376, { game: 'northland', edition: 'ES' }],
  [236_425_219, { game: 'northland', edition: 'PL' }],
  [236_334_059, { game: 'northland', edition: 'HU' }],
  [236_401_816, { game: 'northland', edition: 'CS' }],
  [235_145_693, { game: 'northland', edition: 'IT' }],
  [130_499_978, { game: 'northland', edition: 'demo' }],
  [255_230_793, { game: 'wonders', edition: 'EN' }],
  [267_643_967, { game: 'wonders', edition: 'DE' }],
  [256_951_566, { game: 'wonders', edition: 'ES' }],
  [256_375_821, { game: 'wonders', edition: 'PL' }],
]);

/** Mac App Store bundle identifiers of the three games. */
export const BUNDLE_IDENTIFIERS: ReadonlyMap<string, OriginalGameId> = new Map([
  ['com.rune-soft.cultures2Asgardmacos', 'cultures2'],
  ['com.rune-soft.culturesnorthland', 'northland'],
  ['com.rune-soft.cultureswonders', 'wonders'],
]);

export const GAME_TITLES: Readonly<Record<OriginalGameId, string>> = {
  cultures2: 'Cultures 2: The Gates of Asgard',
  northland: 'Cultures: Northland',
  wonders: 'Cultures: 8th Wonder of the World',
};

/** The player-facing name of a recognized release, such as `Cultures: Northland (PL)`; null when unlisted. */
export function releaseLabel(game: OriginalGameId | undefined, edition: string | undefined): string | null {
  if (game === undefined) return null;
  const title = GAME_TITLES[game];
  return edition === undefined ? title : `${title} (${edition})`;
}
