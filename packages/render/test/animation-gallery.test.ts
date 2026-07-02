import { describe, expect, it } from 'vitest';
import {
  COMPASS_TO_BLOCK,
  type GalleryClip,
  clipDirs,
  galleryBobId,
  galleryCellLayout,
  headBobId,
} from '../src/index.js';

/**
 * The PURE half of the animation gallery — layout, direction count, frame selection, head remap — the part
 * an agent CAN self-verify. Whether the pixels animate right is the `?anim` browser view a human signs off;
 * this pins the grid placement + the `[bobseq]` math so they can't silently drift. Cell PIXEL sizes are
 * intentionally not asserted (a visual tuning knob).
 */

const clip = (over: Partial<GalleryClip> & { start: number; length: number }): GalleryClip => ({
  label: 'x',
  dirs: clipDirs(over.length),
  ...over,
});

describe('galleryCellLayout', () => {
  it('places cells row-major into the given column count', () => {
    const boxes = galleryCellLayout(5, 2);
    expect(boxes.map((b) => b.index)).toEqual([0, 1, 2, 3, 4]);
    expect(boxes.map((b) => b.col)).toEqual([0, 1, 0, 1, 0]);
    expect(boxes.map((b) => b.row)).toEqual([0, 0, 1, 1, 2]);
  });

  it('advances x by a constant per column and y by a constant per row', () => {
    const boxes = galleryCellLayout(4, 2);
    expect(boxes[1].x - boxes[0].x).toBeGreaterThan(0);
    expect(boxes[2].y - boxes[0].y).toBeGreaterThan(0);
    expect(boxes[2].x).toBe(boxes[0].x); // same column shares x
    expect(boxes[0].y).toBe(boxes[1].y); // same row shares y
  });

  it('treats a non-positive column count as a single column', () => {
    expect(galleryCellLayout(3, 0).map((b) => b.col)).toEqual([0, 0, 0]);
    expect(galleryCellLayout(3, 0).map((b) => b.row)).toEqual([0, 1, 2]);
  });
});

describe('clipDirs', () => {
  it('is 8 for a clean ×8 length, 1 otherwise', () => {
    expect(clipDirs(96)).toBe(8); // walk = 8×12
    expect(clipDirs(120)).toBe(8); // chop = 8×15
    expect(clipDirs(57)).toBe(1); // wait
    expect(clipDirs(17)).toBe(1); // eat
    expect(clipDirs(21)).toBe(1); // happy_jump
    expect(clipDirs(102)).toBe(1); // civilian fight
    expect(clipDirs(0)).toBe(1);
  });
});

describe('galleryBobId — 8-directional clip', () => {
  const walk = clip({ start: 1988, length: 96 }); // stride 12, dirs 8

  it('a numeric facing plays that block, staying inside it for any step', () => {
    for (let d = 0; d < 8; d++) {
      const lo = walk.start + d * 12;
      expect(galleryBobId(walk, d, 0)).toBe(lo); // first frame of the block at step 0
      for (let step = 0; step < 200; step++) {
        const bob = galleryBobId(walk, d, step);
        expect(bob).toBeGreaterThanOrEqual(lo);
        expect(bob).toBeLessThan(lo + 12);
      }
    }
  });

  it('full mode advances directions in COMPASS order, one full sub-cycle each', () => {
    // Step 0 → compass slot 0 (N = block 7), frame 0.
    expect(galleryBobId(walk, 'full', 0)).toBe(walk.start + COMPASS_TO_BLOCK[0] * 12);
    // After a full stride (12 steps) → compass slot 1 (NE = block 3), frame 0.
    expect(galleryBobId(walk, 'full', 12)).toBe(walk.start + COMPASS_TO_BLOCK[1] * 12);
    // Mid sub-cycle keeps the same block, advancing the frame.
    expect(galleryBobId(walk, 'full', 5)).toBe(walk.start + COMPASS_TO_BLOCK[0] * 12 + 5);
    // Wraps after all 8 directions (8×12 = 96 steps) back to slot 0.
    expect(galleryBobId(walk, 'full', 96)).toBe(galleryBobId(walk, 'full', 0));
  });

  it('full mode visits all 8 distinct direction blocks over one cycle', () => {
    // One sub-cycle per direction (stride 12), so sampling the first frame of each slot must hit every
    // block exactly once — guards against a bad/duplicate entry in COMPASS_TO_BLOCK.
    const blocks = new Set<number>();
    for (let slot = 0; slot < 8; slot++)
      blocks.add((galleryBobId(walk, 'full', slot * 12) - walk.start) / 12);
    expect(blocks).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  });

  it('wraps a negative facing into range', () => {
    // -1 → block 7 (the last), so it stays a valid frame rather than indexing below `start`.
    expect(galleryBobId(walk, -1, 0)).toBe(walk.start + 7 * 12);
  });
});

describe('galleryBobId — guards', () => {
  it('pins to the clip start when the stride is 0 (dirs > 1 but too short to split)', () => {
    // A hand-built 8-dir clip shorter than 8 frames → floor(4/8) = 0 stride; must not divide-by-0 / go negative.
    const bad = clip({ start: 700, length: 4, dirs: 8 });
    for (let step = 0; step < 20; step++) expect(galleryBobId(bad, 3, step)).toBe(700);
  });
});

describe('galleryBobId — single-direction clip', () => {
  const eat = clip({ start: 1530, length: 17 }); // dirs 1

  it('always plays the whole strip, ignoring the requested facing', () => {
    expect(eat.dirs).toBe(1);
    for (const dir of [0, 3, 7, 'full'] as const) {
      expect(galleryBobId(eat, dir, 0)).toBe(1530);
      expect(galleryBobId(eat, dir, 20)).toBe(1530 + (20 % 17)); // cycles all 17, facing has no effect
    }
  });
});

describe('headBobId', () => {
  it('maps head id == body id when no headStart (the usual case)', () => {
    const c = clip({ start: 1988, length: 96 });
    expect(headBobId(c, 2000)).toBe(2000);
  });

  it('borrows another sequence head at the SAME offset when headStart is set', () => {
    // A headless carry variant at start 4100 borrows the walk head base 1988: body frame +37 → head +37.
    const carry = clip({ start: 4100, length: 96, headStart: 1988 });
    expect(headBobId(carry, 4100)).toBe(1988); // offset 0
    expect(headBobId(carry, 4137)).toBe(2025); // offset 37 into the walk head
  });
});
