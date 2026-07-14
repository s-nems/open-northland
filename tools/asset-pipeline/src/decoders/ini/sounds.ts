/**
 * Sound-bank extraction: static groups, ambients, and jingles with their SFX path/param lists.
 */
import { SoundAmbient, SoundBank, SoundJingle, SoundStaticGroup } from '@open-northland/data';
import type { RuleProp, RuleSection } from './grammar.js';

/** The Cultures sounds root every `SFX` path resolves under, forward-slashed + lower-cased. */
const SOUNDS_ROOT = 'data/engine2d/bin/sounds/';

/**
 * Normalizes a `SFX` wav path (`Data\Engine2D\Bin\Sounds\Gui\Click_Confirm.wav`) to the key the audio
 * layer fetches — forward-slashed, lower-cased, and made relative to {@link SOUNDS_ROOT} so it
 * joins straight onto the served `/sounds/<file>` route (`gui/click_confirm.wav`). A path that does
 * not sit under the sounds root is kept as-is (lower-cased) rather than dropped.
 */
function normalizeSoundPath(path: string): string {
  const p = path.replace(/\\/g, '/').toLowerCase();
  const at = p.indexOf(SOUNDS_ROOT);
  return at >= 0 ? p.slice(at + SOUNDS_ROOT.length) : p;
}

/**
 * `soundfx.cif` disagrees with itself on key/section case (`SFX`/`sfx`, `Name`/`name`,
 * `PatternGroup`/`patternGroup`, `SoundFXAmbient`/`SoundFxAmbient`), and the original engine reads it
 * case-insensitively — so the sound extractor matches on lower-cased keys throughout, unlike the
 * CamelCase-stable graphics tables above.
 */
function soundProps(sec: RuleSection, key: string): RuleProp[] {
  const k = key.toLowerCase();
  return sec.props.filter((p) => p.key.toLowerCase() === k);
}

/** First value of the first case-insensitively-matching property, or undefined. */
function soundStr(sec: RuleSection, key: string): string | undefined {
  return soundProps(sec, key)[0]?.values[0];
}

/** First value parsed as a base-10 int (undefined if absent/NaN), case-insensitive key. */
function soundInt(sec: RuleSection, key: string): number | undefined {
  const v = soundStr(sec, key);
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

/** Every `SFX "<path>" <n…>` line of a group → `{ file, params }`, in file order (empty paths dropped). */
function soundSfx(sec: RuleSection): { file: string; params: number[] }[] {
  return soundProps(sec, 'SFX')
    .map((p) => {
      const [file, ...rest] = p.values;
      return {
        file: normalizeSoundPath(file ?? ''),
        params: rest.map((v) => Number.parseInt(v, 10)).filter((n) => !Number.isNaN(n)),
      };
    })
    .filter((s) => s.file !== '');
}

/** Lower-cased first value of every case-insensitively-matching property (group name lists). */
function soundGroupNames(sec: RuleSection, key: string): string[] {
  return soundProps(sec, key)
    .map((p) => p.values[0])
    .filter((v): v is string => v !== undefined && v.trim() !== '')
    .map((v) => v.toLowerCase());
}

/**
 * Extracts the decoded `soundfx.cif` sections into the {@link SoundBank} IR: `SoundFXStatic` groups
 * (named wav bags, some bound to a `LogicSoundType` engine trigger), `SoundFXAmbient` terrain beds
 * (keyed on `PatternGroup`/`LandscapeGroup`), and `SoundFXJingle` life-event stingers (`MusicType`).
 * Sections it does not recognise contribute nothing. This is render-binding data the pure sim ignores;
 * the browser audio layer joins it onto sim events + on-screen terrain. Case-insensitive throughout
 * (see {@link soundProps}). Sound wav paths are made relative to the served sounds root
 * ({@link normalizeSoundPath}).
 */
export function extractSounds(sections: readonly RuleSection[]): SoundBank {
  const staticGroups: SoundStaticGroup[] = [];
  const ambient: SoundAmbient[] = [];
  const jingles: SoundJingle[] = [];
  for (const sec of sections) {
    switch (sec.name.toLowerCase()) {
      case 'soundfxstatic':
        staticGroups.push(
          SoundStaticGroup.parse({
            name: soundStr(sec, 'Name') ?? '',
            logicSoundType: soundInt(sec, 'LogicSoundType'),
            sfx: soundSfx(sec),
          }),
        );
        break;
      case 'soundfxambient':
        ambient.push(
          SoundAmbient.parse({
            name: soundStr(sec, 'Name') ?? '',
            patternGroups: soundGroupNames(sec, 'PatternGroup'),
            landscapeGroups: soundGroupNames(sec, 'LandscapeGroup'),
            sfx: soundSfx(sec),
          }),
        );
        break;
      case 'soundfxjingle':
        jingles.push(
          SoundJingle.parse({
            name: soundStr(sec, 'Name') ?? '',
            musicType: soundInt(sec, 'MusicType'),
            sfx: soundSfx(sec),
          }),
        );
        break;
    }
  }
  return SoundBank.parse({ staticGroups, ambient, jingles });
}
