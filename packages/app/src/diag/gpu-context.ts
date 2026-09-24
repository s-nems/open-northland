/** WebGL context loss on the game canvas, for the log ring: the browser and Pixi restore the context by
 *  themselves, so without this a diagnostics report says nothing of a lost and rebuilt frame. */
import { type DiagLog, diag } from './log.js';

/** Listens until `signal` aborts; `tick` dates each entry in sim ticks. */
export function logGpuContextLoss(
  canvas: EventTarget,
  tick: () => number,
  signal: AbortSignal,
  target: DiagLog = diag,
): void {
  canvas.addEventListener(
    'webglcontextlost',
    () => target.warn('gpu', 'webgl context lost', { tick: tick() }),
    {
      signal,
    },
  );
  canvas.addEventListener(
    'webglcontextrestored',
    () => target.info('gpu', 'webgl context restored', { tick: tick() }),
    { signal },
  );
}
