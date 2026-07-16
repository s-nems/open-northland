// The embedding surface for hosts that run the conversion in-process (the desktop shell's
// first-run installer). The CLI (`cli.ts`, the package bin) stays the human/agent entry.
export type { Args } from './args.js';
export { CULTURESNATION_MOD, type GameFolderProbe, probeGameFolder } from './probe.js';
export {
  PIPELINE_STAGES,
  type PipelineProgress,
  type PipelineStageId,
  type StageItemReporter,
} from './progress.js';
export { runPipeline } from './run.js';
