/**
 * Sound-bank extraction: the `soundfx.cif` static groups, ambients and jingles with their SFX
 * path/param lists, and the creature voice tables that name those groups.
 */
import {
  AnimalCall,
  HumanVoices,
  SoundAmbient,
  SoundBank,
  SoundJingle,
  SoundStaticGroup,
  VOICE_CLASSES,
  type VoiceClass,
} from '@open-northland/data';
import type { RuleProp, RuleSection } from './grammar.js';
import { getInt, getStr } from './props.js';

/** The Cultures sounds root every `SFX` path resolves under, forward-slashed + lower-cased. */
const SOUNDS_ROOT = 'data/engine2d/bin/sounds/';

/**
 * Normalizes an `SFX` wav path (`Data\Engine2D\Bin\Sounds\Gui\Click_Confirm.wav`) to the key the audio
 * layer fetches on the served `/sounds/<file>` route: forward-slashed, lower-cased, relative to
 * {@link SOUNDS_ROOT}. A path outside that root is kept as-is rather than dropped.
 */
function normalizeSoundPath(path: string): string {
  const p = path.replace(/\\/g, '/').toLowerCase();
  const at = p.indexOf(SOUNDS_ROOT);
  return at >= 0 ? p.slice(at + SOUNDS_ROOT.length) : p;
}

/**
 * `soundfx.cif` disagrees with itself on key and section case (`SFX`/`sfx`, `Name`/`name`,
 * `PatternGroup`/`patternGroup`, `SoundFXAmbient`/`SoundFxAmbient`) and the original engine reads it
 * case-insensitively, so every sound lookup matches on lower-cased keys.
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

/** Every `SFX "<path>" <n...>` line of a group as `{ file, params }`, in file order, empty paths dropped. */
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
 * keyed on `PatternGroup`/`LandscapeGroup`, and `SoundFXJingle` life-event stingers keyed on
 * `MusicType`. Unrecognised sections contribute nothing.
 */
export function extractSounds(
  sections: readonly RuleSection[],
  voices: Pick<SoundBank, 'humanVoices' | 'animalCalls'> = { humanVoices: [], animalCalls: [] },
): SoundBank {
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
  return SoundBank.parse({ staticGroups, ambient, jingles, ...voices });
}

/** The `humans/sounds.cif` class index (`0` child, `1` female, `2` male) as its name, or undefined for
 *  an index the file's vocabulary does not have. */
function voiceClassAt(value: string | undefined): VoiceClass | undefined {
  const index = Number.parseInt(value ?? '', 10);
  return Number.isNaN(index) ? undefined : VOICE_CLASSES[index];
}

/** The `respond <class> <0|1> "<group>"` answer types: the `0` pool answers "ok", the `1` pool "no". */
const RESPOND_OK = 0;
const RESPOND_NO = 1;

/**
 * Extracts the decoded `humans/sounds.cif` `[sounds]` blocks into one {@link HumanVoices} row per
 * `(logictribe, class)` that names at least one group: `scream <class> "<group>"`, `generic <class>
 * "<group>"` and the repeated `respond <class> <0|1> "<group>"` answer pools. A block without a
 * `logictribe` belongs to tribe 0, as in the original.
 */
export function extractHumanVoices(sections: readonly RuleSection[]): HumanVoices[] {
  const rows = new Map<string, HumanVoices>();
  const rowFor = (tribe: number, voiceClass: VoiceClass): HumanVoices => {
    const key = `${tribe}:${voiceClass}`;
    let row = rows.get(key);
    if (row === undefined) {
      row = { tribe, voiceClass, respondOk: [], respondNo: [] };
      rows.set(key, row);
    }
    return row;
  };
  for (const sec of sections) {
    if (sec.name.toLowerCase() !== 'sounds') continue;
    const tribe = getInt(sec, 'logictribe') ?? 0;
    for (const p of sec.props) {
      const voiceClass = voiceClassAt(p.values[0]);
      if (voiceClass === undefined) continue;
      switch (p.key.toLowerCase()) {
        case 'scream': {
          const group = p.values[1];
          if (group !== undefined) rowFor(tribe, voiceClass).scream = group;
          break;
        }
        case 'generic': {
          const group = p.values[1];
          if (group !== undefined) rowFor(tribe, voiceClass).generic = group;
          break;
        }
        case 'respond': {
          const answer = Number.parseInt(p.values[1] ?? '', 10);
          const group = p.values[2];
          if (group === undefined) break;
          if (answer === RESPOND_OK) rowFor(tribe, voiceClass).respondOk.push(group);
          else if (answer === RESPOND_NO) rowFor(tribe, voiceClass).respondNo.push(group);
          break;
        }
      }
    }
  }
  return [...rows.values()].map((row) => HumanVoices.parse(row));
}

/** Extracts the `animals/sounds.ini` `[sounds]` blocks into {@link AnimalCall} rows; a block missing its
 *  tribe or group contributes nothing. */
export function extractAnimalCalls(sections: readonly RuleSection[]): AnimalCall[] {
  const calls: AnimalCall[] = [];
  for (const sec of sections) {
    if (sec.name.toLowerCase() !== 'sounds') continue;
    const tribe = getInt(sec, 'logictribetype');
    const group = getStr(sec, 'enginesoundgroup');
    if (tribe === undefined || group === undefined) continue;
    calls.push(
      AnimalCall.parse({
        tribe,
        minCount: getInt(sec, 'mincount') ?? 0,
        probability: getInt(sec, 'probability') ?? 0,
        group,
      }),
    );
  }
  return calls;
}
