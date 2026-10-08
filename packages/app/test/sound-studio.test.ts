// @vitest-environment jsdom
import {
  type AmbientLoop,
  buildSoundIndex,
  DEFAULT_VOLUMES,
  defaultBindings,
  type LaneCounts,
  type MixerVolumes,
  type MusicManifest,
  type MusicSequence,
  type OneShot,
  type SoundStatsView,
} from '@open-northland/audio';
import type { SoundBank } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BURST } from '../src/entries/sound/controls.js';
import { buildSoundGalleryModel } from '../src/entries/sound/model.js';
import { createSoundStudio, type GalleryAudio } from '../src/entries/sound/studio.js';
import { messages } from '../src/i18n/index.js';

/**
 * The gallery's wiring to the driver, over a fake that records what it is asked to play: each row
 * plays through `audition` with the shot the game would build, the sliders reach the mixer and the
 * listener, a burst fires one shot a frame, and a bed or a stem loops until stopped.
 */

const AXE = ['static/axe01.wav', 'static/axe02.wav'];
const bank: SoundBank = {
  staticGroups: [
    { name: 'Woodcutter Axe', logicSoundType: 9, sfx: AXE.map((file) => ({ file, params: [] })) },
  ],
  ambient: [
    {
      name: 'Meadow Green',
      patternGroups: ['meadow green'],
      landscapeGroups: [],
      sfx: [{ file: 'ambient/meadow.wav', params: [] }],
    },
  ],
  jingles: [],
  humanVoices: [],
  animalCalls: [],
};
const MEADOW_GROUND = 3;
const index = {
  ...buildSoundIndex(bank, [], []),
  ambientByTerrainType: new Map([[MEADOW_GROUND, ['Meadow Green']]]),
};
const STEM = 'theme_viking_neutral';
const music: MusicManifest = {
  tracks: {
    [STEM]: {
      file: `${STEM}.ogg`,
      loopStartS: 4,
      loopEndS: 60,
      loudnessLufs: -20,
      gainDb: -2,
      segmentSha256: '0'.repeat(64),
    },
  },
};

interface AuditionCall {
  readonly shots: readonly OneShot[];
  readonly ambient: readonly AmbientLoop[];
  readonly scale: number;
}

/** Starts every offered shot, so a tally reads offered against started. */
class FakeAudio implements GalleryAudio {
  readonly calls: AuditionCall[] = [];
  readonly volumes: MixerVolumes[] = [];
  readonly music: (MusicSequence | null)[] = [];
  private readonly counts = { frames: 0, offered: lanes(), started: lanes(), stolen: 0 };
  get stats(): SoundStatsView {
    return this.counts;
  }
  audition(shots: readonly OneShot[], ambient: readonly AmbientLoop[], scale: number): void {
    this.calls.push({ shots, ambient, scale });
    for (const shot of shots) {
      const lane = shot.lane?.kind ?? 'free';
      this.counts.offered[lane]++;
      this.counts.started[lane]++;
    }
  }
  auditionMusic(sequence: MusicSequence | null): void {
    this.music.push(sequence);
  }
  setVolumes(volumes: MixerVolumes): void {
    this.volumes.push({ ...volumes });
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  clipLengthS(): number | undefined {
    return undefined;
  }
}

function lanes(): LaneCounts {
  return { jingle: 0, alert: 0, voice: 0, sfx: 0, free: 0 };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function mount(audio: FakeAudio): HTMLElement {
  const model = buildSoundGalleryModel(bank, index, defaultBindings());
  const root = document.createElement('div');
  root.append(...createSoundStudio(audio, index, model, music, DEFAULT_VOLUMES).sections);
  document.body.append(root);
  return root;
}

/** The page section headed `title`. */
function section(root: HTMLElement, title: string): HTMLElement {
  const found = [...root.children].find((child) => child.firstElementChild?.textContent === title);
  if (!(found instanceof HTMLElement)) throw new Error(`no section ${title}`);
  return found;
}

function button(within: HTMLElement, text: string): HTMLButtonElement {
  const b = [...within.querySelectorAll('button')].find((candidate) => candidate.textContent === text);
  if (b === undefined) throw new Error(`no button ${text}`);
  return b;
}

function setSlider(root: HTMLElement, caption: string, value: number): void {
  const label = [...root.querySelectorAll('label')].find((l) => l.textContent?.startsWith(caption));
  const input = label?.querySelector('input');
  if (input === null || input === undefined) throw new Error(`no slider ${caption}`);
  input.value = String(value);
  input.dispatchEvent(new Event('input'));
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('sound studio', () => {
  const copy = messages().soundGallery;

  it('plays a pick through the driver with the index pool, the work lane and the pan slider', async () => {
    const audio = new FakeAudio();
    const root = mount(audio);
    setSlider(root, copy.pan, -50);
    button(section(root, copy.cues), copy.pick).click();
    await flush();
    const shot = audio.calls.at(-1)?.shots[0];
    expect(shot?.files).toBe(index.groupsByName.get('woodcutter axe'));
    expect(shot?.lane).toEqual({ kind: 'sfx' });
    expect(shot?.pan).toBe(-0.5);
  });

  it('fires a burst one shot a frame, each as its own emitter, and shows what the lanes started', async () => {
    const audio = new FakeAudio();
    const root = mount(audio);
    button(section(root, copy.cues), `▶ ×${DEFAULT_BURST}`).click();
    for (let n = 0; n < DEFAULT_BURST + 1; n++) await flush();
    expect(audio.calls).toHaveLength(DEFAULT_BURST);
    expect(audio.calls.every((call) => call.shots.length === 1)).toBe(true);
    expect(new Set(audio.calls.map((call) => call.shots[0]?.key)).size).toBe(DEFAULT_BURST);
    expect(root.textContent).toContain(`${copy.lanes.sfx} ${DEFAULT_BURST}`);
  });

  it('moves the mixer bus and the camera zoom the slider names', async () => {
    const audio = new FakeAudio();
    const root = mount(audio);
    setSlider(root, messages().mainMenu.settings.volumes.world, 40);
    expect(audio.volumes.at(-1)).toEqual({ ...DEFAULT_VOLUMES, world: 40 });
    setSlider(root, copy.zoom, 0.5);
    expect(audio.calls.at(-1)).toEqual({ shots: [], ambient: [], scale: 0.5 });
  });

  it('loops a bed until switched off, and stops music and beds together', async () => {
    const audio = new FakeAudio();
    const root = mount(audio);
    const beds = section(root, copy.ambient);
    button(beds, copy.bedOn).click();
    await flush();
    expect(audio.calls.at(-1)?.ambient.map((bed) => bed.file)).toEqual(['ambient/meadow.wav']);
    button(beds, copy.bedOff).click();
    await flush();
    expect(audio.calls.at(-1)?.ambient).toEqual([]);
    // The music row's play loops its stem; the stop button ends it and every bed.
    button(section(root, copy.music), copy.pick).click();
    await flush();
    expect(audio.music.at(-1)?.next()?.track).toBe(music.tracks[STEM]);
    button(beds, copy.bedOn).click();
    await flush();
    button(root, copy.stopMusic).click();
    expect(audio.music.at(-1)).toBeNull();
    expect(audio.calls.at(-1)?.ambient).toEqual([]);
    expect(button(beds, copy.bedOn)).toBeDefined();
  });
});
