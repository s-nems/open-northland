import { runPipeline } from '@open-northland/asset-pipeline';
import { bridgePipelineProgress, type PipelineEvent } from '@open-northland/installer';
import { nodeVfs } from '@open-northland/vfs/node';
import { decodePipelineArgv } from './pipeline-argv.js';

/**
 * The pipeline runner forked as an Electron `utilityProcess`: the conversion is CPU-bound JS (image
 * decoding, zlib), so it must not share the main process event loop.
 */

/** Typed locally so the child stays a plain Node program that never imports `electron`. */
interface ParentPort {
  postMessage(message: unknown): void;
}

const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (port === undefined) throw new Error('pipeline-child must run as an Electron utilityProcess');
const parent: ParentPort = port;

function post(event: PipelineEvent): void {
  parent.postMessage(event);
}

const args = decodePipelineArgv(process.argv.slice(2));
if (args === undefined) {
  post({ kind: 'error', message: 'pipeline-child: argv is not a pipeline invocation' });
  process.exit(2);
}
const { outDir, modRoot } = args;

const progress = bridgePipelineProgress(post);

// No process.exit() after posting: postMessage is asynchronous, so exiting on the same tick can
// drop the terminal event. The process ends by draining naturally.
runPipeline(nodeVfs(), { modRoot, out: outDir }, progress)
  .then(() => {
    post({ kind: 'done' });
  })
  .catch((err: unknown) => {
    post({ kind: 'error', message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    process.exitCode = 1;
  });
