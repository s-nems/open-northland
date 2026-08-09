import { runPipeline } from '@open-northland/asset-pipeline';
import type { PipelineProgress } from '@open-northland/asset-pipeline/progress';
import { createEventThrottle } from '@open-northland/installer';
import { mountVfs, vjoin } from '@open-northland/vfs';
import { fileMapVfs, opfsVfs } from '@open-northland/vfs/opfs';
import { CONTENT_DIR } from '../opfs-layout.js';
import { DATA_MOUNT, GAME_MOUNT, type PipelineWorkerMessage, type RunPipelineRequest } from './protocol.js';

/** The dedicated-worker global, typed locally: the page project compiles against the DOM lib. */
interface WorkerGlobal {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
}

const worker = self as unknown as WorkerGlobal;

function post(message: PipelineWorkerMessage): void {
  worker.postMessage(message);
}

// The pipeline narrates through console.log/warn; mirror those lines into the page's log tail.
for (const level of ['log', 'warn'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]): void => {
    original(...args);
    post({ kind: 'log', line: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') });
  };
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

worker.onmessage = (event: MessageEvent): void => {
  const request = event.data as RunPipelineRequest;
  if (request.kind !== 'run') return;
  void (async () => {
    const fs = mountVfs({
      [GAME_MOUNT]: fileMapVfs(request.game),
      [DATA_MOUNT]: opfsVfs(await navigator.storage.getDirectory()),
    });
    const args = {
      game: GAME_MOUNT,
      out: vjoin(DATA_MOUNT, CONTENT_DIR),
      modRoot: request.modRoot === undefined ? undefined : vjoin(DATA_MOUNT, request.modRoot),
    };
    await runPipeline(fs, args, progress);
  })().then(
    () => post({ kind: 'done' }),
    (err: unknown) =>
      post({ kind: 'error', message: err instanceof Error ? (err.stack ?? err.message) : String(err) }),
  );
};
