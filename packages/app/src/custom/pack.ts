import type { PresentationPack } from '../presentation/pack.js';
import { customGoodIconSource, customGoodIcons } from './content/goods.js';
import { loadCustomMapObjects } from './content/objects.js';
import { customSceneTerrain } from './content/scene-terrain.js';
import { loadCustomSpriteSheet } from './content/sprite-sheet.js';
import { loadCustomTerrain } from './content/terrain.js';

const customPack: PresentationPack = {
  spriteSheet: (ir, goods, params) => loadCustomSpriteSheet(ir, params.get('customHead'), goods),
  terrain: loadCustomTerrain,
  sceneTerrain: customSceneTerrain,
  mapObjects: loadCustomMapObjects,
  goodIconSource: customGoodIconSource,
  goodTextures: customGoodIcons,
};

export type AssetSet = 'custom' | 'original';

/** The development choice between the custom and the original art, kept across sessions. */
const ASSET_SET_KEY = 'on.assets';

function storedAssetSet(): AssetSet | null {
  try {
    const value = globalThis.localStorage?.getItem(ASSET_SET_KEY);
    return value === 'custom' || value === 'original' ? value : null;
  } catch {
    return null;
  }
}

/** `?assets=custom|original` picks the set during development and is remembered. */
export function assetSetFor(params: URLSearchParams): AssetSet {
  const requested = params.get('assets');
  if (requested !== 'custom' && requested !== 'original') return storedAssetSet() ?? 'custom';
  try {
    globalThis.localStorage?.setItem(ASSET_SET_KEY, requested);
  } catch {
    // Storage may be unavailable; the URL still decides this session.
  }
  return requested;
}

/** A release build draws only the custom art; development can compare it with the original. */
export function presentationPack(params: URLSearchParams): PresentationPack | null {
  if (!import.meta.env.DEV) return customPack;
  return assetSetFor(params) === 'custom' ? customPack : null;
}
