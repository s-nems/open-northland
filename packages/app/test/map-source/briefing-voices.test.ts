import { describe, expect, it, vi } from 'vitest';
import { briefingVoicePlayer, mapBriefingVoices } from '../../src/content/map-source/briefing-voices.js';

describe('mapBriefingVoices', () => {
  it('reads the clip through the map`s own fetch once, and a missing clip is silent', async () => {
    const files = vi.fn<typeof fetch>(async (input) =>
      String(input) === '/maps/island.voice-pol-0001.wav'
        ? new Response(new Uint8Array([7, 8]))
        : new Response(null, { status: 404 }),
    );
    const load = mapBriefingVoices('island', async () => files);
    expect(await load({ lang: 'pol', id: 1 })).toEqual(new Uint8Array([7, 8]));
    await load({ lang: 'pol', id: 1 });
    expect(await load({ lang: 'pol', id: 2 })).toBeNull();
    expect(files).toHaveBeenCalledTimes(2);
    expect(await mapBriefingVoices(null, async () => files)({ lang: 'pol', id: 1 })).toBeNull();
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
});
