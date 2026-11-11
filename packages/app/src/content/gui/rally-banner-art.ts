/// <reference types="vite/client" />
import { Texture } from 'pixi.js';
import bannerUrl from '../../assets/markers/rally-banner.png';
import { loadTextureIfPresent } from '../net.js';

/** The rally banner's art page, or undefined when it fails to load and the renderer's stand-in draws. */
export async function loadRallyBannerArt(): Promise<Texture | undefined> {
  const banner = await loadTextureIfPresent(bannerUrl);
  return banner === undefined ? undefined : new Texture({ source: banner });
}
