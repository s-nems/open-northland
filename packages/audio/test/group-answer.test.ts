import type { SoundBank } from '@open-northland/data';
import { type Camera, ONE, tileToScreen } from '@open-northland/render/data';
import type { EntitySnapshot, WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { poolGain } from '../src/data/bank.js';
import {
  ANSWER_LAYERS,
  authoredVolumeGain,
  buildSoundIndex,
  DEFAULT_CLIP_LENGTH_S,
  defaultBindings,
  directAudio,
  layerCount,
  MAX_PAN,
  MURMUR_COOLDOWN_S,
  MURMUR_GAIN_DB,
  MURMUR_LINES,
  MURMUR_MIN_GROUP,
  type OneShot,
  OneShotArbiter,
  type OrderAnswer,
  panAt,
  SELECT_COOLDOWN_S,
  screenOffset,
  UI_CUE_FILES,
  VOICE_MUSIC_DUCK_DB,
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

/** The Viking murmur's own wavs; its group also lists two answer lines louder, as the data does. */
const VIKING_MURMUR = ['talk/v1.wav', 'talk/v2.wav', 'talk/v3.wav', 'talk/v4.wav'];
const VIKING_TALK = group('Talk Viking Male', VIKING_MURMUR, MURMUR_VOLUME);

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
    group('Talk Franks Male', ['talk/f1.wav', 'talk/f2.wav'], MURMUR_VOLUME),
    group('Talk Arabs Male', ['talk/a1.wav'], MURMUR_VOLUME),
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
    expect(lead?.pan).toBeCloseTo(panAt(offset?.nx ?? Number.NaN));
  });

  it('clamps the pan of a group standing off screen to its side, as a lone answer', () => {
    const members = [man(1, VIKING, CENTRE_COL + 60), man(2, VIKING, CENTRE_COL + 61)];
    expect(answer(members, { members: idsOf(members) })[0]?.pan).toBe(MAX_PAN);
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
  it('lays a murmur of the members tribes under a group from its threshold, cooling between orders', () => {
    const below = army(MURMUR_MIN_GROUP - 1);
    expect(keysOf(answer(below, { members: idsOf(below) })).some((k) => k.startsWith('murmur:'))).toBe(false);
    // Most are Vikings, a few Franks: the murmur cycles through both, the larger first.
    const mixed = [...army(MURMUR_MIN_GROUP), ...army(3, 900, FRANK)];
    const murmur = answer(mixed, { members: idsOf(mixed) }).filter((s) => s.key.startsWith('murmur:'));
    expect(murmur).toHaveLength(MURMUR_LINES.length);
    expect(murmur.map((s) => s.files[0])).toEqual(['talk/v1.wav', 'talk/f1.wav', 'talk/v1.wav']);
    murmur.forEach((shot, i) => {
      expect(shot.delayS).toBe(MURMUR_LINES[i]?.delayS);
      expect(shot.gain).toBeCloseTo(authoredVolumeGain(MURMUR_VOLUME) * dbGain(MURMUR_GAIN_DB));
      expect(shot.cooldownS).toBe(MURMUR_COOLDOWN_S);
      expect(shot.exclusive).toBe('wav');
    });
  });

  it('murmurs none of the answer lines its talk group lists, at the level of the wavs it keeps', () => {
    const pool = index.murmurByTribe.get(VIKING)?.male;
    expect(pool).toEqual(VIKING_MURMUR);
    expect(pool === undefined ? undefined : poolGain(index, pool)).toBe(authoredVolumeGain(MURMUR_VOLUME));
  });

  it('lays no murmur for a tribe whose talk group holds only answer lines', () => {
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
    expect(lent.murmurByTribe.get(EGYPT)?.male).toEqual(['talk/a1.wav']);
    expect(lent.murmurByTribe.get(EGYPT)).toBe(lent.murmurByTribe.get(SARACEN));
  });

  it('starts at most the lead, its layers and the murmur for a thousand-strong order', () => {
    const thousand = army(1000);
    const shots = answer(thousand, { members: idsOf(thousand) });
    const started = new OneShotArbiter().decide(shots, 0);
    expect(started).toHaveLength(1 + ANSWER_LAYERS.length + MURMUR_LINES.length);
    // An order straight after: every pool is still answering and the murmur is cooling.
    const again = new OneShotArbiter();
    again.decide(shots, 0);
    expect(
      again.decide(answer(thousand, { members: idsOf(thousand) }), DEFAULT_CLIP_LENGTH_S / 2),
    ).toHaveLength(0);
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
});

describe('music under an answer', () => {
  it('dips the music under every line of an answer and a selection, not under a fallback click', () => {
    const crowd = [...army(MURMUR_MIN_GROUP), ...army(3, 900, FRANK)];
    const shots = [...answer(crowd, { members: idsOf(crowd) }), ...select(crowd, { members: idsOf(crowd) })];
    expect(keysOf(shots).some((k) => k.startsWith('murmur:'))).toBe(true);
    for (const shot of shots) expect(shot.duckMusicDb).toBe(VOICE_MUSIC_DUCK_DB);
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

  it('never cuts another selection line on the same wav', () => {
    // Ids 5 and 9 share pool 1 and so its select line.
    const members = [man(5, VIKING, CENTRE_COL), man(9, VIKING, CENTRE_COL)];
    const stopped: number[] = [];
    const arbiter = new OneShotArbiter({ playback: { stop: (instance) => stopped.push(instance) } });
    expect(arbiter.decide(select(members, { members: [5] }), 0)).toHaveLength(1);
    expect(arbiter.decide(select(members, { members: [9] }), DEFAULT_CLIP_LENGTH_S / 2)).toHaveLength(0);
    expect(stopped).toEqual([]);
  });

  it('picks the shortest decoded wav of a pool the table does not name, or its first before decoding', () => {
    const members = [man(2, VIKING, CENTRE_COL)]; // pool 2 % 4: 'Viking male ok 03'
    const lengths = new Map([
      ['humantalk/m3ok01.wav', 0.9],
      ['humantalk/m3ok02.wav', 0.4],
    ]);
    expect(select(members, { members: [2] }, (file) => lengths.get(file))[0]?.files).toEqual([
      'humantalk/m3ok02.wav',
    ]);
    expect(select(members, { members: [2] })[0]?.files).toEqual(['humantalk/m3ok01.wav']);
  });

  it('clicks the fallback for a selection nobody in it can speak for', () => {
    const building: EntitySnapshot = { id: 40, components: { Position: { x: 0, y: 0 }, Building: {} } };
    const shots = select([building], { members: [40], fallback: 'confirm' });
    expect(shots.map((s) => s.files)).toEqual([[UI_CUE_FILES.confirm]]);
    expect(select([building], { members: [40] })).toHaveLength(0); // a box select stays silent
  });
});
