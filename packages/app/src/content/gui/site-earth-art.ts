/// <reference types="vite/client" />
import { Texture } from 'pixi.js';
import earthUrl from '../../assets/markers/site-earth.png';
import { loadTextureIfPresent } from '../net.js';

/** The trampled earth of a construction site, tiling in both directions, or undefined when its page
 *  fails to load and the renderer's stand-in draws. */
export async function loadSiteEarthArt(): Promise<Texture | undefined> {
  const earth = await loadTextureIfPresent(earthUrl);
  if (earth === undefined) return undefined;
  earth.addressMode = 'repeat';
  return new Texture({ source: earth });
}
