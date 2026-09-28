import { type FrameListAnim, indexAtlasFrames, type SettlerStateBinding } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import type { BobSeqRow } from '../src/content/ir/rows.js';
import { carryHeadFallback, headBinding, headClips } from '../src/content/settler-gfx/index.js';

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
