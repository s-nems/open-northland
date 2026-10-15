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
    const load = await mapBriefingVoices('island', async () =>
      source(files, { voices: ['.voice-pol-0001.wav'] }),
    );
    expect(await load({ lang: 'pol', id: 1 })).toEqual(new Uint8Array([7, 8]));
    await load({ lang: 'pol', id: 1 });
    expect(files).toHaveBeenCalledOnce();
    expect(files).toHaveBeenCalledWith('/maps/island.voice-pol-0001.wav');
  });

  it('asks for no clip the listing leaves out, nor for a map awaiting a rebuild or none at all', async () => {
    const files = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1])));
    const voice = { lang: 'pol', id: 1 } as const;
    const unlisted = await mapBriefingVoices('island', async () => source(files));
    expect(await unlisted(voice)).toBeNull();
    const otherClip = await mapBriefingVoices('island', async () =>
      source(files, { voices: ['.voice-eng-0001.wav'] }),
    );
    expect(await otherClip(voice)).toBeNull();
    const stale = await mapBriefingVoices('island', async () =>
      source(files, { voices: ['.voice-pol-0001.wav'] }, true),
    );
    expect(await stale(voice)).toBeNull();
    expect(await (await mapBriefingVoices('island', async () => null))(voice)).toBeNull();
    expect(await (await mapBriefingVoices(null))(voice)).toBeNull();
    expect(files).not.toHaveBeenCalled();
  });
});

describe('briefingVoicePlayer', () => {
  it('drops a clip that loads after the page turned', async () => {
    const sink = { narrate: vi.fn(), stopNarration: vi.fn() };
    const clip = new Uint8Array([1]);
    let release: (value: typeof clip) => void = () => undefined;
    const slow = new Promise<typeof clip>((resolve) => {
      release = resolve;
    });
    const player = briefingVoicePlayer(async (voice) => (voice.id === 1 ? slow : clip), sink);
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
    const narrate = vi.fn(() => {
      throw new Error('unplayable');
    });
    briefingVoicePlayer(async () => new Uint8Array([1]), { narrate, stopNarration: vi.fn() }).play({
      lang: 'pol',
      id: 1,
    });
    await vi.waitFor(() => expect(narrate).toHaveBeenCalled());
  });
});
