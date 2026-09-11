import { TextureCache } from '@open-northland/render';
import { Assets, Container, Sprite, Text, type Texture } from 'pixi.js';
import type { GalleryCharacter } from './catalog.js';
import { galleryCharacterFrame } from './preview-character-frame.js';
import type { PreviewPanel } from './preview-state.js';

export async function characterPreview(entry: GalleryCharacter): Promise<PreviewPanel> {
  const texture = await Assets.load<Texture>(entry.image);
  texture.source.scaleMode = entry.manifest.filtering ?? 'nearest';
  const cache = new TextureCache();
  const container = new Container();
  const sprite = new Sprite();
  const absent = new Text({
    text: 'Animation unavailable',
    style: { fontSize: 13, fill: '#ffcb86', stroke: { color: '#171c1b', width: 2 } },
  });
  absent.position.set(8, 30);
  const width = Math.max(150, entry.manifest.cellWidth * entry.scale + 40);
  const height = Math.max(120, entry.manifest.cellHeight * entry.scale + 50);
  sprite.scale.set(entry.scale);
  container.addChild(sprite, absent);
  return {
    container,
    width,
    height,
    update(state, seconds) {
      const clip = entry.clips.find((candidate) => candidate.id === state.clip);
      absent.visible = clip === undefined;
      sprite.visible = clip !== undefined;
      if (clip === undefined) return;
      const bob = galleryCharacterFrame(clip.binding, state, seconds);
      const frame = entry.atlas.frames.get(bob);
      if (frame === undefined) throw new Error(`Missing character frame ${entry.id}/${bob}`);
      sprite.texture = cache.get(texture.source, frame);
      sprite.position.set(width / 2 + frame.offsetX * entry.scale, height - 15 + frame.offsetY * entry.scale);
    },
    destroy() {
      container.destroy({ children: true });
      cache.clear();
    },
  };
}
