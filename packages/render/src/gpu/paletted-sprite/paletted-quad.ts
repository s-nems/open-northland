import { Sprite } from 'pixi.js';
import {
  type Camera,
  cameraScreenX,
  cameraScreenY,
  snapToDevicePixels,
} from '../../data/projection/index.js';
import { type PalettedRow, worldBatched } from '../world-batcher.js';

/**
 * A character layer drawn through the human palette LUT as one quad of the world batch, so a crowd shares
 * draw calls with everything else in the sprite layer. Its texture comes from
 * `TextureCache.palettedFrame`, which names the LUT; {@link lutRow} picks the row.
 */
export class PalettedQuad extends Sprite implements PalettedRow {
  private row = 0;
  private glowing = false;
  /** The layer's offset from the feet anchor in world px, before {@link placeFor} snaps it. */
  offsetX = 0;
  offsetY = 0;

  constructor() {
    super();
    worldBatched(this);
  }

  get lutRow(): number {
    return this.row;
  }

  /** The row is packed into the quad's vertices, so a change repacks them like a texture change. */
  set lutRow(row: number) {
    if (row === this.row) return;
    this.row = row;
    this.onViewUpdate();
  }

  get glow(): boolean {
    return this.glowing;
  }

  /** Packed into the vertices like {@link lutRow}. */
  set glow(on: boolean) {
    if (on === this.glowing) return;
    this.glowing = on;
    this.onViewUpdate();
  }

  /**
   * Place the quad at its offset from the feet anchor `(anchorX, anchorY)`, nudged so the anchor lands on
   * `camera`'s device grid (`snap` device px per screen px; absent keeps it fractional). Each camera
   * that draws the quad places it again, as a mesh re-places its screen origin.
   */
  placeFor(camera: Camera, anchorX: number, anchorY: number, snap: number | undefined): void {
    const scale = camera.scale ?? 1;
    const screenX = cameraScreenX(camera, anchorX);
    const screenY = cameraScreenY(camera, anchorY);
    this.position.set(
      this.offsetX + (snapToDevicePixels(screenX, snap) - screenX) / scale,
      this.offsetY + (snapToDevicePixels(screenY, snap) - screenY) / scale,
    );
  }
}
