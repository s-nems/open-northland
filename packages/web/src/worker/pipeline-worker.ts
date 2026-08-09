import { runPipeline } from '@open-northland/asset-pipeline';
import { bridgePipelineProgress } from '@open-northland/installer';
import { mountVfs } from '@open-northland/vfs';
import { fileMapVfs, opfsVfs } from '@open-northland/vfs/opfs';
import {
  DATA_MOUNT,
  GAME_MOUNT,
  type PipelineWorkerMessage,
  pipelineArgsOf,
  type RunPipelineRequest,
} from './protocol.js';

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

const progress = bridgePipelineProgress(post);

worker.onmessage = (event: MessageEvent): void => {
  const request = event.data as RunPipelineRequest;
  if (request.kind !== 'run') return;
  void (async () => {
    const fs = mountVfs({
      [GAME_MOUNT]: fileMapVfs(request.game),
      [DATA_MOUNT]: opfsVfs(await navigator.storage.getDirectory()),
    });
    await runPipeline(fs, pipelineArgsOf(request), progress);
  })().then(
    () => post({ kind: 'done' }),
    (err: unknown) =>
      post({ kind: 'error', message: err instanceof Error ? (err.stack ?? err.message) : String(err) }),
  );
};
