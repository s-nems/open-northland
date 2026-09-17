/// <reference types="vite/client" />
import type { SpriteLayer, SpriteSheet } from '@open-northland/render';
import { Assets, Rectangle, Texture } from 'pixi.js';
import { diag } from '../../diag/index.js';
import { type OwnGoodManifest, ownGoodAtlas, ownGoodManifest } from './good-manifest.js';

const manifests = import.meta.glob('../../assets/own/goods/*/runtime.json', {
  eager: true,
  import: 'default',
});
const images = import.meta.glob<string>('../../assets/own/goods/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
/** The frame after the five pile states: the good's single-item HUD icon. */
const OWN_GOOD_ICON_FRAME = 5;

/** A good's icon as a DOM surface draws it: the sheet URL and the icon's rect on it. */
export interface GoodIconSource {
  readonly url: string;
  readonly sheet: { readonly width: number; readonly height: number };
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

let ownIconSources: ReadonlyMap<string, GoodIconSource> | undefined;

/** The icon of an own good by string id, or `undefined` when the project has no art for it yet. */
export function ownGoodIconSource(goodId: string): GoodIconSource | undefined {
  ownIconSources ??= new Map(
    Object.entries(manifests).flatMap(([path, raw]): [string, GoodIconSource][] => {
      const m = ownGoodManifest.parse(raw);
      const url = images[path.replace('runtime.json', m.image)];
      const frame = m.frames[OWN_GOOD_ICON_FRAME];
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
  return ownIconSources.get(goodId);
}

export interface LoadedOwnGood {
  readonly manifest: OwnGoodManifest;
  readonly layer: SpriteLayer;
}
let loaded: Promise<readonly LoadedOwnGood[]> | undefined;
export function loadOwnGoods(): Promise<readonly LoadedOwnGood[]> {
  loaded ??= (async () => {
    const ids = new Set<string>();
    const candidates = Object.entries(manifests).map(([path, raw]) => {
      const manifest = ownGoodManifest.parse(raw);
      if (ids.has(manifest.id)) throw new Error(`Duplicate own good: ${manifest.id}`);
      ids.add(manifest.id);
      return { path, manifest };
    });
    const results = await Promise.all(
      candidates.map(async ({ path, manifest }): Promise<LoadedOwnGood | null> => {
        try {
          const url = images[path.replace('runtime.json', manifest.image)];
          if (!url) throw new Error('Missing goods image');
          const texture = await Assets.load<Texture>(url);
          if (texture.width !== manifest.width || texture.height !== manifest.height)
            throw new Error('Goods dimensions mismatch');
          texture.source.scaleMode = 'linear';
          texture.source.autoGenerateMipmaps = true;
          return { manifest, layer: { source: texture.source, atlas: ownGoodAtlas(manifest) } };
        } catch (error) {
          diag.warn('content', `Own good ${manifest.id}: ${String(error)}; using placeholder`);
          return null;
        }
      }),
    );
    return results.filter((g): g is LoadedOwnGood => g !== null);
  })();
  return loaded;
}

const iconsBySheet = new WeakMap<SpriteSheet, ReadonlyMap<string, Texture>>();
export function ownGoodIcons(sheet: SpriteSheet | undefined): ReadonlyMap<string, Texture> {
  if (!sheet) return new Map();
  const cached = iconsBySheet.get(sheet);
  if (cached) return cached;
  const icons = new Map<string, Texture>();
  for (const raw of Object.values(manifests)) {
    const m = ownGoodManifest.parse(raw);
    const layer = sheet.families?.[`own-good-${m.id}`];
    const frame = layer?.atlas.frames.get(OWN_GOOD_ICON_FRAME);
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
