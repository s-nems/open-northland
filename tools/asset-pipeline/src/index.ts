// The embedding surface for hosts that run the conversion in-process; the CLI stays the human entry.
export type { Args } from './args.js';
export {
  CONTENT_REVISION,
  CURRENT_MANIFEST,
  PIPELINE_MANIFEST_NAME,
  type PipelineManifest,
  readPipelineManifest,
  writePipelineManifest,
} from './manifest.js';
export { CULTURESNATION_MOD, type GameFolderProbe, probeGameFolder } from './probe.js';
export { CULTURESNATION_HOME_URL, resolveModRoot } from './roots.js';
// Progress symbols stay on the import-free `./progress` subpath: re-exporting them here would pull
// this barrel's node:fs graph into browser bundles.
export { runPipeline } from './run.js';
