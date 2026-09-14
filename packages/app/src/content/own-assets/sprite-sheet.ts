/// <reference types="vite/client" />
import type { SpriteSheet } from '@open-northland/render';
import { diag } from '../../diag/index.js';
import type { ContentIr } from '../ir/rows.js';
import type { GoodRef } from '../settler-gfx/index.js';
import { syntheticSpriteSheet } from '../sprite-sheet/index.js';
import { loadOwnBuildingLayers } from './building-layers.js';
import {
  type OwnBuildingManifest,
  ownBuildingBindings,
  ownBuildingManifest,
  ownLayerScale,
} from './building-manifest.js';
import { ownBushBinding } from './bush-binding.js';
import { loadOwnCharacters } from './characters.js';
import { ownGoodBindings } from './good-manifest.js';
import { loadOwnGoods } from './goods.js';
import {
  ownPropFlagBinding,
  ownPropLayer,
  ownPropResourceBinding,
  ownPropStumpBinding,
} from './prop-manifest.js';
import { loadOwnProps } from './props.js';

const manifests = import.meta.glob('../../assets/own/buildings/*/runtime.json', {
  eager: true,
  import: 'default',
});
const images = import.meta.glob<string>('../../assets/own/buildings/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export async function loadOwnSpriteSheet(
  ir: ContentIr | null = null,
  selectedHead: string | null = null,
  goods: readonly GoodRef[] = [],
): Promise<SpriteSheet> {
  const base = syntheticSpriteSheet();
  const families: Record<string, NonNullable<SpriteSheet['families']>[string]> = {};
  const familyScales: Record<string, number> = {};
  const candidates = Object.entries(manifests).map(([path, raw]) => ({
    path,
    manifest: ownBuildingManifest.parse(raw),
  }));
  ownBuildingBindings(
    base.bindings.building,
    candidates.map(({ manifest }) => manifest),
  );
  const loaded: OwnBuildingManifest[] = [];
  await Promise.all(
    candidates.map(async ({ path, manifest }) => {
      try {
        const layers = await loadOwnBuildingLayers(
          manifest,
          (name) => images[path.replace('runtime.json', name)],
        );
        for (const [name, layer] of Object.entries(layers)) {
          families[name] = layer;
          familyScales[name] = ownLayerScale(manifest, name);
        }
        loaded.push(manifest);
      } catch (error) {
        diag.warn('content', `Own building ${manifest.layer}: ${String(error)}; using placeholder`);
      }
    }),
  );
  const characters = await loadOwnCharacters(base, ir, selectedHead, goods);
  const props = await loadOwnProps();
  const ownGoods = await loadOwnGoods();
  for (const good of ownGoods) {
    const name = `own-good-${good.manifest.id}`;
    families[name] = good.layer;
    familyScales[name] = good.manifest.scale;
  }
  for (const prop of props) {
    const name = ownPropLayer(prop.manifest.id);
    families[name] = prop.layer;
    familyScales[name] = prop.manifest.scale;
  }
  const stump = ownPropStumpBinding(
    base.bindings.stump,
    props.map((p) => p.manifest),
  );
  const berrybush = ownBushBinding(
    base.bindings.berrybush,
    ir,
    props.map((p) => p.manifest),
  );
  return {
    ...base,
    ...(characters === undefined ? {} : { characters }),
    bindings: {
      ...base.bindings,
      stockpile: ownPropFlagBinding(
        ownGoodBindings(
          base.bindings.stockpile,
          goods,
          ownGoods.map((g) => g.manifest),
        ),
        props.map((p) => p.manifest),
      ),
      building: ownBuildingBindings(base.bindings.building, loaded),
      resource: ownPropResourceBinding(
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
