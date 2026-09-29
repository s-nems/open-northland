import { describe, expect, it } from 'vitest';
import { hueRotateRamp, PLAYER_COLORS, synthesizePlayerSource } from '../src/decoders/player-palette.js';
import { solidPalette as solid } from './fixtures/palette.js';

/**
 * Player-colour maths over synthetic palettes: the hue-rotation synthesiser (hue changes, greys stay
 * neutral, entries outside the ramp untouched) and the slot table.
 */

/** Colour range 1 of a `playerNN.pcx`, the `Player NN` ramp. */
const PLAYER_RAMP_START = 16;

describe('hueRotateRamp', () => {
  it('rotates every entry and leaves its input alone', () => {
    const ramp = new Uint8Array([255, 0, 0, 128, 128, 128]);
    expect([...hueRotateRamp(ramp, 240)]).toEqual([0, 0, 255, 128, 128, 128]);
    expect([...ramp]).toEqual([255, 0, 0, 128, 128, 128]);
  });
});

describe('synthesizePlayerSource', () => {
  it('hue-rotates the source ramp (idx 16..31) while keeping saturation/value; leaves the rest untouched', () => {
    const ref = solid(255, 0, 0); // pure red everywhere (hue 0, s=1, v=1)
    const out = synthesizePlayerSource(ref, 240); // ramp → pure blue
    for (let i = 0; i < 256; i++) {
      const o = i * 3;
      if (i >= PLAYER_RAMP_START && i < PLAYER_RAMP_START + 16) {
        expect([out[o], out[o + 1], out[o + 2]]).toEqual([0, 0, 255]);
      } else {
        expect([out[o], out[o + 1], out[o + 2]]).toEqual([255, 0, 0]); // outside the ramp unchanged
      }
    }
  });

  it('does not alias a Node Buffer reference (Buffer.slice shares memory)', () => {
    const ref = Buffer.from(solid(255, 0, 0));
    synthesizePlayerSource(ref, 240);
    expect(Uint8Array.from(ref)).toEqual(solid(255, 0, 0));
  });
});

describe('PLAYER_COLORS', () => {
  it('defines 16 colours with ids 0..15 in order; 0..9 from pcx, 10..15 synthetic', () => {
    expect(PLAYER_COLORS.length).toBe(16);
    PLAYER_COLORS.forEach((c, i) => {
      expect(c.id).toBe(i);
      expect(c.source.kind).toBe(i < 10 ? 'pcx' : 'synthetic');
    });
    expect(PLAYER_COLORS[0]?.name).toBe('blue'); // the human player's default
  });
});
