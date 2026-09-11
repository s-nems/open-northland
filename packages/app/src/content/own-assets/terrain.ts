import type { TerrainTextureSet } from '@open-northland/render';
import { Assets, Graphics, type Renderer, type Texture } from 'pixi.js';
import type { ContentIr } from '../ir/rows.js';
import { ownTerrainBindings } from './bindings.js';
import { bakeOwnMaterial } from './material-atlas.js';
import { ownMaterialBindings } from './material-layout.js';
import { ownTerrainMaterials } from './materials.js';

const materialUrls = {
  'sand.png': new URL('../../assets/own/terrain/sand.png', import.meta.url).href,
  'quiet.png': new URL('../../assets/own/terrain/quiet.png', import.meta.url).href,
  'dark.png': new URL('../../assets/own/terrain/dark.png', import.meta.url).href,
  'soil.png': new URL('../../assets/own/terrain/soil.png', import.meta.url).href,
  'gravel.png': new URL('../../assets/own/terrain/gravel.png', import.meta.url).href,
  'mountains.png': new URL('../../assets/own/terrain/mountains.png', import.meta.url).href,
};

export async function loadOwnTerrain(renderer: Renderer, ir: ContentIr | null): Promise<TerrainTextureSet> {
  const images = await Assets.load<Texture>(Object.values(materialUrls));
  for (const texture of Object.values(images)) {
    texture.source.scaleMode = 'linear';
    texture.source.autoGenerateMipmaps = true;
  }
  const soil = images[materialUrls['soil.png']];
  if (!soil) throw new Error('Own soil material did not load');
  const pages = new Map<string, Texture['source']>();
  for (const material of ownTerrainMaterials) {
    const texture = images[materialUrls[material.image]];
    if (!texture) throw new Error(`Own terrain material did not load: ${material.image}`);
    const baked = bakeOwnMaterial(renderer, texture, soil, material);
    pages.set(`own-${material.id}`, baked.source);
  }
  const bindings = ownMaterialBindings(
    ir?.gfxPatterns ?? [],
    ir?.gfxPatternTransitions ?? [],
    ownTerrainMaterials,
  );
  const missingArt = new Graphics()
    .rect(0, 0, 64, 64)
    .fill(0x545665)
    .rect(0, 0, 32, 32)
    .rect(32, 32, 32, 32)
    .fill(0x777988);
  const missing = renderer.generateTexture(missingArt);
  missingArt.destroy();
  const overlayArt = new Graphics()
    .rect(0, 0, 64, 64)
    .fill({ color: 0xdc75cf, alpha: 0.22 })
    .moveTo(0, 0)
    .lineTo(64, 64)
    .moveTo(0, 64)
    .lineTo(64, 0)
    .stroke({ color: 0xdc75cf, width: 3 });
  const overlay = renderer.generateTexture(overlayArt);
  overlayArt.destroy();
  pages.set('missing-ground', missing.source);
  pages.set('missing-transition', overlay.source);
  return ownTerrainBindings(pages, bindings.ground, bindings.transitions);
}
