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
  const sprites = Object.fromEntries(
    Object.keys(layers).map((key) => {
      const sprite = new Sprite();
      sprite.scale.set(entry.scale);
      sprite.position.set(20, 25);
      container.addChild(sprite);
      return [key, sprite];
    }),
  );
  const width = manifest.width * entry.scale + 40;
  const height = manifest.height * entry.scale + 50;
  if (person) {
    person.container.position.set(
      20 + manifest.entrancePixel.x * entry.scale - person.width / 2,
      25 + manifest.entrancePixel.y * entry.scale - person.height + 15,
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
