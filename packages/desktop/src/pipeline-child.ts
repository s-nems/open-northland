import { runPipeline } from '@open-northland/asset-pipeline';
import type { PipelineProgress } from '@open-northland/asset-pipeline/progress';
import { nodeVfs } from '@open-northland/vfs/node';
import { createEventThrottle } from './event-throttle.js';
import type { PipelineEvent } from './ipc.js';

/**
 * The pipeline runner forked as an Electron `utilityProcess`: the conversion is CPU-bound JS (image
 * decoding, zlib), so it must not share the main process event loop. argv is
 * `<gameDir> <outDir> [modRoot]`, an empty `modRoot` auto-detecting the mod inside the game folder.
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

const [gameDir, outDir, modRoot] = process.argv.slice(2);
if (gameDir === undefined || outDir === undefined) {
  post({ kind: 'error', message: 'pipeline-child usage: <gameDir> <outDir> [modRoot]' });
  process.exit(2);
}

const itemThrottle = createEventThrottle();
const progress: PipelineProgress = {
  stage(stage) {
    itemThrottle.reset();
    post({ kind: 'stage', stage });
  },
  item(done, total) {
    const lastOfStage = total !== undefined && done >= total - 1;
    if (!itemThrottle.shouldEmit(lastOfStage)) return;
    post(total === undefined ? { kind: 'item', done } : { kind: 'item', done, total });
  },
};

// No process.exit() after posting: postMessage is asynchronous, so exiting on the same tick can
// drop the terminal event. The process ends by draining naturally.
runPipeline(
  nodeVfs(),
  { game: gameDir, out: outDir, modRoot: modRoot === '' ? undefined : modRoot },
  progress,
)
  .then(() => {
    post({ kind: 'done' });
  })
  .catch((err: unknown) => {
    post({ kind: 'error', message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    process.exitCode = 1;
  });
