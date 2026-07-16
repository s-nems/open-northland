import { describe, expect, it } from 'vitest';
import { resolveSignpostDraw } from '../../src/data/sprites/layered.js';
import type { SignpostBinding } from '../../src/data/sprites/layered-bindings.js';
import { drawItem } from '../support/fixtures.js';

/**
 * Unit tests for the signpost resolver: the post vs the angular board pick, and the per-owner recolour
 * variant (`byPlayer` — each player's baked `ls_guidepost.player_NN` atlas) with its fallbacks.
 */

const base = (layer: string): SignpostBinding => ({
  post: { layer, bob: 0 },
  boards: [
    { layer, bob: 1 },
    { layer, bob: 2 },
  ],
});

describe('resolveSignpostDraw — per-owner guidepost binding', () => {
  const binding: SignpostBinding = {
    ...base('ls_guidepost.player_00'),
    byPlayer: [base('ls_guidepost.player_00'), base('ls_guidepost.player_01'), undefined],
  };

  it('picks the post (no boardIndex) from the owner’s recolour variant', () => {
    const draw = resolveSignpostDraw(binding, drawItem('signpost', { player: 1 }));
    expect(draw).toEqual({ bob: 0, layer: 'ls_guidepost.player_01' });
  });

  it('picks the angular board frame from the owner’s variant, clamped into the list', () => {
    expect(resolveSignpostDraw(binding, drawItem('signpost', { player: 1, boardIndex: 1 }))).toEqual({
      bob: 2,
      layer: 'ls_guidepost.player_01',
    });
    expect(resolveSignpostDraw(binding, drawItem('signpost', { player: 1, boardIndex: 9 }))).toEqual({
      bob: 2,
      layer: 'ls_guidepost.player_01',
    });
  });

  it('falls back to the base frames for a missing variant slot or an unowned item', () => {
    // Player 2's slot is undefined — the base (player_00) frames stand in.
    expect(resolveSignpostDraw(binding, drawItem('signpost', { player: 2 }))).toEqual({
      bob: 0,
      layer: 'ls_guidepost.player_00',
    });
    expect(resolveSignpostDraw(binding, drawItem('signpost'))).toEqual({
      bob: 0,
      layer: 'ls_guidepost.player_00',
    });
  });

  it('returns null with no binding (the pool placeholder path)', () => {
    expect(resolveSignpostDraw(undefined, drawItem('signpost'))).toBeNull();
  });
});
