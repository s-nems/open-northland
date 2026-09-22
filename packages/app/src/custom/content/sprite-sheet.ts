/// <reference types="vite/client" />
import type { SpriteSheet } from '@open-northland/render';
import type { ContentIr } from '../../content/ir/rows.js';
import type { GoodRef } from '../../content/settler-gfx/index.js';
import { syntheticSpriteSheet } from '../../content/sprite-sheet/index.js';
import { diag } from '../../diag/index.js';
import { loadCustomBuildingLayers } from './building-layers.js';
import {
  type CustomBuildingManifest,
  customBuildingBindings,
  customBuildingManifest,
  customLayerScale,
} from './building-manifest.js';
import { customBushBinding } from './bush-binding.js';
import { loadCustomCharacters } from './characters.js';
import { customGoodBindings } from './good-manifest.js';
import { loadCustomGoods } from './goods.js';
import {
  customPropFlagBinding,
  customPropLayer,
  customPropResourceBinding,
  customPropStumpBinding,
} from './prop-manifest.js';
import { loadCustomProps } from './props.js';

const manifests = import.meta.glob('../../assets/custom/buildings/*/runtime.json', {
  eager: true,
  import: 'default',
});
const images = import.meta.glob<string>('../../assets/custom/buildings/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export async function loadCustomSpriteSheet(
  ir: ContentIr | null = null,
  selectedHead: string | null = null,
  goods: readonly GoodRef[] = [],
): Promise<SpriteSheet> {
  const base = syntheticSpriteSheet();
  const families: Record<string, NonNullable<SpriteSheet['families']>[string]> = {};
  const familyScales: Record<string, number> = {};
  const candidates = Object.entries(manifests).map(([path, raw]) => ({
    path,
    manifest: customBuildingManifest.parse(raw),
  }));
  customBuildingBindings(
    base.bindings.building,
    candidates.map(({ manifest }) => manifest),
  );
  const loaded: CustomBuildingManifest[] = [];
  await Promise.all(
    candidates.map(async ({ path, manifest }) => {
      try {
        const layers = await loadCustomBuildingLayers(
          manifest,
          (name) => images[path.replace('runtime.json', name)],
        );
        for (const [name, layer] of Object.entries(layers)) {
          families[name] = layer;
          familyScales[name] = customLayerScale(manifest, name);
        }
        loaded.push(manifest);
      } catch (error) {
        diag.warn('content', `Custom building ${manifest.layer}: ${String(error)}; using placeholder`);
      }
    }),
  );
  const characters = await loadCustomCharacters(base, ir, selectedHead, goods);
  const props = await loadCustomProps();
  const customGoods = await loadCustomGoods();
  for (const good of customGoods) {
    const name = `custom-good-${good.manifest.id}`;
    families[name] = good.layer;
    familyScales[name] = good.manifest.scale;
  }
  for (const prop of props) {
    const name = customPropLayer(prop.manifest.id);
    families[name] = prop.layer;
    familyScales[name] = prop.manifest.scale;
  }
  const stump = customPropStumpBinding(
    base.bindings.stump,
    props.map((p) => p.manifest),
  );
  const berrybush = customBushBinding(
    base.bindings.berrybush,
    ir,
    props.map((p) => p.manifest),
  );
  return {
    ...base,
    ...(characters === undefined ? {} : { characters }),
    bindings: {
      ...base.bindings,
      stockpile: customPropFlagBinding(
        customGoodBindings(
          base.bindings.stockpile,
          goods,
          customGoods.map((g) => g.manifest),
        ),
        props.map((p) => p.manifest),
      ),
      building: customBuildingBindings(base.bindings.building, loaded),
      resource: customPropResourceBinding(
        base.bindings.resource,
        ir,
        props.map((p) => p.manifest),
      ),
      ...(stump === undefined ? {} : { stump }),
      ...(berrybush === undefined ? {} : { berrybush }),
    },
    families,
    familyScales,
  };
}
