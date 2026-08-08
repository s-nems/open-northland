import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { utilityProcess } from 'electron';
import type { PipelineEvent } from './ipc.js';

/**
 * Main-process side of the conversion: one `utilityProcess` child at a time, with its structured
 * events and stdio lines merged into one sink.
 */
export class PipelineHost {
  private child: Electron.UtilityProcess | undefined;
  /** Marks the live run finished so a deliberate `stop()` emits no trailing error event. */
  private silence: (() => void) | undefined;

  constructor(private readonly childScript: string) {}

  /** An undefined `modRoot` lets the child auto-detect the mod inside the game folder; the sink's
   * stream ends in `done` or `error` unless `stop()` silences the run. */
  start(
    gameDir: string,
    outDir: string,
    modRoot: string | undefined,
    sink: (event: PipelineEvent) => void,
  ): void {
    if (this.child !== undefined) throw new Error('pipeline already running');
    mkdirSync(outDir, { recursive: true });
    const child = utilityProcess.fork(this.childScript, [gameDir, outDir, modRoot ?? ''], {
      stdio: ['ignore', 'pipe', 'pipe'],
      serviceName: 'open-northland-pipeline',
    });
    this.child = child;
    let finished = false;
    this.silence = () => {
      finished = true;
    };
    const emit = (event: PipelineEvent): void => {
      if (finished) return;
      if (event.kind === 'done' || event.kind === 'error') finished = true;
      sink(event);
    };
    child.on('message', (message) => emit(message as PipelineEvent));
    for (const stream of [child.stdout, child.stderr]) {
      if (stream === null) continue;
      createInterface({ input: stream }).on('line', (line) => emit({ kind: 'log', line }));
    }
    child.on('exit', (code) => {
      this.child = undefined;
      // A crash without a structured done/error (OOM, kill) must still resolve the UI, so the exit
      // itself degrades to an error event.
      if (code !== 0 || !finished) {
        emit({ kind: 'error', message: `pipeline exited with code ${code}` });
      }
    });
  }

  /** Resolves after the child exits; the sink gets no terminal event, so the caller owns the UI
   * transition. */
  async stop(): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    this.child = undefined;
    this.silence?.();
    this.silence = undefined;
    child.kill();
    await once(child, 'exit');
  }
}
