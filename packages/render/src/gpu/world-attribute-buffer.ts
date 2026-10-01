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
    let pending = false;
    for (const key in this._gpuData) {
      const value: unknown = this._gpuData[key];
      if (
        typeof value === 'object' &&
        value !== null &&
        'updateID' in value &&
        value.updateID !== this._updateID
      ) {
        pending = true;
        break;
      }
    }
    if (end > first) {
      const unionFirst = pending ? Math.min(first, this._updateOffset) : first;
      const unionEnd = pending ? Math.max(end, this._updateOffset + this._updateSize) : end;
      super.update(unionEnd - unionFirst, unionFirst);
    } else super.update(sizeInBytes, offsetInBytes);
  }
}
