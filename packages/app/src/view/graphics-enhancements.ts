import type { WorldEnhancements } from '@open-northland/render';

/** Diagnostic A/B override; normal choices live in Graphics settings and apply without restarting. */
export function graphicsEnhancementsFor(
  params: URLSearchParams,
  stored: WorldEnhancements,
): WorldEnhancements {
  const value = params.get('polish');
  if (value === null) return stored;
  const selected = new Set(value.split(','));
  const all = selected.has('on');
  return {
    enhancedSampling: all || selected.has('sampling'),
    softShadows: all || selected.has('shadows'),
    environmentMotion: all || selected.has('motion'),
  };
}
