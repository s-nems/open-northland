import { type AtlasFrame, TextureCache, waveFrameAt } from '@open-northland/render';
import { TICKS_PER_SECOND } from '@open-northland/sim';
import { Assets, Container, Sprite, Text, type Texture } from 'pixi.js';
import type { GalleryGood, GalleryProp } from './catalog.js';
import type { PreviewPanel } from './preview-state.js';

const LABEL_STYLE = { fontSize: 12, fill: '#e8ddc4', stroke: { color: '#171c1b', width: 2 } };

export async function propPreview(entry: GalleryProp | GalleryGood): Promise<PreviewPanel> {
  const texture = await Assets.load<Texture>(entry.image);
  texture.source.scaleMode = 'linear';
  const cache = new TextureCache();
  const container = new Container();
  const height =
    Math.max(...Array.from(entry.atlas.frames.values(), (frame) => frame.height * entry.scale)) + 60;
  let width = 0;
  const baselineY = (frame: AtlasFrame): number => height - 35 + frame.offsetY * entry.scale;
  const place = (frame: AtlasFrame, label: string): Sprite => {
    const sprite = new Sprite(cache.get(texture.source, frame));
    sprite.scale.set(entry.scale);
    sprite.position.set(width + 15, baselineY(frame));
    const text = new Text({ text: label, style: LABEL_STYLE });
    text.position.set(width + 15, height - 22);
    container.addChild(sprite, text);
    width += Math.max(70, frame.width * entry.scale + 30);
    return sprite;
  };
  for (const [index, frame] of entry.atlas.frames) {
    place(frame, entry.kind === 'good' && index === 5 ? 'UI' : `${index + 1}`);
  }
  // A flag's frames are a wave loop, so one more cell plays them at the game's cadence.
  const [first, ...rest] =
    entry.kind === 'prop' && entry.manifest.kind === 'flag' ? entry.atlas.frames.values() : [];
  const loop =
    first === undefined ? undefined : { frames: [first, ...rest] as const, sprite: place(first, 'loop') };
  return {
    container,
    width,
    height,
    update(_state, seconds) {
      if (loop === undefined) return;
      const frame = waveFrameAt(loop.frames, seconds * TICKS_PER_SECOND);
      loop.sprite.texture = cache.get(texture.source, frame);
      loop.sprite.position.y = baselineY(frame);
    },
    destroy() {
      container.destroy({ children: true });
      cache.clear();
    },
  };
}
