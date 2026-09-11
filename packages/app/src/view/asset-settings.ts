import { type AssetSet, readStoredSettings } from './settings-store.js';

export function assetSetFor(
  params: URLSearchParams,
  stored: AssetSet = readStoredSettings().assets,
): AssetSet {
  const value = params.get('assets');
  return value === 'own' || value === 'original' ? value : stored;
}
