/// <reference types="vite/client" />
import { Texture } from 'pixi.js';
import pinUrl from '../../assets/markers/map-ping-pin.png';
import { loadTextureIfPresent } from '../net.js';

/** The map ping's pin page, or undefined when it fails to load and the renderer's stand-in draws. */
export async function loadMapPingPinArt(): Promise<Texture | undefined> {
  const pin = await loadTextureIfPresent(pinUrl);
  return pin === undefined ? undefined : new Texture({ source: pin });
}
