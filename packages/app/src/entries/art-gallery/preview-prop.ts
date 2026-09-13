import { TextureCache } from '@open-northland/render';
import { Assets, Container, Sprite, Text, type Texture } from 'pixi.js';
import type { GalleryGood, GalleryProp } from './catalog.js';
import type { PreviewPanel } from './preview-state.js';

export async function propPreview(entry: GalleryProp | GalleryGood): Promise<PreviewPanel> {
  const texture = await Assets.load<Texture>(entry.image);
  texture.source.scaleMode = 'linear';
  const cache = new TextureCache();
  const container = new Container();
  const height =
    Math.max(...Array.from(entry.atlas.frames.values(), (frame) => frame.height * entry.scale)) + 60;
  let width = 0;
  for (const [index, frame] of entry.atlas.frames) {
    const sprite = new Sprite(cache.get(texture.source, frame));
    sprite.scale.set(entry.scale);
    sprite.position.set(width + 15, height - 35 + frame.offsetY * entry.scale);
    const label = new Text({
      text: entry.kind === 'good' && index === 5 ? 'UI' : `${index + 1}`,
      style: { fontSize: 12, fill: '#e8ddc4', stroke: { color: '#171c1b', width: 2 } },
    });
    label.position.set(width + 15, height - 22);
    container.addChild(sprite, label);
    width += Math.max(70, frame.width * entry.scale + 30);
  }
  return {
    container,
    width,
    height,
    update() {},
    destroy() {
      container.destroy({ children: true });
      cache.clear();
    },
  };
}
