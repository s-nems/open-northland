import { describe, expect, it } from 'vitest';
import {
  BUS_PREVIEWS,
  buildSoundIndex,
  busPreviewShot,
  defaultBindings,
  oneShotBus,
  SOUND_BUSES,
  SoundDriver,
  shotPerspectiveLayer,
} from '../src/index.js';
import { FakeContext, type FakeGain, type FakePanner, type FakeSource, flush } from './helpers/fake-audio.js';
import { mixerGraph } from './helpers/mixer-graph.js';

/** A settings slider's test button plays one short clip on its own bus. */

/** The buses that carry one-shots; the music bus plays its score and has no clip. */
const PREVIEWED = ['responses', 'world', 'ambient', 'ui'] as const;

describe('bus preview', () => {
  it('plays each previewed bus its own clip on that bus, centred, and none for the music', () => {
    for (const bus of PREVIEWED) {
      const shot = busPreviewShot(bus);
      expect(shot?.files).toEqual(BUS_PREVIEWS[bus]?.files);
      expect(shot === null ? undefined : oneShotBus(shot)).toBe(bus);
      expect(shot?.pan).toBe(0);
      // A slider check plays at the bus's own level, never faded or muffled by the camera's zoom.
      expect(shot === null ? undefined : shotPerspectiveLayer(shot)).toBeNull();
    }
    expect(busPreviewShot('music')).toBeNull();
    expect(SOUND_BUSES.filter((bus) => busPreviewShot(bus) !== null)).toEqual([...PREVIEWED]);
  });

  it('plays a preview through the driver once audio runs', async () => {
    const fetched: string[] = [];
    const ctx = new FakeContext();
    const index = buildSoundIndex(
      { staticGroups: [], ambient: [], jingles: [], humanVoices: [], animalCalls: [] },
      [],
      [],
    );
    const driver = new SoundDriver(index, defaultBindings(), {
      createContext: () => ctx as unknown as AudioContext,
      fetchBytes: async (url) => {
        fetched.push(url);
        return new ArrayBuffer(1);
      },
    });
    driver.previewBus('world');
    await flush();
    expect(fetched).toEqual([]);
    await driver.resume();
    driver.previewBus('world');
    driver.previewBus('music');
    await flush();
    const world = BUS_PREVIEWS.world?.files[0] ?? '';
    expect(fetched.filter((url) => url.endsWith(world))).toHaveLength(1);
    expect(ctx.sources).toHaveLength(1);
    const source = ctx.sources[0] as FakeSource;
    const entry = ((source.connectedTo[0] as FakePanner).connectedTo[0] as FakeGain).connectedTo[0];
    expect(entry).toBe(mixerGraph(ctx).buses.world);
  });
});
