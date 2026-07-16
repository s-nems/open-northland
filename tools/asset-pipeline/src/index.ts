// The embedding surface for hosts that run the conversion in-process (the desktop shell's
// first-run installer). The CLI (`cli.ts`, the package bin) stays the human/agent entry.
export { type Args, CULTURESNATION_HOME_URL, resolveModRoot } from './args.js';
export {
  CONTENT_REVISION,
  CURRENT_MANIFEST,
  PIPELINE_MANIFEST_NAME,
  type PipelineManifest,
  readPipelineManifest,
  writePipelineManifest,
} from './manifest.js';
export { CULTURESNATION_MOD, type GameFolderProbe, probeGameFolder } from './probe.js';
// Progress symbols live only on the import-free `./progress` subpath — re-exporting them here would
// invite browser bundles to pull this barrel's node:fs graph.
export { runPipeline } from './run.js';
