import type { SoundBank } from '@open-northland/data';
import type { Camera } from '@open-northland/render/data';
import { ONE, tileToScreen } from '@open-northland/render/data';
import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  ANIMAL_ROLL_RANGE,
  buildSoundIndex,
  defaultBindings,
  directAudio,
  GENERIC_ROLL_RANGE,
  MAX_CHATTER_TICKS_PER_FRAME,
  MAX_PAN,
  SFX_GAIN,
} from '../src/index.js';

/**
 * The creatures' own voices: a settler answering an order in its lifelong voice, the idle natter the
 * humans on screen roll each game tick, and the animals' calls. Pure and headless: the roll takes a
 * scripted random.
 */

const bank: SoundBank = {
  staticGroups: [
    { name: 'Viking male ok 01', sfx: [{ file: 'humantalk/m1ok01.wav', params: [80] }] },
    { name: 'Viking male ok 02', sfx: [{ file: 'humantalk/m2ok01.wav', params: [80] }] },
    { name: 'Viking female ok 01', sfx: [{ file: 'humantalk/f1ok01.wav', params: [80] }] },
    { name: 'Viking female ok 02', sfx: [{ file: 'humantalk/f2ok01.wav', params: [80] }] },
    { name: 'Generic Viking Male', sfx: [{ file: 'generic/m 01.wav', params: [40] }] },
    { name: 'Generic Viking Children', sfx: [{ file: 'generic/c 01.wav', params: [40] }] },
    { name: 'Bear Sounds', sfx: [{ file: 'generic/bear01.wav', params: [80] }] },
    { name: 'Sheep Sounds', sfx: [{ file: 'generic/sheep01.wav', params: [80] }] },
  ],
  ambient: [],
  jingles: [],
  humanVoices: [
    {
      tribe: 1,
      voiceClass: 'male',
      generic: 'Generic Viking Male',
      respondOk: ['Viking male ok 01', 'Viking male ok 02'],
      respondNo: [],
    },
    {
      tribe: 1,
      voiceClass: 'female',
      respondOk: ['Viking female ok 01', 'Viking female ok 02'],
      respondNo: [],
    },
    { tribe: 1, voiceClass: 'child', generic: 'Generic Viking Children', respondOk: [], respondNo: [] },
  ],
  animalCalls: [
    { tribe: 8, minCount: 1, probability: 10, group: 'Bear Sounds' },
    { tribe: 19, minCount: 3, probability: 10, group: 'Sheep Sounds' },
  ],
};
const index = buildSoundIndex(bank, [], [], [{ typeId: 47, id: 'heroine_bow_xena' }]);
const bindings = defaultBindings();

const CANVAS_W = 800;
const CANVAS_H = 600;
const centre = tileToScreen(5, 5);
const camera: Camera = { offsetX: CANVAS_W / 2 - centre.x, offsetY: CANVAS_H / 2 - centre.y, scale: 1 };
const LOCAL = 0;
const ENEMY = 1;

const here = { x: 5 * ONE, y: 5 * ONE };
const farRight = { x: 60 * ONE, y: 5 * ONE }; // well past the right edge of the canvas
const viking = { tribe: 1 };
const person = { person: true };
const snapshot: WorldSnapshot = {
  tick: 10,
  entities: [
    // Two viking men of the local player: ids 2 and 3 alternate the two "ok" pools (id % 2).
    { id: 2, components: { Position: here, Settler: viking, Person: person, Owner: { player: LOCAL } } },
    { id: 3, components: { Position: here, Settler: viking, Person: person, Owner: { player: LOCAL } } },
    // A woman, standing far off to the right.
    {
      id: 4,
      components: {
        Position: farRight,
        Settler: viking,
        Person: person,
        Female: { female: true },
        Owner: { player: LOCAL },
      },
    },
    // A child (still carrying Age), and an enemy man.
    {
      id: 5,
      components: {
        Position: here,
        Settler: viking,
        Person: person,
        Age: { ticks: 3 },
        Owner: { player: LOCAL },
      },
    },
    { id: 6, components: { Position: here, Settler: viking, Person: person, Owner: { player: ENEMY } } },
    // A bear and two sheep, unowned wildlife.
    { id: 8, components: { Position: here, Settler: { tribe: 8 } } },
    { id: 9, components: { Position: here, Settler: { tribe: 19 } } },
    { id: 10, components: { Position: here, Settler: { tribe: 19 } } },
  ],
  events: [],
};

/** A random that yields the scripted values in turn, then repeats the last one. */
function scripted(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

function direct(opts: {
  responses?: readonly number[];
  drawn?: readonly number[];
  ticks?: number;
  random?: () => number;
  localPlayer?: number | null;
  visibleTile?: (col: number, row: number) => boolean;
}) {
  const localPlayer = opts.localPlayer === undefined ? LOCAL : opts.localPlayer;
  return directAudio({
    events: [],
    snapshot,
    camera,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    index,
    bindings,
    ...(localPlayer === null ? {} : { localPlayer }),
    ...(opts.visibleTile !== undefined ? { visibleTile: opts.visibleTile } : {}),
    ...(opts.responses !== undefined ? { responses: opts.responses } : {}),
    ...(opts.drawn !== undefined
      ? {
          chatter: {
            drawn: () => opts.drawn ?? [],
            ticks: opts.ticks ?? 1,
            random: opts.random ?? scripted(0),
          },
        }
      : {}),
  }).oneShots;
}

describe('order responses', () => {
  it('answers each ordered settler in its own lifelong "ok" voice, at full gain and self-exclusive', () => {
    const shots = direct({ responses: [2, 3] });
    expect(shots.map((s) => s.files)).toEqual([['humantalk/m1ok01.wav'], ['humantalk/m2ok01.wav']]);
    expect(shots.map((s) => s.key)).toEqual(['respond:Viking male ok 01', 'respond:Viking male ok 02']);
    for (const s of shots) {
      expect(s.gain).toBe(SFX_GAIN);
      expect(s.exclusive).toBe('group'); // nothing while any line of the pool still sounds
    }
    // The same settler asked again answers with the same voice: id 2 is always pool 0.
    expect(direct({ responses: [2] })[0]?.files).toEqual(['humantalk/m1ok01.wav']);
  });

  it('gives every hero the first response recording rather than an entity-id-selected voice', () => {
    // Original behavior: a hero's response index is forced to zero instead of following the entity.
    // Job 47 is the heroine in readable `jobtypes.ini`.
    const heroSnapshot: WorldSnapshot = {
      tick: 10,
      entities: [
        {
          id: 3,
          components: {
            Position: here,
            Settler: { tribe: 1, jobType: 47 },
            Person: person,
            Female: { female: true },
            Owner: { player: LOCAL },
          },
        },
      ],
      events: [],
    };
    const frame = directAudio({
      events: [],
      responses: [3],
      snapshot: heroSnapshot,
      camera,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      index,
      bindings,
    });
    expect(frame.oneShots[0]?.files).toEqual(['humantalk/f1ok01.wav']);
  });

  it('pans an off-screen settler hard to its side instead of culling it', () => {
    const shots = direct({ responses: [4] });
    expect(shots).toHaveLength(1);
    expect(shots[0]?.files).toEqual(['humantalk/f1ok01.wav']);
    expect(shots[0]?.pan).toBe(MAX_PAN);
    expect(shots[0]?.gain).toBe(SFX_GAIN);
  });

  it('answers nothing for a child, a bear or a settler no longer in the snapshot', () => {
    expect(direct({ responses: [5, 8, 99] })).toHaveLength(0);
  });
});

describe('idle chatter', () => {
  const drawn = [2, 3, 4, 5, 6, 8, 9, 10];

  it('rolls nothing on a frame that advanced no tick', () => {
    expect(direct({ drawn, ticks: 0, random: scripted(0) })).toHaveLength(0);
  });

  it('lets a pool speak when the one die lands under its on-screen head count', () => {
    // One die a tick, polled against the pools in tribe then child / female / male order: the child pool
    // (one) first, then the men (2 and 3; the woman has no chatter pool). A die of 1/2000 is not under the
    // child's count of one but is under the men's two: the men win and the next roll picks one of them.
    // The animal rolls then fail with 0.5 (500 > 10).
    const shots = direct({ drawn, random: scripted(1 / GENERIC_ROLL_RANGE, 0.99, 0.5, 0.5) });
    expect(shots.map((s) => s.files)).toEqual([['generic/m 01.wav']]);
    expect(shots[0]?.key).toBe('generic:Generic Viking Male');
    expect(shots[0]?.exclusive).toBe('wav');
    expect(shots[0]?.gain).toBeCloseTo(SFX_GAIN); // picked man 3, centred on screen
  });

  it('polls the first pool first, so a die under both counts speaks through the child', () => {
    const shots = direct({ drawn, random: scripted(0, 0, 0.5, 0.5) });
    expect(shots.map((s) => s.files)).toEqual([['generic/c 01.wav']]);
  });

  it('stays quiet when the die lands at or above every head count', () => {
    // 3/2000 is not under two men, nor under one child; animals fail with 0.5.
    expect(direct({ drawn, random: scripted(3 / GENERIC_ROLL_RANGE, 0.5, 0.5) })).toHaveLength(0);
  });

  it("counts only the local player's own people, never the enemy's", () => {
    // Only the enemy man (6) is drawn: no pool of ours has anyone on screen, so nothing rolls.
    expect(direct({ drawn: [6], random: scripted(0) })).toHaveLength(0);
    // And without a local player no one is ours.
    expect(direct({ drawn: [2, 3], random: scripted(0), localPlayer: null })).toHaveLength(0);
  });

  it('keeps a speaker standing in the fog silent, even when its pool won the roll', () => {
    expect(direct({ drawn: [2], random: scripted(0), visibleTile: () => false })).toHaveLength(0);
    expect(direct({ drawn: [2], random: scripted(0), visibleTile: () => true })).toHaveLength(1);
  });

  it('caps a long frame at MAX_CHATTER_TICKS_PER_FRAME rolls', () => {
    // Every roll wins (random 0): one line per rolled tick, never more than the cap.
    const shots = direct({ drawn: [2], ticks: 50, random: scripted(0) });
    const lines = shots.filter((s) => s.key.startsWith('generic:'));
    expect(lines).toHaveLength(MAX_CHATTER_TICKS_PER_FRAME);
  });
});

describe('animal calls', () => {
  it('calls through a drawn animal when its tribe rolls at or under its probability', () => {
    // No people drawn, so the first roll is the bear's: 10/1000 is at its probability, so it calls; the
    // sheep are below their minCount of three and never roll.
    const shots = direct({ drawn: [8, 9, 10], random: scripted(10 / ANIMAL_ROLL_RANGE, 0) });
    expect(shots.map((s) => s.files)).toEqual([['generic/bear01.wav']]);
    expect(shots[0]?.key).toBe('animal:Bear Sounds');
    expect(shots[0]?.exclusive).toBe('wav');
  });

  it('stays quiet when the roll lands above the probability', () => {
    expect(direct({ drawn: [8], random: scripted(11 / ANIMAL_ROLL_RANGE) })).toHaveLength(0);
  });

  it('calls for a herd once it reaches its minCount', () => {
    const flock: WorldSnapshot = {
      ...snapshot,
      entities: [...snapshot.entities, { id: 11, components: { Position: here, Settler: { tribe: 19 } } }],
    };
    const shots = directAudio({
      events: [],
      snapshot: flock,
      camera,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      index,
      bindings,
      chatter: { drawn: () => [9, 10, 11], ticks: 1, random: scripted(0) },
    }).oneShots;
    expect(shots.map((s) => s.files)).toEqual([['generic/sheep01.wav']]);
  });
});
