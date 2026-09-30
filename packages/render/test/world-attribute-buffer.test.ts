import { BufferUsage } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { WorldAttributeBuffer } from '../src/gpu/world-attribute-buffer.js';

describe('world attribute uploads', () => {
  it('unions updates until the renderer has consumed the prior upload', () => {
    const buffer = new WorldAttributeBuffer({
      data: new Float32Array(1000),
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    const gpu = { updateID: buffer._updateID };
    Object.assign(buffer._gpuData, { 1: gpu });
    buffer.changed(80, 20);
    buffer.update(4000);
    buffer.changed(240, 20);
    buffer.update(4000);
    expect(buffer._updateOffset).toBe(80);
    expect(buffer._updateSize).toBe(180);
    gpu.updateID = buffer._updateID;
    buffer.changed(400, 20);
    buffer.update(4000);
    expect(buffer._updateOffset).toBe(400);
    expect(buffer._updateSize).toBe(20);
    delete buffer._gpuData[1];
    buffer.destroy();
  });
  it('keeps rebuild data pending for every renderer before narrowing the next upload', () => {
    const data = new Float32Array(1000);
    const buffer = new WorldAttributeBuffer({ data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const a = { updateID: buffer._updateID },
      b = { updateID: buffer._updateID };
    Object.assign(buffer._gpuData, { 1: a, 2: b });
    buffer.setDataWithSize(data, 1000, false);
    a.updateID = buffer._updateID;
    buffer.changed(240, 60);
    buffer.update(4000);
    expect(buffer._updateOffset).toBe(0);
    expect(buffer._updateSize).toBe(4000);
    a.updateID = buffer._updateID;
    b.updateID = buffer._updateID;
    buffer.changed(400, 20);
    buffer.update(4000);
    expect(buffer._updateOffset).toBe(400);
    expect(buffer._updateSize).toBe(20);
    delete buffer._gpuData[1];
    delete buffer._gpuData[2];
    buffer.destroy();
  });

  it('uploads the dirty interval and resets to a full upload for a rebuild', () => {
    const buffer = new WorldAttributeBuffer({
      data: new Float32Array(1000),
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    buffer.changed(80, 20);
    buffer.changed(140, 40);
    buffer.update(4000);
    expect(buffer._updateOffset).toBe(80);
    expect(buffer._updateSize).toBe(100);
    buffer.setDataWithSize(new Float32Array(1000), 1000, false);
    expect(buffer._updateOffset).toBe(0);
    expect(buffer._updateSize).toBe(4000);
    buffer.changed(240, 60);
    buffer.update(4000);
    expect(buffer._updateOffset).toBe(240);
    expect(buffer._updateSize).toBe(60);
    buffer.destroy();
  });
});
