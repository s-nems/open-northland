import type { ShaderWarmup } from '@open-northland/render';
import { type DiagLog, diag } from '../../diag/log.js';

/**
 * Whether the world waits for its programs after the game canvas got its WebGL context back. Pixi
 * would link every program again in the first frame it draws, which blocks the page for seconds on
 * Direct3D, so the world stays still until `rewarm` has linked them, one per turn where the driver
 * cannot link off this thread; the HUD, sound and simulation run on. A stalled driver holds it no
 * longer than the warm-up waits for one.
 */
export function holdWorldAfterContextRestore(
  canvas: EventTarget,
  signal: AbortSignal,
  rewarm: () => ShaderWarmup,
  target: DiagLog = diag,
): () => boolean {
  let held = false;
  let restores = 0;
  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      const restore = ++restores;
      const startedAt = performance.now();
      const release = (): void => {
        // A later restore holds the world for its own warm-up.
        if (restore !== restores) return;
        held = false;
        target.info('gpu', 'world drawn again after the context restore', {
          heldMs: Math.round(performance.now() - startedAt),
        });
      };
      held = true;
      try {
        void rewarm().done.then(release, release);
      } catch (err) {
        // The renderer links what it needs itself, in the frame that draws it.
        target.error('gpu', 'shader warm-up after the context restore failed to start', err);
        release();
      }
    },
    { signal },
  );
  return () => held;
}
