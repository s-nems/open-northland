import { buildTimeThreshold, resolveConstructionDraws, TextureCache } from '@open-northland/render';
import { Container, Sprite } from 'pixi.js';
import { loadOwnBuildingLayers } from '../../content/own-assets/building-layers.js';
import { ownBuildingBindings } from '../../content/own-assets/building-manifest.js';
import type { GalleryBuilding, GalleryCharacter } from './catalog.js';
import { characterPreview } from './preview-character.js';
import type { PreviewPanel } from './preview-state.js';

export async function buildingPreview(
  entry: GalleryBuilding,
  reference?: GalleryCharacter,
): Promise<PreviewPanel> {
  const manifest = entry.manifest;
  const files = new Map([[manifest.sprite, entry.image]]);
  if (manifest.shadow && entry.shadowImage) {
    files.set(manifest.shadow.sprite, entry.shadowImage);
  }
  manifest.construction?.forEach((stage, i) => {
    const paths = entry.construction[i];
    if (paths) {
      files.set(stage.sprite, paths.image);
      files.set(stage.timeMask, paths.timeMask);
    }
  });
  const layers = await loadOwnBuildingLayers(manifest, (filename) => files.get(filename));
  const person = reference === undefined ? undefined : await characterPreview(reference);
  const binding = ownBuildingBindings(0, [manifest]);
  const cache = new TextureCache();
  const container = new Container();
  const shadow = manifest.shadow;
  const dx = shadow ? (manifest.entrancePixel.x - shadow.entrancePixel.x) * entry.scale : 0;
  const dy = shadow ? (manifest.entrancePixel.y - shadow.entrancePixel.y) * entry.scale : 0;
  const left = Math.min(0, dx);
  const top = Math.min(0, dy);
  const shadowLayer = layers[manifest.layer]?.shadow;
  const shadowFrame = shadowLayer?.atlas.frames.get(0);
  const shadowSprite =
    shadowLayer && shadowFrame ? new Sprite(cache.get(shadowLayer.source, shadowFrame)) : undefined;
  if (shadowSprite) {
    shadowSprite.scale.set(entry.scale);
    shadowSprite.position.set(20 - left + dx, 25 - top + dy);
    container.addChild(shadowSprite);
  }
  const sprites = Object.fromEntries(
    Object.keys(layers).map((key) => {
      const sprite = new Sprite();
      sprite.scale.set(entry.scale);
      sprite.position.set(20 - left, 25 - top);
      container.addChild(sprite);
      return [key, sprite];
    }),
  );
  const width = Math.max(manifest.width * entry.scale, dx + (shadow?.width ?? 0) * entry.scale) - left + 40;
  const height = Math.max(manifest.height * entry.scale, dy + (shadow?.height ?? 0) * entry.scale) - top + 50;
  if (person) {
    person.container.position.set(
      20 - left + manifest.entrancePixel.x * entry.scale - person.width / 2,
      25 - top + manifest.entrancePixel.y * entry.scale - person.height + 15,
    );
    container.addChild(person.container);
  }
  let stamp = 0;
  let lastProgress = -1;
  return {
    container,
    width,
    height,
    update(state, seconds) {
      person?.update({ ...state, clip: 'idle', frame: 0 }, seconds);
      if (state.progress === lastProgress) return;
      lastProgress = state.progress;
      if (shadowSprite) shadowSprite.visible = state.progress >= 100 || manifest.construction === undefined;
      stamp++;
      for (const sprite of Object.values(sprites)) sprite.visible = false;
      const draws =
        state.progress >= 100
          ? null
          : resolveConstructionDraws(binding, {
              kind: 'building',
              ref: 0,
              x: 0,
              y: 0,
              depth: 0,
              typeId: manifest.typeId,
              tribe: manifest.tribeId,
              builtPct: state.progress,
            });
      for (const draw of draws ?? [{ layer: manifest.layer, bob: 0 }]) {
        const key = draw.layer ?? manifest.layer;
        const layer = layers[key];
        const sprite = sprites[key];
        const frame = layer?.atlas.frames.get(0);
        if (!layer || !sprite || !frame) throw new Error(`Missing building layer ${entry.id}/${key}`);
        sprite.visible = true;
        sprite.texture =
          layer.times && 'fromPct' in draw
            ? (cache.revealed(
                layer.source,
                frame,
                layer.times,
                buildTimeThreshold(state.progress / 100, draw.fromPct, draw.toPct),
                stamp,
              ) ?? cache.get(layer.source, frame))
            : cache.get(layer.source, frame);
      }
    },
    destroy() {
      person?.destroy();
      container.destroy({ children: true });
      cache.clear();
    },
  };
}
