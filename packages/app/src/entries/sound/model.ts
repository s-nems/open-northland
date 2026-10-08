import {
  type AuditionRole,
  type EventSound,
  NOTIFICATION_SOUNDS,
  type NotificationCue,
  notificationShot,
  type OneShot,
  type SoundBindings,
  type SoundIndex,
  UI_CUE_FILES,
  type UiCue,
  uiCueShot,
} from '@open-northland/audio';
import type { HumanVoices, SoundBank, VoiceClass } from '@open-northland/data';
import { formatMessage, messages } from '../../i18n/index.js';

/**
 * The `?sounds` gallery's pure model: every group the game can sound, each with the way it plays in the
 * game, joined from the decoded bank, the sound index the game plays from and the event bindings. The
 * clip lists are the index's own arrays, so the data's silent placeholder slots never show and a play
 * shares the game's pool, volume and no-repeat memory.
 */

/** How a row plays through the driver. */
export type GalleryPlay =
  /** A pool of the index, as the director builds its shot. */
  | { readonly kind: 'pool'; readonly role: AuditionRole }
  /** A GUI or notification cue, the shot the game fires for it. */
  | { readonly kind: 'cue'; readonly shot: OneShot }
  /** An ambient bed, looped while switched on; `looped` is whether any ground loops it in play. */
  | { readonly kind: 'bed'; readonly looped: boolean };

/** A named group and the interchangeable clips the engine picks from. */
export interface ClipList {
  readonly group: string;
  readonly clips: readonly string[];
  /** The group's `logicSoundType` id, when it carries one - the id an animation's `event <at> 34 <id>`
   *  names to play this group. */
  readonly soundType?: number;
  readonly play: GalleryPlay;
}

export interface ActionRow extends ClipList {
  /** Localized name of the happening. */
  readonly label: string;
  /** Localized description of when it fires. */
  readonly trigger: string;
  /** Spatial (positioned in the world), jingle (life-event stinger) or cue (a hardwired centred wav). */
  readonly kind: EventSound['kind'];
  /** Whether a jingle rings only while its event's position is on screen; false for the other kinds. */
  readonly screenGated: boolean;
}

/** One tribe's voice for one class, as `humans/sounds.cif` binds it: its scream, its idle chatter and
 *  the answers a settler of that class picks its lifelong voice from. */
export interface VoiceClassView {
  readonly tribe: number;
  readonly cls: VoiceClass;
  readonly label: string;
  readonly groups: readonly ClipList[];
}

export interface SoundGalleryModel {
  readonly actions: readonly ActionRow[];
  /** The static groups an animation cue can name, by their `logicSoundType` id: a settler's own work
   *  sounds, chosen by the animation data rather than bound to an event. */
  readonly cues: readonly ClipList[];
  readonly voices: readonly VoiceClassView[];
  /** Each animal tribe's unprompted call (`animals/sounds.ini`). */
  readonly animalCalls: readonly ClipList[];
  /** What placed objects sound (birds in a tree), one row per pool of equal pick weight and chance. */
  readonly objectAmbience: readonly ClipList[];
  readonly jingles: readonly ClipList[];
  /** The hardwired GUI cues and the notification cues built on them. */
  readonly interface: readonly ClipList[];
  readonly ambient: readonly ClipList[];
}

/** Names the gallery prints for a tribe id, from the content's tribe and animal tables; a tribe the
 *  tables do not name prints its number. */
export type TribeLabel = (tribe: number) => string | undefined;

/** The gallery's class order: the grown voices first. */
const VOICE_CLASS_ORDER: readonly VoiceClass[] = ['male', 'female', 'child'];

const WORK: AuditionRole = { kind: 'world', layer: 'detail' };
const VOICE: AuditionRole = { kind: 'voice' };
const SCREAM: AuditionRole = { kind: 'scream' };
const ANSWER: AuditionRole = { kind: 'answer' };
const AMBIENCE: AuditionRole = { kind: 'ambience' };
const NO_CLIPS: readonly string[] = [];

/** The happenings the catalog names; every event `defaultBindings` binds must be one (test-enforced). */
type ActionKind = keyof ReturnType<typeof messages>['soundGallery']['actionsCatalog'];

function actionCopy(kind: string): { readonly label: string; readonly trigger: string } | undefined {
  const catalog = messages().soundGallery.actionsCatalog;
  return Object.hasOwn(catalog, kind) ? catalog[kind as ActionKind] : undefined;
}

/** A static group's playable wavs by name, as the index holds them; `[]` when it holds none. */
function groupClips(index: SoundIndex, name: string): readonly string[] {
  return index.groupsByName.get(name.toLowerCase()) ?? NO_CLIPS;
}

function pool(role: AuditionRole): GalleryPlay {
  return { kind: 'pool', role };
}

function resolveSound(
  sound: EventSound | undefined,
  sounds: SoundBank,
  index: SoundIndex,
): Omit<ActionRow, 'label' | 'trigger'> | null {
  if (sound === undefined) return null;
  if (sound.kind === 'spatial') {
    return {
      group: sound.group,
      kind: 'spatial',
      screenGated: false,
      clips: groupClips(index, sound.group),
      play: pool({ kind: 'world', layer: sound.layer ?? 'detail' }),
    };
  }
  if (sound.kind === 'cue') {
    return {
      group: sound.cue,
      kind: 'cue',
      screenGated: false,
      clips: [UI_CUE_FILES[sound.cue]],
      play: { kind: 'cue', shot: uiCueShot(sound.cue) },
    };
  }
  const j = sounds.jingles.find((x) => x.musicType === sound.musicType);
  return {
    group: j?.name && j.name.length > 0 ? j.name : `MusicType ${sound.musicType}`,
    kind: 'jingle',
    screenGated: sound.screenGated === true,
    clips: index.jinglesByMusicType.get(sound.musicType) ?? NO_CLIPS,
    play: pool({ kind: 'jingle', musicType: sound.musicType }),
  };
}

function voiceClassLabel(cls: VoiceClass): string {
  const copy = messages().soundGallery;
  if (cls === 'male') return copy.voicesCatalog.male;
  return cls === 'female' ? copy.voicesCatalog.female : copy.children;
}

/** The groups one voice row plays, each prefixed with its role so the listener knows what they hear. */
function voiceGroups(voices: HumanVoices, index: SoundIndex): ClipList[] {
  const roles = messages().soundGallery.voiceRoles;
  const groups: ClipList[] = [];
  const add = (role: string, name: string, play: AuditionRole): void => {
    const clips = groupClips(index, name);
    if (clips.length > 0) groups.push({ group: `${role}: ${name}`, clips, play: pool(play) });
  };
  if (voices.scream !== undefined) add(roles.scream, voices.scream, SCREAM);
  if (voices.generic !== undefined) add(roles.chatter, voices.generic, VOICE);
  for (const name of voices.respondOk) add(roles.ok, name, ANSWER);
  for (const name of voices.respondNo) add(roles.no, name, ANSWER);
  return groups;
}

/** Every GUI cue, then every notification cue under its own name. */
function interfaceCues(): ClipList[] {
  const rows: ClipList[] = [];
  for (const cue of Object.keys(UI_CUE_FILES) as UiCue[]) {
    rows.push({ group: cue, clips: [UI_CUE_FILES[cue]], play: { kind: 'cue', shot: uiCueShot(cue) } });
  }
  for (const notification of Object.keys(NOTIFICATION_SOUNDS) as NotificationCue[]) {
    const shot = notificationShot(notification);
    rows.push({
      group: `${notification} (${shot.files.join(', ')})`,
      clips: shot.files,
      play: { kind: 'cue', shot },
    });
  }
  return rows;
}

/** One row per object ambience pool, named once however many landscape records share it. */
function objectAmbience(index: SoundIndex): ClipList[] {
  const rows: ClipList[] = [];
  const seen = new Set<string>();
  for (const ambience of index.landscapeAmbienceByRecord.values()) {
    if (seen.has(ambience.name)) continue;
    seen.add(ambience.name);
    ambience.pools.forEach((p, n) => {
      const group = ambience.pools.length > 1 ? `${ambience.name} · ${n + 1}` : ambience.name;
      rows.push({ group, clips: p.files, play: pool(AMBIENCE) });
    });
  }
  return rows.sort((a, b) => a.group.localeCompare(b.group));
}

/** Pure, with no DOM or Audio, so the "which sound answers which happening" join is unit-tested. */
export function buildSoundGalleryModel(
  sounds: SoundBank,
  index: SoundIndex,
  bindings: SoundBindings,
  tribeLabel: TribeLabel = () => undefined,
): SoundGalleryModel {
  const actions: ActionRow[] = [];
  for (const [kind, sound] of Object.entries(bindings.byEvent)) {
    const copy = actionCopy(kind);
    const resolved = resolveSound(sound, sounds, index);
    if (copy === undefined || resolved === null) continue;
    actions.push({ label: copy.label, trigger: copy.trigger, ...resolved });
  }

  const tribeName = (tribe: number): string =>
    tribeLabel(tribe) ?? formatMessage(messages().soundGallery.tribeNumber, { tribe });
  const voices: VoiceClassView[] = [...sounds.humanVoices]
    .sort(
      (a, b) =>
        a.tribe - b.tribe ||
        VOICE_CLASS_ORDER.indexOf(a.voiceClass) - VOICE_CLASS_ORDER.indexOf(b.voiceClass),
    )
    .map((row) => ({
      tribe: row.tribe,
      cls: row.voiceClass,
      label: `${tribeName(row.tribe)} · ${voiceClassLabel(row.voiceClass)}`,
      groups: voiceGroups(row, index),
    }));

  const animalCalls: ClipList[] = sounds.animalCalls.map((call) => ({
    group: `${tribeName(call.tribe)}: ${call.group}`,
    clips: groupClips(index, call.group),
    play: pool(VOICE),
  }));

  const jingles: ClipList[] = sounds.jingles.flatMap((j) => {
    const clips = j.musicType === undefined ? undefined : index.jinglesByMusicType.get(j.musicType);
    if (j.musicType === undefined || clips === undefined || clips.length === 0) return [];
    const group = j.name && j.name.length > 0 ? j.name : `MusicType ${j.musicType}`;
    return [{ group, clips, play: pool({ kind: 'jingle', musicType: j.musicType }) }];
  });

  // The ambient groups keyed by ground patterns; the ones keyed by landscape objects are listed above.
  const looped = new Set(
    [...index.ambientByGroundPattern.values(), ...index.ambientByTerrainType.values()].flat(),
  );
  const ambient: ClipList[] = [];
  for (const bed of sounds.ambient) {
    const file = index.ambientLoopByName.get(bed.name);
    if (bed.patternGroups.length === 0 || file === undefined) continue;
    ambient.push({ group: bed.name, clips: [file], play: { kind: 'bed', looped: looped.has(bed.name) } });
  }

  const cues: ClipList[] = [];
  for (const g of sounds.staticGroups) {
    if (g.logicSoundType === undefined) continue; // no cue can name it
    const clips = groupClips(index, g.name);
    if (clips.length > 0) cues.push({ group: g.name, clips, soundType: g.logicSoundType, play: pool(WORK) });
  }

  return {
    actions,
    cues,
    voices,
    animalCalls,
    objectAmbience: objectAmbience(index),
    jingles,
    interface: interfaceCues(),
    ambient,
  };
}
