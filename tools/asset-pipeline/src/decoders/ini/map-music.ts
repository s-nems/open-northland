/**
 * `[misc_music]` reducer: one `musictype` value per map, as a plain int or a `#DM_MUSIC_TYPE_*`
 * macro. Codes from the owned copy's `Data/GameSourceIncludes/logicdefines.inc`.
 */
import type { RuleSection } from './grammar.js';

/** `DM_MUSIC_TYPE_*` codes; keys are upper-cased because the corpus spells macros in mixed case. */
const MUSIC_TYPE_CODES: Readonly<Record<string, number>> = {
  DM_MUSIC_TYPE_NOMUSIC: 0,
  DM_MUSIC_TYPE_CULTURE_MISSION: 1,
  DM_MUSIC_TYPE_CULTURE_VIKING: 2,
  DM_MUSIC_TYPE_CULTURE_FRANKEN: 3,
  DM_MUSIC_TYPE_CULTURE_BYZANZ: 4,
  DM_MUSIC_TYPE_CULTURE_ARABS: 5,
  DM_MUSIC_TYPE_ATTACK_VIKING: 6,
  DM_MUSIC_TYPE_ATTACK_FRANKEN: 7,
  DM_MUSIC_TYPE_ATTACK_BYZANZ: 8,
  DM_MUSIC_TYPE_ATTACK_ARABS: 9,
  DM_MUSIC_TYPE_MISSION_VIKING1: 10,
  DM_MUSIC_TYPE_MISSION_FRANKEN1: 11,
  DM_MUSIC_TYPE_MISSION_FRANKEN2: 12,
  DM_MUSIC_TYPE_MISSION_BYZANZ1: 13,
  DM_MUSIC_TYPE_MISSION_BYZANZ2: 14,
  DM_MUSIC_TYPE_MISSION_BYZANZ3: 15,
  DM_MUSIC_TYPE_MISSION_BYZANZ4: 16,
  DM_MUSIC_TYPE_MISSION_ARABS1: 17,
  DM_MUSIC_TYPE_MISSION_ARABS2: 18,
  DM_MUSIC_TYPE_MISSION_ARABS3: 19,
  DM_MUSIC_TYPE_MISSION_MIDGARD1: 20,
  DM_MUSIC_TYPE_MISSION_MIDGARD2: 21,
  DM_MUSIC_TYPE_JINGLE_MARRIAGE: 22,
  DM_MUSIC_TYPE_JINGLE_BIRTH: 23,
  DM_MUSIC_TYPE_JINGLE_CIVILDEFENSE: 24,
  DM_MUSIC_TYPE_JINGLE_DEATH: 25,
  DM_MUSIC_TYPE_JINGLE_HOUSEBUILT: 26,
  DM_MUSIC_TYPE_JINGLE_WON: 27,
  DM_MUSIC_TYPE_JINGLE_LOST: 28,
  DM_MUSIC_TYPE_JINGLE_TECHNOLOGY: 29,
  DM_MUSIC_TYPE_JINGLE_OPENCHEST: 30,
  DM_MUSIC_TYPE_ADDON_MISSION_ARABS1: 31,
  DM_MUSIC_TYPE_ADDON_MISSION_ARABS2: 32,
  DM_MUSIC_TYPE_ADDON_MISSION_FRANKEN1: 33,
  DM_MUSIC_TYPE_ADDON_MISSION_FRANKEN2: 34,
  DM_MUSIC_TYPE_ADDON_MISSION_FRANKEN3: 35,
  DM_MUSIC_TYPE_ADDON_MISSION_NORDLAND: 36,
  DM_MUSIC_TYPE_ADDON_MISSION_UNDERWORLD: 37,
  DM_MUSIC_TYPE_ADDON_MISSION_ASGARD: 38,
};

/** `DM_MUSIC_TYPE_MAXIMUM` - the first invalid code. */
const MUSIC_TYPE_LIMIT = 39;

/**
 * The `[misc_music]` `musictype` code, or undefined when the section, key, or a valid value is
 * absent. Accepts the plaintext macro skin and the packed `map.cif` skin carrying the code already
 * resolved to a number; an out-of-range int is malformed and drops to undefined.
 */
export function extractMusicType(sections: readonly RuleSection[]): number | undefined {
  const section = sections.find((s) => s.name === 'misc_music');
  const token = section?.props.find((p) => p.key === 'musictype')?.values[0];
  if (token === undefined) return undefined;
  let code: number | undefined;
  if (/^\d+$/.test(token)) code = Number.parseInt(token, 10);
  else if (token.startsWith('#')) code = MUSIC_TYPE_CODES[token.slice(1).toUpperCase()];
  if (code === undefined || code >= MUSIC_TYPE_LIMIT) return undefined;
  return code;
}
