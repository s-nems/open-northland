import { defaultBindings, type EventSound, type SoundBindings, UI_CUE_FILES } from '@open-northland/audio';
import type { HumanVoices, SoundBank, VoiceClass } from '@open-northland/data';
import { hasSoundContent } from '../content/audio.js';
import { loadIr } from '../content/ir/load.js';
import { formatMessage, messages } from '../i18n/index.js';
import { el, pageInnerStyle, pageRootStyle, pageSection } from '../view/overlay.js';

/**
 * The `?sounds` verification gallery: the human-oracle seam for audio, since whether a sound is the
 * right sound cannot be self-judged. It lists every wired mapping with a play button per clip.
 */

/** A named group and the interchangeable clips the engine picks from. */
export interface ClipList {
  readonly group: string;
  readonly clips: readonly string[];
  /** The group's `logicSoundType` id, when it carries one - the id an animation's `event <at> 34 <id>`
   *  names to play this group. Absent for a group no cue can reach. */
  readonly soundType?: number;
}

export interface ActionRow {
  /** Localized name of the happening. */
  readonly label: string;
  /** Localized description of when it fires. */
  readonly trigger: string;
  /** The bound sound's handle (the `SoundFXStatic` group name, the jingle name, or a hardwired wav). */
  readonly sound: string;
  /** Spatial (positioned in the world), jingle (life-event stinger) or cue (a hardwired centred wav). */
  readonly kind: EventSound['kind'];
  /** Whether a jingle rings only while its event's position is on screen; false for the other kinds. */
  readonly screenGated: boolean;
  readonly clips: readonly string[];
}

/** One tribe's voice for one class, as `humans/sounds.cif` binds it: its scream, its idle chatter and
 *  the "ok" answers a settler of that class picks its lifelong voice from. */
export interface VoiceClassView {
  readonly tribe: number;
  readonly cls: VoiceClass;
  readonly label: string;
  readonly groups: readonly ClipList[];
}

export interface SoundGalleryModel {
  readonly actions: readonly ActionRow[];
  /** The static groups an animation cue can name, by their `logicSoundType` id. This is where a settler's
   *  own action sounds live - the axe, the hammer, the scythe - since those are chosen by the animation
   *  data rather than bound to an event here. A group the extraction left without an id is unreachable
   *  from a cue and omitted. */
  readonly cues: readonly ClipList[];
  readonly voices: readonly VoiceClassView[];
  /** Each animal tribe's unprompted call (`animals/sounds.ini`). */
  readonly animalCalls: readonly ClipList[];
  readonly jingles: readonly ClipList[];
  readonly ambient: readonly ClipList[];
}

/** Names the gallery prints for a tribe id, from the content's tribe and animal tables; a tribe the
 *  tables do not name prints its number. */
export type TribeLabel = (tribe: number) => string | undefined;

/** The gallery's class order: the grown voices first. */
const VOICE_CLASS_ORDER: readonly VoiceClass[] = ['male', 'female', 'child'];

/** An action's binding key - one of the `byEvent` sim-event kinds. */
type ActionKind =
  | 'buildingPlaced'
  | 'boatPlaced'
  | 'goodProduced'
  | 'buildingFinished'
  | 'settlerBorn'
  | 'settlerDied';

const ACTION_EVENTS: readonly {
  readonly kind: ActionKind;
}[] = [
  { kind: 'buildingPlaced' },
  { kind: 'boatPlaced' },
  { kind: 'goodProduced' },
  { kind: 'buildingFinished' },
  { kind: 'settlerBorn' },
  { kind: 'settlerDied' },
];

/** Matches the `SoundFXStatic` group name case-insensitively; `[]` when the bank lacks it. */
function groupClips(sounds: SoundBank, name: string): readonly string[] {
  const g = sounds.staticGroups.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return g?.sfx.map((s) => s.file) ?? [];
}

function resolveSound(
  sound: EventSound | undefined,
  sounds: SoundBank,
): Pick<ActionRow, 'sound' | 'kind' | 'screenGated' | 'clips'> | null {
  if (sound === undefined) return null;
  if (sound.kind === 'spatial') {
    return {
      sound: sound.group,
      kind: 'spatial',
      screenGated: false,
      clips: groupClips(sounds, sound.group),
    };
  }
  if (sound.kind === 'cue') {
    return { sound: sound.cue, kind: 'cue', screenGated: false, clips: [UI_CUE_FILES[sound.cue]] };
  }
  const j = sounds.jingles.find((x) => x.musicType === sound.musicType);
  return {
    sound: j?.name && j.name.length > 0 ? j.name : `MusicType ${sound.musicType}`,
    kind: 'jingle',
    screenGated: sound.screenGated === true,
    clips: j?.sfx.map((s) => s.file) ?? [],
  };
}

function voiceClassLabel(cls: VoiceClass): string {
  const copy = messages().soundGallery;
  if (cls === 'male') return copy.voicesCatalog.male;
  return cls === 'female' ? copy.voicesCatalog.female : copy.children;
}

/** The groups one voice row plays, each prefixed with its role so the listener knows what they hear. */
function voiceGroups(voices: HumanVoices, sounds: SoundBank): ClipList[] {
  const roles = messages().soundGallery.voiceRoles;
  const groups: ClipList[] = [];
  const add = (role: string, name: string): void => {
    groups.push({ group: `${role}: ${name}`, clips: groupClips(sounds, name) });
  };
  if (voices.scream !== undefined) add(roles.scream, voices.scream);
  if (voices.generic !== undefined) add(roles.chatter, voices.generic);
  for (const name of voices.respondOk) add(roles.ok, name);
  for (const name of voices.respondNo) add(roles.no, name);
  return groups;
}

/** Pure, with no DOM or Audio, so the "which sound answers which happening" join is unit-tested. */
export function buildSoundGalleryModel(
  sounds: SoundBank,
  bindings: SoundBindings,
  tribeLabel: TribeLabel = () => undefined,
): SoundGalleryModel {
  const actions: ActionRow[] = [];
  for (const ev of ACTION_EVENTS) {
    const resolved = resolveSound(bindings.byEvent[ev.kind], sounds);
    if (resolved === null) continue; // unbound in this build - omit the row rather than show an empty one
    const copy = messages().soundGallery.actionsCatalog[ev.kind];
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
      groups: voiceGroups(row, sounds),
    }));

  const animalCalls: ClipList[] = sounds.animalCalls.map((call) => ({
    group: `${tribeName(call.tribe)}: ${call.group}`,
    clips: groupClips(sounds, call.group),
  }));

  const jingles: ClipList[] = sounds.jingles.map((j) => ({
    group: j.name && j.name.length > 0 ? j.name : `MusicType ${j.musicType ?? '?'}`,
    clips: j.sfx.map((s) => s.file),
  }));

  const ambient: ClipList[] = sounds.ambient.map((a) => ({
    group: a.name,
    clips: a.sfx.map((s) => s.file),
  }));

  const cues: ClipList[] = [];
  for (const g of sounds.staticGroups) {
    if (g.logicSoundType === undefined) continue; // no cue can name it
    cues.push({ group: g.name, clips: g.sfx.map((s) => s.file), soundType: g.logicSoundType });
  }

  return { actions, cues, voices, animalCalls, jingles, ambient };
}

// ─── DOM render (browser-only) ───────────────────────────────────────────────────────────────────────

/** Cap on per-clip play buttons a group shows; the rest are reachable through the random pick. */
const MAX_CLIP_BUTTONS = 16;

const ROOT_STYLE = pageRootStyle(32, 14);
const INNER_STYLE = pageInnerStyle(1040);

const CLIP_BTN_STYLE = [
  'cursor:pointer',
  'background:#3a2f22',
  'color:#e8dcc8',
  'border:1px solid #6b5840',
  'border-radius:5px',
  'padding:3px 7px',
  'margin:2px 4px 2px 0',
  'font:11px ui-monospace,monospace',
].join(';');

const ROW_STYLE = [
  'padding:8px 10px',
  'margin:6px 0',
  'background:#2a2016',
  'border:1px solid #4a3c2c',
  'border-radius:6px',
].join(';');

/** The single active player: starting a clip stops the previous one, so sounds never stack. */
let current: HTMLAudioElement | null = null;
/** Plays one wav off the `/sounds` dev route; the click gesture satisfies the autoplay policy. */
function play(file: string): void {
  if (current !== null) current.pause();
  current = new Audio(`/sounds/${file}`);
  void current.play().catch(() => undefined);
}

function basename(file: string): string {
  const slash = file.lastIndexOf('/');
  return slash >= 0 ? file.slice(slash + 1) : file;
}

function clipButton(file: string): HTMLButtonElement {
  const b = el('button', CLIP_BTN_STYLE, `▶ ${basename(file)}`);
  b.addEventListener('click', () => play(file));
  return b;
}

function clipButtons(clips: readonly string[]): HTMLElement {
  const wrap = el('div', 'margin-top:4px');
  if (clips.length === 0) {
    wrap.append(el('span', 'opacity:0.55;font-size:12px', messages().common.noRecordings));
    return wrap;
  }
  for (const file of clips.slice(0, MAX_CLIP_BUTTONS)) wrap.append(clipButton(file));
  if (clips.length > MAX_CLIP_BUTTONS) {
    const rand = el(
      'button',
      CLIP_BTN_STYLE,
      formatMessage(messages().common.randomMore, { count: clips.length - MAX_CLIP_BUTTONS }),
    );
    // Math.random is allowed here: this is the browser gallery, not the deterministic sim.
    rand.addEventListener('click', () => play(clips[Math.floor(Math.random() * clips.length)] as string));
    wrap.append(rand);
  }
  return wrap;
}

function groupRow(cl: ClipList): HTMLElement {
  const row = el('div', ROW_STYLE);
  const id = cl.soundType !== undefined ? `  ·  id ${cl.soundType}` : '';
  row.append(
    el('div', 'font-weight:700', `${cl.group}${id}  ·  ${cl.clips.length} ${messages().common.recordings}`),
  );
  row.append(clipButtons(cl.clips));
  return row;
}

function actionRow(a: ActionRow): HTMLElement {
  const row = el('div', ROW_STYLE);
  const head = el('div', 'display:flex;align-items:baseline;gap:8px;flex-wrap:wrap');
  head.append(el('span', 'font-weight:700', a.label));
  const copy = messages().soundGallery;
  const badge =
    a.kind === 'spatial'
      ? copy.positional
      : a.kind === 'cue'
        ? copy.hardwiredCue
        : a.screenGated
          ? copy.screenGatedJingle
          : copy.nonPositional;
  head.append(el('span', 'opacity:0.6;font-size:12px', `→ ${a.sound}  ·  ${badge}`));
  row.append(head);
  row.append(el('div', 'opacity:0.7;font-size:12px;margin-top:2px', a.trigger));
  row.append(clipButtons(a.clips));
  return row;
}

function mountFullPageMessage(title: string, detail: string): void {
  const root = el('div', ROOT_STYLE);
  const inner = el('div', INNER_STYLE);
  inner.append(
    el('div', 'font-weight:700;font-size:22px', title),
    el('div', 'opacity:0.8;margin-top:8px', detail),
  );
  root.append(inner);
  document.body.append(root);
}

/** Degrades to a "run the pipeline" message when `content/`, and with it the sound bank, is absent. */
export async function renderSoundGallery(
  _canvas: HTMLCanvasElement,
  _params: URLSearchParams,
): Promise<void> {
  const ir = await loadIr();
  const sounds = ir?.sounds;
  if (ir === null || !hasSoundContent(sounds)) {
    mountFullPageMessage(messages().soundGallery.missingTitle, messages().soundGallery.missingDetail);
    return;
  }

  // The tribe table names people and animal species alike; the first record naming a tribe wins.
  const namedTribes = new Map<number, string>();
  for (const tribe of ir.tribes ?? []) {
    if (tribe.typeId !== undefined && tribe.name !== undefined && !namedTribes.has(tribe.typeId)) {
      namedTribes.set(tribe.typeId, tribe.name);
    }
  }
  const model = buildSoundGalleryModel(sounds, defaultBindings(), (tribe) => namedTribes.get(tribe));

  const root = el('div', ROOT_STYLE);
  const inner = el('div', INNER_STYLE);
  inner.append(
    el('div', 'font-weight:700;font-size:24px', messages().soundGallery.title),
    el('div', 'opacity:0.78;margin-top:4px;font-size:13px;line-height:1.5', messages().soundGallery.intro),
  );

  inner.append(pageSection(messages().soundGallery.actions, model.actions.map(actionRow)));
  inner.append(pageSection(messages().soundGallery.cues, model.cues.map(groupRow)));
  const voiceRows: HTMLElement[] = [];
  for (const v of model.voices) {
    voiceRows.push(el('div', 'font-weight:700;opacity:0.85;margin:10px 0 2px', v.label));
    for (const g of v.groups) voiceRows.push(groupRow(g));
  }
  inner.append(pageSection(messages().soundGallery.voices, voiceRows));
  inner.append(pageSection(messages().soundGallery.animalCalls, model.animalCalls.map(groupRow)));
  inner.append(pageSection(messages().soundGallery.jingles, model.jingles.map(groupRow)));
  inner.append(pageSection(messages().soundGallery.ambient, model.ambient.map(groupRow)));

  root.append(inner);
  document.body.append(root);
}
