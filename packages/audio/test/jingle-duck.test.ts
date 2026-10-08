import type { SoundBank } from '@open-northland/data';
import type { Camera } from '@open-northland/render/data';
import { ONE, tileToScreen } from '@open-northland/render/data';
import type { Entity, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  JINGLE_BIRTH,
  JINGLE_COMBAT_INTERVAL_S,
  JINGLE_DEATH,
  JINGLE_DUCK_COMPLETION_DB,
  JINGLE_DUCK_DEATH_DB,
  JINGLE_DUCK_FULL_DB,
  JINGLE_DUCK_HOLD_MS,
  JINGLE_HOUSE_BUILT,
  JINGLE_LOST,
  JINGLE_MARRIAGE,
  JINGLE_OPEN_CHEST,
  JINGLE_TECHNOLOGY,
  JINGLE_WON,
  jingleDuck,
  OFF_SCREEN_JINGLE_GAIN,
} from '../src/data/bindings.js';
import {
  buildSoundIndex,
  defaultBindings,
  directAudio,
  OneShotArbiter,
  WebAudioEngine,
} from '../src/index.js';
import { FakeContext, flush } from './helpers/fake-audio.js';
import { mixerGraph } from './helpers/mixer-graph.js';

/** How deep a jingle dips the music: by its rank, scaled by the share it rings at, and not at all for a
 *  death in a fight, which then rings once per its combat interval. */

const LOCAL = 0;
const DEATH_FILE = 'jingles/jingles_death.wav';
const HOUSE_FILE = 'jingles/jingles_housebuilt.wav';
const bank: SoundBank = {
  staticGroups: [],
  ambient: [],
  jingles: [
    { name: '', musicType: JINGLE_DEATH, sfx: [{ file: DEATH_FILE, params: [] }] },
    { name: '', musicType: JINGLE_HOUSE_BUILT, sfx: [{ file: HOUSE_FILE, params: [] }] },
  ],
  humanVoices: [],
  animalCalls: [],
};
const index = buildSoundIndex(bank, [], []);
const CANVAS_W = 800;
const CANVAS_H = 600;
const centre = tileToScreen(5, 5);
const camera: Camera = { offsetX: CANVAS_W / 2 - centre.x, offsetY: CANVAS_H / 2 - centre.y, scale: 1 };
/** A half-cell node on screen, and one far past its edge. */
const ON_SCREEN = { hx: 11, hy: 10 };
const FAR_COL = 500;
/** Deaths spread over this many neighbouring nodes, each its own key outside a fight. */
const NEARBY_NODES = 3;

function snapshot(col: number): WorldSnapshot {
  return {
    tick: 1,
    entities: [{ id: 7, components: { Position: { x: col * ONE, y: 5 * ONE }, Owner: { player: LOCAL } } }],
    events: [],
  };
}

function direct(events: readonly SimEvent[], col = 5, tense = false) {
  return directAudio({
    events,
    snapshot: snapshot(col),
    camera,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    index,
    bindings: defaultBindings(),
    localPlayer: LOCAL,
    ...(tense ? { tense: true } : {}),
  }).oneShots;
}

const death = (n: number): SimEvent => ({
  kind: 'settlerDied',
  entity: n as Entity,
  cause: 'damage',
  player: LOCAL,
  at: { hx: ON_SCREEN.hx + (n % NEARBY_NODES), hy: ON_SCREEN.hy },
});

describe('jingle duck depth', () => {
  it('dips the music by rank: lighter for something done, lightest for a death, full for a verdict', () => {
    for (const type of [
      JINGLE_HOUSE_BUILT,
      JINGLE_TECHNOLOGY,
      JINGLE_OPEN_CHEST,
      JINGLE_BIRTH,
      JINGLE_MARRIAGE,
    ]) {
      expect(jingleDuck(type)?.jingleDuckDb).toBe(JINGLE_DUCK_COMPLETION_DB);
    }
    expect(jingleDuck(JINGLE_DEATH)?.jingleDuckDb).toBe(JINGLE_DUCK_DEATH_DB);
    expect(jingleDuck(JINGLE_WON)?.jingleDuckDb).toBe(JINGLE_DUCK_FULL_DB);
    expect(jingleDuck(JINGLE_LOST)?.jingleDuckDb).toBe(JINGLE_DUCK_FULL_DB);
    expect(jingleDuck(JINGLE_DEATH)?.duckMusicMs).toBe(JINGLE_DUCK_HOLD_MS.get(JINGLE_DEATH));
  });

  it('scales the depth with the share an off-screen house jingle rings at', () => {
    const [near] = direct([{ kind: 'buildingFinished', entity: 7 as Entity }]);
    const [far] = direct([{ kind: 'buildingFinished', entity: 7 as Entity }], FAR_COL);
    expect(near?.jingleDuckDb).toBe(JINGLE_DUCK_COMPLETION_DB);
    expect(far?.gain).toBeCloseTo((near?.gain ?? 0) * OFF_SCREEN_JINGLE_GAIN, 6);
    expect(far?.jingleDuckDb).toBeCloseTo(JINGLE_DUCK_COMPLETION_DB * OFF_SCREEN_JINGLE_GAIN, 6);
    expect(far?.duckMusicMs).toBe(near?.duckMusicMs);
  });

  it('rings a death in a fight without a duck, once per its combat interval', () => {
    const [calm] = direct([death(0)]);
    expect(calm?.jingleDuckDb).toBe(JINGLE_DUCK_DEATH_DB);
    const [first] = direct([death(0)], 5, true);
    expect(first?.duckMusicMs).toBeUndefined();
    expect(first?.jingleDuckDb).toBeUndefined();
    const intervalS = JINGLE_COMBAT_INTERVAL_S.get(JINGLE_DEATH) ?? 0;
    expect(first?.cooldownS).toBe(intervalS);
    const arbiter = new OneShotArbiter();
    expect(arbiter.decide(direct([death(0)], 5, true), 0)).toHaveLength(1);
    // Every later fall inside the interval, wherever it lies, folds into the first.
    for (let n = 1; n < intervalS; n++) {
      const offered = direct([death(n)], 5, true);
      expect(offered).toHaveLength(1);
      expect(arbiter.decide(offered, n)).toEqual([]);
    }
    expect(arbiter.decide(direct([death(0)], 5, true), intervalS)).toHaveLength(1);
  });

  it("dips the engine's music to the shot's own depth", async () => {
    const ctx = new FakeContext();
    const engine = new WebAudioEngine({
      createContext: () => ctx as unknown as AudioContext,
      fetchBytes: async () => new ArrayBuffer(4),
    });
    await engine.resume();
    const { duck } = mixerGraph(ctx);
    const [shot] = direct([{ kind: 'buildingFinished', entity: 7 as Entity }]);
    if (shot === undefined) throw new Error('the house jingle should ring');
    engine.apply({ oneShots: [shot], ambient: [] });
    await flush();
    expect(duck.gain.ramps[0]?.value).toBeCloseTo(10 ** (JINGLE_DUCK_COMPLETION_DB / 20), 6);
  });
});
