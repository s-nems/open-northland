import { runPipeline } from '@open-northland/asset-pipeline';
import { bridgePipelineProgress } from '@open-northland/installer';
import { setActiveLocale } from '@open-northland/installer/i18n';
import { vjoin } from '@open-northland/vfs';
import { opfsVfs } from '@open-northland/vfs/opfs';
import { CONTENT_DIR, CONTENT_RUNNING_MARKER } from '../opfs-layout.js';
import { storageFullMessage } from '../storage.js';
import type { PipelineWorkerMessage, RunPipelineRequest } from './protocol.js';

/** The dedicated-worker global, typed locally: the page project compiles against the DOM lib. */
interface WorkerGlobal {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
}

const worker = self as unknown as WorkerGlobal;

function post(message: PipelineWorkerMessage): void {
  worker.postMessage(message);
}

/** Never throws inside the pipeline it is only logging: a circular or BigInt argument would. */
function describeArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

// The pipeline narrates through console.log/warn; mirror those lines into the page's log tail.
for (const level of ['log', 'warn'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]): void => {
    original(...args);
    post({ kind: 'log', line: args.map(describeArg).join(' ') });
  };
}

const progress = bridgePipelineProgress(post);

function describeError(error: unknown): string {
  return (
    storageFullMessage(error) ?? (error instanceof Error ? (error.stack ?? error.message) : String(error))
  );
}

worker.onmessage = (event: MessageEvent<RunPipelineRequest>): void => {
  const request = event.data;
  if (request.kind !== 'run') return;
  setActiveLocale(request.locale);
  void (async () => {
    const fs = opfsVfs(await navigator.storage.getDirectory());
    const args = { modRoot: request.modRoot, out: CONTENT_DIR };
    // A previous run's tree is dead weight on a storage-bounded origin, and a retry that starts on
    // a failed run's leftovers runs out of room the same way.
    await fs.rm(args.out);
    // Closing the tab kills this worker without unwinding, so the marker is what tells the next
    // visit that the tree it finds was never finished.
    const marker = vjoin(args.out, CONTENT_RUNNING_MARKER);
    await fs.writeFile(marker, new Uint8Array(0));
    await runPipeline(fs, args, progress);
    await fs.rm(marker);
  })().then(
    () => post({ kind: 'done' }),
    (error: unknown) => post({ kind: 'error', message: describeError(error) }),
  );
};
