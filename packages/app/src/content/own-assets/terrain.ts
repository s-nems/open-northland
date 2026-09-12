import type { TerrainTextureSet } from '@open-northland/render';
import { Assets, Graphics, type Renderer, type Texture } from 'pixi.js';
import type { ContentIr } from '../ir/rows.js';
import { ownTerrainBindings } from './bindings.js';
import { bakeOwnMaterial } from './material-atlas.js';
import { ownMaterialBindings } from './material-layout.js';
import { ownMaterialUrls, ownTerrainMaterials } from './materials.js';

export async function loadOwnTerrain(renderer: Renderer, ir: ContentIr | null): Promise<TerrainTextureSet> {
  const materialImages = new Set(['soil.png', ...ownTerrainMaterials.map((material) => material.image)]);
  const textures = new Map<string, Texture>(
    await Promise.all(
      [...materialImages].map(async (name): Promise<[string, Texture]> => {
        const url = ownMaterialUrls.get(name);
        if (!url) throw new Error(`Missing terrain material image: ${name}`);
        return [name, await Assets.load<Texture>(url)];
      }),
    ),
  );
  for (const texture of textures.values()) {
    texture.source.scaleMode = 'linear';
    texture.source.autoGenerateMipmaps = true;
  }
  const soil = textures.get('soil.png');
  if (!soil) throw new Error('Own soil material did not load');
  const pages = new Map<string, Texture['source']>();
  for (const material of ownTerrainMaterials) {
    const texture = textures.get(material.image);
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
