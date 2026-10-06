import { type FrameListAnim, indexAtlasFrames, type SettlerStateBinding } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import type { BobSeqRow } from '../src/content/ir/rows.js';
import {
  borrowedHeadAtlas,
  carryHeadFallback,
  headBinding,
  headClips,
} from '../src/content/settler-gfx/index.js';

/**
 * The head overlay's own clips: a body clip the source overlays with another head clip (`gfxbobseqhead`)
 * draws its head from that clip at the body's own list entry, as the original composes a human.
 */

function row(name: string, start: number, length: number): BobSeqRow {
  return { name, start, length };
}

const SPEAR_WAIT = row('spear_wait', 100, 12);
const BOW_WAIT = row('bow_wait', 500, 12);
const SPEAR_WALK = row('spear_walk', 200, 24);
const SWORD_WALK = row('sword_walk', 700, 24);
const SLEEP = row('sleep', 300, 6);
const SEQUENCES = new Map([SPEAR_WAIT, BOW_WAIT, SPEAR_WALK, SWORD_WALK, SLEEP].map((r) => [r.name, r]));
const BODY = new Map([SPEAR_WAIT, SPEAR_WALK, SLEEP].map((r) => [r.name, r]));
const HEADS = new Map([
  ['spear_wait', 'bow_wait'],
  ['spear_walk', 'sword_walk'],
]);

describe('headClips', () => {
  it('moves each clip the source overlays with another head clip, and no other', () => {
    expect(headClips(BODY, HEADS, SEQUENCES)).toEqual(
      new Map([
        [SPEAR_WAIT.start, { head: BOW_WAIT, bodyLength: SPEAR_WAIT.length }],
        [SPEAR_WALK.start, { head: SWORD_WALK, bodyLength: SPEAR_WALK.length }],
      ]),
    );
  });

  it('keeps a start two playable rows share unless both overlay the same head clip', () => {
    const twin = row('spear_wait_twin', SPEAR_WAIT.start, SPEAR_WAIT.length);
    const body = new Map([...BODY, [twin.name, twin]]);
    expect(headClips(body, HEADS, SEQUENCES).has(SPEAR_WAIT.start)).toBe(false);
    const agreeing = new Map([...HEADS, [twin.name, 'bow_wait']]);
    expect(headClips(body, agreeing, SEQUENCES).get(SPEAR_WAIT.start)?.head).toBe(BOW_WAIT);
  });

  it('ignores a head clip no table carries', () => {
    expect(headClips(BODY, new Map([['sleep', 'missing']]), SEQUENCES).size).toBe(0);
  });
});

describe('headBinding', () => {
  const wait: FrameListAnim = { start: SPEAR_WAIT.start, frameLists: [[0, 1, 2]], loop: true };
  const walk = { start: SPEAR_WALK.start, dirs: 8, stride: 3 };
  const sleep: FrameListAnim = { start: SLEEP.start, frameLists: [[0, 1]] };
  const binding: SettlerStateBinding = {
    idle: wait,
    moving: walk,
    byAtomic: { 8: sleep },
    engaged: { moving: walk },
    carrying: { byGood: { 3: { moving: walk } } },
  };

  it('reads every moved clip from its head clip at the same entries, and every other from the body', () => {
    const head = headBinding(binding, headClips(BODY, HEADS, SEQUENCES));
    const headWalk = { ...walk, start: SWORD_WALK.start };
    expect(head).toEqual({
      idle: { ...wait, start: BOW_WAIT.start },
      moving: headWalk,
      byAtomic: { 8: sleep },
      engaged: { moving: headWalk },
      carrying: { byGood: { 3: { moving: headWalk } } },
    });
  });

  it('is undefined when no clip moves, so the head draws the body bob ids', () => {
    expect(headBinding(binding, new Map())).toBeUndefined();
  });

  it('maps every action variant without changing its order or playback timing', () => {
    const choices = [{ ...wait, spansAtomic: true }, sleep];
    const head = headBinding(
      { idle: wait, byAtomicChoices: { 81: choices } },
      headClips(BODY, HEADS, SEQUENCES),
    );
    expect(head?.byAtomicChoices?.[81]).toEqual([
      { ...wait, start: BOW_WAIT.start, spansAtomic: true },
      sleep,
    ]);
  });

  it('reads a six-facing head clip of another block size at the same point of each facing', () => {
    // Body 6 blocks of 4, head 6 blocks of 2: the second facing's swing keeps to the head clip's second block.
    const swing = row('two_hander', 900, 24);
    const sword = row('sword', 1000, 12);
    const clips = headClips(
      new Map([[swing.name, swing]]),
      new Map([[swing.name, sword.name]]),
      new Map([[sword.name, sword]]),
    );
    const attack: FrameListAnim = {
      start: swing.start,
      frameLists: [
        [4, 5, 6, 7],
        [20, 23],
      ],
    };
    const head = headBinding({ idle: attack, byAtomic: { 81: attack } }, clips);
    expect(head?.byAtomic?.[81]).toEqual({
      start: sword.start,
      frameLists: [
        [2, 2, 3, 3],
        [10, 11],
      ],
    });
  });
});

describe('carryHeadFallback', () => {
  const WALK = { start: 1988, dirs: 8, stride: 12 } as const;
  const STONE = { start: 4100, dirs: 8, stride: 12 } as const;
  const WOOD = { start: 4580, dirs: 8, stride: 12 } as const;
  /** A hat set that draws the wood carry's head and leaves the stone carry's blank. */
  const hats = indexAtlasFrames(64, 64, [
    { bobId: WOOD.start, rect: { x: 0, y: 0, width: 10, height: 10 }, offsetX: 0, offsetY: 0 },
    { bobId: STONE.start, rect: { x: 0, y: 0, width: 0, height: 0 }, offsetX: 0, offsetY: 0 },
  ]);
  const wood = { moving: WOOD, idle: { ...WOOD, frames: 1 } };
  const head: SettlerStateBinding = {
    idle: { ...WALK, frames: 1 },
    moving: WALK,
    carrying: { byGood: { 3: { moving: STONE, idle: { ...STONE, frames: 1 } }, 5: wood } },
  };

  it('gives a carry gait with a blank head the plain walk head, and keeps a drawn one', () => {
    const fallen = carryHeadFallback(head, hats);
    expect(fallen.carrying?.byGood?.[3]).toEqual({ moving: WALK, idle: { ...WALK, frames: 1 } });
    expect(fallen.carrying?.byGood?.[5]).toBe(wood);
  });

  it('returns the binding by identity when every carry head draws', () => {
    const drawn: SettlerStateBinding = { ...head, carrying: { byGood: { 5: wood } } };
    expect(carryHeadFallback(drawn, hats)).toBe(drawn);
  });
});

describe('borrowedHeadAtlas', () => {
  /** Six facings: the stand clip draws one frame per facing, the kiss two. */
  const STAND = row('walk', 10, 6);
  const KISS = row('kiss', 40, 12);
  const frame = (bobId: number, x: number, offsetX: number, offsetY: number) => ({
    bobId,
    rect: { x, y: 0, width: 8, height: 8 },
    offsetX,
    offsetY,
  });
  const standFrames = (x: number, offsetY: number) =>
    Array.from({ length: STAND.length }, (_, i) => frame(STAND.start + i, x + i, i, offsetY));
  /** A donor set that draws the kiss, its head lower and to the right as the body leans. */
  const donor = indexAtlasFrames(64, 64, [
    ...standFrames(0, -40),
    ...Array.from({ length: KISS.length }, (_, i) => frame(KISS.start + i, 0, i + 3, -36)),
  ]);
  /** A taller hat that draws only the stand clip, two pixels higher on the same neck. */
  const hat = indexAtlasFrames(64, 64, standFrames(20, -42));

  it('draws a blank clip with the own stand head of that facing, where the donor puts its head', () => {
    const borrowed = borrowedHeadAtlas(hat, [donor], [STAND, KISS], STAND);
    // Kiss entry 7 lies in the fourth facing block, whose stand frame is bob 13.
    expect(borrowed.frames.get(KISS.start + 7)).toMatchObject({ x: 23, offsetX: 7 + 3, offsetY: -38 });
    expect(borrowed.frames.get(STAND.start)).toBe(hat.frames.get(STAND.start));
  });

  it('keeps the druid hat on the neck as the one-facing brewing body moves', () => {
    const walk = row('human_man_generic_walk', 100, 96);
    const work = row('human_man_Druid_work', 300, 16);
    const own = indexAtlasFrames(64, 64, [frame(136, 20, -10, -50)]);
    const guide = indexAtlasFrames(64, 64, [
      frame(136, 0, -7, -40),
      ...Array.from({ length: 16 }, (_, i) => frame(300 + i, 5, -6 + (i % 2), -38 - (i % 3))),
    ]);
    const borrowed = borrowedHeadAtlas(own, [guide], [work], walk);
    for (let i = 0; i < 16; i++) {
      expect(borrowed.frames.get(300 + i)).toMatchObject({
        x: 20,
        offsetX: -9 + (i % 2),
        offsetY: -48 - (i % 3),
      });
    }
    expect(own.frames.has(300)).toBe(false);
  });

  it('leaves a clip without six facing blocks blank rather than drawing from the donor sheet', () => {
    const swing = row('swing', 60, 7);
    const donorSwing = indexAtlasFrames(64, 64, [
      ...standFrames(0, -40),
      ...Array.from({ length: swing.length }, (_, i) => frame(swing.start + i, 40, 0, -30)),
    ]);
    expect(borrowedHeadAtlas(hat, [donorSwing], [STAND, swing], STAND)).toBe(hat);
  });

  it('returns the atlas by identity when no donor draws what it leaves blank', () => {
    expect(borrowedHeadAtlas(hat, [], [STAND, KISS], STAND)).toBe(hat);
    expect(borrowedHeadAtlas(donor, [hat], [STAND, KISS], STAND)).toBe(donor);
  });
});
