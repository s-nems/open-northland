/**
 * Which rendered segments each `DM_MUSIC_TYPE_*` map code may play. Codes from the owned copy's
 * `logicdefines.inc`. The variant sets come from the segment-name pointer table in `Game.exe`: it
 * gives every `Theme_*` and `Mission_*` code three mood slots and one `Attack_*` code a single slot,
 * and repeats the `Standard` name in all three slots of a mission that authored no other segment.
 */

/** A `Theme_*` map's mood, named by the segment suffix. */
export type ThemeMood = 'friendly' | 'neutral' | 'hostile';

/** A `Mission_*` map's mood, named by the segment suffix. */
export type MissionMood = 'standard' | 'wealthy' | 'danger';

/** The stems one map code can play. Only the two mood families switch; `Attack_*` authors one segment. */
export type MusicVariants =
  | { readonly family: 'theme'; readonly stems: Readonly<Record<ThemeMood, string>> }
  | { readonly family: 'mission'; readonly stems: Readonly<Record<MissionMood, string>> }
  | { readonly family: 'attack'; readonly stem: string };

function theme(tribe: string): MusicVariants {
  const base = `theme_${tribe}`;
  return {
    family: 'theme',
    stems: { friendly: `${base}_friendly`, neutral: `${base}_neutral`, hostile: `${base}_hostile` },
  };
}

/** `'standardOnly'` collapses all three moods onto the Standard stem, the way the original's table
 *  repeats that one pointer for a mission with no Wealthy or Danger segment. */
function mission(base: string, variants: 'all' | 'standardOnly'): MusicVariants {
  const standard = `${base}_standard`;
  return {
    family: 'mission',
    stems:
      variants === 'all'
        ? { standard, wealthy: `${base}_wealthy`, danger: `${base}_danger` }
        : { standard, wealthy: standard, danger: standard },
  };
}

/**
 * Map code to its playable stems. Jingle codes 22-30 are absent: they name wav one-shots, not
 * segments. So are 0 `NOMUSIC` and 1 `CULTURE_MISSION`, which the table gives no segment.
 */
export const MUSIC_VARIANTS: Readonly<Record<number, MusicVariants>> = {
  2: theme('viking'),
  3: theme('franken'),
  4: theme('byzanz'),
  5: theme('arabs'),
  6: { family: 'attack', stem: 'attack_viking' },
  7: { family: 'attack', stem: 'attack_franken' },
  8: { family: 'attack', stem: 'attack_byzanz' },
  9: { family: 'attack', stem: 'attack_arabs' },
  10: mission('mission_viking1', 'all'),
  11: mission('mission_franken1', 'all'),
  12: mission('mission_franken2', 'all'),
  13: mission('mission_byzanz1', 'all'),
  14: mission('mission_byzanz2', 'all'),
  15: mission('mission_byzanz3', 'all'),
  16: mission('mission_byzanz4', 'all'),
  17: mission('mission_arabs1', 'all'),
  18: mission('mission_arabs2', 'all'),
  19: mission('mission_arabs3', 'all'),
  20: mission('mission_midgard1', 'standardOnly'),
  21: mission('mission_midgard2', 'standardOnly'),
  31: mission('mission_addon_arabs1', 'all'),
  32: mission('mission_addon_arabs2', 'all'),
  33: mission('mission_addon_franken1', 'standardOnly'),
  34: mission('mission_addon_franken2', 'all'),
  35: mission('mission_addon_franken3', 'all'),
  36: mission('mission_addon_nordland', 'standardOnly'),
  37: mission('mission_addon_underworld', 'standardOnly'),
  38: mission('mission_addon_asgard', 'standardOnly'),
};
