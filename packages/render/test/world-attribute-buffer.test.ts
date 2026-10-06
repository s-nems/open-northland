import { Buffer, BufferUsage } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { updateByteRange, WorldAttributeBuffer } from '../src/gpu/world-attribute-buffer.js';

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

/** The world batch's attribute buffer uploads the union of the elements Pixi repacked in place. */
describe('WorldAttributeBuffer', () => {
  const FLOATS = 1000;
  const BYTES = FLOATS * Float32Array.BYTES_PER_ELEMENT;
  const make = (data = new Float32Array(FLOATS)): WorldAttributeBuffer =>
    new WorldAttributeBuffer({ data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });

  it('uploads the union of the changed elements and resets to a full upload for a rebuild', () => {
    const buffer = make();
    buffer.changed(80, 20);
    buffer.changed(140, 40);
    buffer.update(BYTES);
    expect([buffer._updateOffset, buffer._updateSize]).toEqual([80, 100]);
    buffer.setDataWithSize(new Float32Array(FLOATS), FLOATS, false);
    expect([buffer._updateOffset, buffer._updateSize]).toEqual([0, BYTES]);
    buffer.changed(240, 60);
    buffer.update(BYTES);
    expect([buffer._updateOffset, buffer._updateSize]).toEqual([240, 60]);
    buffer.destroy();
  });

  it('widens over an upload the renderer has not consumed yet, then narrows again', () => {
    const buffer = make();
    const gpu = { updateID: buffer._updateID };
    Object.assign(buffer._gpuData, { 1: gpu });
    buffer.changed(80, 20);
    buffer.update(BYTES);
    buffer.changed(240, 20);
    buffer.update(BYTES);
    expect([buffer._updateOffset, buffer._updateSize]).toEqual([80, 180]);
    gpu.updateID = buffer._updateID;
    buffer.changed(400, 20);
    buffer.update(BYTES);
    expect([buffer._updateOffset, buffer._updateSize]).toEqual([400, 20]);
    delete buffer._gpuData[1];
    buffer.destroy();
  });

  it('keeps a rebuild pending for every renderer before narrowing the next upload', () => {
    const data = new Float32Array(FLOATS);
    const buffer = make(data);
    const a = { updateID: buffer._updateID };
    const b = { updateID: buffer._updateID };
    Object.assign(buffer._gpuData, { 1: a, 2: b });
    buffer.setDataWithSize(data, FLOATS, false);
    a.updateID = buffer._updateID;
    buffer.changed(240, 60);
    buffer.update(BYTES);
    expect([buffer._updateOffset, buffer._updateSize]).toEqual([0, BYTES]);
    a.updateID = buffer._updateID;
    b.updateID = buffer._updateID;
    buffer.changed(400, 20);
    buffer.update(BYTES);
    expect([buffer._updateOffset, buffer._updateSize]).toEqual([400, 20]);
    delete buffer._gpuData[1];
    delete buffer._gpuData[2];
    buffer.destroy();
  });
});
