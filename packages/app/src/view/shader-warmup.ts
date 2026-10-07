import { type ShaderWarmup, startShaderWarmup, type WorldEnhancements } from '@open-northland/render';
import { diag } from '../diag/log.js';
import { readStoredSettings } from './settings-store.js';

/** Programs the renderer links for the current settings are compiled once per process; a change of the
 *  filter or shadow setting starts a fresh warm-up for its variants. */
let current: { readonly key: string; readonly warmup: ShaderWarmup } | null = null;

function settingsKey(settings: WorldEnhancements): string {
  return `${settings.enhancedSampling}/${settings.pixelArtScaler}/${settings.softShadows}`;
}

/**
 * The warm-up of the graphics programs the stored settings select, started on the first call and shared
 * by every later one for the same settings. The menu waits for it behind a card, so the first map
 * opens without the compile; a map booted directly waits for it before its first frame.
 */
export function graphicsShaderWarmup(onProgress?: (linked: number, total: number) => void): ShaderWarmup {
  const settings = readStoredSettings();
  const key = settingsKey(settings);
  if (current?.key === key) return current.warmup;
  const startedAt = performance.now();
  const warmup = startShaderWarmup(settings, onProgress);
  current = { key, warmup };
  void warmup.done.then((programs) => {
    const failed = programs.filter((program) => !program.linked).map((program) => program.name);
    diag.info('boot', 'shaders warmed', {
      ms: Math.round(performance.now() - startedAt),
      programs: programs.map((program) => `${program.name} ${Math.round(program.ms)} ms`),
    });
    if (failed.length > 0) diag.warn('boot', 'shaders failed to link in the warm-up', { failed });
  });
  return warmup;
}

/**
 * `apply` for a live enhancement change, run once the change's programs are linked: the renderer's
 * own link of a fresh variant blocks the frame it happens in, seconds on Direct3D. A change that
 * another supersedes before its programs link is dropped.
 */
export function applyEnhancementsWarmed(
  apply: (next: WorldEnhancements) => void,
): (next: WorldEnhancements) => void {
  let revision = 0;
  return (next) => {
    const mine = ++revision;
    void graphicsShaderWarmup().done.then(() => {
      if (mine === revision) apply(next);
    });
  };
}
