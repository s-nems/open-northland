import type { NarrationState } from '@open-northland/audio';
import type { MapsIndexEntry } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import { briefingVoicePlayer, mapBriefingVoices } from '../../src/content/map-source/briefing-voices.js';
import type { MapSource } from '../../src/content/map-source/sources.js';

const FINGERPRINT = '0'.repeat(64);

function source(files: typeof fetch, extra: Partial<MapsIndexEntry> = {}, stale = false): MapSource {
  return {
    entry: { id: 'island', fingerprint: FINGERPRINT, picture: false, minimap: false, ...extra },
    stale,
    fetch: files,
  };
}

describe('mapBriefingVoices', () => {
  it('reads a listed clip through the map`s own fetch once', async () => {
    const files = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([7, 8])));
    const voices = await mapBriefingVoices('island', async () =>
      source(files, { voices: ['.voice-pol-0001.wav'] }),
    );
    expect(voices.has({ lang: 'pol', id: 1 })).toBe(true);
    expect(voices.has({ lang: 'eng', id: 1 })).toBe(false);
    expect(await voices.load({ lang: 'pol', id: 1 })).toEqual(new Uint8Array([7, 8]));
    await voices.load({ lang: 'pol', id: 1 });
    expect(files).toHaveBeenCalledOnce();
    expect(files).toHaveBeenCalledWith('/maps/island.voice-pol-0001.wav');
  });

  it('asks for no clip the listing leaves out, nor for a map awaiting a rebuild or none at all', async () => {
    const files = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1])));
    const voice = { lang: 'pol', id: 1 } as const;
    const unlisted = await mapBriefingVoices('island', async () => source(files));
    expect(await unlisted.load(voice)).toBeNull();
    const otherClip = await mapBriefingVoices('island', async () =>
      source(files, { voices: ['.voice-eng-0001.wav'] }),
    );
    expect(await otherClip.load(voice)).toBeNull();
    const stale = await mapBriefingVoices('island', async () =>
      source(files, { voices: ['.voice-pol-0001.wav'] }, true),
    );
    expect(await stale.load(voice)).toBeNull();
    expect(await (await mapBriefingVoices('island', async () => null)).load(voice)).toBeNull();
    expect(await (await mapBriefingVoices(null)).load(voice)).toBeNull();
    expect(files).not.toHaveBeenCalled();
  });
});

/** A sink standing in for the sound driver's narration transport. */
function fakeSink() {
  let state: NarrationState = { status: 'idle', positionS: 0, durationS: 0 };
  const sink = {
    narrate: vi.fn((_wav: Uint8Array, fromS = 0) => {
      state = { status: 'playing', positionS: fromS, durationS: 9 };
    }),
    stopNarration: vi.fn(() => {
      state = { status: 'idle', positionS: 0, durationS: 0 };
    }),
    pauseNarration: vi.fn(() => {
      state = { ...state, status: 'paused' };
    }),
    resumeNarration: vi.fn(() => {
      state = { ...state, status: 'playing' };
    }),
    seekNarration: vi.fn((atS: number) => {
      state = { ...state, positionS: atS };
    }),
    narrationState: () => state,
  };
  return sink;
}

const loaderOf = (load: (voice: { readonly id: number }) => Promise<Uint8Array | null>) => ({
  has: () => true,
  load,
});

describe('briefingVoicePlayer', () => {
  it('drops a clip that loads after the page turned', async () => {
    const sink = fakeSink();
    const clip = new Uint8Array([1]);
    let release: (value: typeof clip) => void = () => undefined;
    const slow = new Promise<typeof clip>((resolve) => {
      release = resolve;
    });
    const player = briefingVoicePlayer(
      loaderOf(async (voice) => (voice.id === 1 ? slow : clip)),
      sink,
    );
    player.play({ lang: 'pol', id: 1 });
    player.stop();
    release(clip);
    await slow;
    await Promise.resolve();
    expect(sink.narrate).not.toHaveBeenCalled();
    player.play({ lang: 'pol', id: 2 });
    await vi.waitFor(() => expect(sink.narrate).toHaveBeenCalledWith(clip));
  });

  it('keeps a sink that throws from leaving an unhandled rejection', async () => {
    const sink = fakeSink();
    sink.narrate.mockImplementation(() => {
      throw new Error('unplayable');
    });
    briefingVoicePlayer(
      loaderOf(async () => new Uint8Array([1])),
      sink,
    ).play({ lang: 'pol', id: 1 });
    await vi.waitFor(() => expect(sink.narrate).toHaveBeenCalled());
  });

  it('drives a plain map`s clip: pause, resume, seek, and a replay once the line went idle', async () => {
    const files = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([5])));
    const voices = await mapBriefingVoices('island', async () =>
      source(files, { voices: ['.voice-eng-0002.wav'] }),
    );
    const sink = fakeSink();
    const player = briefingVoicePlayer(voices, sink);
    const voice = { lang: 'eng', id: 2 } as const;
    expect(player.has(voice)).toBe(true);
    player.play(voice);
    expect(player.state()).toEqual({ voice, status: 'waiting', positionS: 0, durationS: 0 });
    await vi.waitFor(() => expect(player.state().status).toBe('playing'));
    player.toggle(voice);
    expect(player.state()).toMatchObject({ voice, status: 'paused' });
    player.seek(voice, 4);
    expect(player.state().positionS).toBe(4);
    player.seek({ lang: 'eng', id: 3 }, 1);
    expect(sink.seekNarration).toHaveBeenCalledTimes(1);
    player.toggle(voice);
    expect(player.state().status).toBe('playing');
    sink.stopNarration();
    player.toggle(voice);
    expect(sink.narrate).toHaveBeenCalledTimes(2);
    player.stop();
    expect(player.state()).toEqual({ voice: null, status: 'idle', positionS: 0, durationS: 0 });
    expect(files).toHaveBeenCalledOnce();
  });
});
