import { describe, expect, it } from 'vitest';
import { PALETTED_SAMPLING_MODES } from '../src/gpu/paletted-sprite/shader.js';

// The sprite setter needs a GL test context, so the browser preview covers it; this pins the
// uniform contract the shader reads.
describe('paletted sampling modes', () => {
  it('keeps the exact original path at 0 and gives every magnification mode its own value', () => {
    expect(PALETTED_SAMPLING_MODES.nearest).toBe(0);
    expect(PALETTED_SAMPLING_MODES.bilinear).toBe(1);
    expect(new Set(Object.values(PALETTED_SAMPLING_MODES)).size).toBe(4);
  });
});
