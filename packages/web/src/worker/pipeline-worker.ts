import { runPipeline } from '@open-northland/asset-pipeline';
import { bridgePipelineProgress } from '@open-northland/installer';
import { setActiveLocale } from '@open-northland/installer/i18n';
import { mountVfs } from '@open-northland/vfs';
import { fileMapVfs, opfsVfs } from '@open-northland/vfs/opfs';
import { storageFullMessage } from '../storage.js';
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

function describeError(error: unknown): string {
  return (
    storageFullMessage(error) ?? (error instanceof Error ? (error.stack ?? error.message) : String(error))
  );
}

worker.onmessage = (event: MessageEvent): void => {
  const request = event.data as RunPipelineRequest;
  if (request.kind !== 'run') return;
  setActiveLocale(request.locale);
  void (async () => {
    const fs = mountVfs({
      [GAME_MOUNT]: fileMapVfs(request.game),
      [DATA_MOUNT]: opfsVfs(await navigator.storage.getDirectory()),
    });
    const args = pipelineArgsOf(request);
    // A previous run's tree is dead weight on a storage-bounded origin, and a retry that starts on
    // a failed run's leftovers runs out of room the same way.
    await fs.rm(args.out);
    await runPipeline(fs, args, progress);
  })().then(
    () => post({ kind: 'done' }),
    (error: unknown) => post({ kind: 'error', message: describeError(error) }),
  );
};
