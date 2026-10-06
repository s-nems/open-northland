import { Buffer } from 'pixi.js';

/** Pixi repacks individual elements in place; upload their enclosing byte range.
 *  Undocumented Pixi behaviour, verified on pixi.js 8.21, re-verify on a bump: WebGL uploads the
 *  `_updateOffset`/`_updateSize` range with `bufferSubData` and records the consumed `_updateID` per GPU
 *  buffer, while WebGPU uploads eagerly on `update` and keeps no `updateID`. */
export class WorldAttributeBuffer extends Buffer {
  private first = Number.POSITIVE_INFINITY;
  private end = 0;

  changed(firstByte: number, byteLength: number): void {
    this.first = Math.min(this.first, firstByte);
    this.end = Math.max(this.end, firstByte + byteLength);
  }

  override setDataWithSize(...args: Parameters<Buffer['setDataWithSize']>): void {
    this.first = Number.POSITIVE_INFINITY;
    this.end = 0;
    super.setDataWithSize(...args);
  }

  override update(sizeInBytes?: number, offsetInBytes?: number): void {
    const first = this.first,
      end = this.end;
    this.first = Number.POSITIVE_INFINITY;
    this.end = 0;
    if (end > first) updateByteRange(this, first, end - first, (size, offset) => super.update(size, offset));
    else super.update(sizeInBytes, offsetInBytes);
  }
}

/** Whether `buffer` holds an upload no GPU copy has consumed yet. */
function uploadPending(buffer: Buffer): boolean {
  for (const key in buffer._gpuData) {
    const value: unknown = buffer._gpuData[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      'updateID' in value &&
      value.updateID !== buffer._updateID
    )
      return true;
  }
  return false;
}

/**
 * Upload `size` bytes of `buffer` from `offset`, widened to cover a range an earlier update queued and no
 * GPU copy consumed yet: WebGL keeps one pending range per buffer, so a second partial update would
 * otherwise drop the first.
 */
export function updateByteRange(
  buffer: Buffer,
  offset: number,
  size: number,
  update: (size: number, offset: number) => void = (s, o) => buffer.update(s, o),
): void {
  if (!uploadPending(buffer)) {
    update(size, offset);
    return;
  }
  const first = Math.min(offset, buffer._updateOffset);
  const end = Math.max(offset + size, buffer._updateOffset + buffer._updateSize);
  update(end - first, first);
}
