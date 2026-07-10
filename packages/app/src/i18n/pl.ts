/**
 * The Polish (`pol`) message table — the game's only shipped language for now. Every other locale is a
 * sibling file with the same shape; {@link import('./index.js')} picks one by {@link Locale}.
 *
 * These are clean-room UI strings, NOT decoded original text (the original's own string tables are loaded
 * separately by `content/gui-gfx.ts`). Profession names sit under `profession`, keyed by the stable
 * profession `key` from `catalog/professions.ts`; short UI labels sit under `ui`; group headers under
 * `category`. Keep the key sets identical across locale tables so a missing translation is a compile error,
 * not a silent English leak.
 */
export const pl = {
  /** Profession display names, keyed by `catalog/professions.ts` profession `key`. */
  profession: {
    idle: 'Bezrobotny',
    gatherer_wood: 'Zbieracz drewna',
    gatherer_stone: 'Zbieracz kamienia',
    gatherer_mud: 'Zbieracz gliny',
    gatherer_iron: 'Zbieracz żelaza',
    gatherer_gold: 'Zbieracz złota',
    gatherer_mushroom: 'Zbieracz grzybów',
    carrier: 'Tragarz',
    builder: 'Budowniczy',
    joiner: 'Cieśla',
    armorer: 'Płatnerz',
    potter: 'Garncarz',
    mason: 'Murarz',
    smith: 'Kowal',
    coin_maker: 'Mincerz',
    hunter: 'Myśliwy',
    breeder: 'Hodowca',
    tailor: 'Krawiec',
    farmer: 'Rolnik',
    miller: 'Młynarz',
    baker: 'Piekarz',
    brewer: 'Piwowar',
    fisher: 'Rybak',
    herbalist: 'Zielarz',
    druid: 'Druid',
    scout: 'Zwiadowca',
    jester: 'Błazen',
    trader: 'Kupiec',
    soldier: 'Żołnierz',
  },
  /** Profession-group headers shown as separators in the picker list. */
  category: {
    gathering: 'Zbieractwo',
    transport: 'Transport',
    production: 'Rzemiosło',
    special: 'Specjalne',
    military: 'Wojsko',
  },
  /** Short UI chrome labels. */
  ui: {
    changeProfession: 'Zmiana zawodu',
  },
} as const;

/** The message-table shape every locale must satisfy (Polish is the reference). */
export type Messages = typeof pl;
