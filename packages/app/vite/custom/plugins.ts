import type { Plugin } from 'vite';
import { artPreviewPlugin } from './art-preview.js';

/** The custom art checkout's development plugins, loaded by `vite.config.ts` when this file exists. */
export async function checkoutPlugins(repoRoot: string, command: 'serve' | 'build'): Promise<Plugin[]> {
  const candidate = process.env.ART_CANDIDATE;
  return command === 'serve' && candidate ? [await artPreviewPlugin(repoRoot, candidate)] : [];
}
