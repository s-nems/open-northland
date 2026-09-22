import { Assets, Container, Rectangle, type Renderer, Sprite, Text, Texture } from 'pixi.js';
import { bakeCustomMaterial } from '../content/material-atlas.js';
import {
  MATERIAL_COLUMNS,
  MATERIAL_GUTTER,
  MATERIAL_STRIDE,
  MATERIAL_TILE,
  MATERIAL_TILES,
} from '../content/material-layout.js';
import { MOUNTAIN_GUTTER, MOUNTAIN_HEIGHT, MOUNTAIN_WIDTH } from '../content/mountain-layout.js';
import type { GalleryMaterial } from './catalog.js';
import type { PreviewPanel } from './preview-state.js';

export async function terrainPreview(
  entry: GalleryMaterial,
  renderer: Renderer,
  soilImage: string,
): Promise<PreviewPanel> {
  const [source, soil] = await Promise.all([
    Assets.load<Texture>(entry.image),
    Assets.load<Texture>(soilImage),
  ]);
  for (const texture of [source, soil]) {
    texture.source.scaleMode = 'linear';
    texture.source.autoGenerateMipmaps = true;
  }
  const baked = bakeCustomMaterial(renderer, source, soil, entry.manifest);
  const container = new Container();
  const atlas = new Container();
  const repeat = new Container();
  container.addChild(atlas, repeat);
  const mountain = entry.manifest.layout === 'mountain';
  const tiles = Array.from(
    { length: mountain ? 1 : MATERIAL_TILES },
    (_, i) =>
      new Texture({
        source: baked.source,
        frame: mountain
          ? new Rectangle(MOUNTAIN_GUTTER, MOUNTAIN_GUTTER, MOUNTAIN_WIDTH, MOUNTAIN_HEIGHT)
          : new Rectangle(
              (i % MATERIAL_COLUMNS) * MATERIAL_STRIDE + MATERIAL_GUTTER,
              Math.floor(i / MATERIAL_COLUMNS) * MATERIAL_STRIDE + MATERIAL_GUTTER,
              MATERIAL_TILE,
              MATERIAL_TILE,
            ),
      }),
  );
  for (const [i, texture] of tiles.entries()) {
    const sprite = new Sprite(texture);
    const x = mountain ? 0 : (i % MATERIAL_COLUMNS) * (MATERIAL_TILE + 12);
    const y = mountain ? 0 : Math.floor(i / MATERIAL_COLUMNS) * (MATERIAL_TILE + 28);
    sprite.position.set(x, y);
    const label = new Text({
      text: mountain
        ? 'Macro'
        : i < 4
          ? `Variant ${i + 1}`
          : `V${Math.floor((i - 4) / 12) + 1} · ${(i - 4) % 12 < 6 ? 'A' : 'B'} · ${((i - 4) % 6) + 1}`,
      style: { fontSize: 11, fill: '#e8ddc4', stroke: { color: '#171c1b', width: 2 } },
    });
    label.position.set(x, y + texture.height + 2);
    atlas.addChild(sprite, label);
  }
  const columns = mountain ? 2 : 6;
  const rows = mountain ? 2 : 4;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const texture = tiles[mountain ? 0 : (x + y * 3) % 4];
      if (!texture) continue;
      const sprite = new Sprite(texture);
      sprite.position.set(x * texture.width, y * texture.height);
      repeat.addChild(sprite);
    }
  const width = mountain ? MOUNTAIN_WIDTH * 2 : MATERIAL_COLUMNS * (MATERIAL_TILE + 12);
  const height = mountain ? MOUNTAIN_HEIGHT * 2 + 30 : 4 * (MATERIAL_TILE + 28);
  return {
    container,
    width,
    height,
    update(state) {
      atlas.visible = state.terrainView === 'atlas';
      repeat.visible = !atlas.visible;
    },
    destroy() {
      container.destroy({ children: true });
      for (const texture of tiles) texture.destroy();
      baked.destroy(true);
    },
  };
}
