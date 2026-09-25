/// <reference types="vite/client" />
import type { PlanStakeTextures } from '@open-northland/render';
import { Texture } from 'pixi.js';
import blockedUrl from '../assets/markers/plan-stake-blocked.png';
import openUrl from '../assets/markers/plan-stake-open.png';
import ringUrl from '../assets/markers/plan-stake-ring.png';
import { loadTextureIfPresent } from './net.js';

/** The line tools' stake art and a claimed wall site's ring, or undefined when a page fails to load and the renderer's stand-in draws. */
export async function loadPlanStakeArt(): Promise<PlanStakeTextures | undefined> {
  const [open, blocked, ring] = await Promise.all([
    loadTextureIfPresent(openUrl, 'linear'),
    loadTextureIfPresent(blockedUrl, 'linear'),
    loadTextureIfPresent(ringUrl, 'linear'),
  ]);
  if (open === undefined || blocked === undefined || ring === undefined) return undefined;
  return {
    open: new Texture({ source: open }),
    blocked: new Texture({ source: blocked }),
    ring: new Texture({ source: ring }),
  };
}
