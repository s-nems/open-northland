import { expect, it } from 'vitest';
import type { DrawItem } from '../../src/data/scene/index.js';
import { resolveSettlerBobId } from '../../src/data/sprites/settler.js';
import { createPresentationTrack, idleClipElapsed } from '../../src/gpu/sprite-pool/present-item.js';

const item = (state: NonNullable<DrawItem['state']>): DrawItem => ({
  kind: 'settler',
  ref: 1,
  x: 0,
  y: 0,
  depth: 0,
  state,
  facing: 0,
});

it('starts each animal wait clip at frame zero after movement and attack', () => {
  const track = createPresentationTrack('settler');
  const binding = {
    idle: 10,
    idleChoices: [
      { start: 300, frameLists: [[0, 1, 2]] },
      { start: 400, frameLists: [[0, 1, 2]] },
    ],
  };
  expect(idleClipElapsed(track, item('moving'), 8)).toBeUndefined();
  const first = idleClipElapsed(track, item('idle'), 9);
  expect(first).toBe(0);
  expect(resolveSettlerBobId(binding, item('idle'), 9, 9, first)).toBe(400);
  const next = idleClipElapsed(track, item('idle'), 10);
  expect(resolveSettlerBobId(binding, item('idle'), 10, 10, next)).toBe(401);
  expect(idleClipElapsed(track, item('acting'), 11)).toBeUndefined();
  const restarted = idleClipElapsed(track, item('idle'), 12);
  expect(resolveSettlerBobId(binding, item('idle'), 12, 12, restarted)).toBe(400);
});
