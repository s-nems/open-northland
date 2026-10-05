/// <reference types="vite/client" />
import type { PlanRoadTextures } from '@open-northland/render';
import { Texture } from 'pixi.js';
import blockedUrl from '../assets/markers/plan-road-blocked.png';
import claimedUrl from '../assets/markers/plan-road-claimed.png';
import openUrl from '../assets/markers/plan-road-open.png';
import { loadTextureIfPresent } from './net.js';

/** The road tool's plot art and a claimed road site's bare plot, or undefined when a page fails to load and the renderer's stand-in draws. */
export async function loadPlanRoadArt(): Promise<PlanRoadTextures | undefined> {
  const [open, blocked, claimed] = await Promise.all([
    loadTextureIfPresent(openUrl),
    loadTextureIfPresent(blockedUrl),
    loadTextureIfPresent(claimedUrl),
  ]);
  if (open === undefined || blocked === undefined || claimed === undefined) return undefined;
  return {
    open: new Texture({ source: open }),
    blocked: new Texture({ source: blocked }),
    claimed: new Texture({ source: claimed }),
  };
}
