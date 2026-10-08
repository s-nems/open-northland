import {
  AUTHORED_VOLUME_MAX,
  AUTHORED_VOLUME_RANGE_DB,
  auditionBed,
  auditionShot,
  type MixerVolumes,
  type MusicManifest,
  NEAR_ZOOM_SCALE,
  type OneShot,
  oneShotBus,
  type SoundDriver,
  type SoundIndex,
  type SoundStatsView,
  STAT_LANES,
  shotLayer,
  trackRotation,
} from '@open-northland/audio';
import { formatMessage, messages } from '../../i18n/index.js';
import { BUTTON_STYLE, el, pageSection } from '../../view/overlay.js';
import { type RafLoop, startRafLoop } from '../../view/runtime/raf-loop.js';
import { DEFAULT_BURST, type Listening, listeningControls } from './controls.js';
import type { ClipList, SoundGalleryModel } from './model.js';

/**
 * The `?sounds` gallery's controls and rows, played through the game's own sound driver: every play
 * passes the arbiter (lanes, budgets, pool caps, no-repeat picks) and the engine (buses, layers,
 * jitter, limiter), so what the listener hears is what the game would play for that group.
 */

/** What the gallery asks of the driver; a test passes a fake. */
export type GalleryAudio = Pick<
  SoundDriver,
  'audition' | 'auditionMusic' | 'setVolumes' | 'resume' | 'clipLengthS' | 'stats'
>;

/** Cap on per-clip play buttons a group shows; the rest are reachable through the pick. */
const MAX_CLIP_BUTTONS = 16;
/** Milliseconds after a play before a row reads its wavs' decoded lengths. */
const LENGTH_REFRESH_MS = 600;
const DB_DECIMALS = 1;
/** Decimals the seconds, pan and zoom readouts show. */
const DECIMALS = 2;

const CLIP_BTN_STYLE = [
  BUTTON_STYLE,
  'margin:2px 4px 2px 0',
  'padding:3px 7px',
  'font:11px ui-monospace,monospace',
].join(';');
const ROW_STYLE = [
  'padding:8px 10px',
  'margin:6px 0',
  'background:#2a2016',
  'border:1px solid #4a3c2c',
  'border-radius:6px',
].join(';');
const FACTS_STYLE = 'opacity:0.65;font-size:12px;margin-top:2px';

/** The counts a play moved: what each lane was offered and started, and the steals. */
function tally(before: SoundStatsView, after: SoundStatsView): string {
  const copy = messages().soundGallery;
  const lanes: string[] = [];
  for (const lane of STAT_LANES) {
    const offered = after.offered[lane] - before.offered[lane];
    if (offered === 0) continue;
    const started = after.started[lane] - before.started[lane];
    lanes.push(formatMessage(copy.laneTally, { lane: copy.lanes[lane], started, offered }));
  }
  return formatMessage(copy.tally, { lanes: lanes.join(' · '), stolen: after.stolen - before.stolen });
}

function snapshotStats(stats: SoundStatsView): SoundStatsView {
  return { ...stats, offered: { ...stats.offered }, started: { ...stats.started } };
}

function decibels(gain: number): string {
  return gain > 0 ? (20 * Math.log10(gain)).toFixed(DB_DECIMALS) : '-∞';
}

/** The authored 0-100 volume behind a pool's gain, the inverse of the index's volume curve. */
function authoredVolume(gain: number): number {
  return Math.round(AUTHORED_VOLUME_MAX * (1 + (20 * Math.log10(gain)) / AUTHORED_VOLUME_RANGE_DB));
}

function basename(file: string): string {
  const slash = file.lastIndexOf('/');
  return slash >= 0 ? file.slice(slash + 1) : file;
}

export interface SoundStudio {
  /** The gallery's whole page body: controls, then one section per model list and the music. */
  readonly sections: readonly HTMLElement[];
  /** One driver frame with no new shot: the beds switched on and the zoom, for {@link runStudioClock}. */
  readonly idleFrame: () => void;
}

/**
 * Run `frame` every animation frame while `page` shows, stopping on `pagehide` and starting again on
 * a `pageshow`. The arbiter rings a jingle that waited for its lane only inside a driver frame, so the
 * studio needs frames between its clicks as a game has.
 */
export function runStudioClock(frame: () => void, page: EventTarget): void {
  let loop: RafLoop | null = startRafLoop(frame);
  page.addEventListener('pagehide', () => {
    loop?.stop();
    loop = null;
  });
  page.addEventListener('pageshow', () => {
    loop ??= startRafLoop(frame);
  });
}

/** Build the gallery over `audio`; `music` lists the rendered stems, null when none were rendered. */
export function createSoundStudio(
  audio: GalleryAudio,
  index: SoundIndex,
  model: SoundGalleryModel,
  music: MusicManifest | null,
  volumes: MixerVolumes,
): SoundStudio {
  const copy = messages().soundGallery;
  const listening: Listening = {
    volumes: { ...volumes },
    pan: 0,
    scale: NEAR_ZOOM_SCALE,
    burst: DEFAULT_BURST,
  };
  /** The beds switched on, by name. */
  const beds = new Map<string, string>();
  const tallyLine = el('div', 'opacity:0.8;font-size:12px;margin-top:6px;min-height:1.5em');
  const burstButtons: HTMLButtonElement[] = [];
  /** Each bed row's switch back to off, for the stop button. */
  const bedResets: (() => void)[] = [];
  let nextKey = 0;

  /** Every play waits for the context the click resumes. */
  const withAudio = (action: () => void): void => {
    void audio.resume().then(action);
  };
  /** One frame through the driver: `shots`, the beds switched on, and the camera's zoom. */
  const frame = (shots: readonly OneShot[]): void => {
    const loops = [...beds].map(([name, file]) => auditionBed(name, file, listening.pan));
    audio.audition(shots, loops, listening.scale);
  };

  const shotOf = (row: ClipList, files: readonly string[]): OneShot | null => {
    const key = `gallery:${nextKey++}`;
    switch (row.play.kind) {
      case 'pool': {
        const shot = auditionShot(index, row.clips, row.play.role, key, listening.pan);
        return files === row.clips ? shot : { ...shot, files };
      }
      case 'cue':
        return files === row.clips ? { ...row.play.shot, key } : { ...row.play.shot, files, key };
      case 'bed':
        return null;
    }
  };

  /** Fire `count` plays of `row`, one a frame as a stream of game events would arrive, then show what
   *  the arbiter made of them. */
  const play = (row: ClipList, files: readonly string[], count: number, after: () => void): void =>
    withAudio(() => {
      const before = snapshotStats(audio.stats);
      let left = count;
      const step = (): void => {
        const shot = shotOf(row, files);
        if (shot !== null) frame([shot]);
        left--;
        if (left > 0) {
          requestAnimationFrame(step);
          return;
        }
        tallyLine.textContent = tally(before, audio.stats);
        after();
      };
      step();
    });

  const facts = (row: ClipList): string => {
    const parts = [formatMessage(copy.fileCount, { count: row.clips.length })];
    const sample = shotOf(row, row.clips);
    if (sample !== null) {
      const db = decibels(sample.gain);
      parts.push(
        row.play.kind === 'pool'
          ? formatMessage(copy.authoredVolume, { volume: authoredVolume(sample.gain), db })
          : formatMessage(copy.gain, { db }),
      );
      const layer = shotLayer(sample);
      const bus = messages().mainMenu.settings.volumes[oneShotBus(sample)];
      parts.push(layer === null ? bus : `${bus} / ${copy.layers[layer]}`);
    } else {
      parts.push(messages().mainMenu.settings.volumes.ambient);
      if (row.play.kind === 'bed' && !row.play.looped) parts.push(copy.bedUnreached);
    }
    return parts.join(' · ');
  };

  const lengths = (row: ClipList): string => {
    const known = row.clips.map((file) => audio.clipLengthS(file)).filter((s) => s !== undefined);
    if (known.length === 0) return copy.lengthsUnknown;
    const range = formatMessage(copy.lengths, {
      min: Math.min(...known).toFixed(DECIMALS),
      max: Math.max(...known).toFixed(DECIMALS),
    });
    return known.length < row.clips.length ? `${range} (${known.length}/${row.clips.length})` : range;
  };

  const clipButton = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = el('button', CLIP_BTN_STYLE, label);
    b.addEventListener('click', onClick);
    return b;
  };

  const groupRow = (row: ClipList, head?: HTMLElement): HTMLElement => {
    const box = el('div', ROW_STYLE);
    const id = row.soundType !== undefined ? `  ·  id ${row.soundType}` : '';
    box.append(head ?? el('div', 'font-weight:700', `${row.group}${id}`));
    const lengthLine = el('span', '', lengths(row));
    const factLine = el('div', FACTS_STYLE, `${facts(row)} · `);
    factLine.append(lengthLine);
    box.append(factLine);
    const refresh = (): void => {
      window.setTimeout(() => {
        lengthLine.textContent = lengths(row);
      }, LENGTH_REFRESH_MS);
    };
    const buttons = el('div', 'margin-top:4px');
    if (row.clips.length === 0) {
      buttons.append(el('span', 'opacity:0.55;font-size:12px', messages().common.noRecordings));
    } else if (row.play.kind === 'bed') {
      const file = row.clips[0] as string;
      const toggle = clipButton(copy.bedOn, () =>
        withAudio(() => {
          if (beds.delete(row.group)) toggle.textContent = copy.bedOn;
          else {
            beds.set(row.group, file);
            toggle.textContent = copy.bedOff;
          }
          frame([]);
          refresh();
        }),
      );
      bedResets.push(() => {
        toggle.textContent = copy.bedOn;
      });
      buttons.append(toggle);
    } else {
      buttons.append(clipButton(copy.pick, () => play(row, row.clips, 1, refresh)));
      const burst = clipButton(formatMessage(copy.burst, { count: listening.burst }), () =>
        play(row, row.clips, listening.burst, refresh),
      );
      burstButtons.push(burst);
      buttons.append(burst);
      for (const file of row.clips.slice(0, MAX_CLIP_BUTTONS)) {
        buttons.append(clipButton(`▶ ${basename(file)}`, () => play(row, [file], 1, refresh)));
      }
    }
    box.append(buttons);
    return box;
  };

  const actionRow = (a: SoundGalleryModel['actions'][number]): HTMLElement => {
    const head = el('div', 'display:flex;align-items:baseline;gap:8px;flex-wrap:wrap');
    head.append(el('span', 'font-weight:700', a.label));
    const badge =
      a.kind === 'spatial'
        ? copy.positional
        : a.kind === 'cue'
          ? copy.hardwiredCue
          : a.screenGated
            ? copy.screenGatedJingle
            : copy.nonPositional;
    head.append(el('span', 'opacity:0.6;font-size:12px', `→ ${a.group}  ·  ${badge}`));
    const wrap = el('div', '');
    wrap.append(head, el('div', 'opacity:0.7;font-size:12px;margin-top:2px', a.trigger));
    return groupRow(a, wrap);
  };

  const controls = listeningControls(
    listening,
    {
      onVolumes: (v) => audio.setVolumes(v),
      onListener: () => frame([]),
      onBurst: (count) => {
        for (const b of burstButtons) b.textContent = formatMessage(copy.burst, { count });
      },
      onStop: () => {
        audio.auditionMusic(null);
        beds.clear();
        for (const reset of bedResets) reset();
        frame([]);
      },
    },
    tallyLine,
  );

  const voiceRows: HTMLElement[] = [];
  for (const v of model.voices) {
    if (v.groups.length === 0) continue;
    voiceRows.push(el('div', 'font-weight:700;opacity:0.85;margin:10px 0 2px', v.label));
    for (const g of v.groups) voiceRows.push(groupRow(g));
  }

  const musicRows: HTMLElement[] = [];
  for (const [stem, track] of Object.entries(music?.tracks ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const box = el('div', ROW_STYLE);
    box.append(el('div', 'font-weight:700', stem));
    box.append(
      el(
        'div',
        FACTS_STYLE,
        formatMessage(copy.musicFacts, {
          start: track.loopStartS.toFixed(DECIMALS),
          end: track.loopEndS.toFixed(DECIMALS),
          db: track.gainDb.toFixed(DB_DECIMALS),
        }),
      ),
    );
    box.append(clipButton(copy.pick, () => withAudio(() => audio.auditionMusic(trackRotation([track])))));
    musicRows.push(box);
  }

  return {
    idleFrame: () => frame([]),
    sections: [
      controls,
      pageSection(copy.actions, model.actions.map(actionRow)),
      pageSection(
        copy.cues,
        model.cues.map((row) => groupRow(row)),
      ),
      pageSection(copy.voices, voiceRows),
      pageSection(
        copy.animalCalls,
        model.animalCalls.map((row) => groupRow(row)),
      ),
      pageSection(
        copy.objectAmbience,
        model.objectAmbience.map((row) => groupRow(row)),
      ),
      pageSection(
        copy.jingles,
        model.jingles.map((row) => groupRow(row)),
      ),
      pageSection(
        copy.interface,
        model.interface.map((row) => groupRow(row)),
      ),
      pageSection(
        copy.ambient,
        model.ambient.map((row) => groupRow(row)),
      ),
      pageSection(copy.music, musicRows),
    ],
  };
}
