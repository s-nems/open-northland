import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { utilityProcess } from 'electron';
import type { PipelineEvent } from './ipc.js';

/**
 * Main-process side of the conversion: forks the bundled pipeline child (`pipeline-child.cjs`) as a
 * `utilityProcess` and streams its structured events + stdio lines to one sink. One run at a time —
 * a second start while a child lives is a caller bug.
 */
export class PipelineHost {
  private child: Electron.UtilityProcess | undefined;

  constructor(private readonly childScript: string) {}

  get running(): boolean {
    return this.child !== undefined;
  }

  /** Fork the conversion of `gameDir` into `outDir`; every event lands in `sink` (ending in done/error). */
  start(
    gameDir: string,
    outDir: string,
    mod: string | undefined,
    sink: (event: PipelineEvent) => void,
  ): void {
    if (this.child !== undefined) throw new Error('pipeline already running');
    mkdirSync(outDir, { recursive: true });
    const child = utilityProcess.fork(this.childScript, [gameDir, outDir, mod ?? ''], {
      stdio: ['ignore', 'pipe', 'pipe'],
      serviceName: 'open-northland-pipeline',
    });
    this.child = child;
    let finished = false;
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
      // A structured done/error normally precedes exit; a crash without one (OOM, kill) must still
      // resolve the UI, so the exit itself degrades to an error event.
      if (code !== 0 || !finished) {
        emit({ kind: 'error', message: `pipeline exited with code ${code}` });
      }
    });
  }

  /** Kill a running conversion (window closed mid-run); resolves after the child exits. */
  async stop(): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    this.child = undefined;
    child.kill();
    await once(child, 'exit');
  }
}
