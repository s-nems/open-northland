import { type Camera, tileToScreen } from '@open-northland/render/data';
import { type Entity, ONE, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { SoundIndex } from '../src/index.js';
import { defaultBindings, MAX_CHATTER_DT_MS, SoundDriver } from '../src/index.js';
import { FakeContext, type FakeSource, flush } from './helpers/fake-audio.js';

/**
 * The app-facing façade end to end through the fake platform seams: one `update()` turns world state
 * into actual (fake) playback — event one-shots, terrain ambient, settler chatter — and the whole
 * pipeline stays a free no-op while the engine is inaudible (no gesture yet / muted).
 */

const index: SoundIndex = {
  groupsByName: new Map([
    ['hammer wood', ['static/hammer01.wav']],
    ['generic viking male', ['voice/male_generic.wav']],
    ['talk viking male', ['voice/male_talk.wav']],
    ['socialtalk male', ['voice/male_social.wav']],
    ['generic viking female', []],
    ['talk viking female', []],
    ['socialtalk female', []],
    ['generic viking children', []],
  ]),
  jinglesByMusicType: new Map([[26, ['jingles/jingles_housebuilt.wav']]]),
  ambientLoopByName: new Map([['Meadow Green', 'ambient/meadow1.wav']]),
  ambientByTerrainType: new Map([[1, ['Meadow Green']]]),
};

const CANVAS_W = 800;
const CANVAS_H = 600;
// Centre the camera on tile (5,5) through the live projection (a hand-baked offset breaks on recalibration).
const centre = tileToScreen(5, 5);
const camera: Camera = {
  offsetX: CANVAS_W / 2 - centre.x,
  offsetY: CANVAS_H / 2 - centre.y,
  scale: 1,
};

const snapshot: WorldSnapshot = {
  tick: 1,
  entities: [
    { id: 3, components: { Position: { x: 5 * ONE, y: 5 * ONE }, Settler: { jobType: 0 } } },
    { id: 7, components: { Position: { x: 5 * ONE, y: 5 * ONE }, Building: {} } },
  ],
  events: [],
};

interface Harness {
  readonly driver: SoundDriver;
  readonly ctx: FakeContext;
  readonly fetched: string[];
}

function makeDriver(): Harness {
  const ctx = new FakeContext();
  const fetched: string[] = [];
  const driver = new SoundDriver(index, defaultBindings(), {
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async (url) => {
      fetched.push(url);
      return new ArrayBuffer(4);
    },
    random: () => 0,
  });
  return { driver, ctx, fetched };
}

const baseInput = { snapshot, camera, canvasW: CANVAS_W, canvasH: CANVAS_H };

describe('SoundDriver', () => {
  it('does no decision work while inaudible (no gesture yet), then plays after resume', async () => {
    const { driver, ctx, fetched } = makeDriver();
    const events: readonly SimEvent[] = [{ kind: 'buildingPlaced', entity: 7 as Entity, at: { x: 5, y: 5 } }];
    driver.update({ ...baseInput, events });
    await flush();
    expect(fetched).toHaveLength(0); // dropped before the director even ran
    expect(driver.started).toBe(false);

    await driver.resume();
    expect(driver.started).toBe(true);
    driver.update({ ...baseInput, events });
    await flush();
    expect(fetched).toEqual(['/sounds/static/hammer01.wav']);
    expect(ctx.sources).toHaveLength(1);
    expect((ctx.sources[0] as FakeSource).started).toBe(true);
  });

  it('starts the ambient bed for on-screen terrain handed through the frame input', async () => {
    const { driver, ctx } = makeDriver();
    await driver.resume();
    const terrain = { width: 10, height: 10, typeIds: new Array(100).fill(1) };
    driver.update({ ...baseInput, events: [], terrain });
    await flush();
    expect(ctx.sources).toHaveLength(1);
    expect((ctx.sources[0] as FakeSource).loop).toBe(true); // the looping meadow bed
  });

  it('merges chatter voices into the frame once the voice budget crosses a clip', async () => {
    const { driver, fetched } = makeDriver();
    await driver.resume();
    // Pump whole clamp-sized frames until one voice is owed (settler 3 is on screen at the centre).
    for (let t = 0; t < 2000; t += MAX_CHATTER_DT_MS) {
      driver.update({ ...baseInput, events: [], dtMs: MAX_CHATTER_DT_MS });
    }
    await flush();
    expect(fetched).toContain('/sounds/voice/male_generic.wav');
  });

  it('emits no chatter without dtMs', async () => {
    const { driver, fetched } = makeDriver();
    await driver.resume();
    for (let i = 0; i < 20; i++) driver.update({ ...baseInput, events: [] });
    await flush();
    expect(fetched).toHaveLength(0);
  });
});
