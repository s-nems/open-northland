import {
  defaultBindings,
  type EventSound,
  type SoundBindings,
  VIKING_VOICE_POOLS,
  type VoiceClass,
} from '@open-northland/audio';
import type { SoundBank } from '@open-northland/data';
import { HARVEST_ATOMIC } from '../catalog/atomics.js';
import { hasSoundContent } from '../content/audio.js';
import { loadIr } from '../content/ir.js';
import { formatMessage, messages } from '../i18n/index.js';
import { el, pageInnerStyle, pageRootStyle, pageSection } from '../view/overlay.js';

/**
 * The `?sounds` verification gallery — the audio twin of the `?anim` character gallery. An agent can't
 * self-judge whether a sound is the right sound (root AGENTS.md "How to verify your work"), so this is the
 * human-oracle seam for audio: it lists every wired mapping — which sim happening triggers which decoded
 * clip, the settler voice pools split by sex/age, the life-event jingles and the terrain ambient beds —
 * each with a ▶ that plays the wav straight off the `/sounds` dev route. A click is a user gesture, so the
 * browser lets it sound without the live loop's suspended-until-gesture dance.
 *
 * Two halves like the anim gallery: a pure {@link buildSoundGalleryModel} (unit-tested — it is where the
 * event→sound bindings become an auditable list) and the DOM render below.
 */

/** A named group and the interchangeable clips the engine picks from — the leaf of every gallery row. */
export interface ClipList {
  readonly group: string;
  readonly clips: readonly string[];
}

/** One "a happening → its sound" row: what occurs, when, the bound group/jingle, and its clips. */
export interface ActionRow {
  /** PL name of the happening (e.g. "Rąbanie drzewa"). */
  readonly label: string;
  /** PL description of when it fires (e.g. "każde uderzenie siekierą drwala"). */
  readonly trigger: string;
  /** The bound sound's handle (the `SoundFXStatic` group name, or the jingle name). */
  readonly sound: string;
  /** Spatial (positioned in the world) vs jingle (non-spatial life-event stinger). */
  readonly kind: EventSound['kind'];
  readonly clips: readonly string[];
}

/** The voice pools for one sex/age class — what an on-screen settler of that class draws its murmur from. */
export interface VoiceClassView {
  readonly cls: VoiceClass;
  readonly label: string;
  readonly groups: readonly ClipList[];
}

/** The whole auditable model: happenings, voices (by sex/age), jingles, ambient beds. */
export interface SoundGalleryModel {
  readonly actions: readonly ActionRow[];
  readonly voices: readonly VoiceClassView[];
  readonly jingles: readonly ClipList[];
  readonly ambient: readonly ClipList[];
}

/** An action's binding key: the `chop` atomic, or one of the `byEvent` sim-event kinds. */
type ActionKind =
  | 'chop'
  | 'buildingPlaced'
  | 'boatPlaced'
  | 'goodProduced'
  | 'buildingFinished'
  | 'settlerBorn'
  | 'settlerDied';

/** The action rows to show, in a readable order — `chop` is the atomic binding, the rest are `byEvent`. */
const ACTION_EVENTS: readonly {
  readonly kind: ActionKind;
}[] = [
  { kind: 'chop' },
  { kind: 'buildingPlaced' },
  { kind: 'boatPlaced' },
  { kind: 'goodProduced' },
  { kind: 'buildingFinished' },
  { kind: 'settlerBorn' },
  { kind: 'settlerDied' },
];

/** The clips of a `SoundFXStatic` group by name (case-insensitive), or `[]` when the bank lacks it. */
function groupClips(sounds: SoundBank, name: string): readonly string[] {
  const g = sounds.staticGroups.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return g?.sfx.map((s) => s.file) ?? [];
}

/** Resolve a binding into its display sound (name + clips) — a group for spatial, a jingle for a MusicType. */
function resolveSound(
  sound: EventSound | undefined,
  sounds: SoundBank,
): { readonly sound: string; readonly kind: EventSound['kind']; readonly clips: readonly string[] } | null {
  if (sound === undefined) return null;
  if (sound.kind === 'spatial') {
    return { sound: sound.group, kind: 'spatial', clips: groupClips(sounds, sound.group) };
  }
  const j = sounds.jingles.find((x) => x.musicType === sound.musicType);
  return {
    sound: j?.name && j.name.length > 0 ? j.name : `MusicType ${sound.musicType}`,
    kind: 'jingle',
    clips: j?.sfx.map((s) => s.file) ?? [],
  };
}

/**
 * Turn the decoded bank + the resolved {@link SoundBindings} into the auditable gallery model: the
 * happening→sound rows (the chop atomic + the event bindings), the sex/age voice pools, the jingles and
 * the ambient beds. Pure — no DOM, no Audio — so the "which sound answers which happening" join is
 * unit-tested. `chopAtomicId` is the content's woodcutter-chop atomic (the app owns it, like the driver).
 */
export function buildSoundGalleryModel(
  sounds: SoundBank,
  bindings: SoundBindings,
  chopAtomicId: number,
): SoundGalleryModel {
  const actions: ActionRow[] = [];
  for (const ev of ACTION_EVENTS) {
    const bound = ev.kind === 'chop' ? bindings.byAtomic.get(chopAtomicId) : bindings.byEvent[ev.kind];
    const resolved = resolveSound(bound, sounds);
    if (resolved === null) continue; // unbound in this build — omit the row rather than show an empty one
    const copy = messages().soundGallery.actionsCatalog[ev.kind];
    actions.push({ label: copy.label, trigger: copy.trigger, ...resolved });
  }

  const voices: VoiceClassView[] = (['male', 'female', 'child'] as const).map((cls) => ({
    cls,
    label:
      cls === 'male'
        ? messages().soundGallery.voicesCatalog.male
        : cls === 'female'
          ? messages().soundGallery.voicesCatalog.female
          : messages().soundGallery.children,
    groups: VIKING_VOICE_POOLS[cls].map((name) => ({ group: name, clips: groupClips(sounds, name) })),
  }));

  const jingles: ClipList[] = sounds.jingles.map((j) => ({
    group: j.name && j.name.length > 0 ? j.name : `MusicType ${j.musicType ?? '?'}`,
    clips: j.sfx.map((s) => s.file),
  }));

  const ambient: ClipList[] = sounds.ambient.map((a) => ({
    group: a.name,
    clips: a.sfx.map((s) => s.file),
  }));

  return { actions, voices, jingles, ambient };
}

// ─── DOM render (browser-only; the pure model above is what the test covers) ─────────────────────────

/** Cap on individual per-clip play buttons a group shows — the rest are reachable via "▶ losowy". */
const MAX_CLIP_BUTTONS = 16;

/** The gallery's page-shell knobs (shared shell in view/overlay.ts) — denser than the menu. */
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

/** The single active player — clicking a new ▶ stops the previous clip so sounds never stack. */
let current: HTMLAudioElement | null = null;
/** Play one wav off the `/sounds` dev route (a click gesture, so autoplay policy is satisfied). */
function play(file: string): void {
  if (current !== null) current.pause();
  current = new Audio(`/sounds/${file}`);
  void current.play().catch(() => undefined);
}

/** The basename of a `dir/name.wav` path — the short label a play button shows. */
function basename(file: string): string {
  const slash = file.lastIndexOf('/');
  return slash >= 0 ? file.slice(slash + 1) : file;
}

/** A play button for one clip (labelled by its basename). */
function clipButton(file: string): HTMLButtonElement {
  const b = el('button', CLIP_BTN_STYLE, `▶ ${basename(file)}`);
  b.addEventListener('click', () => play(file));
  return b;
}

/** The clip buttons for a group: up to {@link MAX_CLIP_BUTTONS} named clips + a random pick when capped. */
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
    // Math.random is fine here — this is the browser gallery, not the deterministic sim.
    rand.addEventListener('click', () => play(clips[Math.floor(Math.random() * clips.length)] as string));
    wrap.append(rand);
  }
  return wrap;
}

/** A group row: its name + clip count on top, the play buttons below. */
function groupRow(cl: ClipList): HTMLElement {
  const row = el('div', ROW_STYLE);
  row.append(
    el('div', 'font-weight:700', `${cl.group}  ·  ${cl.clips.length} ${messages().common.recordings}`),
  );
  row.append(clipButtons(cl.clips));
  return row;
}

/** A happening→sound row: the happening + when it fires, the bound sound + kind badge, then its clips. */
function actionRow(a: ActionRow): HTMLElement {
  const row = el('div', ROW_STYLE);
  const head = el('div', 'display:flex;align-items:baseline;gap:8px;flex-wrap:wrap');
  head.append(el('span', 'font-weight:700', a.label));
  const badge =
    a.kind === 'jingle' ? messages().soundGallery.nonPositional : messages().soundGallery.positional;
  head.append(el('span', 'opacity:0.6;font-size:12px', `→ ${a.sound}  ·  ${badge}`));
  row.append(head);
  row.append(el('div', 'opacity:0.7;font-size:12px;margin-top:2px', a.trigger));
  row.append(clipButtons(a.clips));
  return row;
}

/** Mount a full-page message (missing `content/`) instead of a blank gallery. */
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

/**
 * Render the `?sounds` gallery: fetch the decoded bank, build the model, and lay out the four sections
 * with a ▶ on every clip. Degrades to a "run the pipeline" message when `content/` (and thus the sound
 * bank) is absent — the same graceful-without-content stance the other real-content entries take.
 */
export async function renderSoundGallery(
  _canvas: HTMLCanvasElement,
  _params: URLSearchParams,
): Promise<void> {
  const ir = await loadIr();
  const sounds = ir?.sounds;
  // Empty (or absent) bank ⇒ nothing to audition — the same emptiness the live driver treats as "run silent".
  if (!hasSoundContent(sounds)) {
    mountFullPageMessage(messages().soundGallery.missingTitle, messages().soundGallery.missingDetail);
    return;
  }

  const model = buildSoundGalleryModel(
    sounds,
    defaultBindings({ chopAtomicId: HARVEST_ATOMIC }),
    HARVEST_ATOMIC,
  );

  const root = el('div', ROOT_STYLE);
  const inner = el('div', INNER_STYLE);
  inner.append(
    el('div', 'font-weight:700;font-size:24px', messages().soundGallery.title),
    el('div', 'opacity:0.78;margin-top:4px;font-size:13px;line-height:1.5', messages().soundGallery.intro),
  );

  inner.append(pageSection(messages().soundGallery.actions, model.actions.map(actionRow)));
  const voiceRows: HTMLElement[] = [];
  for (const v of model.voices) {
    voiceRows.push(el('div', 'font-weight:700;opacity:0.85;margin:10px 0 2px', v.label));
    for (const g of v.groups) voiceRows.push(groupRow(g));
  }
  inner.append(pageSection(messages().soundGallery.voices, voiceRows));
  inner.append(pageSection(messages().soundGallery.jingles, model.jingles.map(groupRow)));
  inner.append(pageSection(messages().soundGallery.ambient, model.ambient.map(groupRow)));

  root.append(inner);
  document.body.append(root);
}
