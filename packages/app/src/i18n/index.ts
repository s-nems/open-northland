import { de } from './de.js';
import { en, type Messages } from './en.js';
import { pl } from './pl.js';
import { ru } from './ru.js';

export const LOCALE_CODES = ['pol', 'eng', 'ger', 'rus'] as const;

export type Locale = (typeof LOCALE_CODES)[number];

/** The BCP-47 primary subtag each shipped catalog claims. */
const LOCALE_TAGS: Readonly<Record<Locale, string>> = { pol: 'pl', eng: 'en', ger: 'de', rus: 'ru' };

/** Where a preferred language with no shipped catalog lands. */
const FALLBACK_LOCALE: Locale = 'eng';

const LOCALES: Readonly<Record<Locale, Messages>> = { pol: pl, eng: en, ger: de, rus: ru };
let activeLocale: Locale | undefined;

/** Display names that replace authored catalog entries, keyed as each catalog table keys them. */
export interface NameOverlay {
  readonly goods?: Readonly<Record<string, string>>;
  readonly building?: Readonly<Record<string, string>>;
  readonly profession?: Readonly<Record<string, string>>;
  readonly roleNames?: Readonly<Record<string, string>>;
  readonly heroNames?: Readonly<Record<string, string>>;
  readonly soldierClass?: Readonly<Record<string, string>>;
  /** `hud.groupPanel.professions`, the plural of `profession`. */
  readonly professions?: Readonly<Record<string, string>>;
  /** `hud.groupPanel.soldierClasses`, the plural of `soldierClass`. */
  readonly soldierClasses?: Readonly<Record<string, string>>;
  /** `hud.groupPanel.role`, a settler role's name, and `roles`, its plural. */
  readonly groupRole?: Readonly<Record<string, string>>;
  readonly groupRoles?: Readonly<Record<string, string>>;
  readonly trackLabels?: Readonly<Record<string, string>>;
  readonly weaponXp?: Readonly<Record<string, string>>;
  readonly tribeNames?: Readonly<Record<number, string>>;
}

const overlaid = new Map<Locale, Messages>();

/** Make `messages(locale)` answer the overlay's names over the authored catalog; every entry the overlay
 *  lacks keeps its authored text. A later install for the same locale replaces the earlier one. */
export function installNameOverlay(locale: Locale, names: NameOverlay): void {
  const base = LOCALES[locale];
  const { hud } = base;
  overlaid.set(locale, {
    ...base,
    goods: { ...base.goods, ...names.goods },
    building: { ...base.building, ...names.building },
    profession: { ...base.profession, ...names.profession },
    roleNames: { ...base.roleNames, ...names.roleNames },
    heroNames: { ...base.heroNames, ...names.heroNames },
    tribeNames: { ...base.tribeNames, ...names.tribeNames },
    hud: {
      ...hud,
      trackLabels: { ...hud.trackLabels, ...names.trackLabels },
      weaponXp: { ...hud.weaponXp, ...names.weaponXp },
      groupPanel: {
        ...hud.groupPanel,
        soldierClass: { ...hud.groupPanel.soldierClass, ...names.soldierClass },
        soldierClasses: { ...hud.groupPanel.soldierClasses, ...names.soldierClasses },
        professions: { ...hud.groupPanel.professions, ...names.professions },
        role: { ...hud.groupPanel.role, ...names.groupRole },
        roles: { ...hud.groupPanel.roles, ...names.groupRoles },
      },
    },
  });
}

export function isLocale(value: unknown): value is Locale {
  return LOCALE_CODES.some((code) => code === value);
}

/** The first shipped catalog claimed by `preferred` (BCP-47 tags, most wanted first). */
export function resolveLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split('-')[0];
    const match = LOCALE_CODES.find((code) => LOCALE_TAGS[code] === primary);
    if (match !== undefined) return match;
  }
  return FALLBACK_LOCALE;
}

/** The app is imported under Node in tests, where there is no navigator to ask. */
function preferredLanguages(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : navigator.languages;
}

/** The language a player with no stored and no explicit choice starts in. */
export function defaultLocale(): Locale {
  return resolveLocale(preferredLanguages());
}

/** Accepts either spelling, the locale code or the bare tag; anything else takes the default. */
export function localeParam(params: URLSearchParams): Locale {
  const value = params.get('lang')?.toLowerCase();
  return LOCALE_CODES.find((code) => code === value || LOCALE_TAGS[code] === value) ?? defaultLocale();
}

export function bcp47Tag(locale: Locale = currentLocale()): string {
  return LOCALE_TAGS[locale];
}

const labelCollators = new Map<string, Intl.Collator>();

/** Orders names a player reads, as `tag`'s language sorts them, digits by value ("Mission 2" before
 *  "Mission 10"). ICU collation may vary by host, so nothing deterministic may sort with it. */
export function compareLabels(tag: string = bcp47Tag()): (a: string, b: string) => number {
  let collator = labelCollators.get(tag);
  if (collator === undefined) {
    collator = new Intl.Collator(tag, { numeric: true });
    labelCollators.set(tag, collator);
  }
  return collator.compare;
}

const clockFormats = new Map<string, Intl.DateTimeFormat>();

/** The local hour and minute of `epochMs`, written as `tag`'s language writes a time of day. */
export function formatClockTime(epochMs: number, tag: string = bcp47Tag()): string {
  let format = clockFormats.get(tag);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' });
    clockFormats.set(tag, format);
  }
  return format.format(epochMs);
}

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = bcp47Tag(locale);
}

export function currentLocale(): Locale {
  return activeLocale ?? defaultLocale();
}

/** A tribe's localized name. The authored catalog names only the playable tribes, so without the game's
 *  own tables an animal species falls back to `contentName`, the content's untranslated id, and then to
 *  the bare tribe code. */
export function tribeName(tribe: number | undefined, contentName?: string): string {
  if (tribe === undefined) return '-';
  return messages().tribeNames[tribe] ?? contentName ?? `#${tribe}`;
}

export function messages(locale: Locale = currentLocale()): Messages {
  return overlaid.get(locale) ?? LOCALES[locale];
}

/** A good's display name by its content slug; a good no catalog names keeps its content name, then its
 *  slug. */
export function goodName(
  good: { readonly id: string; readonly name?: string | undefined },
  locale: Locale = currentLocale(),
): string {
  const names: Readonly<Record<string, string | undefined>> = messages(locale).goods;
  return names[good.id] ?? good.name ?? good.id;
}

/** The menu title and summary of scene `id`, or undefined for an id the catalog does not know. */
export function sceneCopy(
  id: string,
  locale: Locale = currentLocale(),
): Messages['scene'][keyof Messages['scene']] | undefined {
  const scenes = LOCALES[locale].scene;
  return Object.hasOwn(scenes, id) ? scenes[id as keyof typeof scenes] : undefined;
}

/** A scene's own string table, the stand-in for a map's `strings.ini`, keyed by string id; undefined
 *  for a scene whose copy carries none. */
export function sceneStrings(
  id: string,
  locale: Locale = currentLocale(),
): Readonly<Record<string, string>> | undefined {
  const entry = sceneCopy(id, locale);
  return entry !== undefined && 'strings' in entry ? entry.strings : undefined;
}

/** A scene's briefing pages by cutscene id, the stand-in for a map's `text/<lang>/briefings/`;
 *  undefined for a scene whose script plays none. */
export function scenePages(
  id: string,
  locale: Locale = currentLocale(),
): Readonly<Record<string, string>> | undefined {
  const entry = sceneCopy(id, locale);
  return entry !== undefined && 'pages' in entry ? entry.pages : undefined;
}

/** A scene's stage and stage-button labels by key; undefined for a scene without stages. */
export function sceneStageLabels(
  id: string,
  locale: Locale = currentLocale(),
): Readonly<Record<string, string>> | undefined {
  const entry = sceneCopy(id, locale);
  return entry !== undefined && 'stages' in entry ? entry.stages : undefined;
}

export function formatMessage(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

export function professionLabel(key: keyof Messages['profession'], locale: Locale = currentLocale()): string {
  return messages(locale).profession[key];
}

export function categoryLabel(key: keyof Messages['category'], locale: Locale = currentLocale()): string {
  return messages(locale).category[key];
}

export function uiLabel(key: keyof Messages['hud'], locale: Locale = currentLocale()): string {
  const value = messages(locale).hud[key];
  return typeof value === 'string' ? value : key;
}

export type { Messages } from './en.js';

export interface PluralForms {
  readonly one: string;
  readonly few: string;
  readonly many: string;
}

const pluralRulesByTag = new Map<string, Intl.PluralRules>();

/** Picks the CLDR plural form for `count`; categories beyond one/few (`many`, `other`) fall to
 *  `many`, which is also English's plural. One `Intl.PluralRules` per locale: lists ask per row. */
export function pluralForm(count: number, forms: PluralForms, localeTag: string): string {
  let rules = pluralRulesByTag.get(localeTag);
  if (rules === undefined) {
    rules = new Intl.PluralRules(localeTag);
    pluralRulesByTag.set(localeTag, rules);
  }
  const category = rules.select(count);
  return category === 'one' ? forms.one : category === 'few' ? forms.few : forms.many;
}
