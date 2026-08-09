import type { PipelineManifest } from '@open-northland/asset-pipeline';

export type ContentStatus =
  | 'missing'
  /** The app cannot load this content, so regeneration is required. */
  | 'stale-schema'
  /** Same schema, older conversion output: regeneration is recommended but playing is allowed. */
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
