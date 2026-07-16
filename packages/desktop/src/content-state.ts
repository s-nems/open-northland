import type { PipelineManifest } from '@open-northland/asset-pipeline';

/**
 * Classifies the data root's content against the shell's bundled pipeline expectation
 * (`CURRENT_MANIFEST`). Drives what the window boots into: only `ready` goes straight to the game;
 * everything else lands on the setup page, which words each state (see setup.ts).
 */
export type ContentStatus =
  /** No converted content — the true first run. */
  | 'missing'
  /** IR schema mismatch: the app cannot load this content; regeneration is required. */
  | 'stale-schema'
  /** Same schema but older conversion output (or a pre-manifest/interrupted install) — regeneration recommended, playing anyway allowed. */
  | 'stale-revision'
  | 'ready';

export function classifyContent(
  stored: PipelineManifest | undefined,
  current: PipelineManifest,
  irJsonExists: boolean,
): ContentStatus {
  if (!irJsonExists) return 'missing';
  if (stored === undefined) return 'stale-revision';
  if (stored.irVersion !== current.irVersion) return 'stale-schema';
  if (stored.contentRevision !== current.contentRevision) return 'stale-revision';
  return 'ready';
}
