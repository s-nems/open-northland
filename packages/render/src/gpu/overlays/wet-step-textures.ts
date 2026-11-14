import { BufferImageSource, Rectangle, Texture } from 'pixi.js';
import {
  WET_STEP_FRAME_H,
  WET_STEP_FRAME_W,
  WET_STEP_FRAMES,
  wetStepStrip,
} from '../../data/effects/index.js';

/** The wet step's splash frames, painted on first use: a dry game never builds them. */
export class WetStepTextures {
  private source: BufferImageSource | undefined;
  private readonly frames: Texture[] = [];

  frame(index: number): Texture | undefined {
    if (this.source === undefined) {
      const source = new BufferImageSource({
        resource: wetStepStrip(),
        width: WET_STEP_FRAME_W * WET_STEP_FRAMES,
        height: WET_STEP_FRAME_H,
        alphaMode: 'premultiplied-alpha',
        scaleMode: 'nearest',
      });
      this.source = source;
      for (let i = 0; i < WET_STEP_FRAMES; i++)
        this.frames.push(
          new Texture({
            source,
            frame: new Rectangle(i * WET_STEP_FRAME_W, 0, WET_STEP_FRAME_W, WET_STEP_FRAME_H),
          }),
        );
    }
    return this.frames[index];
  }

  destroy(): void {
    for (const frame of this.frames) frame.destroy();
    this.frames.length = 0;
    this.source?.destroy();
    this.source = undefined;
  }
}
