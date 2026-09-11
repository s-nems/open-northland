/// <reference types="vite/client" />
import type { SpriteLayer } from '@open-northland/render';
import { Assets, type Texture } from 'pixi.js';
import { diag } from '../../diag/index.js';
import { type OwnPropManifest, ownPropAtlas, ownPropManifest, ownPropNames } from './prop-manifest.js';

const manifests = import.meta.glob('../../assets/own/props/*/runtime.json', {
  eager: true,
  import: 'default',
});
const images = import.meta.glob<string>('../../assets/own/props/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export interface LoadedOwnProp {
  readonly manifest: OwnPropManifest;
  readonly layer: SpriteLayer;
}

export async function loadOwnProps(): Promise<readonly LoadedOwnProp[]> {
  const candidates = Object.entries(manifests).map(([path, raw]) => ({
    path,
    manifest: ownPropManifest.parse(raw),
  }));
  ownPropNames(candidates.map((c) => c.manifest));
  const loaded = await Promise.all(
    candidates.map(async ({ path, manifest }): Promise<LoadedOwnProp | null> => {
      try {
        const url = images[path.replace('runtime.json', manifest.image)];
        if (url === undefined) throw new Error('Missing prop image');
        const texture = await Assets.load<Texture>(url);
        if (texture.width !== manifest.width || texture.height !== manifest.height)
          throw new Error('Prop dimensions mismatch');
        texture.source.scaleMode = 'linear';
        texture.source.autoGenerateMipmaps = true;
        return {
          manifest,
          layer: {
            source: texture.source,
            atlas: ownPropAtlas(manifest),
            ...(manifest.sway === undefined ? {} : { sway: manifest.sway }),
          },
        };
      } catch (error) {
        diag.warn('content', `Own prop ${manifest.id}: ${String(error)}; using placeholder`);
        return null;
      }
    }),
  );
  return loaded.filter((p): p is LoadedOwnProp => p !== null);
}
