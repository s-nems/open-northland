/// <reference types="vite/client" />
import type { PlanStakeTextures } from '@open-northland/render';
import { Texture } from 'pixi.js';
import blockedUrl from '../assets/markers/plan-stake-blocked.png';
import openUrl from '../assets/markers/plan-stake-open.png';
import { loadTextureIfPresent } from './net.js';

/** The line tools' stake art, or undefined when a page fails to load and the renderer's stand-in draws. */
export async function loadPlanStakeArt(): Promise<PlanStakeTextures | undefined> {
  const [open, blocked] = await Promise.all([
    loadTextureIfPresent(openUrl, 'linear'),
    loadTextureIfPresent(blockedUrl, 'linear'),
  ]);
  if (open === undefined || blocked === undefined) return undefined;
  return { open: new Texture({ source: open }), blocked: new Texture({ source: blocked }) };
}
