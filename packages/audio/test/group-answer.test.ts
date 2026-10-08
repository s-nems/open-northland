import type { SoundBank } from '@open-northland/data';
import { type Camera, ONE, tileToScreen } from '@open-northland/render/data';
import type { EntitySnapshot, WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { MURMUR_MIN_TALK_WAVS, poolGain } from '../src/data/bank.js';
import { SELECT_SECOND_LINE_MAX_S, selectLines } from '../src/data/voices.js';
import {
  ANSWER_LAYERS,
  ANSWER_MAX_PAN,
  ANSWER_MUSIC_DUCK_DB,
  authoredVolumeGain,
  buildSoundIndex,
  DEFAULT_CLIP_LENGTH_S,
  defaultBindings,
  directAudio,
  layerCount,
  MURMUR_COOLDOWN_S,
  MURMUR_GAIN_DB,
  MURMUR_LINE_VOLUME,
  MURMUR_LINES,
  MURMUR_MIN_GROUP,
  type OneShot,
  OneShotArbiter,
  type OrderAnswer,
  SELECT_ANY_COOLDOWN_S,
  SELECT_COOLDOWN_S,
  screenOffset,
  UI_CUE_FILES,
  type VoiceCall,
} from '../src/index.js';

/**
 * A group's answer to an order or a selection: one lead line from the member nearest the screen centre,
 * a few quieter, later lines from other actors and a murmur under a large group. Pure: the director decides the lines, the arbiter keeps a pool from stacking on itself.
 */

const VIKING = 1;
const FRANK = 2;
const VIKING_POOLS = ['Viking male ok 01', 'Viking male ok 02', 'Viking male ok 03', 'Viking male ok 04'];
const ANSWER_VOLUME = 80;
const MURMUR_VOLUME = 40;

const group = (name: string, files: readonly string[], volume = ANSWER_VOLUME) => ({
  name,
  sfx: files.map((file) => ({ file, params: [volume] })),
});

/** Talk wavs `talk/<prefix>1.wav` onwards, `count` of them. */
const talkWavs = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `talk/${prefix}${i + 1}.wav`);
/** The bank's sighs and gasps, which its talk groups list beside their lines. */
const DISTRESS = ['generic/human_sigh m 01.wav', 'generic/human_gasp m 01.wav'];
/** The Viking talk group's laughs: too few to murmur with once its answer lines, sighs and gasps are
 *  left out, as in the data, so Vikings murmur with their other actors' "ok" lines. */
const VIKING_LAUGHS = talkWavs('laugh', MURMUR_MIN_TALK_WAVS - 1);
const VIKING_TALK = group('Talk Viking Male', [...VIKING_LAUGHS, ...DISTRESS], MURMUR_VOLUME);
/** The Frank talk group's own lines, enough to murmur with. */
const FRANK_MURMUR = talkWavs('f', MURMUR_MIN_TALK_WAVS);

const bank: SoundBank = {
  staticGroups: [
    group('Viking male ok 01', ['humantalk/m1ok01.wav', 'humantalk/m1ok02.wav']),
    group('Viking male ok 02', ['humantalk/m2ok01.wav', 'humantalk/m2ok08.wav']),
    // Neither file is the authored select line, so the pool's shortest decoded wav decides.
    group('Viking male ok 03', ['humantalk/m3ok01.wav', 'humantalk/m3ok02.wav']),
    group('Viking male ok 04', ['humantalk/m4ok01.wav']),
    group('Viking male no 01', ['humantalk/m1no01.wav']),
    group('Frank male ok 01', ['humantalk/oldenglish/o33.wav']),
    {
      ...VIKING_TALK,
      sfx: [...group('', ['humantalk/m1ok01.wav', 'humantalk/m1no01.wav']).sfx, ...VIKING_TALK.sfx],
    },
    group('Talk Franks Male', [...FRANK_MURMUR, ...DISTRESS], MURMUR_VOLUME),
    group('Talk Arabs Male', talkWavs('a', MURMUR_MIN_TALK_WAVS), MURMUR_VOLUME),
  ],
  ambient: [],
  jingles: [],
  humanVoices: [
    { tribe: VIKING, voiceClass: 'male', respondOk: VIKING_POOLS, respondNo: ['Viking male no 01'] },
    { tribe: FRANK, voiceClass: 'male', respondOk: ['Frank male ok 01'], respondNo: [] },
  ],
  animalCalls: [],
};
const index = buildSoundIndex(
  bank,
  [],
  [],
  [],
  [
    { typeId: VIKING, id: 'viking' },
    { typeId: FRANK, id: 'frank' },
  ],
);
const bindings = defaultBindings();

const CANVAS_W = 800;
const CANVAS_H = 600;
const CENTRE_COL = 5;
const CENTRE_ROW = 5;
const centre = tileToScreen(CENTRE_COL, CENTRE_ROW);
const camera: Camera = { offsetX: CANVAS_W / 2 - centre.x, offsetY: CANVAS_H / 2 - centre.y, scale: 1 };
const LOCAL = 0;

const ANSWER_GAIN = authoredVolumeGain(ANSWER_VOLUME);
const dbGain = (db: number): number => 10 ** (db / 20);

/** A grown man of `tribe` standing at tile `(col, row)`. */
function man(id: number, tribe: number, col: number, row = CENTRE_ROW): EntitySnapshot {
  return {
    id,
    components: {
      Position: { x: col * ONE, y: row * ONE },
      Settler: { tribe },
      Person: { person: true },
      Owner: { player: LOCAL },
    },
  };
}

/** `count` Viking men from id `firstId`, on a row a step further right each, starting at the centre. */
function army(count: number, firstId = 1, tribe = VIKING): EntitySnapshot[] {
  return Array.from({ length: count }, (_, i) => man(firstId + i, tribe, CENTRE_COL + i / count));
}

/** A snapshot lists its entities by ascending id, as the mirror keeps them. */
function snapshotOf(entities: readonly EntitySnapshot[]): WorldSnapshot {
  return { tick: 1, entities: [...entities].sort((a, b) => a.id - b.id), events: [] };
}

const idsOf = (entities: readonly EntitySnapshot[]): number[] => entities.map((e) => e.id);

function answer(
  entities: readonly EntitySnapshot[],
  order: OrderAnswer,
  clipLengthS?: (file: string) => number | undefined,
): readonly OneShot[] {
  return directAudio({
    events: [],
    snapshot: snapshotOf(entities),
    camera,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    index,
    bindings,
    responses: [order],
    ...(clipLengthS !== undefined ? { clipLengthS } : {}),
  }).oneShots;
}

function select(
  entities: readonly EntitySnapshot[],
  call: VoiceCall,
  clipLengthS?: (file: string) => number | undefined,
): readonly OneShot[] {
  return directAudio({
    events: [],
    snapshot: snapshotOf(entities),
    camera,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    index,
    bindings,
    selection: call,
    ...(clipLengthS !== undefined ? { clipLengthS } : {}),
  }).oneShots;
}

const keysOf = (shots: readonly OneShot[]): string[] => shots.map((s) => s.key);

describe('group answer lead', () => {
  it('leads with the member nearest the screen centre, panned at the group centroid', () => {
    // Id 5 stands at the centre (pool 5 % 4 = 1), id 6 two tiles right (pool 2), id 8 off to the left
    // (pool 0); the mean column is the centre's.
    const members = [
      man(6, VIKING, CENTRE_COL + 2),
      man(5, VIKING, CENTRE_COL),
      man(8, VIKING, CENTRE_COL - 2),
    ];
    const shots = answer(members, { members: idsOf(members) });
    const lead = shots[0];
    expect(lead?.key).toBe('respond:Viking male ok 02');
    expect(lead?.gain).toBe(ANSWER_GAIN);
    expect(lead?.delayS).toBeUndefined();
    expect(lead?.exclusive).toBe('group');
    const offset = screenOffset(CENTRE_COL, CENTRE_ROW, camera, CANVAS_W, CANVAS_H);
    expect(lead?.pan).toBeCloseTo((offset?.nx ?? Number.NaN) * ANSWER_MAX_PAN);
  });

  it('leans an answer and a selection line only slightly toward a group off screen', () => {
    const members = [man(1, VIKING, CENTRE_COL + 60), man(2, VIKING, CENTRE_COL + 61)];
    const shots = [...answer(members, { members: idsOf(members) }), ...select(members, { members: [1] })];
    expect(shots.length).toBeGreaterThan(1);
    expect(shots[0]?.pan).toBe(ANSWER_MAX_PAN);
    for (const shot of shots) expect(Math.abs(shot.pan)).toBeLessThanOrEqual(ANSWER_MAX_PAN);
  });
});

describe('group answer layers', () => {
  it('adds one layer at 1-4 speakers, two at 5-19 and three from 20, never more', () => {
    expect([1, 4, 5, 19, 20, 1000].map(layerCount)).toEqual([1, 1, 2, 2, 3, 3]);
    const responders = (count: number) => answer(army(count), { members: idsOf(army(count)) });
    expect(responders(1)).toHaveLength(1); // no other member to layer
    expect(responders(4)).toHaveLength(2);
    expect(responders(5)).toHaveLength(3);
    expect(responders(20)).toHaveLength(4);
    expect(responders(MURMUR_MIN_GROUP - 1)).toHaveLength(1 + ANSWER_LAYERS.length);
  });

  it('layers other pools than the lead, each once, later, quieter and spread around its pan', () => {
    const members = army(20);
    const shots = answer(members, { members: idsOf(members) });
    const pools = keysOf(shots);
    expect(new Set(pools).size).toBe(pools.length);
    const [lead, ...layers] = shots;
    expect(layers).toHaveLength(ANSWER_LAYERS.length);
    layers.forEach((shot, i) => {
      const layer = ANSWER_LAYERS[i];
      expect(shot.delayS).toBe(layer?.delayS);
      expect(shot.gain).toBeCloseTo(ANSWER_GAIN * dbGain(layer?.gainDb ?? 0));
      expect(shot.pan).toBeCloseTo((lead?.pan ?? 0) + (layer?.panOffset ?? 0));
      expect(shot.exclusive).toBe('group');
    });
  });

  it('takes a layer from another nation in a mixed group, in that member own voice', () => {
    // Four Vikings of one pool (ids 4, 8, 12, 16 all take pool 0) and a Frank beside them.
    const vikings = [4, 8, 12, 16].map((id) => man(id, VIKING, CENTRE_COL));
    const members = [...vikings, man(30, FRANK, CENTRE_COL + 1)];
    expect(keysOf(answer(members, { members: idsOf(members) }))).toEqual([
      'respond:Viking male ok 01',
      'respond:Frank male ok 01',
    ]);
  });
});

describe('group answer murmur', () => {
  /** Six Viking actors, so a group answered by four leaves two silent to murmur with. */
  const ACTORS = 6;
  const actorPool = (n: number) => `Viking male ok ${String(n).padStart(2, '0')}`;
  const actorWav = (n: number) => `humantalk/m${n}ok01.wav`;
  const actorPools = Array.from({ length: ACTORS }, (_, i) => actorPool(i + 1));
  const crowdIndex = buildSoundIndex(
    {
      ...bank,
      staticGroups: [
        ...bank.staticGroups.filter((g) => !g.name.startsWith('Viking male ok')),
        ...Array.from({ length: ACTORS }, (_, i) => group(actorPool(i + 1), [actorWav(i + 1)])),
      ],
      humanVoices: [
        { tribe: VIKING, voiceClass: 'male', respondOk: actorPools, respondNo: ['Viking male no 01'] },
        { tribe: FRANK, voiceClass: 'male', respondOk: ['Frank male ok 01'], respondNo: [] },
      ],
    },
    [],
    [],
    [],
    [
      { typeId: VIKING, id: 'viking' },
      { typeId: FRANK, id: 'frank' },
    ],
  );
  const crowdAnswer = (entities: readonly EntitySnapshot[]): readonly OneShot[] =>
    directAudio({
      events: [],
      snapshot: snapshotOf(entities),
      camera,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      index: crowdIndex,
      bindings,
      responses: [{ members: idsOf(entities) }],
    }).oneShots;
  const isMurmur = (s: OneShot): boolean => s.key.startsWith('murmur:');

  it('lays no murmur under a group short of its threshold', () => {
    const below = army(MURMUR_MIN_GROUP - 1);
    expect(crowdAnswer(below).some(isMurmur)).toBe(false);
  });

  it('murmurs with the actors that did not answer and a talk pool, the larger tribe first', () => {
    // Vikings at the centre, a few Franks off to the right, so the lead and layers are all Vikings.
    const FRANK_OFFSET = 3;
    const mixed = [
      ...army(MURMUR_MIN_GROUP),
      ...army(3, 900, FRANK).map((m) => man(m.id, FRANK, CENTRE_COL + FRANK_OFFSET)),
    ];
    const shots = crowdAnswer(mixed);
    const answered = new Set(shots.filter((s) => s.key.startsWith('respond:')).flatMap((s) => s.files));
    expect(answered.size).toBe(1 + ANSWER_LAYERS.length);
    const murmur = shots.filter(isMurmur);
    expect(murmur).toHaveLength(MURMUR_LINES.length);
    const [first, frank, third] = murmur;
    for (const line of [first, third]) {
      expect(line?.files).toHaveLength(1);
      expect(answered.has(line?.files[0] ?? '')).toBe(false); // an actor that did not answer
      expect(line?.unheld).toBe(true);
      expect(line?.gain).toBeCloseTo(authoredVolumeGain(MURMUR_LINE_VOLUME) * dbGain(MURMUR_GAIN_DB));
    }
    expect(first?.files).not.toEqual(third?.files); // the two silent actors take turns
    expect(frank?.files).toEqual(FRANK_MURMUR);
    expect(frank?.unheld).toBeUndefined();
    expect(frank?.gain).toBeCloseTo(authoredVolumeGain(MURMUR_VOLUME) * dbGain(MURMUR_GAIN_DB));
    murmur.forEach((shot, i) => {
      expect(shot.delayS).toBe(MURMUR_LINES[i]?.delayS);
      expect(shot.cooldownS).toBe(MURMUR_COOLDOWN_S);
      expect(shot.exclusive).toBe('wav');
    });
  });

  it('never holds the next answer of an actor it murmurs with', () => {
    const shots = crowdAnswer(army(MURMUR_MIN_GROUP));
    const arbiter = new OneShotArbiter({ playback: { clipLengthS: () => DEFAULT_CLIP_LENGTH_S } });
    const line = arbiter.decide(shots, 0).find(isMurmur);
    const actor = actorPools.find(
      (name) => crowdIndex.groupsByName.get(name.toLowerCase())?.[0] === line?.files[0],
    );
    expect(actor).toBeDefined();
    const files = crowdIndex.groupsByName.get(actor?.toLowerCase() ?? '') ?? [];
    const next: OneShot = { files, gain: 1, pan: 0, key: `respond:${actor}`, exclusive: 'group' };
    const murmurSounds = (MURMUR_LINES[0]?.delayS ?? 0) + DEFAULT_CLIP_LENGTH_S / 2;
    expect(arbiter.decide([next], murmurSounds)).toHaveLength(1);
  });

  it('keeps only the talk lines of a talk group, without its answer lines, sighs and gasps', () => {
    const pool = index.murmurByTribe.get(FRANK)?.male;
    expect(pool).toEqual(FRANK_MURMUR);
    expect(pool === undefined ? undefined : poolGain(index, pool)).toBe(authoredVolumeGain(MURMUR_VOLUME));
    // The Viking group keeps too few laughs to murmur with.
    expect(index.murmurByTribe.get(VIKING)?.male).toBeUndefined();
  });

  it('lays no murmur when the only actor answered and the talk group holds only answer lines', () => {
    const answersOnly = buildSoundIndex(
      {
        ...bank,
        staticGroups: [
          ...bank.staticGroups.filter((g) => g.name !== 'Talk Franks Male'),
          group('Talk Franks Male', ['humantalk/oldenglish/o33.wav'], MURMUR_VOLUME),
        ],
      },
      [],
      [],
      [],
      [{ typeId: FRANK, id: 'frank' }],
    );
    expect(answersOnly.murmurByTribe.get(FRANK)).toEqual({});
    const franks = army(MURMUR_MIN_GROUP, 1, FRANK);
    const shots = directAudio({
      events: [],
      snapshot: snapshotOf(franks),
      camera,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      index: answersOnly,
      bindings,
      responses: [{ members: idsOf(franks) }],
    }).oneShots;
    expect(keysOf(shots)).toEqual(['respond:Frank male ok 01']);
  });

  it('lets a voiceless tribe murmur with the tribe it borrows its voices from', () => {
    const EGYPT = 7;
    const SARACEN = 4;
    const lent = buildSoundIndex(
      bank,
      [],
      [],
      [],
      [
        { typeId: EGYPT, id: 'egypt' },
        { typeId: SARACEN, id: 'saracen' },
      ],
    );
    expect(lent.murmurByTribe.get(EGYPT)?.male).toEqual(talkWavs('a', MURMUR_MIN_TALK_WAVS));
    expect(lent.murmurByTribe.get(EGYPT)).toBe(lent.murmurByTribe.get(SARACEN));
  });

  it('starts at most the lead, its layers and the murmur for a thousand-strong order', () => {
    const thousand = army(1000);
    const shots = crowdAnswer(thousand);
    const started = new OneShotArbiter().decide(shots, 0);
    expect(started).toHaveLength(1 + ANSWER_LAYERS.length + MURMUR_LINES.length);
    // An order straight after: every answering pool is still sounding and the murmur is cooling.
    const again = new OneShotArbiter();
    again.decide(shots, 0);
    expect(again.decide(crowdAnswer(thousand), DEFAULT_CLIP_LENGTH_S / 2)).toHaveLength(0);
  });
});

describe('refused orders', () => {
  it('answers "no" through the lead alone when every member refused', () => {
    const members = army(30);
    const shots = answer(members, { members: idsOf(members), refused: true, fallback: 'fail' });
    expect(keysOf(shots)).toEqual(['refuse:Viking male no 01']);
    expect(shots[0]?.exclusive).toBe('group');
  });

  it('clicks the fallback for a refusing group without a "no" pool', () => {
    const franks = army(3, 1, FRANK);
    const shots = answer(franks, { members: idsOf(franks), refused: true, fallback: 'fail' });
    expect(shots.map((s) => s.files)).toEqual([[UI_CUE_FILES.fail]]);
  });

  it('answers "ok" when one order of the frame was taken beside a refused one', () => {
    const members = army(2);
    const shots = directAudio({
      events: [],
      snapshot: snapshotOf(members),
      camera,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      index,
      bindings,
      responses: [{ members: [1], refused: true, fallback: 'fail' }, { members: [2] }],
    }).oneShots;
    expect(keysOf(shots)).toEqual(['respond:Viking male ok 03']);
  });

  it('keeps the fallback cue of the orders one frame merges', () => {
    const building = (id: number): EntitySnapshot => ({
      id,
      components: { Position: { x: 0, y: 0 }, Building: {} },
    });
    const shots = directAudio({
      events: [],
      snapshot: snapshotOf([building(40), building(41)]),
      camera,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      index,
      bindings,
      responses: [{ members: [40] }, { members: [41], fallback: 'confirm' }],
    }).oneShots;
    expect(shots.map((s) => s.files)).toEqual([[UI_CUE_FILES.confirm]]);
  });
});

describe('music under an answer', () => {
  it('dips the music under the lines of an answer, not its murmur, a selection or a fallback click', () => {
    const crowd = [...army(MURMUR_MIN_GROUP), ...army(3, 900, FRANK)];
    const shots = answer(crowd, { members: idsOf(crowd) });
    const murmur = shots.filter((s) => s.key.startsWith('murmur:'));
    expect(murmur.length).toBeGreaterThan(0);
    for (const shot of shots) {
      expect(shot.duckMusicDb).toBe(murmur.includes(shot) ? undefined : ANSWER_MUSIC_DUCK_DB);
    }
    expect(select(crowd, { members: idsOf(crowd) })[0]?.duckMusicDb).toBeUndefined();
    const building: EntitySnapshot = { id: 40, components: { Position: { x: 0, y: 0 }, Building: {} } };
    expect(select([building], { members: [40], fallback: 'confirm' })[0]?.duckMusicDb).toBeUndefined();
  });
});

describe('selection voice', () => {
  it('speaks the authored shortest line of the nearest member, once per cooldown', () => {
    // Box-selected: id 5 nearest the centre (pool 1), id 6 further right (pool 2).
    const members = [man(6, VIKING, CENTRE_COL + 2), man(5, VIKING, CENTRE_COL)];
    const shots = select(members, { members: idsOf(members) });
    expect(shots).toHaveLength(1);
    expect(shots[0]?.files).toEqual(['humantalk/m2ok08.wav']);
    expect(shots[0]?.key).toBe('select:5');
    expect(shots[0]?.cooldownS).toBe(SELECT_COOLDOWN_S);
    const arbiter = new OneShotArbiter();
    expect(arbiter.decide(shots, 0)).toHaveLength(1);
    expect(arbiter.decide(shots, SELECT_COOLDOWN_S / 2)).toHaveLength(0);
    expect(arbiter.decide(shots, SELECT_COOLDOWN_S)).toHaveLength(1);
  });

  it('gives way to the order the player gives while it still sounds', () => {
    const members = [man(5, VIKING, CENTRE_COL)]; // pool 1: 'Viking male ok 02', which holds the line
    const stopped: number[] = [];
    const arbiter = new OneShotArbiter({ playback: { stop: (instance) => stopped.push(instance) } });
    const [line] = arbiter.decide(select(members, { members: [5] }), 0);
    expect(line?.files).toEqual(['humantalk/m2ok08.wav']);
    const ORDER_AFTER_SELECT_S = 0.3;
    const started = arbiter.decide(answer(members, { members: [5] }), ORDER_AFTER_SELECT_S);
    expect(keysOf(started)).toEqual(['respond:Viking male ok 02']);
    expect(stopped).toEqual([line?.instance]);
  });

  it('leaves only the answer of an order given in the selecting frame', () => {
    const members = [man(5, VIKING, CENTRE_COL)];
    const stopped: number[] = [];
    const arbiter = new OneShotArbiter({ playback: { stop: (instance) => stopped.push(instance) } });
    const frame = [...select(members, { members: [5] }), ...answer(members, { members: [5] })];
    expect(keysOf(arbiter.decide(frame, 0))).toEqual(['respond:Viking male ok 02']);
    expect(stopped).toEqual([]); // the engine never started the line it would stop
  });

  it('keeps silent while the settler own answer still sounds', () => {
    const members = [man(5, VIKING, CENTRE_COL)]; // pool 1: 'Viking male ok 02'
    const CLIP_S = 2;
    const arbiter = new OneShotArbiter({
      random: () => 0, // the answer picks its pool's first wav, not the select line's
      playback: { clipLengthS: () => CLIP_S, stop: () => undefined },
    });
    const ANSWER_AT_S = 0.3;
    arbiter.decide(select(members, { members: [5] }), 0);
    const [reply] = arbiter.decide(answer(members, { members: [5] }), ANSWER_AT_S);
    expect(reply?.files).toEqual(['humantalk/m2ok01.wav']);
    // Re-selected once the select cooldown has run, while the answer still has a while to go.
    const answerEnds = ANSWER_AT_S + CLIP_S;
    expect(SELECT_COOLDOWN_S).toBeLessThan(answerEnds);
    expect(arbiter.decide(select(members, { members: [5] }), SELECT_COOLDOWN_S)).toEqual([]);
    expect(arbiter.decide(select(members, { members: [5] }), answerEnds)).toHaveLength(1);
  });

  it('never cuts another selection line on the same wav', () => {
    // Ids 5 and 9 share pool 1 and so its select line.
    const members = [man(5, VIKING, CENTRE_COL), man(9, VIKING, CENTRE_COL)];
    const stopped: number[] = [];
    const arbiter = new OneShotArbiter({ playback: { stop: (instance) => stopped.push(instance) } });
    expect(arbiter.decide(select(members, { members: [5] }), 0)).toHaveLength(1);
    expect(arbiter.decide(select(members, { members: [9] }), DEFAULT_CLIP_LENGTH_S / 2)).toHaveLength(0);
    expect(stopped).toEqual([]);
  });

  it('takes the two shortest decoded wavs of a pool the table does not name, or its first before decoding', () => {
    const members = [man(2, VIKING, CENTRE_COL)]; // pool 2 % 4: 'Viking male ok 03'
    expect(select(members, { members: [2] })[0]?.files).toEqual(['humantalk/m3ok01.wav']);
    const lengths = new Map([
      ['humantalk/m3ok01.wav', 0.9],
      ['humantalk/m3ok02.wav', 0.4],
    ]);
    const lines = select(members, { members: [2] }, (file) => lengths.get(file))[0]?.files;
    expect(lines).toEqual(['humantalk/m3ok02.wav', 'humantalk/m3ok01.wav']);
    // The same array comes back, so the ledger can alternate its lines.
    expect(select(members, { members: [2] }, (file) => lengths.get(file))[0]?.files).toBe(lines);
  });

  it('leaves out a second line longer than the cap', () => {
    const LONG = 'humantalk/long.wav';
    const SHORT = 'humantalk/short.wav';
    const own = buildSoundIndex(
      { ...bank, staticGroups: [...bank.staticGroups, group('Viking male ok 05', [LONG, SHORT])] },
      [],
      [],
      [],
      [{ typeId: VIKING, id: 'viking' }],
    );
    const pools = [...VIKING_POOLS, 'Viking male ok 05'];
    const lengths = new Map([
      [LONG, SELECT_SECOND_LINE_MAX_S + 0.1],
      [SHORT, SELECT_SECOND_LINE_MAX_S / 2],
    ]);
    const lines = selectLines(own, pools[4] ?? '', (file) => lengths.get(file));
    expect(lines).toEqual([SHORT]);
  });

  it('alternates its lines and keeps quiet for a second after any selection', () => {
    // Id 5 speaks with pool 1 ('Viking male ok 02'), id 6 with pool 2 ('Viking male ok 03').
    const members = [man(5, VIKING, CENTRE_COL), man(6, VIKING, CENTRE_COL)];
    const own = buildSoundIndex(
      {
        ...bank,
        staticGroups: [
          ...bank.staticGroups.filter((g) => g.name !== 'Viking male ok 02'),
          group('Viking male ok 02', [
            'humantalk/m2ok01.wav',
            'humantalk/m2ok07.wav',
            'humantalk/m2ok08.wav',
          ]),
        ],
      },
      [],
      [],
      [],
      [{ typeId: VIKING, id: 'viking' }],
    );
    const selectIn = (id: number): readonly OneShot[] =>
      directAudio({
        events: [],
        snapshot: snapshotOf(members),
        camera,
        canvasW: CANVAS_W,
        canvasH: CANVAS_H,
        index: own,
        bindings,
        selection: { members: [id] },
      }).oneShots;
    const arbiter = new OneShotArbiter({ playback: { clipLengthS: () => SELECT_ANY_COOLDOWN_S / 2 } });
    const heard: string[] = [];
    const SELECTIONS = 4;
    for (let i = 0; i < SELECTIONS; i++) {
      for (const shot of arbiter.decide(selectIn(5), i * SELECT_COOLDOWN_S)) heard.push(shot.files[0] ?? '');
    }
    expect(heard).toHaveLength(SELECTIONS);
    expect(new Set(heard)).toEqual(new Set(['humantalk/m2ok08.wav', 'humantalk/m2ok07.wav']));
    for (let i = 1; i < heard.length; i++) expect(heard[i]).not.toBe(heard[i - 1]);
    // Another settler, inside the shared cooldown of the last line: silent; past it: speaks.
    const last = (SELECTIONS - 1) * SELECT_COOLDOWN_S;
    expect(arbiter.decide(selectIn(6), last + SELECT_ANY_COOLDOWN_S / 2)).toEqual([]);
    expect(arbiter.decide(selectIn(6), last + SELECT_ANY_COOLDOWN_S)).toHaveLength(1);
  });

  it('clicks the fallback for a selection nobody in it can speak for', () => {
    const building: EntitySnapshot = { id: 40, components: { Position: { x: 0, y: 0 }, Building: {} } };
    const shots = select([building], { members: [40], fallback: 'confirm' });
    expect(shots.map((s) => s.files)).toEqual([[UI_CUE_FILES.confirm]]);
    expect(select([building], { members: [40] })).toHaveLength(0); // a box select stays silent
  });
});
