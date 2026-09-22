/// <reference types="vite/client" />
import type { SpriteLayer, SpriteSheet } from '@open-northland/render';
import { Assets, Rectangle, Texture } from 'pixi.js';
import { diag } from '../../diag/index.js';
import type { GoodIconSource } from '../../presentation/pack.js';
import { type CustomGoodManifest, customGoodAtlas, customGoodManifest } from './good-manifest.js';

const manifests = import.meta.glob('../../assets/custom/goods/*/runtime.json', {
  eager: true,
  import: 'default',
});
const images = import.meta.glob<string>('../../assets/custom/goods/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
/** The frame after the five pile states: the good's single-item HUD icon. */
const CUSTOM_GOOD_ICON_FRAME = 5;

let customIconSources: ReadonlyMap<string, GoodIconSource> | undefined;

/** The icon of a custom good by string id, or `undefined` when the project has no art for it yet. */
export function customGoodIconSource(goodId: string): GoodIconSource | undefined {
  customIconSources ??= new Map(
    Object.entries(manifests).flatMap(([path, raw]): [string, GoodIconSource][] => {
      const m = customGoodManifest.parse(raw);
      const url = images[path.replace('runtime.json', m.image)];
      const frame = m.frames[CUSTOM_GOOD_ICON_FRAME];
      if (url === undefined || frame === undefined) return [];
      return [
        [
          m.id,
          {
            url,
            sheet: { width: m.width, height: m.height },
            rect: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
          },
        ],
      ];
    }),
  );
  return customIconSources.get(goodId);
}

export interface LoadedCustomGood {
  readonly manifest: CustomGoodManifest;
  readonly layer: SpriteLayer;
}
let loaded: Promise<readonly LoadedCustomGood[]> | undefined;
export function loadCustomGoods(): Promise<readonly LoadedCustomGood[]> {
  loaded ??= (async () => {
    const ids = new Set<string>();
    const candidates = Object.entries(manifests).map(([path, raw]) => {
      const manifest = customGoodManifest.parse(raw);
      if (ids.has(manifest.id)) throw new Error(`Duplicate custom good: ${manifest.id}`);
      ids.add(manifest.id);
      return { path, manifest };
    });
    const results = await Promise.all(
      candidates.map(async ({ path, manifest }): Promise<LoadedCustomGood | null> => {
        try {
          const url = images[path.replace('runtime.json', manifest.image)];
          if (!url) throw new Error('Missing goods image');
          const texture = await Assets.load<Texture>(url);
          if (texture.width !== manifest.width || texture.height !== manifest.height)
            throw new Error('Goods dimensions mismatch');
          texture.source.scaleMode = 'linear';
          texture.source.autoGenerateMipmaps = true;
          return { manifest, layer: { source: texture.source, atlas: customGoodAtlas(manifest) } };
        } catch (error) {
          diag.warn('content', `Custom good ${manifest.id}: ${String(error)}; using placeholder`);
          return null;
        }
      }),
    );
    return results.filter((g): g is LoadedCustomGood => g !== null);
  })();
  return loaded;
}

const iconsBySheet = new WeakMap<SpriteSheet, ReadonlyMap<string, Texture>>();
export function customGoodIcons(sheet: SpriteSheet | undefined): ReadonlyMap<string, Texture> {
  if (!sheet) return new Map();
  const cached = iconsBySheet.get(sheet);
  if (cached) return cached;
  const icons = new Map<string, Texture>();
  for (const raw of Object.values(manifests)) {
    const m = customGoodManifest.parse(raw);
    const layer = sheet.families?.[`custom-good-${m.id}`];
    const frame = layer?.atlas.frames.get(CUSTOM_GOOD_ICON_FRAME);
    if (layer && frame)
      icons.set(
        m.id,
        new Texture({
          source: layer.source,
          frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
        }),
      );
  }
  iconsBySheet.set(sheet, icons);
  return icons;
}
