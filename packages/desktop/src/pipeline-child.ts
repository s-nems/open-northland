import { runPipeline } from '@open-northland/asset-pipeline';
import type { PipelineProgress } from '@open-northland/asset-pipeline/progress';
import type { PipelineEvent } from './ipc.js';

/**
 * The pipeline runner forked as an Electron `utilityProcess` — the conversion is CPU-bound JS
 * (image decoding, zlib), so it must not share the main process event loop. argv: `<gameDir> <outDir>
 * [mod]` (no third arg = no mod). Progress goes to the parent as {@link PipelineEvent}s; the
 * pipeline's own console logs ride the piped stdio and are forwarded by the host as `log` events.
 */

/** Minimum ms between forwarded item events — the unpack stage ticks thousands of times per second. */
const ITEM_POST_INTERVAL_MS = 100;

/** The slice of Electron's `utilityProcess` parent port the child uses (typed locally so the child
 * stays a plain Node program — it must not import the `electron` module). */
interface ParentPort {
  postMessage(message: unknown): void;
}

const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (port === undefined) throw new Error('pipeline-child must run as an Electron utilityProcess');
const parent: ParentPort = port;

function post(event: PipelineEvent): void {
  parent.postMessage(event);
}

const [gameDir, outDir, mod] = process.argv.slice(2);
if (gameDir === undefined || outDir === undefined) {
  post({ kind: 'error', message: 'pipeline-child usage: <gameDir> <outDir> [mod]' });
  process.exit(2);
}

let lastItemPost = 0;
const progress: PipelineProgress = {
  stage(stage) {
    lastItemPost = 0;
    post({ kind: 'stage', stage });
  },
  item(done, total) {
    const now = Date.now();
    if (now - lastItemPost < ITEM_POST_INTERVAL_MS && !(total !== undefined && done >= total - 1)) return;
    lastItemPost = now;
    post(total === undefined ? { kind: 'item', done } : { kind: 'item', done, total });
  },
};

// No process.exit() after posting: postMessage is asynchronous and exiting on the same tick can
// drop the terminal event (a finished conversion would then surface as a failure). The process
// ends by draining naturally; the host kills it if it ever lingers.
runPipeline({ game: gameDir, out: outDir, mod: mod === '' ? undefined : mod }, progress)
  .then(() => {
    post({ kind: 'done' });
  })
  .catch((err: unknown) => {
    post({ kind: 'error', message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    process.exitCode = 1;
  });
