import { Buffer, BufferUsage } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { updateByteRange } from '../src/gpu/world-attribute-buffer.js';

/** WebGL keeps one pending upload range per buffer: a second partial update must widen it, not drop it. */
describe('updateByteRange', () => {
  const buffer = (): Buffer => new Buffer({ data: new Float32Array(64), usage: BufferUsage.VERTEX });

  it('uploads exactly the range when nothing is pending', () => {
    const b = buffer();
    updateByteRange(b, 32, 16);
    expect([b._updateOffset, b._updateSize]).toEqual([32, 16]);
  });

  it('widens to cover a range a GPU copy has not consumed yet', () => {
    const b = buffer();
    updateByteRange(b, 32, 16);
    // A GPU copy that has not seen the last update yet.
    b._gpuData[1] = { updateID: b._updateID - 1 } as never;
    updateByteRange(b, 128, 8);
    expect([b._updateOffset, b._updateSize]).toEqual([32, 104]);
  });
});
